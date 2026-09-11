"""
Faz 3 (edupusula-drive-entegrasyon-prompt.md bolum 3): native question_bank
sorulari ile Drive Soru Havuzu (soru_havuzu_drive.py) sorularini ORTAK bir
DTO'ya donusturup birlestiren servis katmani.

ONEMLI - kesif notu: platformun curriculum_nodes agacindaki kodlar (orn.
"5.K01-K", "MAT.5.3.1") ile EduPusula Soru Merkezi'nin taksonomi
dosyasindaki kodlar (orn. "7.K03", "M.7.2.1.3") AYNI formatta degil - iki
taraf farkli zamanlarda/kaynaklardan seed edilmis. Yani iki kaynagin
konu_id/kazanim_kodu degerleri birebir string esitligiyle KARSILASTIRILAMAZ.
Bu modul sadece HER kaynagin KENDI dogal alanlarini tasiyan bir DTO uretir;
"ayni konu/kazanim" aramasi gereken ust katmanlar (Faz 6/7/8) konu_adi/
kazanim_adi gibi INSAN-OKUNABILIR alanlar uzerinden (gerekirse bulanik)
eslestirme yapmali, kod esitligine guvenmemeli.
"""

import soru_havuzu_drive

# Sartname bolum 3: iki kaynak da bu alanlarin TAMAMINI (degeri olmasa bile
# None olarak) tasir - cagiran kod kaynak ayrimi yapmadan tek bir listede
# islem yapabilir.
DTO_FIELDS = (
    "kaynak", "soru_referans_id", "display_id",
    "sinif_duzeyi", "ders", "konu_id", "konu_adi",
    "kazanim_kodu", "kazanim_adi", "zorluk_derecesi", "soru_turu",
    "dogru_cevap", "gorsel_url", "drive_file_id",
)


def _resolve_konu_kazanim(db, curriculum_node_id):
    """Bir question_curriculum_tags.is_primary=1 etiketinin isaret ettigi
    curriculum_nodes satirindan konu_id/konu_adi (+ varsa kazanim_kodu/
    kazanim_adi) cikarir. Node 'kazanim' seviyesindeyse konu bilgisi
    EBEVEYN node'dan gelir (agac: tema -> konu -> kazanim); node zaten
    'konu' (ya da 'tema') seviyesindeyse kazanim alanlari None kalir."""
    node = db.execute(
        "SELECT id, code, name, level, parent_id FROM curriculum_nodes WHERE id=?",
        (curriculum_node_id,),
    ).fetchone()
    if not node:
        return None, None, None, None
    if node["level"] == "kazanim" and node["parent_id"]:
        parent = db.execute(
            "SELECT code, name FROM curriculum_nodes WHERE id=?", (node["parent_id"],)
        ).fetchone()
        if parent:
            return parent["code"], parent["name"], node["code"], node["name"]
        return None, None, node["code"], node["name"]
    return node["code"], node["name"], None, None


def native_question_to_dto(db, row):
    """row: en az id, subject_name, grade_level, display_code,
    difficulty_level, question_type, correct_answer alanlarini iceren bir
    sqlite3.Row (bkz. fetch_native_questions_as_dto)."""
    konu_id = konu_adi = kazanim_kodu = kazanim_adi = None
    primary_tag = db.execute(
        "SELECT curriculum_node_id FROM question_curriculum_tags WHERE question_id=? AND is_primary=1",
        (row["id"],),
    ).fetchone()
    if primary_tag:
        konu_id, konu_adi, kazanim_kodu, kazanim_adi = _resolve_konu_kazanim(db, primary_tag["curriculum_node_id"])

    return {
        "kaynak": "native_db",
        "soru_referans_id": row["id"],
        "display_id": row["display_code"],
        "sinif_duzeyi": row["grade_level"],
        "ders": row["subject_name"],
        "konu_id": konu_id,
        "konu_adi": konu_adi,
        "kazanim_kodu": kazanim_kodu,
        "kazanim_adi": kazanim_adi,
        "zorluk_derecesi": row["difficulty_level"],
        "soru_turu": row["question_type"],
        "dogru_cevap": row["correct_answer"],
        # Bolum 4: native sorularda gorsel servis mekanizmasi DEGISMEZ, oldugu
        # gibi kullanilir (mevcut admin-only endpoint - bkz. Faz 3 kesif notu:
        # ogretmen tarafinda bugun icin ayri bir gorsel gosterim yolu yok,
        # bu doküman kapsaminda DEGISTIRILMIYOR).
        "gorsel_url": f"/api/admin/question-bank/image/{row['id']}",
        "drive_file_id": None,
    }


