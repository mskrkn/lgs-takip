#!/usr/bin/env python3
"""EduPusula yedekleme: veritabani (sqlite online backup) + uploads klasoru.

Kullanim (VM'de, uygulama dizininde):
    python3 backup_db.py                      # ./yedekler/ altina yazar
    python3 backup_db.py /baska/dizin 14      # hedef dizin, saklanacak yedek sayisi

- Veritabani sqlite3 "backup" API'siyle kopyalanir: sunucu CALISIRKEN bile
  tutarli bir kopya alinir (dosyayi cp ile kopyalamak WAL modunda yarim/bozuk
  yedek uretebilir).
- Yedek alindiktan sonra kopya acilip PRAGMA integrity_check ve tablo/satir
  sayilari dogrulanir; dogrulama basarisizsa dosya SILINIR ve cikis kodu 1 olur.
- uploads/ (soru gorselleri, optik tarama fotograflari) tar.gz olarak arsivlenir.
- En yeni KEEP adet yedek saklanir, eskiler silinir.

Cron ornegi (her gece 03:15):
    15 3 * * * cd /home/mskrk/edupusula && /usr/bin/python3 backup_db.py >> yedekler/backup.log 2>&1
"""
import os
import sqlite3
import sys
import tarfile
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("EDUPUSULA_DB", os.path.join(BASE_DIR, "yetki_veritabani.db"))
UPLOADS = os.path.join(BASE_DIR, "uploads")
OMR_SCANS = os.path.join(BASE_DIR, "omr_scans")


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE_DIR, "yedekler")
    keep = int(sys.argv[2]) if len(sys.argv) > 2 else 14
    os.makedirs(dest, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if not os.path.exists(DB_PATH):
        print(f"HATA: veritabani bulunamadi: {DB_PATH}")
        return 1

    db_out = os.path.join(dest, f"db_{stamp}.sqlite")
    src = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=30)
    try:
        dst = sqlite3.connect(db_out)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()

    # Dogrulama: yedek gercekten acilabiliyor mu, butunlugu saglam mi?
    chk = sqlite3.connect(db_out)
    try:
        integrity = chk.execute("PRAGMA integrity_check").fetchone()[0]
        n_students = chk.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        n_users = chk.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        n_results = chk.execute("SELECT COUNT(*) FROM results").fetchone()[0]
    finally:
        chk.close()
    if integrity != "ok":
        os.remove(db_out)
        print(f"HATA: yedek butunluk kontrolunden gecemedi: {integrity}")
        return 1
    print(f"[{stamp}] DB yedegi OK: {db_out} ({os.path.getsize(db_out)//1024} KB) "
          f"ogrenci={n_students} kullanici={n_users} sonuc={n_results}")

    up_out = os.path.join(dest, f"uploads_{stamp}.tar.gz")
    with tarfile.open(up_out, "w:gz") as tar:
        for d in (UPLOADS, OMR_SCANS):
            if os.path.isdir(d):
                tar.add(d, arcname=os.path.basename(d))
    print(f"[{stamp}] Uploads yedegi OK: {up_out} ({os.path.getsize(up_out)//1024} KB)")

    for prefix in ("db_", "uploads_"):
        files = sorted(f for f in os.listdir(dest) if f.startswith(prefix))
        for old in files[:-keep]:
            os.remove(os.path.join(dest, old))
            print(f"eski yedek silindi: {old}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
