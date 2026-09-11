"""
Drive Soru Havuzu entegrasyonu (2. Adim - edupusula-drive-entegrasyon-prompt.md).

EduPusula Soru Merkezi (ayri, local masaustu uygulamasi - bkz. 1. Adim,
edupusula-soru-merkezi-prompt.md) ogretmenlerin kestigi/etiketledigi sorulari
ortak bir Google Sheets index + Drive gorsel havuzuna YAZAR. Bu modul o
havuzu SADECE OKUR - hicbir yazma islemi yapmaz.

Servis hesabi anahtari repo'ya COMMIT EDILMEZ (bkz. .gitignore) - sunucuda
proje kokunde soru-havuzu-service-account.json olarak beklenir (ayni
firebase-adminsdk-key.json deseni). Yoksa (orn. yerel gelistirme veya henuz
kurulmamis) Drive havuzu sessizce devre disi kalir, sadece native question_bank
sorulari kullanilir (bkz. bolum 7 - hata/kullanilabilirlik senaryolari).
"""

import os
import threading
import time

SHEET_ID = os.environ.get("SORU_HAVUZU_SHEET_ID")
CACHE_TTL_SECONDS = int(os.environ.get("SORU_HAVUZU_CACHE_TTL_SECONDS", "300"))
SERVICE_ACCOUNT_KEY_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "soru-havuzu-service-account.json"
)
# Sartname bolum 17 (edupusula-soru-merkezi-prompt.md) - Sheets'teki gercek
# kolon sirasiyla BIREBIR eslesmeli.
SHEET_RANGE = "Sorular!A:Q"
SHEET_COLUMNS = [
    "soru_id", "display_id", "durum", "sinif_duzeyi", "ders",
    "konu_id", "konu_adi", "kazanim_kodu", "kazanim_adi",
    "zorluk_derecesi", "soru_turu", "dogru_cevap", "ocr_motoru",
    "drive_file_id", "yuklenme_tarihi", "yukleyen", "kaynak_pdf",
]

_sheets_service = None
_drive_service = None
# Sheets ve Drive icin AYRI basarisizlik bayraklari - biri coksa digeri
# gereksiz yere devre disi kalmasin (orn. Sheets kotasi dolsa bile gorsel
# proxy calismaya devam edebilmeli).
_sheets_init_failed = False
_drive_init_failed = False
_cache_lock = threading.Lock()
_cache = {"data": None, "fetched_at": 0.0, "last_error": None}


def is_configured():
    """Servis hesabi anahtari VE Sheet ID ikisi de tanimliysa True - bkz.
    bolum 15.1 (Soru Merkezi tarafinda tanimlanan) tek seferlik on kosul."""
    return bool(SHEET_ID) and os.path.exists(SERVICE_ACCOUNT_KEY_PATH)


def _get_credentials():
    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_KEY_PATH,
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
    )


def _init_sheets_service():
    global _sheets_service, _sheets_init_failed
    if _sheets_service is not None:
        return _sheets_service
    if _sheets_init_failed or not is_configured():
        return None
    try:
        from googleapiclient.discovery import build

        _sheets_service = build("sheets", "v4", credentials=_get_credentials(), cache_discovery=False)
        return _sheets_service
    except Exception as exc:
        _sheets_init_failed = True
        print(f"[soru-havuzu-drive] Sheets servisi baslatilamadi, Drive havuzu devre disi: {exc}")
        return None


def _init_drive_service():
    global _drive_service, _drive_init_failed
    if _drive_service is not None:
        return _drive_service
    if _drive_init_failed or not is_configured():
        return None
    try:
        from googleapiclient.discovery import build

        _drive_service = build("drive", "v3", credentials=_get_credentials(), cache_discovery=False)
        return _drive_service
    except Exception as exc:
        _drive_init_failed = True
        print(f"[soru-havuzu-drive] Drive servisi baslatilamadi, gorsel proxy devre disi: {exc}")
        return None