def drive_question_to_dto(item):
    """item: soru_havuzu_drive.get_all_questions() satirlarindan biri
    (zaten dict, Sheets kolonlariyla anahtarli)."""
    drive_file_id = item.get("drive_file_id")
    return {
        "kaynak": "drive_havuzu",
        "soru_referans_id": item.get("soru_id"),
        "display_id": item.get("display_id"),
        "sinif_duzeyi": item.get("sinif_duzeyi"),
        "ders": item.get("ders"),
        "konu_id": item.get("konu_id"),
        "konu_adi": item.get("konu_adi"),
        "kazanim_kodu": item.get("kazanim_kodu"),
        "kazanim_adi": item.get("kazanim_adi"),
        "zorluk_derecesi": item.get("zorluk_derecesi"),
        "soru_turu": item.get("soru_turu"),
        "dogru_cevap": item.get("dogru_cevap"),
        # Faz 4'te gercek bir proxy endpoint'e baglanacak (bkz. bolum 4) -
        # simdilik sozlesme/URL sekli burada sabitleniyor.
        "gorsel_url": f"/api/drive-havuzu/image/{drive_file_id}" if drive_file_id else None,
        "drive_file_id": drive_file_id,
    }


def fetch_native_questions_as_dto(db, org_id, *, sinif_duzeyi=None, subject_id=None):
    """Yayinlanmis (published) native sorulari DTO listesine cevirir.
    subject_id verilirse SQL'de filtrelenir (indeksli, ucuz); sinif_duzeyi
    verilirse SQL'de filtrelenir (question_bank.grade_level TEXT kolonu)."""
    query = (
        "SELECT qb.id, qb.display_code, qb.grade_level, qb.difficulty_level, "
        "qb.question_type, qb.correct_answer, s.name AS subject_name "
        "FROM question_bank qb JOIN subjects s ON s.id = qb.subject_id "
        "WHERE qb.organization_id = ? AND qb.status = 'published' "
    )
    params = [org_id]
    if subject_id:
        query += "AND qb.subject_id = ? "
        params.append(subject_id)
    if sinif_duzeyi:
        query += "AND qb.grade_level = ? "
        params.append(str(sinif_duzeyi))
    rows = db.execute(query, params).fetchall()
    return [native_question_to_dto(db, r) for r in rows]


def fetch_drive_questions_as_dto(*, sinif_duzeyi=None, ders=None):
    """Drive havuzundaki (cache'lenmis) sorulari DTO listesine cevirir.
    Sadece durum='Aktif' olanlar kullanilabilir - Pasif/Incelemede olanlar
    havuzdan disari birakilir (native'deki status='published' filtresiyle
    ayni rolu oynar). Filtreleme Sheets'te DEGIL, onbellek uzerinde
    (bolum 2) yapilir."""
    items = soru_havuzu_drive.get_all_questions()
    result = []
    for item in items:
        if (item.get("durum") or "").strip().lower() != "aktif":
            continue
        if sinif_duzeyi and str(item.get("sinif_duzeyi")) != str(sinif_duzeyi):
            continue
        if ders and (item.get("ders") or "").strip().lower() != ders.strip().lower():
            continue
        result.append(drive_question_to_dto(item))
    return result


def get_merged_questions(db, org_id, *, sinif_duzeyi=None, subject_id=None, ders=None):
    """Iki kaynagi BIRLESTIRIP tek bir DTO listesi dondurur (bolum 3).
    ders (string, orn. "Matematik") drive_havuzu filtrelemesi icin gerekli
    - subject_id (native'in integer FK'si) otomatik olarak bir isme
    cevrilmiyor; cagiran kod native ve drive filtrelerini AYNI dersi
    kastedecek sekilde birlikte vermeli (orn. subjects.name degeri)."""
    native = fetch_native_questions_as_dto(db, org_id, sinif_duzeyi=sinif_duzeyi, subject_id=subject_id)
    drive = fetch_drive_questions_as_dto(sinif_duzeyi=sinif_duzeyi, ders=ders)
    return native + drive