def fetch_drive_image_bytes(file_id):
    """Bolum 4: bir sorunun gorselini service account ile Drive'dan indirir.
    Donen deger: (bytes, mime_type) ya da dosya yoksa/erisilemezse None -
    cagiran taraf (server.py'deki proxy endpoint) None durumunda 404
    dondurmeli. Bu fonksiyon HICBIR onbellekleme YAPMAZ - disk cache
    server.py tarafinda (bolum 4: 'performans icin backend'de de
    cache'lenir') yonetilir, boylece cache dizini/TTL'i backend'in genel
    dosya sunma konvansiyonuyla (UPLOADS_DIR) tutarli kalir."""
    service = _init_drive_service()
    if service is None:
        return None
    try:
        import io as _io

        from googleapiclient.http import MediaIoBaseDownload

        meta = service.files().get(fileId=file_id, fields="mimeType,name").execute()
        mime_type = meta.get("mimeType") or "application/octet-stream"

        buffer = _io.BytesIO()
        request = service.files().get_media(fileId=file_id)
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _status, done = downloader.next_chunk()
        return buffer.getvalue(), mime_type
    except Exception as exc:
        print(f"[soru-havuzu-drive] Gorsel indirilemedi (file_id={file_id}): {exc}")
        return None


def _row_to_dict(row):
    padded = list(row) + [""] * (len(SHEET_COLUMNS) - len(row))
    return {col: (val if val != "" else None) for col, val in zip(SHEET_COLUMNS, padded)}


def _fetch_all_from_sheets():
    service = _init_sheets_service()
    if service is None:
        return []
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=SHEET_RANGE)
        .execute()
    )
    rows = result.get("values", [])
    if not rows:
        return []
    return [_row_to_dict(r) for r in rows[1:] if r]  # ilk satir baslik


def get_all_questions(force_refresh=False):
    """Sartname bolum 2: Sheets'in tamami TEK seferde cekilip kisa sureli
    (varsayilan 5 dakika, SORU_HAVUZU_CACHE_TTL_SECONDS ile ayarlanabilir)
    in-memory cache'de tutulur - sinif/konu/kazanim/zorluk filtrelemesi
    Sheets uzerinde degil, bu onbellek uzerinde cagiran kodda yapilir.
    Boylece akilli atama gibi tek istekte ogrenci basina ayri sorgu
    tetikleyen akislar (orn. 30 kisilik sinif) Sheets API kotasini
    doldurmaz - hepsi ayni 5 dakikalik pencerede TEK bir Sheets okumasini
    paylasir."""
    if not is_configured():
        return []
    with _cache_lock:
        now = time.time()
        if not force_refresh and _cache["data"] is not None and (now - _cache["fetched_at"]) < CACHE_TTL_SECONDS:
            return _cache["data"]
        try:
            data = _fetch_all_from_sheets()
            _cache["data"] = data
            _cache["fetched_at"] = now
            _cache["last_error"] = None
            return data
        except Exception as exc:
            _cache["last_error"] = str(exc)
            print(f"[soru-havuzu-drive] Sheets okunamadi: {exc}")
            # Bolum 7: gecici bir erisim sorununda elde varsa bir onceki
            # basarili cekimi kullanmaya devam ediyoruz (tamamen bos donup
            # zaten native'e dusecek olan cagiran kodu gereksiz yere
            # ekstra bir "hic soru yok" durumuna sokmamak icin) - cagiran
            # taraf get_status() ile bunun "stale" oldugunu ayrica gorebilir.
            return _cache["data"] if _cache["data"] is not None else []


def get_status():
    """Bolum 7/9: cagiran kod (merge katmani), ogretmene 'Drive havuzuna su
    an ulasilamiyor' uyarisi gosterip gostermeyecegine bununla karar verir."""
    with _cache_lock:
        return {
            "configured": is_configured(),
            "last_fetch_at": _cache["fetched_at"] or None,
            "last_error": _cache["last_error"],
            "has_data": _cache["data"] is not None,
        }


def invalidate_cache():
    """'Drive Havuzunu Yenile' butonu (bolum 2) - ogretmen az once Soru
    Merkezi'nden senkronize ettigi yeni sorulari hemen gormek isteyebilir."""
    with _cache_lock:
        _cache["data"] = None
        _cache["fetched_at"] = 0.0
