"""
LGS Deneme Takip Sistemi - Yetkilendirmeli Sunucu
====================================================
Bu dosya eski basit statik dosya sunucusunun yerine geçer.

Ne değişti?
  - Artık gerçek bir giriş (kullanıcı adı + şifre) sistemi var.
  - 3 rol tanımlı: admin, teacher (öğretmen), parent (veli/öğrenci).
  - Öğretmen ve veli/öğrenci hesapları SADECE kendilerine ait veriyi
    görebilir; bu filtreleme SUNUCU tarafında yapılır (tarayıcı
    konsolundan bile aşılamaz).
  - Admin (siz) mevcut uygulamayı (index.html) aynen kullanmaya devam
    eder; verileriniz yine tarayıcınızda (IndexedDB) tutulur, ama
    "Ayarlar" sayfasındaki yeni "Sunucuya Yükle" butonuyla verinizi
    öğretmen/veli erişimi için sunucudaki veritabanına gönderirsiniz.

İlk çalıştırmada otomatik olarak "admin" / "admin123" hesabı oluşturulur.
Giriş yaptıktan sonra Ayarlar > Kullanıcılar bölümünden şifrenizi
değiştirebilir ve öğretmen / veli hesapları oluşturabilirsiniz.
"""

import os
import re
import sys
import io
import csv
import json
import socket
import sqlite3
import secrets
import zipfile
import difflib
import threading
import webbrowser
from datetime import datetime, timedelta
from functools import wraps

# Konsolun kod sayfası UTF-8 olmayabilir (örn. Windows'ta chcp 65001
# çalıştırılmadan başlatılırsa); banner/log mesajlarındaki emoji ve Türkçe
# karakterler bu durumda print() sırasında UnicodeEncodeError ile sunucuyu
# başlamadan çökertebilir. Mümkünse stdout/stderr'i UTF-8'e zorla.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from flask import Flask, request, jsonify, session, send_from_directory, redirect, g, Response
except ImportError:
    print("\n❌ 'flask' kütüphanesi kurulu değil.")
    print("   Lütfen şu komutu çalıştırıp tekrar deneyin:")
    print("   pip install flask\n")
    sys.exit(1)

from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError, InvalidHash
except ImportError:
    print("\n❌ 'argon2-cffi' kütüphanesi kurulu değil.")
    print("   Lütfen şu komutu çalıştırıp tekrar deneyin:")
    print("   pip install argon2-cffi\n")
    sys.exit(1)

try:
    import pdf_question_extractor
except ImportError as exc:
    print(f"\n❌ Soru Havuzu PDF girişi için gerekli bir kütüphane kurulu değil ({exc}).")
    print("   Lütfen şu komutu çalıştırıp tekrar deneyin:")
    print("   pip install -r requirements.txt")
    print("   (Taranmış PDF'lerde OCR için ayrıca Tesseract-OCR programının da kurulu olması gerekir.)\n")
    sys.exit(1)

# AI destekli soru sınıflandırma (admin-panel-soru-havuzu-1.md) OPSİYONEL bir
# özellik - paket kurulu değilse ya da GEMINI_API_KEY ayarlanmamışsa sunucu
# ÇÖKMEMELİ, sadece o tek özellik (🤖 AI ile Sınıflandır butonu) devre dışı
# kalmalı. Bu yüzden pdf_question_extractor'ın aksine burada sys.exit YOK.
# Not (2026-09): Anthropic'ten Gemini'ye geçildi - Anthropic'te bakiye
# bitince özellik hiç fark edilmeden sessizce durmuştu (gerçek bir
# ücretsiz katmanı yoktu); Gemini'nin ücretsiz katmanı bu riski ortadan
# kaldırıyor.
try:
    from google import genai as gemini_sdk
    from google.genai import types as gemini_types
    from google.genai import errors as gemini_errors
    GEMINI_SDK_AVAILABLE = True
except ImportError:
    gemini_sdk = None
    gemini_types = None
    gemini_errors = None
    GEMINI_SDK_AVAILABLE = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "yetki_veritabani.db")
SECRET_PATH = os.path.join(BASE_DIR, ".flask_secret_key")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
QUESTION_IMAGES_DIR = os.path.join(UPLOADS_DIR, "questions")
PORT = int(os.environ.get("PORT", 8080))
_SERVER_STARTED_AT = datetime.now()

# development / staging / production - her checkout kendi ortamini
# EDUPUSULA_ENV ortam degiskeniyle bildirir (systemd servis dosyasinda
# Environment= ile ayarlanir). production disindaki ortamlarda karisikligi
# onlemek icin sayfalarin basina goze carpan bir seritli banner enjekte
# edilir - kodda dallanma yok, sadece gorsel isaret.
APP_ENV = os.environ.get("EDUPUSULA_ENV", "production")

app = Flask(__name__, static_folder=None)


@app.after_request
def _inject_env_banner(resp):
    # KRITIK: /api/* yanitlari HICBIR sekilde (tarayici HTTP cache'i, PWA
    # service worker'i, aradaki bir proxy) cache'lenmemeli - hepsi oturuma/
    # okula (organization_id) gore degisir. Bir tarayicida art arda farkli
    # okul hesaplariyla giris yapildiginda (bkz. sw.js'deki ayni gerekce)
    # onceki hesabin yaniti servis edilebilirdi. Bu, o sinif hatanin ikinci,
    # sunucu tarafli savunma katmani.
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
    if APP_ENV == "production":
        return resp
    if resp.content_type and resp.content_type.startswith("text/html"):
        banner = (
            f'<div style="position:fixed;top:0;left:0;right:0;z-index:999999;'
            f'background:#f59e0b;color:#1a1a1a;font:700 13px system-ui;'
            f'text-align:center;padding:4px 0;letter-spacing:.05em">'
            f'⚠️ {APP_ENV.upper()} ORTAMI — gercek veri degil</div>'
        )
        resp.direct_passthrough = False
        body = resp.get_data(as_text=True)
        if "<body" in body:
            resp.set_data(_insert_after_body_open(body, banner))
    return resp


def _insert_after_body_open(html, banner):
    idx = html.find("<body")
    if idx == -1:
        return html
    close_idx = html.find(">", idx)
    if close_idx == -1:
        return html
    insert_at = close_idx + 1
    return html[:insert_at] + banner + html[insert_at:]


@app.route("/api/meta")
def api_meta():
    return jsonify({"env": APP_ENV})


# ============================================================
# Şifre güvenliği: Argon2 (yeni) + eski werkzeug/pbkdf2 hash'lerine geriye
# dönük destek. Var olan kullanıcılar şifrelerini kaybetmez; bir sonraki
# başarılı girişlerinde hash'leri sessizce Argon2'ye yükseltilir.
# ============================================================

_argon2_hasher = PasswordHasher()


def hash_password(password):
    return _argon2_hasher.hash(password)


def verify_password(stored_hash, password):
    """(doğru_mu, yeniden_hash_gerekli_mi) döner. Eski pbkdf2 hash'i doğru
    şifreyle eşleşirse ikinci değer True olur - çağıran taraf hash'i
    Argon2 ile güncelleyip veritabanına yazmalıdır."""
    if stored_hash.startswith("$argon2"):
        try:
            _argon2_hasher.verify(stored_hash, password)
            return True, False
        except (VerifyMismatchError, InvalidHash):
            return False, False
    if check_password_hash(stored_hash, password):
        return True, True
    return False, False


def get_secret_key():
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, "r", encoding="utf-8") as f:
            key = f.read().strip()
            if key:
                return key
    key = secrets.token_hex(32)
    with open(SECRET_PATH, "w", encoding="utf-8") as f:
        f.write(key)
    return key


app.secret_key = get_secret_key()
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # Soru Havuzu PDF yükleme - kötüye kullanımı sınırlar


# ============================================================
# Firebase Admin SDK - bulut senkronizasyonu (js/sync.js) icin kimlik
# dogrulamali ozel token uretir (bkz. /api/firebase-token). Eskiden bu
# senkron Firestore'a HICBIR kimlik dogrulama olmadan, sadece tahmin
# edilebilir bir oda adiyla (organization_id) baglaniyordu - internetteki
# herkes baska bir okulun ogrenci verisini okuyup UZERINE YAZABILIYORDU.
# Servis hesabi anahtari repo'ya COMMIT EDILMEZ (bkz. .gitignore); sadece
# sunucuda proje kokunde firebase-adminsdk-key.json olarak beklenir. Yoksa
# (orn. yerel gelistirme) bulut senkronizasyonu sessizce devre disi kalir,
# uygulamanin geri kalani etkilenmez.
FIREBASE_ADMIN_KEY_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "firebase-adminsdk-key.json"
)
firebase_auth = None
if os.path.exists(FIREBASE_ADMIN_KEY_PATH):
    try:
        import firebase_admin
        from firebase_admin import credentials as _fb_credentials, auth as firebase_auth
        firebase_admin.initialize_app(_fb_credentials.Certificate(FIREBASE_ADMIN_KEY_PATH))
    except Exception as _fb_exc:
        print(f"[firebase-admin] baslatilamadi, bulut senkronizasyonu devre disi: {_fb_exc}")
        firebase_auth = None
else:
    print("[firebase-admin] firebase-adminsdk-key.json bulunamadi, bulut senkronizasyonu devre disi.")


# ============================================================
# Veritabanı
# ============================================================

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        # WAL: yazma islemleri okuyuculari kilitlemez (varsayilan 'delete'
        # modda TEK bir yazma tum okuma/yazmalari bloke ediyordu - 500
        # ogrenci + 10 admin eszamanli kullanimda "database is locked"
        # hatasina dogrudan yol aciyordu). WAL bir kez ayarlaninca DB
        # dosyasinda kalici olur (baglanti ozelligi degil), ama her
        # baglantida tekrar istemek zararsiz/idempotent.
        g.db.execute("PRAGMA journal_mode=WAL")
        # busy_timeout: WAL'da bile es zamanli iki YAZMA ayni anda olursa
        # (SQLite'ta tek yazici kurali hala gecerli) sqlite3 varsayilan
        # olarak ANINDA "database is locked" hatasi firlatirdi - bunun
        # yerine baglanti 5 saniyeye kadar diger yazicinin bitmesini bekler.
        g.db.execute("PRAGMA busy_timeout=5000")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _migrate_users_table(conn):
    """Var olan (önceki sürümden kalma) 'users' tablosunu veri kaybetmeden
    yeni sütun/CHECK ile uyumlu hale getirir. ÖNEMLİ: bu, parent_students gibi
    users'a FK ile bağlı başka tablolar oluşturulmadan ÖNCE çağrılmalıdır -
    aksi halde SQLite'ın "ALTER TABLE ... RENAME" sırasında bağımlı tablonun
    FK tanımını otomatik olarak geçici isme (users_old) güncellemesi, o
    geçici tablo silindiğinde kalıcı/kırık bir referans bırakır."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "active" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    if "email" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    if "phone" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    if "last_login" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN last_login TEXT")
    if "subject" not in cols:
        # Ogretmenin branşı (admin-panel-prompt.md bölüm 6 filtreleri icin) -
        # diger roller icin anlamsiz, NULL kalir.
        conn.execute("ALTER TABLE users ADD COLUMN subject TEXT")

    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()
    if row and "'student'" not in row[0]:
        conn.executescript(
            """
            ALTER TABLE users RENAME TO users_old;
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','teacher','parent','student')),
                display_name TEXT,
                class_name TEXT,
                student_id INTEGER,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT
            );
            INSERT INTO users (id, username, password_hash, role, display_name,
                                class_name, student_id, active, created_at)
                SELECT id, username, password_hash, role, display_name,
                       class_name, student_id, active, created_at FROM users_old;
            DROP TABLE users_old;
            """
        )
    conn.commit()

    # 'super_admin' rolu icin CHECK genisletmesi - coklu okul (organizations)
    # ozelliginin bir parcasi. organization_id sutunu bu noktada zaten var
    # olabilir (bu fonksiyon var olan bir kurulumda IKINCI kez, v2 migration
    # organization_id'yi ekledikten SONRAKI bir surumde calisirsa) - hardcoded
    # sutun listesi kullanirsak organization_id'yi SESSIZCE kaybederiz, bu
    # yuzden PRAGMA table_info ile var olup olmadigini kontrol edip koruyoruz.
    #
    # ONEMLI: "ALTER TABLE users RENAME TO users_old" KULLANMIYORUZ - bu
    # noktada user_roles/teacher_profiles/parent_profiles gibi v2 tablolari
    # zaten "REFERENCES users(id)" ile var olabilir, ve SQLite bir tabloyu
    # yeniden adlandirinca ona referans veren BASKA tablolarin FK metnini
    # otomatik olarak yeni isme (users_old) gunceller; DROP TABLE users_old
    # sonrasi bu tablolar kalici olarak kirik bir referansta ("no such
    # table: users_old") kalir - _fix_parent_students_fk'nin duzelttigi
    # sorunun ta kendisi, farkli bir tabloda. Bunun yerine "users" adini
    # HIC yeniden adlandirmadan (yeni tabloyu gecici bir adla olusturup,
    # eskisini SILIP, sonra gecici olani "users"a yeniden adlandirarak)
    # bu tuzaktan tamamen kaciniyoruz.
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()
    if row and "'super_admin'" not in row[0]:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        has_org = "organization_id" in cols
        has_contact = "email" in cols and "phone" in cols
        has_subject = "subject" in cols
        org_col_def = ",\n                organization_id INTEGER REFERENCES organizations(id)" if has_org else ""
        org_col_name = ", organization_id" if has_org else ""
        contact_col_def = ",\n                email TEXT,\n                phone TEXT" if has_contact else ""
        contact_col_name = ", email, phone" if has_contact else ""
        subject_col_def = ",\n                subject TEXT" if has_subject else ""
        subject_col_name = ", subject" if has_subject else ""
        conn.executescript(
            f"""
            CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('super_admin','admin','teacher','parent','student')),
                display_name TEXT,
                class_name TEXT,
                student_id INTEGER,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT{org_col_def}{contact_col_def}{subject_col_def}
            );
            INSERT INTO users_new (id, username, password_hash, role, display_name,
                                    class_name, student_id, active, created_at{org_col_name}{contact_col_name}{subject_col_name})
                SELECT id, username, password_hash, role, display_name,
                       class_name, student_id, active, created_at{org_col_name}{contact_col_name}{subject_col_name} FROM users;
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;
            """
        )
        conn.commit()


def _fix_parent_students_fk(conn):
    """Yukarıdaki users yeniden-adlandırma adımı geçmişte parent_students
    oluşturulduktan SONRA çalıştıysa, parent_students.parent_user_id'nin FK
    tanımı SQLite tarafından otomatik olarak 'users_old' üzerine
    güncellenmiş ve o tablo silinince sahipsiz kalmış olabilir (örn:
    "no such table: main.users_old" hatası). Böyle bozuk bir referans
    tespit edilirse tabloyu veri kaybı olmadan doğru referansla yeniden kurar."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='parent_students'"
    ).fetchone()
    if row and "users_old" in row[0]:
        conn.executescript(
            """
            ALTER TABLE parent_students RENAME TO parent_students_broken;
            CREATE TABLE parent_students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                UNIQUE(parent_user_id, student_id)
            );
            INSERT INTO parent_students (id, parent_user_id, student_id)
                SELECT id, parent_user_id, student_id FROM parent_students_broken;
            DROP TABLE parent_students_broken;
            """
        )
        conn.commit()


def _backfill_parent_students(conn):
    """Eski tekli veli->öğrenci bağlantısını (users.student_id) yeni
    çoklu-çocuk tablosuna (parent_students) geriye dönük uyumlu aktarır."""
    parents = conn.execute(
        "SELECT id, student_id FROM users WHERE role = 'parent' AND student_id IS NOT NULL"
    ).fetchall()
    for user_id, student_id in parents:
        conn.execute(
            "INSERT OR IGNORE INTO parent_students (parent_user_id, student_id) VALUES (?,?)",
            (user_id, student_id),
        )
    conn.commit()


# ============================================================
# EduPusula v2: Çok-kurumlu / RBAC / normalize edilmiş veri modeli
# ============================================================
# ÖNEMLİ MİMARİ KARAR: users/students/exams/results tabloları hâlâ asıl
# "kaynak" (source of truth) olarak kalır - hiçbir satır silinmez/anlamı
# değişmez, /api/admin/sync hâlâ aynı şekilde çalışır. Aşağıdaki tablolar
# bunlardan TÜRETİLEN (derived) bir katmandır: her sunucu başlangıcında ve
# her admin senkronundan sonra yeniden hesaplanır. Böylece iki taraf hep
# tutarlı kalır ve ham veri hiçbir zaman tek kopyada yaşamaz.
#
# İstisna: student_enrollments (sınıf geçmişi) - bu, bilinçli olarak
# türetilmiş-ama-append-only bir tablodur: bir öğrencinin sınıfı değişince
# eski kaydı SİLİNMEZ, "completed" olarak kapatılır ve yeni bir "active"
# kayıt açılır. Bu, spesifikasyonun "sınıf geçmişi kaybolmamalı" gereksinimini
# doğrudan karşılar.

SUBJECT_SEED = [
    ("turkce", "Türkçe"), ("inkilap", "T.C. İnkılap Tarihi"), ("din", "Din Kültürü"),
    ("ingilizce", "İngilizce"), ("matematik", "Matematik"), ("fen", "Fen Bilimleri"),
    ("tyt_turkce", "Türkçe"), ("tyt_sosyal", "Sosyal Bilimler"),
    ("tyt_matematik", "Temel Matematik"), ("tyt_fen", "Fen Bilimleri"),
    ("ayt_matematik", "Matematik"), ("ayt_fizik", "Fizik"), ("ayt_kimya", "Kimya"),
    ("ayt_biyoloji", "Biyoloji"), ("ayt_edebiyat_sos1", "Türk Dili ve Edebiyatı - Sosyal Bilimler 1"),
    ("ayt_tarih1", "Tarih-1"), ("ayt_cografya1", "Coğrafya-1"), ("ayt_tarih2", "Tarih-2"),
    ("ayt_cografya2", "Coğrafya-2"), ("ayt_felsefe", "Felsefe Grubu"), ("ayt_din", "Din Kültürü (Seçmeli)"),
]

# seeds/curriculum_seed.json'daki kısa ders etiketini (ör. "MAT") subjects.code'a
# eşler - seed dosyasını her ders için ayrıca yeniden kodlamamak için.
CURRICULUM_SEED_SUBJECT_MAP = {"MAT": "matematik"}


def _load_curriculum_seed(conn):
    """seeds/curriculum_seed.json içindeki MEB müfredat ağacını (tema/konu/
    kazanım) curriculum_nodes'a idempotent şekilde yükler. Dosya sort_order'a
    göre üst düğüm alt düğümden önce geldiğinden, tek geçişte code->id
    haritası kurarak parent_id çözülür."""
    seed_path = os.path.join(BASE_DIR, "seeds", "curriculum_seed.json")
    if not os.path.exists(seed_path):
        return
    with open(seed_path, encoding="utf-8") as f:
        entries = json.load(f)

    subject_ids = {code: row["id"] for code, row in (
        (code, conn.execute("SELECT id FROM subjects WHERE code=?", (code,)).fetchone())
        for code in set(CURRICULUM_SEED_SUBJECT_MAP.values())
    ) if row}

    now = datetime.now().isoformat()
    code_to_id = {}
    for entry in entries:
        subject_code = CURRICULUM_SEED_SUBJECT_MAP.get(entry["subject"], entry["subject"])
        subject_id = subject_ids.get(subject_code)
        if not subject_id:
            continue
        parent_id = code_to_id.get(entry["parent_code"]) if entry["parent_code"] else None
        conn.execute(
            "INSERT INTO curriculum_nodes (code, parent_id, level, subject_id, grade_level, name, sort_order, created_at) "
            "VALUES (?,?,?,?,?,?,?,?) "
            "ON CONFLICT(code) DO UPDATE SET parent_id=excluded.parent_id, level=excluded.level, "
            "subject_id=excluded.subject_id, grade_level=excluded.grade_level, name=excluded.name, "
            "sort_order=excluded.sort_order",
            (entry["code"], parent_id, entry["level"], subject_id, str(entry["grade"]), entry["name"],
             entry["sort_order"], now),
        )
        row = conn.execute("SELECT id FROM curriculum_nodes WHERE code=?", (entry["code"],)).fetchone()
        code_to_id[entry["code"]] = row["id"]


ROLE_SEED = ["SUPER_ADMIN", "PLATFORM_ADMIN", "ASSISTANT_ADMIN", "INSTITUTION_ADMIN",
             "SCHOOL_ADMIN_DELEGATE", "DATA_ADMIN", "COORDINATOR", "TEACHER", "PARENT", "STUDENT"]

PERMISSION_SEED = [
    "students.view", "students.create", "students.update", "students.delete",
    "students.archive", "students.view_academic_data",
    "classes.view", "classes.create", "classes.update", "classes.delete", "classes.archive",
    "exams.view", "exams.create", "exams.update", "exams.delete",
    "exams.import", "exams.view_results",
    "results.view", "results.create", "analytics.view", "organization.manage", "users.manage",
    "users.view", "users.create", "users.update", "users.deactivate", "users.assign_role",
    "admins.manage",
    "organizations.view", "organizations.create", "organizations.update", "organizations.archive",
    "teachers.view", "teachers.create", "teachers.update", "teachers.manage_assignments",
    "questions.view", "questions.create", "questions.update", "questions.delete",
    "questions.submit_review", "questions.approve", "questions.publish", "questions.view_assigned",
    "assignments.view", "assignments.create", "assignments.update", "assignments.cancel",
    "assignments.view_results", "assignments.complete",
    "analytics.student", "analytics.class", "analytics.school", "analytics.global",
    "ai.analyze", "ai.generate_question", "ai.generate_assignment", "ai.manage", "ai.analyze_self",
    "system.settings", "system.logs", "system.manage",
]

# Platform (okul-ustu) duzeyi izinler - hicbir okul admininin KENDI okuluyla
# ilgisi yok, ROLE_PERMISSIONS_SEED'de INSTITUTION_ADMIN'den bilerek
# cikarilir (bkz. asagisi). organization.manage = "baska bir okulun
# VERISINI goruntule/yonet" (_effective_org_id'nin ?school_id= override
# gate'i). organizations.* = "organizations TABLOSUNUN kendisini (ad/
# iletisim/durum) yonet". analytics.global/system.*/ai.manage = platform
# geneli, tek bir okulla sinirli olmayan yetkiler. admins.manage = admin
# hesabi olusturma/duzenleme/pasiflestirme (bkz. ASSIGNABLE_ADMIN_SUBROLES) -
# KRITIK: bu listede olmasi sart, aksi halde INSTITUTION_ADMIN'in izin kumesi
# (= PERMISSION_SEED - PLATFORM_ONLY_PERMISSIONS) admins.manage'i SESSIZCE
# icerir ve herhangi bir okul admini baska admin hesaplari olusturabilir/
# silebilir hale gelir (IDOR/yetki yukseltme). Hepsi SUPER_ADMIN/PLATFORM_ADMIN'de;
# admins.manage HARIC hepsi ayrica ASSISTANT_ADMIN'de de (bkz. asagisi).
PLATFORM_ONLY_PERMISSIONS = [
    "organization.manage", "organizations.view", "organizations.create",
    "organizations.update", "organizations.archive", "admins.manage",
    "analytics.global", "system.settings", "system.logs", "system.manage", "ai.manage",
]

ROLE_PERMISSIONS_SEED = {
    "SUPER_ADMIN": PERMISSION_SEED,
    "PLATFORM_ADMIN": PERMISSION_SEED,
    # Platform sahibi bir admin'e PLATFORM_ONLY_PERMISSIONS ozel olarak
    # PLATFORM_ADMIN v2 rolu EK OLARAK atanarak verilir (bkz.
    # grant_platform_admin.py) - legacy role='admin' degismez. Aksi halde
    # (bu liste PERMISSION_SEED'in tamami olsaydi) her okul admini bir
    # digerinin school_id'sini enjekte edip/organizations ucuna erisip
    # baska okulun verisine ulasabilirdi (IDOR).
    #
    # Admin Yardimcisi (admin-panel-prompt.md bolum 1) - PLATFORM_ADMIN ile
    # AYNI kapsam (tum okullar, sistem loglari, vs.) ama "admins.manage"
    # HARIC: yeni admin hesabi olusturamaz/silemez/duzenleyemez. PLATFORM_ADMIN
    # bilerek degistirilmedi (bugunku platform sahibi hesabi zaten o v2 rolu
    # tasiyor, admins.manage'i PERMISSION_SEED'e eklemek ona otomatik gecti);
    # bu yuzden ayri, katilimci bir rol.
    "ASSISTANT_ADMIN": [p for p in PERMISSION_SEED if p != "admins.manage"],
    "INSTITUTION_ADMIN": [p for p in PERMISSION_SEED if p not in PLATFORM_ONLY_PERMISSIONS],
    # Veri girisi personeli (Excel/optik/PDF aktarimi, ogrenci kaydi) -
    # organizasyon ayarlarina/kullanici yetkilerine dokunamaz. NOT: legacy
    # role='admin' uzerine ek v2 rol olarak verilecekse (grant_data_admin.py),
    # bugun admin panelinin cogu ucu SADECE role="admin" kontrol ediyor,
    # permission= DEGIL - bu yuzden DATA_ADMIN'e bu rolu vermek onu GERCEKTEN
    # daraltmaz (hala tam admin gibi davranir), ta ki o uclar tek tek
    # permission= ile de korunana kadar (ayri, gelecekteki bir is). Bu liste
    # simdilik SADECE has_permission() kontrollerinin dogru calismasi icin var.
    "DATA_ADMIN": ["students.view", "students.create", "students.update",
                   "exams.view", "exams.import", "exams.update"],
    # Ogrenci gelisimini/sinif-okul analizini izleyen, veri GIRMEYEN rol.
    # Legacy role='teacher' uzerine ek v2 rol olarak verilir (grant_coordinator.py) -
    # ogretmen paneli/oturumu degismez, sadece org-genelinde salt-okunur
    # analiz gorunurlugu ekler.
    "COORDINATOR": ["students.view", "analytics.student", "analytics.class",
                    "analytics.school", "assignments.view"],
    "TEACHER": [
        "students.view", "students.view_academic_data",
        "classes.view", "exams.view", "results.view", "analytics.view",
        "questions.view", "questions.create", "questions.update",
        "assignments.view", "assignments.create", "assignments.update",
        "assignments.cancel", "assignments.view_results",
        "analytics.student", "analytics.class",
        "ai.analyze", "ai.generate_question", "ai.generate_assignment",
    ],
    "PARENT": ["results.view", "analytics.view", "students.view",
               "assignments.view", "analytics.student"],
    "STUDENT": ["results.view", "analytics.view", "assignments.view", "assignments.complete",
                "analytics.student", "questions.view_assigned", "ai.analyze_self"],
    # Okul admini kendi ogretmenlerinden birine "hesap ekleme" yetkisi
    # devredebilir - bkz. /api/admin/users/<id>/delegate. Legacy role hala
    # 'teacher' kalir (ogretmen paneli/oturumu degismez), bu SADECE ek bir
    # v2 rol atamasidir (LEGACY_ROLE_TO_NEW_ROLE'a EKLENMEZ - otomatik
    # atanmaz, sadece admin'in acikca verdigi bir yetki).
    "SCHOOL_ADMIN_DELEGATE": ["users.manage", "students.create", "students.view"],
}

LEGACY_ROLE_TO_NEW_ROLE = {
    "super_admin": "SUPER_ADMIN",
    "admin": "INSTITUTION_ADMIN", "teacher": "TEACHER", "parent": "PARENT", "student": "STUDENT",
}


def _create_v2_tables(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            short_name TEXT,
            type TEXT,
            slug TEXT UNIQUE NOT NULL,
            logo_url TEXT, email TEXT, phone TEXT, address TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            archived_at TEXT
        );

        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS role_permissions (
            role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
            PRIMARY KEY (role_id, permission_id)
        );

        CREATE TABLE IF NOT EXISTS user_roles (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, role_id)
        );

        CREATE TABLE IF NOT EXISTS academic_years (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            start_date TEXT, end_date TEXT,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            grade_level TEXT,
            academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(organization_id, name, academic_year_id)
        );

        CREATE TABLE IF NOT EXISTS teacher_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            employee_number TEXT, specialization TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS student_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            legacy_student_id INTEGER UNIQUE REFERENCES students(id) ON DELETE CASCADE,
            student_number TEXT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
            birth_date TEXT, status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS parent_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );

        -- subject_id: Yetki Matrisi Faz 4 - "hangi ogretmen hangi dersi hangi
        -- sinifa okutuyor" (TEACHER_ASSIGNMENTS) icin rezerve edilmis kolon.
        -- Su an HICBIR kod yolu bunu yazmiyor/okumuyor (bkz. asagidaki NOT) -
        -- bu tabloyu zaten dolduran sync_derived_tables() sadece class_name
        -- string'inden turetiyor, ders bilgisi hic yok. Gercek kullanim icin
        -- once bir ogretmene ders atama UI'i gerekir (ayri, gelecekteki is).
        CREATE TABLE IF NOT EXISTS teacher_classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
            subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            UNIQUE(teacher_id, class_id, academic_year_id)
        );

        CREATE TABLE IF NOT EXISTS student_enrollments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
            class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
            start_date TEXT, end_date TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exam_subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            question_count INTEGER,
            UNIQUE(exam_id, subject_id)
        );

        CREATE TABLE IF NOT EXISTS exam_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            total_correct REAL, total_wrong REAL, total_blank REAL, total_net REAL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(exam_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS exam_subject_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_result_id INTEGER NOT NULL REFERENCES exam_results(id) ON DELETE CASCADE,
            subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            correct REAL, wrong REAL, blank REAL, net REAL,
            UNIQUE(exam_result_id, subject_id)
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
            question_number INTEGER, topic TEXT, difficulty TEXT
        );

        CREATE TABLE IF NOT EXISTS student_question_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            answer TEXT, is_correct INTEGER,
            created_at TEXT NOT NULL,
            UNIQUE(student_id, question_id)
        );

        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            file_name TEXT, file_type TEXT, file_path TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            total_records INTEGER DEFAULT 0, success_records INTEGER DEFAULT 0, failed_records INTEGER DEFAULT 0,
            created_at TEXT NOT NULL, completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS import_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
            row_number INTEGER, raw_data TEXT, status TEXT, error_message TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS performance_insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
            topic TEXT, insight_type TEXT NOT NULL,
            confidence_level REAL, based_on_exam_count INTEGER,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );

        -- Odev (assignment) modulu: icerik kaynagi question_bank (status='approved'
        -- olanlar) - eski/olu 'questions' tablosuna KASITLI OLARAK dokunulmuyor,
        -- o her sync'te silinip yeniden kuruluyor. class_name TEXT (classes.id
        -- DEGIL) - ogretmen erisimi zaten class_name string'ine dayanan
        -- teacher_class_list() ile calisiyor (bkz. get_allowed_student_ids),
        -- ayni deseni tekrar kullanmak yeni bir id-cozumleme katmani eklemekten
        -- daha az riskli.
        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            class_name TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            due_date TEXT,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assignment_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            question_bank_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS assignment_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            question_bank_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            answer TEXT,
            is_correct INTEGER,
            submitted_at TEXT NOT NULL,
            UNIQUE(assignment_id, student_id, question_bank_id)
        );

        CREATE TABLE IF NOT EXISTS ai_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
            conversation_type TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL, content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL, resource_type TEXT, resource_id INTEGER,
            ip_address TEXT, metadata TEXT, created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type TEXT NOT NULL, title TEXT NOT NULL, message TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
    )
    for table in ("users", "students", "exams", "results"):
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if "organization_id" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN organization_id INTEGER REFERENCES organizations(id)")
    # Kritik #8 (500 ogrenci + 10 admin olcek analizi): organization_id/
    # student_id/exam_id SQLite'ta FK oldugu icin OTOMATIK indekslenmiyor -
    # bu sutunlara filtreleyen HER sorgu (dashboard'lar, "kendi okulunun
    # ogrencileri" listeleri, sonuc/karsilastirma raporlari) tam tablo
    # taramasi yapiyordu. Veri hacmi arttikca yavaslamayi onceden onlemek
    # icin - IF NOT EXISTS oldugu icin zararsiz/tekrar calistirilabilir.
    for table in ("users", "students", "exams", "results"):
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_org ON {table}(organization_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_results_exam ON results(exam_id)")
    # students/exams/results.source: bu satir okulun kendi tarayici senkronundan
    # mi ('browser_sync', varsayilan - mevcut TUM veri bu sekilde damgalanir)
    # yoksa platform sahibinin dogrudan girdisinden mi ('platform_admin') geldi.
    # api_admin_sync'in DELETE'leri SADECE 'browser_sync' satirlarini siler,
    # yani platform sahibinin ekledigi kayitlar bir okulun kendi senkronuyla
    # asla silinmez (bkz. _platform_admin_next_id).
    for table in ("students", "exams", "results"):
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if "source" not in cols:
            conn.execute(
                f"ALTER TABLE {table} ADD COLUMN source TEXT NOT NULL DEFAULT 'browser_sync'"
            )
    org_cols = [r[1] for r in conn.execute("PRAGMA table_info(organizations)").fetchall()]
    if "teacher_invite_code" not in org_cols:
        # SQLite "ALTER TABLE ... ADD COLUMN" bir UNIQUE kisitiyla dogrudan
        # calismiyor ("Cannot add a UNIQUE column") - once duz sutunu ekleyip
        # ayri bir UNIQUE INDEX ile benzersizligi sagliyoruz (NULL degerler
        # bu index'te birbirinden farkli sayilir, yani kod atanmamis okullar
        # cakismaz).
        conn.execute("ALTER TABLE organizations ADD COLUMN teacher_invite_code TEXT")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_org_teacher_invite_code "
            "ON organizations(teacher_invite_code)"
        )
    conn.commit()


def _create_invite_tables(conn):
    """Veli/ogrenci kendi kendine kayit icin ogrenciye ozel davet token'lari.
    Ogretmen daveti (okul geneli tek kod) organizations.teacher_invite_code'da
    tutulur (yukarida _create_v2_tables) - ogretmen belirli bir students
    satirina bagli olmadigi icin ayri bir tabloya gerek yok."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS student_invite_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            token TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            revoked_at TEXT
        );
        """
    )
    conn.commit()


# ============================================================
# Soru Havuzu (EduPusula Adaptif Öğrenme Motoru - Aşama 1)
# ============================================================
# ÖNEMLİ: Bu tablolar questions/student_question_results'tan TAMAMEN
# BAĞIMSIZDIR ve kasıtlı olarak farklı isimlendirilmiştir. questions ve
# student_question_results, sync_derived_tables() içinde her sunucu
# başlangıcında ve her /api/admin/sync çağrısında SİLİNİP YENİDEN KURULUR
# (bkz. yukarısı, satır ~628) - buraya gerçek soru verisi yazsaydık her
# yeniden başlatmada sessizce kaybolurdu. question_bank ve ilişkili
# tablolar bu döngünün tamamen dışında durur; hiçbir yerde DELETE FROM
# question_bank / question_import_batches / topics / learning_outcomes
# çağrısı YAPILMAMALIDIR.
def _create_question_bank_tables(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS grade_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(subject_id, name)
        );

        -- admin-panel-soru-havuzu-2 bolum 10.3: beceri (skill) sistemi.
        -- organization_id BILEREK YOK - merkezi soru bankasi gibi TUM
        -- okullarda ortak/paylasilan bir kaynak. Ogretmenler de yeni beceri
        -- ONERebilir (created_by bir ogretmen olabilir), ama onay hala
        -- ayni "dort goz" mantigiyla bir admin tarafindan verilir (bkz.
        -- _check_four_eyes ile ayni desen, questions.approve izniyle).
        CREATE TABLE IF NOT EXISTS skills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'pending_review'
                CHECK(status IN ('pending_review','active','rejected')),
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            rejection_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        -- Bir soru birden fazla beceri olcebilir; agirliklar (weight, 0-100)
        -- toplami %100 olmali - bu VERITABANI seviyesinde degil, yazma
        -- ucunda (api_question_bank_set_skills) dogrulanir (SQLite CHECK
        -- birden fazla satir arasi toplami kontrol edemez).
        CREATE TABLE IF NOT EXISTS question_skills (
            question_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            weight REAL NOT NULL,
            PRIMARY KEY (question_id, skill_id)
        );

        -- admin-panel-soru-havuzu-2 bolum 10.6: HER anlamli ogrenci cozumu
        -- (su an icin sadece odev cevaplari - bkz. api_student_submit_assignment)
        -- burada EKLENIR, assignment_submissions gibi UZERINE YAZILMAZ - mastery
        -- hesabi tam deneme GECMISINE ihtiyac duyar. difficulty/pattern
        -- ATTEMPT ANINDAKI degeri ile DENORMALIZE edilir (question_bank.difficulty
        -- sonradan degisirse gecmis mastery hesaplari kaymasin diye).
        CREATE TABLE IF NOT EXISTS student_question_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
            exam_id INTEGER,
            answer TEXT,
            is_correct INTEGER,
            score REAL,
            difficulty_at_attempt TEXT,
            question_pattern_at_attempt TEXT,
            started_at TEXT,
            answered_at TEXT NOT NULL,
            duration_seconds INTEGER,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sqa_student_question
            ON student_question_attempts(student_id, question_id);
        CREATE INDEX IF NOT EXISTS idx_sqa_student_answered
            ON student_question_attempts(student_id, answered_at);

        -- Beceri basina onbelleklenmis mastery - her attempt sonrasi
        -- _recompute_student_skill_mastery ile yeniden hesaplanir, boylece
        -- mastery sorgulari (ogretmen paneli, gelecekteki adaptif motor)
        -- her seferinde tum attempt gecmisini taramak zorunda kalmaz.
        CREATE TABLE IF NOT EXISTS student_skills (
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            mastery_percentage REAL NOT NULL DEFAULT 0,
            attempts_count INTEGER NOT NULL DEFAULT 0,
            distinct_patterns_count INTEGER NOT NULL DEFAULT 0,
            mastery_confirmed INTEGER NOT NULL DEFAULT 0,
            confirmed_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (student_id, skill_id)
        );

        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(subject_id, name)
        );

        CREATE TABLE IF NOT EXISTS learning_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(topic_id, name)
        );

        -- MEB müfredat ağacı (tema/konu/kazanım) - topics/learning_outcomes'ın
        -- (yukarıda, hâlâ boş) yerini alan asıl taksonomi. seeds/curriculum_seed.json
        -- içinden _load_curriculum_seed() ile idempotent şekilde doldurulur.
        CREATE TABLE IF NOT EXISTS curriculum_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            parent_id INTEGER REFERENCES curriculum_nodes(id) ON DELETE CASCADE,
            level TEXT NOT NULL CHECK(level IN ('tema','konu','kazanim')),
            subject_id INTEGER NOT NULL REFERENCES subjects(id),
            grade_level TEXT NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_curriculum_nodes_parent ON curriculum_nodes(parent_id);
        CREATE INDEX IF NOT EXISTS idx_curriculum_nodes_subject_grade ON curriculum_nodes(subject_id, grade_level);

        -- Bir sorunun birden çok kazanıma (ağırlıklı) etiketlenmesi -
        -- question_bank.topic_id/learning_outcome_id (tekli, hep NULL) yerine.
        CREATE TABLE IF NOT EXISTS question_curriculum_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            curriculum_node_id INTEGER NOT NULL REFERENCES curriculum_nodes(id) ON DELETE RESTRICT,
            weight REAL NOT NULL DEFAULT 1.0 CHECK(weight > 0 AND weight <= 1),
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            UNIQUE(question_id, curriculum_node_id)
        );

        CREATE INDEX IF NOT EXISTS idx_qct_question ON question_curriculum_tags(question_id);
        CREATE INDEX IF NOT EXISTS idx_qct_node ON question_curriculum_tags(curriculum_node_id);
        -- Soru başına en fazla bir birincil (is_primary=1) etiket.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_qct_one_primary
            ON question_curriculum_tags(question_id) WHERE is_primary = 1;

        CREATE TABLE IF NOT EXISTS question_import_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            source_filename TEXT NOT NULL,
            page_count INTEGER,
            status TEXT NOT NULL DEFAULT 'processing'
                CHECK(status IN ('processing','ready_for_review','completed','failed')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS question_booklet_numbers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            booklet_code TEXT NOT NULL,
            question_number INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(question_id, booklet_code)
        );

        CREATE TABLE IF NOT EXISTS question_bank (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            batch_id INTEGER REFERENCES question_import_batches(id) ON DELETE SET NULL,
            display_code TEXT UNIQUE,

            subject_id INTEGER NOT NULL REFERENCES subjects(id),
            grade_level TEXT,
            topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
            learning_outcome_id INTEGER REFERENCES learning_outcomes(id) ON DELETE SET NULL,

            question_type TEXT,
            difficulty_level INTEGER,
            tags TEXT,

            image_path TEXT NOT NULL,
            source_page_number INTEGER,
            crop_x REAL, crop_y REAL, crop_width REAL, crop_height REAL,
            question_text TEXT,

            correct_answer TEXT,
            correct_answer_source TEXT CHECK(correct_answer_source IN ('answer_key','manual','edited')),
            explanation TEXT,

            status TEXT NOT NULL DEFAULT 'pending_review'
                CHECK(status IN ('pending_review','reviewed','excluded','approved','published','archived')),
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TEXT,
            published_at TEXT,
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    # Var olan kurulumlarda (question_number sütunu eklenmeden önce
    # oluşturulmuş question_bank tablosu) veri kaybetmeden sütunu ekler -
    # bu sütun olmadan "Soru 12" gibi orijinal numara PNG dosya adından
    # başka hiçbir yerde tutulmuyordu.
    qb_cols = [r[1] for r in conn.execute("PRAGMA table_info(question_bank)").fetchall()]
    if qb_cols and "question_number" not in qb_cols:
        conn.execute("ALTER TABLE question_bank ADD COLUMN question_number INTEGER")

    # admin-panel-soru-havuzu-1.md: ünite seviyesi (konu'nun üstünde, ders'in
    # altında) + AI destekli otomatik etiketleme icin yeni alanlar. Hepsi
    # NULL-varsayilanli/opsiyonel - var olan sorular hicbir sey kaybetmez,
    # sadece yeni bir soru AI ile siniflandirildiginda doldurulur.
    if qb_cols:
        for col, decl in (
            ("difficulty", "TEXT"),  # 'kolay' | 'orta' | 'zor' - eski difficulty_level (INTEGER,
                                      # hicbir yerde okunmuyor) BİLEREK degistirilmedi/silinmedi.
            ("question_pattern", "TEXT"),  # 'islem_sorusu' | 'problem_sorusu' | 'yorum_sorusu' | 'yeni_nesil_soru'
            ("source", "TEXT"),  # 'pdf_import' | 'teacher' | 'ai_generated' - bugun tek yol pdf_import
            ("ai_confidence", "TEXT"),  # JSON: {"zorluk": 0.9, "konu": 0.4, ...} - alan bazli guven
            ("ai_suggested_json", "TEXT"),  # AI'nin HAM onerisi (taksonomiye henuz eslenmemis
                                             # unite/konu/beceri isimleri dahil) - admin inceleme ekraninda gosterilir
            ("ai_classified_at", "TEXT"),
            # admin-panel-soru-havuzu-2 bolum 8: "dort goz" onay sureci -
            # reddedilirken gerekce ZORUNLU, girene gosterilir. Yeniden
            # incelemeye/onaya girildiginde (status pending_review/approved)
            # temizlenir - bkz. _apply_question_status.
            ("rejection_reason", "TEXT"),
        ):
            if col not in qb_cols:
                conn.execute(f"ALTER TABLE question_bank ADD COLUMN {col} {decl}")

    # grade_level (TEXT, ör. "8") hiç yazılmıyordu - bkz. api_question_bank_upload/
    # api_question_bank_update. Tam bir FK'ye geçmek (units.grade_level_id ile aynı
    # desen) yerine TEXT sütun DURUYOR - _smart_select_questions_for_student/
    # _find_similar_question class_name.split("/")[0] ile üretilen serbest metinle
    # bu sütunu karşılaştırıyor, INTEGER FK bu eşleşmeyi bozardı. grade_level_id
    # sadece taksonomi/units bağlantısı (ör. gelecekte ünite listesini sınıfa göre
    # filtrelemek) için EK bir sütun - ikisi UI'da her zaman birlikte set edilir.
    if qb_cols and "grade_level_id" not in qb_cols:
        conn.execute("ALTER TABLE question_bank ADD COLUMN grade_level_id INTEGER REFERENCES grade_levels(id) ON DELETE SET NULL")

    topics_cols = [r[1] for r in conn.execute("PRAGMA table_info(topics)").fetchall()]
    if topics_cols and "unit_id" not in topics_cols:
        conn.execute("ALTER TABLE topics ADD COLUMN unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL")

    units_cols = [r[1] for r in conn.execute("PRAGMA table_info(units)").fetchall()]
    if units_cols and "grade_level_id" not in units_cols:
        conn.execute("ALTER TABLE units ADD COLUMN grade_level_id INTEGER REFERENCES grade_levels(id) ON DELETE SET NULL")

    # 5-12 (ortaokul + lise) varsayilan kademe listesi - admin panelinden
    # sonradan duzenlenebilir/genisletilebilir, burasi sadece ilk kurulum.
    if not conn.execute("SELECT 1 FROM grade_levels LIMIT 1").fetchone():
        now_gl = datetime.now().isoformat()
        for grade_name in ("5", "6", "7", "8", "9", "10", "11", "12"):
            conn.execute("INSERT OR IGNORE INTO grade_levels (name, created_at) VALUES (?,?)", (grade_name, now_gl))

    # Var olan kurulumlarda booklet_code sütunu eklenmeden önce oluşturulmuş
    # question_import_batches tablosuna, çoklu kitapçık eşleştirmesinin
    # dayandığı "bu batch hangi kitapçık" bilgisini kaybetmeden ekler.
    batch_cols = [r[1] for r in conn.execute("PRAGMA table_info(question_import_batches)").fetchall()]
    if batch_cols and "booklet_code" not in batch_cols:
        conn.execute("ALTER TABLE question_import_batches ADD COLUMN booklet_code TEXT NOT NULL DEFAULT 'A'")
    conn.commit()

    _migrate_question_bank_lifecycle(conn)

    tc_cols = [r[1] for r in conn.execute("PRAGMA table_info(teacher_classes)").fetchall()]
    if tc_cols and "subject_id" not in tc_cols:
        conn.execute("ALTER TABLE teacher_classes ADD COLUMN subject_id INTEGER REFERENCES subjects(id)")
        conn.commit()

    org_extra_cols = [r[1] for r in conn.execute("PRAGMA table_info(organizations)").fetchall()]
    # user_limit: NULL = sinirsiz (bkz. admin-panel-prompt.md bolum 3) - o
    # okulun students tablosundaki KAYITLI ogrenci sayisina uygulanir,
    # ogretmen/veli/admin hesaplarini ETKILEMEZ (bkz. Admins/ogretmen paneli).
    # trial_ends_at: NULL degilse ve gecmisteyse okul otomatik pasif sayilir
    # (bkz. _is_org_effectively_active) - status kolonu ayrica 'trial'
    # degerini de alabilir (CHECK kisiti yok, TEXT NOT NULL DEFAULT 'active').
    for col, decl in (("short_name", "TEXT"), ("type", "TEXT"), ("archived_at", "TEXT"),
                       ("user_limit", "INTEGER"), ("trial_ends_at", "TEXT")):
        if col not in org_extra_cols:
            conn.execute(f"ALTER TABLE organizations ADD COLUMN {col} {decl}")
    conn.commit()

    audit_cols = [r[1] for r in conn.execute("PRAGMA table_info(audit_logs)").fetchall()]
    if audit_cols and "metadata" not in audit_cols:
        conn.execute("ALTER TABLE audit_logs ADD COLUMN metadata TEXT")
        conn.commit()

    # admin-panel-soru-havuzu-2 bolum 10.7 (ogretmen odev sistemi: manuel/
    # otomatik/akilli). assignment_type: eski satirlar NULL kalir (mevcut
    # davranis zaten "manuel" ile ozdes, geriye donuk kod NULL/'manual'
    # ayrimini yapmiyor). assignment_questions.student_id: NULL = paylasimli
    # (manuel/otomatik - tum sinif AYNI sorulari gorur), dolu = akilli modda
    # SADECE o ogrenciye ozel soru (bkz. api_teacher_create_assignment).
    assignments_cols = [r[1] for r in conn.execute("PRAGMA table_info(assignments)").fetchall()]
    if assignments_cols and "assignment_type" not in assignments_cols:
        conn.execute("ALTER TABLE assignments ADD COLUMN assignment_type TEXT NOT NULL DEFAULT 'manual'")
        conn.commit()
    aq_cols = [r[1] for r in conn.execute("PRAGMA table_info(assignment_questions)").fetchall()]
    if aq_cols and "student_id" not in aq_cols:
        conn.execute("ALTER TABLE assignment_questions ADD COLUMN student_id INTEGER REFERENCES students(id) ON DELETE CASCADE")
        conn.commit()

    # admin-panel-soru-havuzu-2 bolum 10.10: deneme analizi -> kisisel calisma
    # plani. matched_kazanim: eski deneme sisteminin serbest-metin kazanim
    # stringi (bkz. _match_kazanim_to_topic) - hangi zayif alandan geldigini
    # SEFFAF tutmak icin saklanir, iki ayri taksonomi arasinda tam id
    # eslesmesi olmadigindan (bkz. o fonksiyonun yorumu) sorgulanabilir bir
    # iz birakmak onemli.
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS personal_study_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            exam_id INTEGER,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
            generated_from TEXT NOT NULL DEFAULT 'EXAM_ANALYSIS'
        );
        CREATE TABLE IF NOT EXISTS personal_study_plan_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL REFERENCES personal_study_plans(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
            skill_id INTEGER REFERENCES skills(id) ON DELETE SET NULL,
            matched_kazanim TEXT,
            order_index INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_psp_student ON personal_study_plans(student_id, created_at);

        -- Ana Sayfa Geliştirme Önerileri madde 9 (Bildirim Merkezi). notif_key
        -- SABİT bir tanımlayıcı (bkz. _compute_attention_items'taki 'key'
        -- alanı) - aynı olayı (ör. 'near_limit') tekrar tekrar YENİ bildirim
        -- olarak oluşturmamak için UNIQUE(user_id, notif_key). 'archived'
        -- durumundaki bir bildirim BİLİNÇLİ OLARAK bir daha güncellenmez
        -- (kullanıcı kapattı, tekrar tekrar geri gelmesin).
        CREATE TABLE IF NOT EXISTS platform_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            notif_key TEXT NOT NULL,
            text TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            page TEXT,
            status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','archived')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, notif_key)
        );
        """
    )
    conn.commit()


def _migrate_question_bank_lifecycle(conn):
    """question_bank.status'un CHECK kisitina 'published'/'archived' ekler
    (Yetki Matrisi Faz 4 - onaylanmis bir soruyu fiilen KULLANILABILIR
    yapan ayri bir 'yayinlama' adimi + hard delete yerine arsivleme).
    SQLite CHECK kisitini dogrudan ALTER edemedigi icin _migrate_users_table
    ile AYNI kanitlanmis desen kullanilir: yeni semali bir tabloyu GECICI
    adla olustur, veriyi kopyala, ESKI TABLOYU (yeniden adlandirmadan) SIL,
    sonra geciciyi gercek isme yeniden adlandir. 'question_bank' adini
    ASLA gecici bir isme (orn. question_bank_old) YENIDEN ADLANDIRMIYORUZ -
    aksi halde ona REFERENCES question_bank(id) ile bagli
    question_booklet_numbers/assignment_questions tablolarinin FK metni
    SQLite tarafindan o gecici isme guncellenir ve tablo silinince kalici
    olarak kirilir (_migrate_users_table'daki users_old hatasinin ayni
    tuzagi, bkz. oradaki yorum)."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='question_bank'"
    ).fetchone()
    if not row or "'published'" in row["sql"]:
        return  # tablo yok (ilk kurulum, asagidaki CREATE zaten dogru) ya da zaten migrate edilmis

    cols = [r[1] for r in conn.execute("PRAGMA table_info(question_bank)").fetchall()]
    has_question_number = "question_number" in cols

    conn.executescript(
        f"""
        CREATE TABLE question_bank_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            batch_id INTEGER REFERENCES question_import_batches(id) ON DELETE SET NULL,
            display_code TEXT UNIQUE,

            subject_id INTEGER NOT NULL REFERENCES subjects(id),
            grade_level TEXT,
            topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
            learning_outcome_id INTEGER REFERENCES learning_outcomes(id) ON DELETE SET NULL,

            question_type TEXT,
            difficulty_level INTEGER,
            tags TEXT,
            {"question_number INTEGER," if has_question_number else ""}

            image_path TEXT NOT NULL,
            source_page_number INTEGER,
            crop_x REAL, crop_y REAL, crop_width REAL, crop_height REAL,
            question_text TEXT,

            correct_answer TEXT,
            correct_answer_source TEXT CHECK(correct_answer_source IN ('answer_key','manual','edited')),
            explanation TEXT,

            status TEXT NOT NULL DEFAULT 'pending_review'
                CHECK(status IN ('pending_review','reviewed','excluded','approved','published','archived')),
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TEXT,
            published_at TEXT,
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT INTO question_bank_new ({", ".join(cols)})
            SELECT {", ".join(cols)} FROM question_bank;
        DROP TABLE question_bank;
        ALTER TABLE question_bank_new RENAME TO question_bank;
        """
    )
    conn.commit()


def _get_default_org_id(conn):
    row = conn.execute("SELECT id FROM organizations LIMIT 1").fetchone()
    if row:
        return row["id"]
    now = datetime.now().isoformat()
    conn.execute(
        "INSERT INTO organizations (name, slug, status, created_at, updated_at) VALUES (?,?,?,?,?)",
        ("EduPusula Okulu", "edupusula-okulu", "active", now, now),
    )
    conn.commit()
    return conn.execute("SELECT id FROM organizations LIMIT 1").fetchone()["id"]


def _current_org_id(db):
    """Oturumdaki kullanıcının kurum id'si; yoksa varsayılan kuruma düşer
    (tek-kurumlu kurulumlar için)."""
    org_row = db.execute(
        "SELECT organization_id FROM users WHERE id=?", (session["user_id"],)
    ).fetchone()
    if org_row and org_row["organization_id"]:
        return org_row["organization_id"]
    # Platform sahibi (organization.manage izni olan) hesaplarin sabit bir
    # okulu OLMAYABILIR (bkz. admin'in kendi okulunun kaldirilmasi) - bu
    # durumda varsayilan kuruma SESSIZCE dusmek, bu hesabin (_effective_org_id
    # KULLANMAYAN eski) uclara yanlislikla eristigi durumlarda BASKA/ARSIVLI
    # bir okula veri yazmasina yol acabilir. Bu yuzden boyle bir hesap icin
    # None donulur - cagiran taraf zaten "okul secilmedi" seklinde ele almali.
    # Gercek bir okulu olan TUM normal kullanicilar (admin/teacher/parent/
    # student) icin davranis birebir ayni kalir (ilk dal her zaman onlar icin
    # devreye girer).
    if has_permission(db, session["user_id"], "organization.manage"):
        return None
    return _get_default_org_id(db)


def _effective_org_id(db):
    """Bir Kullanicilar/Ogrenciler/Denemeler ucunun ISLEM YAPACAGI okulu cozer.

    - "organization.manage" iznine sahip kullanicilar (her zaman super_admin;
      ayrica platform sahibi oldugu icin bu izin EK OLARAK verilmis, legacy
      role='admin' kalan bir "hibrit" okul admini de) ?school_id= query
      param'i ile ACIKCA baska bir okulu secebilir.
    - school_id verilmemisse: bu izne sahip olsa bile kendi organization_id'sine
      (varsa) doner - saf platform hesabinin (organization_id NULL) kendi
      okulu yoktur, None doner (cagiran taraf bunu 400 olarak islemeli).
    - bu izne sahip OLMAYAN her rol (normal admin/teacher-delege): query
      param'i TAMAMEN YOK SAYILIR - kendi organization_id'sine sabittir.
      Aksi halde bir okul admini/delegesi URL'e baska bir school_id
      yapistirip baska okulun hesaplarini yonetebilirdi (okul-arasi IDOR)."""
    if has_permission(db, session["user_id"], "organization.manage"):
        raw = request.args.get("school_id")
        if raw:
            try:
                org_id = int(raw)
            except (TypeError, ValueError):
                return None
            exists = db.execute("SELECT 1 FROM organizations WHERE id = ?", (org_id,)).fetchone()
            return org_id if exists else None
        own_row = db.execute(
            "SELECT organization_id FROM users WHERE id=?", (session["user_id"],)
        ).fetchone()
        return own_row["organization_id"] if own_row else None
    return _current_org_id(db)


# ============================================================
# Coklu okul: client (tarayici IndexedDB) tarafinda uretilen
# students/exams/results id'lerinin okullar arasi CAKISMAMASI
# ============================================================
# students.id/exams.id/results.id sunucuda degil, adminin tarayicisindaki
# Dexie/IndexedDB otomatik-artan sayaclarindan gelir (bkz. api_admin_sync).
# Her okulun kendi tarayicisi 1'den baslar - ikinci bir okul senkron olunca
# "ogrenci #1"i ilk okulun "ogrenci #1"iyle ayni PRIMARY KEY'e carpar.
#
# Bunu, PRIMARY KEY'i bilesik (organization_id, id) yapip her foreign key'i
# (ozellikle parent_students.student_id REFERENCES students(id), tekil
# sutunun UNIQUE olmasina dayanir) yeniden kurmak yerine, her okula devasa
# bir id "bloku" ayirarak cozuyoruz: id'ler artik sunucuda
# `client_id + (organization_id-1) * ORG_ID_BLOCK_SIZE` olarak saklanir.
# Bu sayede id GERCEKTEN global olarak benzersiz olur, mevcut tekil-sutunlu
# PRIMARY KEY/FOREIGN KEY tanimlarinin HICBIRINE dokunmaya gerek kalmaz.
# 1. okul (mevcut gercek veri) icin offset SIFIRDIR - id'ler bugunku gibi
# aynen kalir, hicbir gocun/veri donusumunun gerekmedigi anlamina gelir.
ORG_ID_BLOCK_SIZE = 10_000_000


def _org_scoped_id(org_id, client_id):
    """Bir okulun tarayicisindan gelen ham id'yi (client_id) o okula ayrilmis
    global-benzersiz id blogu icine tasir. client_id None/0 ise (beklenmez
    ama savunmaci) oldugu gibi dondurur."""
    if not client_id:
        return client_id
    return int(client_id) + (int(org_id) - 1) * ORG_ID_BLOCK_SIZE


# Platform sahibinin bir okula DOGRUDAN (o okulun kendi tarayicisi disinda)
# ekledigi ogrenci/deneme/sonuc kayitlari icin, o okulun ID blogunun EN UST
# 1 milyonluk alt-araligi rezerve edilir. Bir okulun tarayici sayaci
# (Dexie auto-increment) buraya pratikte asla ulasmaz (milyonlarca kayit
# gerekir), bu yuzden browser_sync ve platform_admin kaynakli id'ler
# CAKISMAZ - ayrica bkz. yukaridaki ORG_ID_BLOCK_SIZE yorumu.
PLATFORM_ADMIN_ID_RESERVE_START = 9_000_000


def _platform_admin_next_id(db, table, org_id):
    """table icin, org_id'ye ayrilmis rezerve id alt-araliginda bir sonraki
    (kullanilmamis) global-benzersiz id'yi dondurur."""
    org_id = int(org_id)
    range_start = _org_scoped_id(org_id, PLATFORM_ADMIN_ID_RESERVE_START)
    range_end = _org_scoped_id(org_id, ORG_ID_BLOCK_SIZE - 1)
    row = db.execute(
        f"SELECT MAX(id) FROM {table} WHERE id >= ? AND id <= ?",
        (range_start, range_end),
    ).fetchone()
    current_max = row[0]
    next_id = (current_max + 1) if current_max else range_start
    if next_id > range_end:
        raise ValueError(f"{table} icin platform-admin id rezervi doldu (org {org_id})")
    return next_id


def _seed_reference_data(conn):
    """Statik referans veriler: kurum, roller, izinler, dersler, eğitim yılı.
    Hepsi INSERT OR IGNORE ile idempotent - tekrar tekrar çağrılması güvenli."""
    now = datetime.now().isoformat()
    org_id = _get_default_org_id(conn)

    # super_admin hicbir okula ait degildir (organization_id = NULL kalmali) -
    # aksi halde her sunucu yeniden baslatmasinda yanlislikla varsayilan
    # okula atanir ve _current_org_id o okula sabitlenmis gibi davranir. Ayni
    # istisna, "organization.manage" iznine sahip (platform sahibi) ama
    # BILEREK kendi okulu olmayan hesaplar icin de gecerli (bkz. admin'in
    # kendi okulunun kaldirilmasi) - bunlar da super_admin gibi her zaman
    # NULL kalmali, aksi halde her yeniden baslatmada arsivlenmis/varsayilan
    # okula sessizce geri baglanirlardi.
    conn.execute(
        "UPDATE users SET organization_id = ? WHERE organization_id IS NULL AND role != 'super_admin' "
        "AND id NOT IN ("
        "  SELECT ur.user_id FROM user_roles ur "
        "  JOIN role_permissions rp ON rp.role_id = ur.role_id "
        "  JOIN permissions p ON p.id = rp.permission_id "
        "  WHERE p.name = 'organization.manage'"
        ")",
        (org_id,),
    )
    conn.execute("UPDATE students SET organization_id = ? WHERE organization_id IS NULL", (org_id,))
    conn.execute("UPDATE exams SET organization_id = ? WHERE organization_id IS NULL", (org_id,))
    conn.execute("UPDATE results SET organization_id = ? WHERE organization_id IS NULL", (org_id,))

    for role_name in ROLE_SEED:
        conn.execute("INSERT OR IGNORE INTO roles (name) VALUES (?)", (role_name,))
    for perm_name in PERMISSION_SEED:
        conn.execute("INSERT OR IGNORE INTO permissions (name) VALUES (?)", (perm_name,))
    for role_name, perms in ROLE_PERMISSIONS_SEED.items():
        role_row = conn.execute("SELECT id FROM roles WHERE name=?", (role_name,)).fetchone()
        for perm_name in perms:
            perm_row = conn.execute("SELECT id FROM permissions WHERE name=?", (perm_name,)).fetchone()
            conn.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?,?)",
                (role_row["id"], perm_row["id"]),
            )

    # Gecmiste INSTITUTION_ADMIN'e yanlislikla verilmis "organization.manage"
    # iznini var olan veritabanlarindan temizle (yukaridaki INSERT OR IGNORE
    # bunu bir daha eklemez ama zaten var olan satiri silmez de). Idempotent -
    # satir yoksa no-op.
    conn.execute(
        "DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name='INSTITUTION_ADMIN') "
        "AND permission_id = (SELECT id FROM permissions WHERE name='organization.manage')"
    )
    # Ayni sekilde: "admins.manage" ilk eklendiginde PLATFORM_ONLY_PERMISSIONS'a
    # dahil edilmemis olabilir (yukaridaki INSERT OR IGNORE bu satiri o zaman
    # eklemis olabilir) - okul adminlerinin baska admin hesabi olusturabilmesi
    # gibi bir yetki yukselmesine yol acmamasi icin idempotent temizlik.
    conn.execute(
        "DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name='INSTITUTION_ADMIN') "
        "AND permission_id = (SELECT id FROM permissions WHERE name='admins.manage')"
    )

    for code, name in SUBJECT_SEED:
        conn.execute("INSERT OR IGNORE INTO subjects (code, name) VALUES (?,?)", (code, name))

    _load_curriculum_seed(conn)

    if not conn.execute("SELECT id FROM academic_years WHERE is_active = 1 LIMIT 1").fetchone():
        conn.execute(
            "INSERT INTO academic_years (organization_id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)",
            (org_id, "2025-2026", 1, now, now),
        )
    conn.commit()
    return org_id


def _sync_user_roles_and_profiles(conn, org_id):
    now = datetime.now().isoformat()
    for u in conn.execute("SELECT id, role FROM users").fetchall():
        new_role = LEGACY_ROLE_TO_NEW_ROLE.get(u["role"])
        if not new_role:
            continue
        role_row = conn.execute("SELECT id FROM roles WHERE name=?", (new_role,)).fetchone()
        conn.execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)", (u["id"], role_row["id"]))
        if u["role"] == "teacher":
            conn.execute(
                "INSERT OR IGNORE INTO teacher_profiles (user_id, organization_id, created_at, updated_at) VALUES (?,?,?,?)",
                (u["id"], org_id, now, now),
            )
        elif u["role"] == "parent":
            conn.execute(
                "INSERT OR IGNORE INTO parent_profiles (user_id, organization_id, created_at, updated_at) VALUES (?,?,?,?)",
                (u["id"], org_id, now, now),
            )
    conn.commit()


def sync_derived_tables(conn, org_id):
    """students/exams/results (asıl kaynak) verisinden normalize edilmiş
    tabloları yeniden kurar. init_db()'de VE her /api/admin/sync sonrasında
    çağrılır - böylece iki katman hep tutarlı kalır."""
    now = datetime.now().isoformat()
    ay = conn.execute("SELECT id FROM academic_years WHERE is_active = 1 LIMIT 1").fetchone()
    ay_id = ay["id"]

    # --- classes: öğrenci + öğretmen class_name alanlarından türet ---
    class_names = set()
    for r in conn.execute("SELECT DISTINCT class_name FROM students WHERE class_name IS NOT NULL AND class_name != ''"):
        class_names.add(r["class_name"])
    for r in conn.execute("SELECT DISTINCT class_name FROM users WHERE role='teacher' AND class_name IS NOT NULL AND class_name != ''"):
        class_names.add(r["class_name"])
    for cn in class_names:
        conn.execute(
            "INSERT OR IGNORE INTO classes (organization_id, name, academic_year_id, status, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?)",
            (org_id, cn, ay_id, "active", now, now),
        )

    def class_id_for(name):
        if not name:
            return None
        row = conn.execute(
            "SELECT id FROM classes WHERE organization_id=? AND name=? AND academic_year_id=?", (org_id, name, ay_id)
        ).fetchone()
        return row["id"] if row else None

    def subject_id_for(code):
        row = conn.execute("SELECT id FROM subjects WHERE code=?", (code,)).fetchone()
        if row:
            return row["id"]
        conn.execute("INSERT INTO subjects (code, name) VALUES (?,?)", (code, code))
        return conn.execute("SELECT id FROM subjects WHERE code=?", (code,)).fetchone()["id"]

    # --- teacher_classes: tamamen türetilmiş, güvenle yeniden kurulur ---
    conn.execute("DELETE FROM teacher_classes WHERE academic_year_id = ?", (ay_id,))
    for r in conn.execute("SELECT id, class_name FROM users WHERE role='teacher' AND class_name IS NOT NULL AND class_name != ''"):
        cid = class_id_for(r["class_name"])
        if cid:
            conn.execute(
                "INSERT OR IGNORE INTO teacher_classes (teacher_id, class_id, academic_year_id, created_at) VALUES (?,?,?,?)",
                (r["id"], cid, ay_id, now),
            )

    # --- student_profiles (upsert) + student_enrollments (geçmiş korunur) ---
    for s in conn.execute("SELECT id, school_number, first_name, last_name, class_name FROM students").fetchall():
        user_row = conn.execute("SELECT id FROM users WHERE role='student' AND student_id=?", (s["id"],)).fetchone()
        user_id = user_row["id"] if user_row else None
        existing = conn.execute("SELECT id FROM student_profiles WHERE legacy_student_id=?", (s["id"],)).fetchone()
        if existing:
            profile_id = existing["id"]
            conn.execute(
                "UPDATE student_profiles SET first_name=?, last_name=?, student_number=?, user_id=?, "
                "organization_id=?, updated_at=? WHERE id=?",
                (s["first_name"], s["last_name"], s["school_number"], user_id, org_id, now, profile_id),
            )
        else:
            conn.execute(
                "INSERT INTO student_profiles (user_id, organization_id, legacy_student_id, student_number, "
                "first_name, last_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (user_id, org_id, s["id"], s["school_number"], s["first_name"], s["last_name"], "active", now, now),
            )
            profile_id = conn.execute("SELECT id FROM student_profiles WHERE legacy_student_id=?", (s["id"],)).fetchone()["id"]

        cid = class_id_for(s["class_name"])
        if cid:
            active_enr = conn.execute(
                "SELECT id, class_id FROM student_enrollments WHERE student_id=? AND status='active'", (profile_id,)
            ).fetchone()
            if not active_enr or active_enr["class_id"] != cid:
                if active_enr:
                    conn.execute(
                        "UPDATE student_enrollments SET status='completed', end_date=? WHERE id=?",
                        (now, active_enr["id"]),
                    )
                conn.execute(
                    "INSERT INTO student_enrollments (student_id, class_id, academic_year_id, start_date, status, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (profile_id, cid, ay_id, now, "active", now),
                )

    # --- exam_subjects / exam_results / exam_subject_results / questions /
    #     student_question_results: tamamen türetilmiş -> her seferinde yeniden kur ---
    conn.execute("DELETE FROM exam_subject_results")
    conn.execute("DELETE FROM exam_results")
    conn.execute("DELETE FROM student_question_results")
    conn.execute("DELETE FROM questions")
    conn.execute("DELETE FROM exam_subjects")

    exam_rows = conn.execute("SELECT id, data_json FROM exams").fetchall()
    result_rows_all = conn.execute("SELECT id, student_id, exam_id, data_json FROM results").fetchall()

    for exam in exam_rows:
        exam_data = json.loads(exam["data_json"]) if exam["data_json"] else {}
        topic_map = exam_data.get("topicMap") or {}
        exam_results_for_exam = [r for r in result_rows_all if r["exam_id"] == exam["id"]]

        subject_keys = set()
        for r in exam_results_for_exam:
            rdata = json.loads(r["data_json"]) if r["data_json"] else {}
            subject_keys.update((rdata.get("subjects") or {}).keys())

        question_id_by_subject_idx = {}
        for skey in subject_keys:
            sid = subject_id_for(skey)
            entries = topic_map.get(skey) or []
            conn.execute(
                "INSERT OR IGNORE INTO exam_subjects (exam_id, subject_id, question_count) VALUES (?,?,?)",
                (exam["id"], sid, len(entries) or None),
            )
            for idx, tinfo in enumerate(entries):
                conn.execute(
                    "INSERT INTO questions (exam_id, subject_id, question_number, topic) VALUES (?,?,?,?)",
                    (exam["id"], sid, tinfo.get("dizilim") or (idx + 1), tinfo.get("kazanim")),
                )
                question_id_by_subject_idx[(skey, idx)] = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        for r in exam_results_for_exam:
            rdata = json.loads(r["data_json"]) if r["data_json"] else {}
            subjects = rdata.get("subjects") or {}
            total_net = calc_total_net(subjects)
            tc = sum((v or {}).get("correct") or 0 for v in subjects.values())
            tw = sum((v or {}).get("wrong") or 0 for v in subjects.values())
            tb = sum((v or {}).get("blank") or 0 for v in subjects.values())
            conn.execute(
                "INSERT OR IGNORE INTO exam_results (exam_id, student_id, total_correct, total_wrong, total_blank, "
                "total_net, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (exam["id"], r["student_id"], tc, tw, tb, total_net, now, now),
            )
            exam_result_id = conn.execute(
                "SELECT id FROM exam_results WHERE exam_id=? AND student_id=?", (exam["id"], r["student_id"])
            ).fetchone()["id"]
            for skey, sdata in subjects.items():
                sid = subject_id_for(skey)
                sdata = sdata or {}
                conn.execute(
                    "INSERT OR IGNORE INTO exam_subject_results (exam_result_id, subject_id, correct, wrong, blank, net) "
                    "VALUES (?,?,?,?,?,?)",
                    (exam_result_id, sid, sdata.get("correct"), sdata.get("wrong"), sdata.get("blank"), sdata.get("net")),
                )
                for idx, ans in enumerate(sdata.get("answers") or []):
                    qid = question_id_by_subject_idx.get((skey, idx))
                    if qid and ans:
                        conn.execute(
                            "INSERT OR IGNORE INTO student_question_results (student_id, question_id, answer, "
                            "is_correct, created_at) VALUES (?,?,?,?,?)",
                            (r["student_id"], qid, ans, 1 if ans == "D" else 0, now),
                        )

    # --- performance_insights (Başarı Pusulası) - mevcut _build_compass mantığı yeniden kullanılır ---
    conn.execute("DELETE FROM performance_insights")
    insight_type_map = {"strong": "STRONG", "developing": "IMPROVING", "attention": "WATCH", "priority": "PRIORITY"}
    for s in conn.execute("SELECT id FROM students").fetchall():
        report = _build_student_report(conn, s["id"])
        if not report:
            continue
        exam_count = len(report.get("results") or [])
        compass = report.get("compass") or {}
        for bucket, insight_type in insight_type_map.items():
            for item in compass.get(bucket, []):
                subject_id = subject_id_for(item["subjectKey"]) if item.get("subjectKey") else None
                if bucket == "developing":
                    confidence = min(1.0, (item.get("delta") or 0) / 10)
                else:
                    confidence = (item.get("successRate") or 0) / 100
                conn.execute(
                    "INSERT INTO performance_insights (student_id, subject_id, topic, insight_type, "
                    "confidence_level, based_on_exam_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (s["id"], subject_id, item.get("kazanim"), insight_type, round(confidence, 2), exam_count, now, now),
                )
    conn.commit()


def run_v2_migration(conn):
    """Tek giriş noktası: yeni tabloları oluştur, referans veriyi doldur,
    kullanıcı rollerini/profillerini eşitle, türetilmiş tabloları yeniden kur.
    init_db() ve /api/admin/sync tarafından çağrılır - tamamen idempotent."""
    conn.row_factory = sqlite3.Row
    _create_v2_tables(conn)
    _create_question_bank_tables(conn)
    _create_invite_tables(conn)
    org_id = _seed_reference_data(conn)
    _sync_user_roles_and_profiles(conn, org_id)
    sync_derived_tables(conn, org_id)
    return org_id


def log_audit(db, action, resource_type=None, resource_id=None, user_id=None):
    """Kritik işlemleri denetim kaydına yazar. Asla asıl işlemi bozmamalıdır -
    bu yüzden herhangi bir hata sessizce yutulur (audit logging best-effort)."""
    try:
        acting_user_id = user_id or session.get("user_id")
        org_row = db.execute(
            "SELECT organization_id FROM users WHERE id=?", (acting_user_id,)
        ).fetchone() if acting_user_id else None
        # super_admin'in organization_id'si NULL'dur - bu dogru/beklenen bir
        # deger (bir okula ait olmayan islem), varsayilan okula duselerek
        # gizlenmemeli.
        org_id = org_row["organization_id"] if org_row else None
        db.execute(
            "INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, ip_address, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (org_id, acting_user_id, action, resource_type, resource_id,
             request.remote_addr, datetime.now().isoformat()),
        )
        db.commit()
    except Exception:
        pass


# Trial suresi dolan/dolmak uzere olan okullar icin ayri bir zamanlanmis is
# (cron/scheduler) bu projede yok (bkz. server infra notlari) - bu yuzden
# platform sahibinin okullari GORDUGU/bir okulun kullanicisinin GIRIS YAPMAYA
# CALISTIGI her an bu kontrolu tetikleriz (bkz. cagiran yerler: api_login,
# api_superadmin_list_organizations).
TRIAL_EXPIRY_WARNING_DAYS = 3


def _process_trial_lifecycle(db):
    """1) Suresi gecmis 'trial' okullari otomatik 'inactive' yapar (bolum 4 -
    o okulun kullanicilari bir sonraki giris denemesinde/zaten aktif
    session'lari organization status kontrolunden gecemeyip engellenir).
    2) Suresi TRIAL_EXPIRY_WARNING_DAYS gun icinde dolacak okullar icin log
    akisina bir uyari dusurur - ayni okul icin 24 saatte bir defadan fazla
    tekrar etmesini (her sayfa yenilemesinde spam) onlemek icin son 24 saatte
    ayni uyari zaten atilmis mi diye once kontrol eder."""
    now = datetime.now()
    now_iso = now.isoformat()

    expired = db.execute(
        "SELECT id FROM organizations WHERE status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < ?",
        (now_iso,),
    ).fetchall()
    for row in expired:
        db.execute(
            "UPDATE organizations SET status = 'inactive', updated_at = ? WHERE id = ?",
            (now_iso, row["id"]),
        )
        log_audit(db, "ORGANIZATION_TRIAL_EXPIRED", resource_type="organization", resource_id=row["id"])

    soon_cutoff = (now + timedelta(days=TRIAL_EXPIRY_WARNING_DAYS)).isoformat()
    warn_since = (now - timedelta(hours=24)).isoformat()
    soon = db.execute(
        "SELECT id FROM organizations WHERE status = 'trial' AND trial_ends_at IS NOT NULL "
        "AND trial_ends_at >= ? AND trial_ends_at <= ?",
        (now_iso, soon_cutoff),
    ).fetchall()
    for row in soon:
        already_warned = db.execute(
            "SELECT 1 FROM audit_logs WHERE action = 'ORGANIZATION_TRIAL_EXPIRING_SOON' "
            "AND resource_type = 'organization' AND resource_id = ? AND created_at > ? LIMIT 1",
            (row["id"], warn_since),
        ).fetchone()
        if not already_warned:
            log_audit(db, "ORGANIZATION_TRIAL_EXPIRING_SOON", resource_type="organization", resource_id=row["id"])
    db.commit()


def _org_student_count(db, org_id):
    return db.execute(
        "SELECT COUNT(*) AS c FROM students WHERE organization_id = ?", (org_id,)
    ).fetchone()["c"]


def init_db():
    os.makedirs(QUESTION_IMAGES_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")  # bkz. get_db() - dosya genelinde kalici bir ayar

    # 1) Önce 'users' tablosunu oluştur/düzelt - diğer tablolar buna FK ile
    #    bağlı olacağı için bu adım kesinlikle önce tamamlanmalı.
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('super_admin','admin','teacher','parent','student')),
            display_name TEXT,
            class_name TEXT,
            student_id INTEGER,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT
        );
        """
    )
    _migrate_users_table(conn)

    # 2) Şimdi geri kalan tabloları oluştur (users artık kararlı/final halinde).
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY,
            school_number TEXT,
            first_name TEXT,
            last_name TEXT,
            class_name TEXT
        );

        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY,
            name TEXT,
            date TEXT,
            exam_type TEXT,
            data_json TEXT
        );

        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY,
            student_id INTEGER,
            exam_id INTEGER,
            data_json TEXT
        );

        CREATE TABLE IF NOT EXISTS parent_students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(parent_user_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS demo_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            okul TEXT NOT NULL,
            yetkili_ad TEXT NOT NULL,
            telefon TEXT,
            eposta TEXT NOT NULL,
            ogrenci_sayisi TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS teacher_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            teacher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            read_at TEXT
        );
        """
    )
    _fix_parent_students_fk(conn)
    _backfill_parent_students(conn)

    # Var olan kurulumlarda (read_at sütunu eklenmeden önce oluşturulmuş
    # teacher_messages tablosu) veri kaybetmeden sütunu ekler.
    tm_cols = [r[1] for r in conn.execute("PRAGMA table_info(teacher_messages)").fetchall()]
    if tm_cols and "read_at" not in tm_cols:
        conn.execute("ALTER TABLE teacher_messages ADD COLUMN read_at TEXT")

    cur = conn.execute("SELECT COUNT(*) FROM users")
    if cur.fetchone()[0] == 0:
        conn.execute(
            "INSERT INTO users (username, password_hash, role, display_name, created_at) "
            "VALUES (?,?,?,?,?)",
            ("admin", hash_password("admin123"), "admin", "Yönetici",
             datetime.now().isoformat()),
        )
        print("\n" + "=" * 60)
        print("  İLK KURULUM: varsayılan admin hesabı oluşturuldu")
        print("  Kullanıcı adı : admin")
        print("  Şifre         : admin123")
        print("  ⚠️  Giriş yaptıktan sonra şifrenizi mutlaka değiştirin!")
        print("=" * 60 + "\n")
    conn.commit()

    # v2: çok-kurumlu / RBAC / normalize edilmiş veri modeli (bkz. yukarıdaki
    # run_v2_migration tanımı) - mevcut veriye dokunmadan ek katman kurar.
    run_v2_migration(conn)

    conn.close()


# ============================================================
# Yardımcılar: net hesaplama / konu analizi (js/db.js ile birebir aynı mantık)
# ============================================================

def calc_total_net(subjects):
    total = 0.0
    for s in (subjects or {}).values():
        total += (s or {}).get("net") or 0
    return round(total, 2)


def build_question_stats(exam_data, results_rows):
    """exam_data: exams.data_json (dict, 'topicMap' içerir).
    results_rows: [{'subjects': {...}}] listesi."""
    topic_map = (exam_data or {}).get("topicMap")
    if not topic_map:
        return None
    stats = []
    for subject_key, entries in topic_map.items():
        for idx, entry in enumerate(entries or []):
            correct = wrong = blank = total = 0
            for r in results_rows:
                answers = ((r.get("subjects") or {}).get(subject_key) or {}).get("answers")
                if not answers or idx >= len(answers) or answers[idx] is None:
                    continue
                total += 1
                if answers[idx] == "D":
                    correct += 1
                elif answers[idx] == "Y":
                    wrong += 1
                elif answers[idx] == "B":
                    blank += 1
            if total == 0:
                continue
            stats.append({
                "subjectKey": subject_key,
                "dizilim": entry.get("dizilim"),
                "soruId": entry.get("soruId"),
                "kazanim": entry.get("kazanim") or "(Kazanım belirtilmemiş)",
                "correct": correct, "wrong": wrong, "blank": blank, "total": total,
                "successRate": round(correct / total * 100, 1),
            })
    return stats


def build_topic_stats(question_stats):
    by_topic = {}
    for q in question_stats:
        key = f"{q['subjectKey']}::{q['kazanim']}"
        t = by_topic.setdefault(key, {
            "subjectKey": q["subjectKey"], "kazanim": q["kazanim"],
            "correct": 0, "wrong": 0, "blank": 0, "total": 0, "questionCount": 0,
        })
        t["correct"] += q["correct"]; t["wrong"] += q["wrong"]
        t["blank"] += q["blank"]; t["total"] += q["total"]; t["questionCount"] += 1
    out = []
    for t in by_topic.values():
        t["successRate"] = round(t["correct"] / t["total"] * 100, 1) if t["total"] else 0
        out.append(t)
    out.sort(key=lambda x: x["successRate"])
    return out


# ============================================================
# Basit kotuye kullanim korumasi (public /api/register/* icin)
# ============================================================
# Kod tabaninda hic emsali yok (login/demo-talebi de dahil hicbir ucta hiz
# sinirlama yoktur) - bellek-ici, surec omru boyunca yeterli, kucuk olcekli
# bir uygulama icin bagimsizliksiz minimum bir katman. Token/kodlarin
# kendisi zaten (secrets.token_urlsafe) kaba kuvvetle tahmin edilemez.
_REGISTER_ATTEMPTS = {}
_REGISTER_WINDOW_SECONDS = 60
_REGISTER_MAX_ATTEMPTS = 10


def _register_rate_limited(ip):
    now = datetime.now().timestamp()
    attempts = [t for t in _REGISTER_ATTEMPTS.get(ip, []) if now - t < _REGISTER_WINDOW_SECONDS]
    _REGISTER_ATTEMPTS[ip] = attempts
    return len(attempts) >= _REGISTER_MAX_ATTEMPTS


# Kritik #7 (500 ogrenci + 10 admin olcek analizi): /api/login'de HICBIR
# hiz sinirlama yoktu - kaba kuvvet saldirisina tamamen acikti. Yukaridaki
# register limiteri TUM denemeleri sayar (kayit zaten tek seferlik), ama
# burada SADECE BASARISIZ denemeler sayilir - aksi halde bir ogretmen gunde
# birden fazla kez normal giris yaptiginda yanlislikla kilitlenebilirdi.
_LOGIN_FAILED_ATTEMPTS = {}
_LOGIN_WINDOW_SECONDS = 300
_LOGIN_MAX_ATTEMPTS = 8


def _login_rate_limited(ip):
    now = datetime.now().timestamp()
    attempts = [t for t in _LOGIN_FAILED_ATTEMPTS.get(ip, []) if now - t < _LOGIN_WINDOW_SECONDS]
    _LOGIN_FAILED_ATTEMPTS[ip] = attempts
    return len(attempts) >= _LOGIN_MAX_ATTEMPTS


def _login_record_failure(ip):
    now = datetime.now().timestamp()
    _LOGIN_FAILED_ATTEMPTS.setdefault(ip, []).append(now)


def _login_clear_failures(ip):
    _LOGIN_FAILED_ATTEMPTS.pop(ip, None)


def _register_record_attempt(ip):
    _REGISTER_ATTEMPTS.setdefault(ip, []).append(datetime.now().timestamp())


# ============================================================
# Kimlik doğrulama yardımcıları
# ============================================================

def has_permission(db, user_id, permission_name):
    """RBAC: kullanıcının rol(ler)i, verilen izne sahip mi? (user_roles ->
    role_permissions -> permissions). Bu, mevcut role= kontrolünün YERİNE
    değil, ONA EK bir katmandır - çok katmanlı yetkilendirmenin bir parçası."""
    row = db.execute(
        "SELECT 1 FROM user_roles ur "
        "JOIN role_permissions rp ON rp.role_id = ur.role_id "
        "JOIN permissions p ON p.id = rp.permission_id "
        "WHERE ur.user_id = ? AND p.name = ? LIMIT 1",
        (user_id, permission_name),
    ).fetchone()
    return row is not None


def login_required(role=None, permission=None):
    # role: tek bir rol stringi ("admin") ya da izin verilen birden fazla rolun
    # tuple/list'i (("admin","teacher")) olabilir - okul bazli yetki devrinde
    # bir ucun hem gercek admin'e hem yetki devredilmis bir ogretmene acik
    # olmasi gerekiyor (bkz. permission= ile ek kisitlama, asagida).
    allowed_roles = None
    if role:
        allowed_roles = tuple(role) if isinstance(role, (list, tuple, set)) else (role,)

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if "user_id" not in session:
                return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
            if allowed_roles and session.get("role") not in allowed_roles:
                return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403
            if permission and not has_permission(get_db(), session["user_id"], permission):
                return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ============================================================
# Merkezi yetki kontrolü: "kim hangi öğrenciyi görebilir"
# ============================================================
# Öğrenciye özel veri döndüren HER endpoint, doğrudan session'a güvenmek yerine
# bu fonksiyonlardan geçmelidir. Böylece yeni bir endpoint eklendiğinde bile
# başka bir öğrencinin ID'sini URL/parametre olarak verip veri çekmeye çalışmak
# (IDOR) otomatik olarak engellenmiş olur.

def teacher_class_list(class_name_raw):
    """Öğretmen hesabının 'class_name' alanını yorumlar:
    - '*'                => None döner (okul müdürü gibi TÜM sınıflara sınırsız erişim)
    - 'A,B,C'             => ['A','B','C'] (birden fazla sınıfa erişim)
    - 'A' (eski, tekil)   => ['A'] (geriye dönük uyumluluk)
    """
    raw = (class_name_raw or "").strip()
    if raw == "*":
        return None
    return [c.strip() for c in raw.split(",") if c.strip()]


def teacher_class_display(class_name_raw):
    """teacher_class_list'in sonucunu ekranda gösterime uygun bir metne çevirir
    ('*' -> 'Tüm Sınıflar', 'A,B' -> 'A, B'). Öğretmen dışındaki roller için
    class_name zaten boş olduğundan zararsızca None döner."""
    classes = teacher_class_list(class_name_raw)
    if classes is None:
        return "Tüm Sınıflar"
    return ", ".join(classes) if classes else None


def get_allowed_student_ids(db):
    """None => sınırsız erişim (admin / tüm sınıflara yetkili öğretmen).
    Aksi halde izinli öğrenci id'lerinin kümesi."""
    role = session.get("role")
    if role == "admin":
        return None
    if role == "super_admin":
        # admin'in aksine "None = sinirsiz" DEGIL - super_admin'in sabit bir
        # organization_id'si yok (NULL), bu yuzden ?school_id= ile ACIKCA
        # hangi okulu goruntuledigini belirtmek zorunda (bkz. _effective_org_id).
        # Belirtmezse/gecersizse HICBIR ogrenciyi gormemeli (bos kume) -
        # None donmek yanlislikla "tum okullarin tum ogrencileri" anlamina
        # gelirdi ki bu ciddi bir okul-arasi veri sizintisi olurdu.
        org_id = _effective_org_id(db)
        if org_id is None:
            return set()
        rows = db.execute("SELECT id FROM students WHERE organization_id = ?", (org_id,)).fetchall()
        return {r["id"] for r in rows}
    if role == "teacher":
        org_id = _current_org_id(db)
        classes = teacher_class_list(session.get("class_name"))
        if classes is None:
            rows = db.execute("SELECT id FROM students WHERE organization_id = ?", (org_id,)).fetchall()
        elif classes:
            placeholders = ",".join("?" * len(classes))
            rows = db.execute(
                f"SELECT id FROM students WHERE organization_id = ? AND class_name IN ({placeholders})",
                (org_id, *classes),
            ).fetchall()
        else:
            rows = []
        return {r["id"] for r in rows}
    if role == "parent":
        rows = db.execute(
            "SELECT student_id FROM parent_students WHERE parent_user_id = ?",
            (session.get("user_id"),),
        ).fetchall()
        return {r["student_id"] for r in rows}
    if role == "student":
        sid = session.get("student_id")
        return {sid} if sid else set()
    return set()


def can_view_student(db, student_id):
    allowed = get_allowed_student_ids(db)
    return allowed is None or student_id in allowed


# ============================================================
# /api/ istekleri için JSON hata sayfaları
# ============================================================
# Flask'ın varsayılan 404/405/500 sayfaları HTML döner. Ön yüzdeki tüm kod
# `res.json()` beklediği için, beklenmeyen bir durumda (yanlış adres, kapanan
# oturum, sunucu hatası) HTML gelmesi "Unexpected token '<' is not valid
# JSON" gibi anlaşılmaz bir hataya yol açıyordu. /api/ altındaki tüm hata
# sayfalarını JSON'a çeviriyoruz; statik dosya sunumu bundan etkilenmez.

def _json_error(message, status):
    return jsonify({"error": message}), status


@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith("/api/"):
        return _json_error("İstenen adres bulunamadı.", 404)
    return e


@app.errorhandler(405)
def handle_405(e):
    if request.path.startswith("/api/"):
        return _json_error("Bu işlem için uygun olmayan bir istek yöntemi kullanıldı.", 405)
    return e


@app.errorhandler(500)
def handle_500(e):
    if request.path.startswith("/api/"):
        return _json_error("Sunucuda beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", 500)
    return e


# ============================================================
# Statik dosya sunumu (index.html sadece admin'e açık)
# ============================================================

BLOCKED_TOP_LEVEL = {".git", "__pycache__", "agentler", "node_modules"}
BLOCKED_EXTENSIONS = (".db", ".py", ".bat", ".md", ".pyc")


def _safe_send(filename):
    top = filename.split("/")[0]
    if top in BLOCKED_TOP_LEVEL or filename.startswith("."):
        return ("Erişim engellendi.", 403)
    if filename.lower().endswith(BLOCKED_EXTENSIONS):
        return ("Erişim engellendi.", 403)
    full_path = os.path.join(BASE_DIR, filename)
    if not os.path.abspath(full_path).startswith(BASE_DIR):
        return ("Erişim engellendi.", 403)
    if not os.path.isfile(full_path):
        return ("Bulunamadı.", 404)
    resp = send_from_directory(BASE_DIR, filename)
    # Kritik (500 ogrenci + 10 admin olcek analizi): eskiden HER statik
    # dosyaya (css/js/resim dahil) "no-cache" konuyordu - bu, tarayicinin VE
    # Cloudflare'in edge cache'inin bu dosyalari HIC tutmamasina, yani ayni
    # css/js dosyasinin her sayfa yuklemesinde tekrar tekrar Flask'a (bu kucuk
    # VM'ye) istek dusmesine yol aciyordu. HTML sayfalari icin "no-cache"
    # hala DOGRU (oturum bazli, ortam banner'i enjekte ediliyor) - ama
    # statik varliklar icin kisa/orta sureli bir cache, ozellikle "cok
    # sayida ogrenci ayni anda giris yapiyor" gibi yuk anlarinda VM'ye
    # gereksiz tekrar istek dusmesini onemli olcude azaltir. 1 saat -
    # deploy sonrasi eski dosyanin gorulme penceresi kucuk tutuluyor
    # (icerik-hash'li dosya adi yok, o yuzden cok uzun bir sure guvenli
    # olmazdi).
    if filename.lower().endswith((
        ".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".ico",
        ".woff", ".woff2", ".gif", ".webp",
    )):
        resp.headers["Cache-Control"] = "public, max-age=3600"
    else:
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/")
def root():
    role = session.get("role")
    if role in ("admin", "super_admin"):
        return _safe_send("index.html")
    if role == "teacher":
        # Yetki devredilmis (delege) bir ogretmense hesap ekleme/listeleme
        # icin admin SPA'sina yonlendirilir; kendi ders panelini gormek
        # isterse /ogretmen.html'i dogrudan ziyaret edebilir.
        if has_permission(get_db(), session["user_id"], "users.manage"):
            return _safe_send("index.html")
        return redirect("/ogretmen.html")
    if role == "parent":
        return redirect("/veli.html")
    if role == "student":
        return redirect("/ogrenci.html")
    return _safe_send("landing.html")


@app.route("/index.html")
def index_html():
    role = session.get("role")
    if role in ("admin", "super_admin"):
        return _safe_send("index.html")
    if role == "teacher" and has_permission(get_db(), session.get("user_id"), "users.manage"):
        return _safe_send("index.html")
    return redirect("/login.html")


@app.route("/<path:filename>")
def static_files(filename):
    if filename == "index.html":
        return index_html()
    return _safe_send(filename)


# ============================================================
# API: Kimlik doğrulama
# ============================================================

@app.route("/api/login", methods=["POST"])
def api_login():
    ip = request.remote_addr
    if _login_rate_limited(ip):
        return jsonify({"error": "Çok fazla başarısız deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin."}), 429
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user:
        _login_record_failure(ip)
        return jsonify({"error": "Kullanıcı adı veya şifre hatalı."}), 401
    ok, needs_rehash = verify_password(user["password_hash"], password)
    if not ok:
        _login_record_failure(ip)
        return jsonify({"error": "Kullanıcı adı veya şifre hatalı."}), 401
    _login_clear_failures(ip)
    if not user["active"]:
        return jsonify({"error": "Bu hesap pasifleştirilmiş. Yöneticinizle iletişime geçin."}), 403
    # Okulun kendisi pasiflestirilmisse (bkz. api_superadmin_toggle_organization_status)
    # o okula bagli KIMSE giris yapamaz - platform sahibinin organization_id'si
    # NULL oldugu icin bu kontrolden hic etkilenmez.
    if user["organization_id"]:
        # 'trial' de giris icin ACTIVE ile ESDEGER (suresi henuz dolmamis bir
        # deneme kullanicilari engellemez) - once ONCEKI durumu yakala (mesaj
        # icin), SONRA suresi gecmis trial'lari pasife cek, SONRA guncel
        # duruma bak.
        org_before = db.execute(
            "SELECT status FROM organizations WHERE id = ?", (user["organization_id"],)
        ).fetchone()
        was_trial = bool(org_before) and org_before["status"] == "trial"
        _process_trial_lifecycle(db)
        org = db.execute(
            "SELECT status FROM organizations WHERE id = ?", (user["organization_id"],)
        ).fetchone()
        if org and org["status"] not in ("active", "trial"):
            msg = ("Bu okulun deneme süresi sona ermiş. Platform yöneticinizle iletişime geçin."
                   if was_trial
                   else "Bu okulun hesabı pasifleştirilmiş. Platform yöneticinizle iletişime geçin.")
            return jsonify({"error": msg}), 403
    if needs_rehash:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user["id"]))
        db.commit()

    # Komuta Merkezi (Ana Sayfa Geliştirme Önerileri) faz A: "son giriş"
    # okul sağlığı skorunun ve "30 gündür giriş yok" uyarısının temel girdisi -
    # her başarılı girişte güncellenir.
    db.execute("UPDATE users SET last_login = ? WHERE id = ?", (datetime.now().isoformat(), user["id"]))
    db.commit()

    session.clear()
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session["display_name"] = user["display_name"]
    session["class_name"] = user["class_name"]
    session["student_id"] = user["student_id"]
    session.permanent = True

    log_audit(db, "LOGIN_SUCCESS", resource_type="user", resource_id=user["id"], user_id=user["id"])

    # Yetki devredilmis (delege) bir ogretmen mi? login.html bu bayrağa göre
    # admin SPA'sina mi yoksa normal /ogretmen.html'e mi yonlendirecegine
    # karar veriyor - /api/me'deki ayni mantik (bkz. orada).
    is_delegate = user["role"] == "teacher" and has_permission(db, user["id"], "users.manage")
    # Platform sahibi bir admin mi (bkz. scripts/grant_platform_admin.py) -
    # legacy role='admin' kalir, sadece EK bir "organization.manage" izni
    # verilmis olabilir. /api/me'deki ayni mantik (bkz. orada).
    can_manage_schools = has_permission(db, user["id"], "organization.manage")
    can_manage_admins = has_permission(db, user["id"], "admins.manage")
    user_limit = None
    if user["organization_id"]:
        org_row = db.execute(
            "SELECT user_limit FROM organizations WHERE id = ?", (user["organization_id"],)
        ).fetchone()
        user_limit = org_row["user_limit"] if org_row else None
    # Veri Girişi Admini mi? (admin-panel-prompt.md bölüm 7: "+ Yeni Deneme"
    # butonunu göremez.) NOT: bu SADECE frontend'te butonu gizler - backend
    # tarafında exams.create'i GERÇEKTEN kısıtlamaz (bkz. _admin_subrole
    # yorumu, DATA_ADMIN'in yanında otomatik INSTITUTION_ADMIN de taşınır).
    data_entry_only = user["role"] == "admin" and _admin_subrole(db, user["id"], user["role"]) == "DATA_ADMIN"

    return jsonify({
        "ok": True, "role": user["role"], "displayName": user["display_name"],
        "className": teacher_class_display(user["class_name"]) if user["role"] == "teacher" else user["class_name"],
        "studentId": user["student_id"],
        "isDelegateAdmin": is_delegate,
        "canManageSchools": can_manage_schools,
        "canManageAdmins": can_manage_admins,
        "organizationId": user["organization_id"],
        "userLimit": user_limit,
        "dataEntryOnly": data_entry_only,
    })


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    if "user_id" not in session:
        return jsonify({"authenticated": False})
    # Yetki devredilmis bir ogretmen mi? (legacy role hala 'teacher' -
    # bkz. /api/admin/users/<id>/delegate) - frontend'in "Kullanicilar"
    # sayfasinda hangi butonlari (sil/pasiflestir/sifre sifirla DEGIL,
    # sadece ekleme/listeleme) gosterecegine karar vermesi icin.
    db = get_db()
    is_delegate = (
        session.get("role") == "teacher"
        and has_permission(db, session["user_id"], "users.manage")
    )
    # Platform sahibi bir admin mi (bkz. scripts/grant_platform_admin.py) -
    # legacy role='admin' kalir, sadece EK bir "organization.manage" izni
    # verilmis olabilir - bu durumda normal admin panelinin YANI SIRA
    # "Okullar" sekmesini de gorur (bkz. js/app.js init()).
    can_manage_schools = has_permission(db, session["user_id"], "organization.manage")
    can_manage_admins = has_permission(db, session["user_id"], "admins.manage")
    own_org_row = db.execute(
        "SELECT organization_id FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()
    own_org_id = own_org_row["organization_id"] if own_org_row else None
    user_limit = None
    if own_org_id:
        limit_row = db.execute("SELECT user_limit FROM organizations WHERE id = ?", (own_org_id,)).fetchone()
        user_limit = limit_row["user_limit"] if limit_row else None
    data_entry_only = (
        session.get("role") == "admin"
        and _admin_subrole(db, session["user_id"], session.get("role")) == "DATA_ADMIN"
    )
    return jsonify({
        "authenticated": True, "role": session.get("role"),
        "displayName": session.get("display_name"),
        "className": teacher_class_display(session.get("class_name")) if session.get("role") == "teacher" else session.get("class_name"),
        "studentId": session.get("student_id"),
        "isDelegateAdmin": is_delegate,
        "canManageSchools": can_manage_schools,
        "canManageAdmins": can_manage_admins,
        "organizationId": own_org_id,
        "userLimit": user_limit,
        "dataEntryOnly": data_entry_only,
    })


@app.route("/api/data-admin/dashboard")
@login_required(role=("admin", "super_admin"), permission="students.view")
def api_data_admin_dashboard():
    """Komuta Merkezi (yeni master prompt, Bölüm 2): Veri Giriş Admini'nin
    operasyon odaklı Anasayfa'sı. NOT: master prompt "bekleyen dosyalar /
    hatalı dosyalar / işleme başarı oranı" istiyor ama bunun karşılığı
    backend'de YOK - Veri Girişi sayfasındaki Manuel/Excel/Optik/PDF
    akışlarının hepsi tarayıcının yerel IndexedDB'sinde çalışır, sunucuya
    sadece /api/admin/sync push'unda (tamamlanmış, tek satır) uğrar; ayrı
    dosyalar için kuyruk/durum takibi hiç tutulmuyor (question_bank'in PDF
    içe aktarma hattının aksine). Bu yüzden burada GERÇEKTEN var olan ve
    aksiyon alınabilir 4 sinyal kullanılıyor: öğrenci sayısı, son senkron,
    sınıfı/şubesi atanmamış öğrenciler (gerçek bir veri kalitesi sorunu -
    bkz. js/app.js Sınıf Karşılaştırma'daki "5/undefined" hatasının kökeni
    de bu), ve en son denemede sonucu eksik öğrenciler."""
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    total_students = db.execute(
        "SELECT COUNT(*) c FROM students WHERE organization_id=?", (org_id,)
    ).fetchone()["c"]

    missing_class = db.execute(
        "SELECT COUNT(*) c FROM students WHERE organization_id=? "
        "AND (class_name IS NULL OR TRIM(class_name)='')", (org_id,)
    ).fetchone()["c"]

    last_sync = db.execute(
        "SELECT created_at, total_records FROM imports "
        "WHERE organization_id=? AND file_type='admin_sync' "
        "ORDER BY id DESC LIMIT 1", (org_id,)
    ).fetchone()

    latest_exam = db.execute(
        "SELECT id, name, date FROM exams WHERE organization_id=? "
        "ORDER BY date DESC, id DESC LIMIT 1", (org_id,)
    ).fetchone()
    missing_results = None
    if latest_exam:
        results_count = db.execute(
            "SELECT COUNT(DISTINCT student_id) c FROM results WHERE exam_id=?", (latest_exam["id"],)
        ).fetchone()["c"]
        missing_results = max(total_students - results_count, 0)

    return jsonify({
        "totalStudents": total_students,
        "missingClassCount": missing_class,
        "lastSync": {"at": last_sync["created_at"], "totalRecords": last_sync["total_records"]} if last_sync else None,
        "latestExam": {
            "id": latest_exam["id"], "name": latest_exam["name"], "date": latest_exam["date"],
            "missingResultsCount": missing_results,
        } if latest_exam else None,
    })


@app.route("/api/firebase-token")
@login_required(role=("admin", "super_admin"))
def api_firebase_token():
    """Bulut senkronizasyonu (js/sync.js) icin Firebase custom token uretir.
    Token'a organization_id claim'i gomulur; Firestore kurallari bu claim'i
    oda adiyla (edupusula-org-<id>) karsilastirip baska bir okulun senkron
    odasina erisimi engeller (bkz. FIREBASE_ADMIN_KEY_PATH yorumu)."""
    if firebase_auth is None:
        return jsonify({"error": "Bulut senkronizasyonu sunucuda yapılandırılmamış."}), 503
    db = get_db()
    own_org_row = db.execute(
        "SELECT organization_id FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()
    org_id = own_org_row["organization_id"] if own_org_row else None
    if not org_id:
        return jsonify({"error": "Bu hesabın senkronize edeceği bir okulu yok."}), 400
    try:
        token = firebase_auth.create_custom_token(f"user-{session['user_id']}", {"org_id": org_id})
    except Exception as exc:
        print(f"[firebase-token] özel token üretilemedi: {exc}")
        return jsonify({"error": "Bulut kimlik doğrulama tokeni üretilemedi."}), 500
    return jsonify({"token": token.decode("utf-8") if isinstance(token, bytes) else token})


# ============================================================
# API: Süper admin - okul (organization) yönetimi
# ============================================================
# Faz 1 kapsami: sadece okul listeleme/olusturma. Super admin'in baska
# hicbir role="admin" ucuna erisimi YOK - bir okulun verisine "girip
# bakma" bilincli olarak bu fazda yok (bkz. proje plani).

_TR_SLUG_MAP = str.maketrans({
    "ş": "s", "Ş": "s", "ç": "c", "Ç": "c", "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ı": "i", "İ": "i",
})


def _slugify(text):
    text = (text or "").translate(_TR_SLUG_MAP).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "okul"


def _external_base_url():
    """request.host_url, Cloudflare Tunnel arkasinda HER ZAMAN http:// doner
    (TLS Cloudflare'de sonlanir, cloudflared'a duz HTTP ile gelir) - davet
    linkleri bu yuzden yanlislikla http:// ile uretilirdi. Cloudflare/cogu
    ters proxy X-Forwarded-Proto basligini gercek semayla dolduruyor;
    yoksa (yerel gelistirme) request.scheme'e (http) duser."""
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme)
    return f"{scheme}://{request.host}"


def _compute_school_health(db, org_id):
    """Komuta Merkezi (Ana Sayfa Geliştirme Önerileri, madde 3/6/7) - bir
    okulun platformu ne kadar aktif/verimli kullandığını 0-100 arası tek bir
    skora indirger. Ağırlıklar kasıtlı basit/açıklanabilir (uydurma bir "AI
    skoru" değil):
      - Son giriş yakınlığı (30p): 7 gün içinde=30, 30 gün içinde=15, sonrası/hiç=0
      - Deneme yükleme sıklığı (25p): son 30 günde >=5 deneme=25, >=1=15, 0=0
      - Aktif öğretmen oranı (20p): son 30 günde giriş yapan öğretmen / toplam öğretmen
      - Aktif öğrenci oranı (15p): son 30 günde sonucu olan öğrenci / toplam öğrenci
      - Veri kalitesi (10p): question_import_batches'te başarısız oran düşükse tam puan
    Öğretmen/öğrenci/batch hiç yoksa o bileşen için tam puan verilir (henüz
    veri üretme fırsatı olmamış yeni bir okulu cezalandırmamak için)."""
    now = datetime.now()
    d7 = (now - timedelta(days=7)).isoformat()
    d30 = (now - timedelta(days=30)).isoformat()

    last_login_row = db.execute(
        "SELECT MAX(last_login) AS ml FROM users WHERE organization_id=?", (org_id,)
    ).fetchone()
    last_login = last_login_row["ml"] if last_login_row else None
    if last_login and last_login >= d7:
        login_score = 30
    elif last_login and last_login >= d30:
        login_score = 15
    else:
        login_score = 0

    exam_count_30d = db.execute(
        "SELECT COUNT(*) c FROM exams WHERE organization_id=? AND date >= ?", (org_id, d30[:10])
    ).fetchone()["c"]
    exam_score = 25 if exam_count_30d >= 5 else (15 if exam_count_30d >= 1 else 0)

    teacher_total = db.execute(
        "SELECT COUNT(*) c FROM users WHERE organization_id=? AND role='teacher'", (org_id,)
    ).fetchone()["c"]
    teacher_active = db.execute(
        "SELECT COUNT(*) c FROM users WHERE organization_id=? AND role='teacher' AND last_login >= ?",
        (org_id, d30),
    ).fetchone()["c"]
    teacher_score = 20 if teacher_total == 0 else round((teacher_active / teacher_total) * 20, 1)

    student_total = db.execute(
        "SELECT COUNT(*) c FROM students WHERE organization_id=?", (org_id,)
    ).fetchone()["c"]
    student_active = db.execute(
        "SELECT COUNT(DISTINCT r.student_id) c FROM results r JOIN exams e ON e.id=r.exam_id "
        "WHERE r.organization_id=? AND e.date >= ?", (org_id, d30[:10]),
    ).fetchone()["c"]
    student_score = 15 if student_total == 0 else round(min(student_active / student_total, 1.0) * 15, 1)

    batch_total = db.execute(
        "SELECT COUNT(*) c FROM question_import_batches WHERE organization_id=?", (org_id,)
    ).fetchone()["c"]
    batch_failed = db.execute(
        "SELECT COUNT(*) c FROM question_import_batches WHERE organization_id=? AND status='failed'", (org_id,)
    ).fetchone()["c"]
    quality_score = 10 if batch_total == 0 else round((1 - batch_failed / batch_total) * 10, 1)

    total = round(login_score + exam_score + teacher_score + student_score + quality_score, 1)
    band = "healthy" if total >= 70 else ("warning" if total >= 40 else "risky")
    return {
        "score": total, "band": band,
        "breakdown": {
            "loginRecency": login_score, "examActivity": exam_score,
            "teacherActivity": teacher_score, "studentActivity": student_score,
            "dataQuality": quality_score,
        },
    }


@app.route("/api/superadmin/dashboard")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_dashboard():
    """Platform geneli ozet (admin-panel-prompt.md bolum 2) - okul durum
    kirilimi, toplam ogrenci, limite yaklasan okul sayisi, bugun/bu hafta
    yapilan deneme sayisi, son denemeler + zaman icindeki deneme grafigi,
    ve TUM okullari kapsayan bir aktivite akisi.

    Aktivite akisi icin BILEREK /api/superadmin/audit-logs'u (ve onun
    _effective_org_id filtresini) yeniden KULLANMIYORUZ - o uc "bu okulun
    KENDI personelinin yaptigi islemler" anlamina gelir ve saf platform
    hesaplari (organization_id NULL, ?school_id= verilmemis) icin 400 doner
    (bkz. _effective_org_id yorumu). Platform ozetinin amaci tam tersi:
    TUM okullari kapsayan tek bir akis - bu yuzden burada ayri, filtresiz
    bir sorgu kullaniyoruz."""
    db = get_db()
    _process_trial_lifecycle(db)

    status_rows = db.execute("SELECT status, COUNT(*) AS c FROM organizations GROUP BY status").fetchall()
    school_counts = {"active": 0, "trial": 0, "inactive": 0}
    for r in status_rows:
        if r["status"] in school_counts:
            school_counts[r["status"]] = r["c"]
    school_counts["total"] = sum(school_counts.values())

    total_students = db.execute("SELECT COUNT(*) AS c FROM students").fetchone()["c"]

    # Komuta Merkezi (Ana Sayfa Geliştirme Önerileri madde 1): KPI kartlarına
    # "son 30 günde +N okul" gibi bir trend eklemek için.
    trend_cutoff = (datetime.now() - timedelta(days=30)).isoformat()
    schools_added_30d = db.execute(
        "SELECT COUNT(*) c FROM organizations WHERE created_at >= ?", (trend_cutoff,)
    ).fetchone()["c"]

    # Madde 1: KPI kartındaki toplam kullanıcı sayısının rol dağılımı
    # (tooltip/modal için) - 4 kategori: öğrenci/öğretmen/okul yöneticisi
    # (kendi okuluna atanmış admin)/platform admin (organization_id NULL).
    role_breakdown = {
        "students": total_students,
        "teachers": db.execute("SELECT COUNT(*) c FROM users WHERE role='teacher'").fetchone()["c"],
        "schoolAdmins": db.execute(
            "SELECT COUNT(*) c FROM users WHERE role IN ('admin','super_admin') AND organization_id IS NOT NULL"
        ).fetchone()["c"],
        "platformAdmins": db.execute(
            "SELECT COUNT(*) c FROM users WHERE role IN ('admin','super_admin') AND organization_id IS NULL"
        ).fetchone()["c"],
    }

    schools_near_limit = db.execute(
        "SELECT COUNT(*) AS c FROM organizations o WHERE o.user_limit IS NOT NULL "
        "AND (SELECT COUNT(*) FROM students s WHERE s.organization_id = o.id) >= o.user_limit * 0.8"
    ).fetchone()["c"]

    # Komuta Merkezi (yeni master prompt, Bölüm 5): "Kullanıcı" KPI kartı için
    # platform çapında kota kullanımı - SADECE user_limit'i olan okullar dahil
    # edilir (sınırsız okulların öğrencisi payda/pay'a girmez, aksi halde
    # kota yüzdesi yapay şekilde düşük görünürdü).
    quota_row = db.execute(
        "SELECT COALESCE(SUM(o.user_limit), 0) AS limit_sum, "
        "COALESCE(SUM((SELECT COUNT(*) FROM students s WHERE s.organization_id = o.id)), 0) AS used_sum "
        "FROM organizations o WHERE o.user_limit IS NOT NULL"
    ).fetchone()
    user_quota = None
    if quota_row["limit_sum"] > 0:
        user_quota = {
            "used": quota_row["used_sum"], "limit": quota_row["limit_sum"],
            "pct": round(quota_row["used_sum"] / quota_row["limit_sum"] * 100),
        }

    # Bölüm 7: "Abonelik" KPI kartı - trial'ların ne kadarı yakında bitiyor
    # (_compute_attention_items'taki 'expiring_trial' ile aynı 7 günlük pencere).
    soon_cutoff = (datetime.now() + timedelta(days=7)).isoformat()
    expiring_trial_count = db.execute(
        "SELECT COUNT(*) c FROM organizations WHERE status='trial' "
        "AND trial_ends_at IS NOT NULL AND trial_ends_at <= ?", (soon_cutoff,)
    ).fetchone()["c"]

    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")
    prev_week_start = (datetime.now() - timedelta(days=13)).strftime("%Y-%m-%d")
    month_ago = (datetime.now() - timedelta(days=29)).strftime("%Y-%m-%d")
    exams_today = db.execute("SELECT COUNT(*) AS c FROM exams WHERE date = ?", (today,)).fetchone()["c"]
    exams_this_week = db.execute("SELECT COUNT(*) AS c FROM exams WHERE date >= ?", (week_ago,)).fetchone()["c"]
    exams_this_month = db.execute("SELECT COUNT(*) AS c FROM exams WHERE date >= ?", (month_ago,)).fetchone()["c"]
    exams_prev_week = db.execute(
        "SELECT COUNT(*) AS c FROM exams WHERE date >= ? AND date < ?", (prev_week_start, week_ago)
    ).fetchone()["c"]
    exams_week_change_pct = round((exams_this_week - exams_prev_week) / exams_prev_week * 100) if exams_prev_week else None

    recent_exams = db.execute(
        "SELECT e.id, e.name, e.date, o.name AS org_name, "
        "(SELECT COUNT(DISTINCT r.student_id) FROM results r WHERE r.exam_id = e.id) AS participant_count "
        "FROM exams e LEFT JOIN organizations o ON o.id = e.organization_id "
        "ORDER BY e.date DESC, e.id DESC LIMIT 10"
    ).fetchall()

    chart_start = (datetime.now() - timedelta(days=13)).strftime("%Y-%m-%d")
    chart_rows = db.execute(
        "SELECT date, COUNT(*) AS c FROM exams WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date",
        (chart_start, today),
    ).fetchall()

    # audit_logs.organization_id ISLEMI YAPAN kisinin okulunu tutar, ETKILENEN
    # kaynagin okulunu DEGIL (bkz. api_superadmin_audit_logs yorumu) - platform
    # sahibi baska bir okulu duzenlediginde/o okula admin eklediginde bu satir
    # olmadan HER ZAMAN platform sahibinin KENDI okulunun adi gorunurdu. Bu
    # yuzden resource_type'a gore GERCEKTEN etkilenen okulu coz: 'organization'
    # ise resource_id DOGRUDAN bir organizations.id'dir; 'user' ise resource_id
    # bir users.id'dir, o kullanicinin organization_id'sinden okula ulasilir.
    # Diger resource_type'lar (student/exam/result/admin_sync - hepsi
    # platform-admin dogrudan yazma ya da senkron kaynakli) icin bu coz ume
    # yapilmiyor, actor'un kendi okulu fallback olarak kalir (bkz. asagisi -
    # ayri, gelecekteki bir is: bu id'ler ORG_ID_BLOCK_SIZE ile kodlanmis,
    # coz mek ayri bir yardimci fonksiyon gerektirir).
    activity_rows = db.execute(
        "SELECT al.id, al.action, al.resource_type, al.resource_id, al.created_at, "
        "u.username, u.display_name, "
        "COALESCE(res_org.name, target_user_org.name, actor_org.name) AS org_name "
        "FROM audit_logs al "
        "LEFT JOIN users u ON u.id = al.user_id "
        "LEFT JOIN organizations actor_org ON actor_org.id = al.organization_id "
        "LEFT JOIN organizations res_org ON al.resource_type = 'organization' AND res_org.id = al.resource_id "
        "LEFT JOIN users target_user ON al.resource_type = 'user' AND target_user.id = al.resource_id "
        "LEFT JOIN organizations target_user_org ON target_user_org.id = target_user.organization_id "
        "WHERE al.action != 'LOGIN_SUCCESS' "
        "ORDER BY al.id DESC LIMIT 20"
    ).fetchall()

    return jsonify({
        "schoolCounts": school_counts,
        "schoolsAdded30d": schools_added_30d,
        "totalStudents": total_students,
        "userRoleBreakdown": role_breakdown,
        "schoolsNearLimit": schools_near_limit,
        "userQuota": user_quota,
        "expiringTrialCount": expiring_trial_count,
        "examsToday": exams_today,
        "examsThisWeek": exams_this_week,
        "examsThisMonth": exams_this_month,
        "examsWeekChangePct": exams_week_change_pct,
        "recentExams": [{
            "id": r["id"], "name": r["name"], "date": r["date"],
            "organizationName": r["org_name"], "participantCount": r["participant_count"],
        } for r in recent_exams],
        "examChart": [{"date": r["date"], "count": r["c"]} for r in chart_rows],
        "recentActivity": [{
            "id": r["id"], "action": r["action"], "resourceType": r["resource_type"],
            "resourceId": r["resource_id"], "createdAt": r["created_at"],
            "actorDisplayName": r["display_name"] or r["username"],
            "organizationName": r["org_name"],
        } for r in activity_rows],
    })


@app.route("/api/superadmin/growth-chart")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_growth_chart():
    """Komuta Merkezi (Ana Sayfa Geliştirme Önerileri madde 4): tek grafiğin
    zaman aralığı ve metriği sorgu parametreleriyle değişir - ayrı bir uç,
    çünkü filtre her değiştiğinde ana dashboard'un tamamını yeniden çekmeye
    gerek yok. 1y'de günlük 365 nokta yerine aya göre gruplanır (okunabilirlik)."""
    db = get_db()
    range_key = request.args.get("range", "30d")
    metric = request.args.get("metric", "exams")
    range_days = {"7d": 7, "30d": 30, "3m": 90, "1y": 365}.get(range_key, 30)
    by_month = range_key == "1y"
    now = datetime.now()
    start = (now - timedelta(days=range_days - 1)).strftime("%Y-%m-%d")
    end = now.strftime("%Y-%m-%d")
    date_expr = "substr(date, 1, 7)" if by_month else "date"

    if metric == "exams":
        rows = db.execute(
            f"SELECT {date_expr} AS bucket, COUNT(*) AS c FROM exams "
            "WHERE date >= ? AND date <= ? GROUP BY bucket ORDER BY bucket",
            (start, end),
        ).fetchall()
    elif metric == "activeStudents":
        rows = db.execute(
            f"SELECT {date_expr.replace('date', 'e.date')} AS bucket, COUNT(DISTINCT r.student_id) AS c "
            "FROM results r JOIN exams e ON e.id = r.exam_id "
            "WHERE e.date >= ? AND e.date <= ? GROUP BY bucket ORDER BY bucket",
            (start, end),
        ).fetchall()
    elif metric == "newUsers":
        date_expr_created = "substr(created_at, 1, 7)" if by_month else "substr(created_at, 1, 10)"
        rows = db.execute(
            f"SELECT {date_expr_created} AS bucket, COUNT(*) AS c FROM users "
            "WHERE created_at >= ? AND created_at <= ? GROUP BY bucket ORDER BY bucket",
            (start, end + "T23:59:59"),
        ).fetchall()
    else:
        return jsonify({"error": "Geçersiz metrik."}), 400

    return jsonify([{"date": r["bucket"], "value": r["c"]} for r in rows])


@app.route("/api/superadmin/school-rankings")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_school_rankings():
    """Komuta Merkezi (Ana Sayfa Geliştirme Önerileri madde 6+7): 'En Aktif
    Okullar' (bu haftaki deneme sayısına göre) ve 'Aktivitesi Düşen Okullar'
    (bu hafta vs geçen hafta - SaaS'ta 'churn risk monitoring') - ikisi de
    aynı iki haftalık pencereden türetildiği için tek uçta birleştirildi."""
    db = get_db()
    now = datetime.now()
    this_week_start = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    last_week_start = (now - timedelta(days=13)).strftime("%Y-%m-%d")
    last_week_end = (now - timedelta(days=7)).strftime("%Y-%m-%d")

    this_week_counts = {r["organization_id"]: r["c"] for r in db.execute(
        "SELECT organization_id, COUNT(*) c FROM exams WHERE date >= ? GROUP BY organization_id",
        (this_week_start,),
    ).fetchall()}
    last_week_counts = {r["organization_id"]: r["c"] for r in db.execute(
        "SELECT organization_id, COUNT(*) c FROM exams WHERE date >= ? AND date < ? GROUP BY organization_id",
        (last_week_start, last_week_end),
    ).fetchall()}
    schools = {r["id"]: r["name"] for r in db.execute(
        "SELECT id, name FROM organizations WHERE status != 'inactive'"
    ).fetchall()}

    top_active = sorted(
        [{"id": oid, "name": schools[oid], "examCount": c} for oid, c in this_week_counts.items() if oid in schools and c > 0],
        key=lambda x: x["examCount"], reverse=True,
    )[:5]

    declining = []
    for oid, name in schools.items():
        cur_c = this_week_counts.get(oid, 0)
        prev_c = last_week_counts.get(oid, 0)
        if prev_c >= 3 and cur_c < prev_c:
            drop_pct = round((1 - cur_c / prev_c) * 100)
            if drop_pct >= 30:
                declining.append({"id": oid, "name": name, "dropPercent": drop_pct, "thisWeek": cur_c, "lastWeek": prev_c})
    declining.sort(key=lambda x: x["dropPercent"], reverse=True)

    return jsonify({"topActive": top_active, "declining": declining[:5]})


@app.route("/api/superadmin/pusi-insights")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_pusi_insights():
    """Komuta Merkezi (Ana Sayfa Geliştirme Önerileri madde 5; yeni master
    prompt Bölüm 12): 'Pusi'nin Günlük Analizi' - KURAL TABANLI (gerçek bir
    LLM çağrısı YOK, bkz. server.py'deki mevcut AI-STUB yorumu,
    ai.analyze/generate_* ile aynı yaklaşım). Faz A-D'nin ürettiği verilerin
    üzerine ek bir sorgu katmanı değil, çoğunlukla onların BASİT bir yeniden
    özetlemesi. Her içgörü artık düz metin değil, {category, text, anchor}
    - category rozet rengini/ikonunu belirler (Fırsat/Risk/Öneri/Başarı/
    Analiz), anchor (varsa) frontend'de o DOM id'sine scroll eder (bkz.
    js/schools.js - Pusi ile aynı sayfada oldukları için ayrı bir sayfaya
    YÖNLENDİRME yok, sadece sayfa içi kaydırma)."""
    db = get_db()
    now = datetime.now()
    this_week_start = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    last_week_start = (now - timedelta(days=13)).strftime("%Y-%m-%d")
    last_week_end = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    insights = []

    exams_this_week = db.execute(
        "SELECT COUNT(*) c FROM exams WHERE date >= ?", (this_week_start,)
    ).fetchone()["c"]
    exams_last_week = db.execute(
        "SELECT COUNT(*) c FROM exams WHERE date >= ? AND date < ?", (last_week_start, last_week_end)
    ).fetchone()["c"]
    if exams_last_week > 0:
        change_pct = round((exams_this_week - exams_last_week) / exams_last_week * 100)
        if change_pct > 0:
            insights.append({"category": "Fırsat", "anchor": "schools-growth-card",
                              "text": f"Bu hafta platform kullanımı geçen haftaya göre %{change_pct} arttı."})
        elif change_pct < 0:
            insights.append({"category": "Risk", "anchor": "schools-growth-card",
                              "text": f"Bu hafta platform kullanımı geçen haftaya göre %{abs(change_pct)} azaldı."})

    declining_count = db.execute(
        "SELECT COUNT(*) c FROM ("
        "  SELECT e.organization_id, "
        "  SUM(CASE WHEN e.date >= ? THEN 1 ELSE 0 END) AS cur_c, "
        "  SUM(CASE WHEN e.date >= ? AND e.date < ? THEN 1 ELSE 0 END) AS prev_c "
        "  FROM exams e GROUP BY e.organization_id"
        ") t WHERE t.prev_c >= 3 AND t.cur_c < t.prev_c * 0.7",
        (this_week_start, last_week_start, last_week_end),
    ).fetchone()["c"]
    if declining_count > 0:
        insights.append({"category": "Risk", "anchor": "schools-rankings-card",
                          "text": f"{declining_count} okulda deneme girişleri geçen haftaya göre ciddi şekilde azaldı."})

    new_school_cutoff = (now - timedelta(days=30)).isoformat()
    new_schools = db.execute(
        "SELECT COUNT(*) c FROM organizations WHERE created_at >= ?", (new_school_cutoff,)
    ).fetchone()["c"]
    new_schools_with_exam = db.execute(
        "SELECT COUNT(DISTINCT o.id) c FROM organizations o JOIN exams e ON e.organization_id = o.id "
        "WHERE o.created_at >= ?", (new_school_cutoff,)
    ).fetchone()["c"]
    if new_schools > 0:
        completion_pct = round(new_schools_with_exam / new_schools * 100)
        insights.append({"category": "Başarı" if completion_pct >= 50 else "Analiz", "anchor": "schools-table-card",
                          "text": f"Son 30 günde kayıt olan okulların %{completion_pct}'i ilk denemesini tamamladı."})

    near_limit_count = db.execute(
        "SELECT COUNT(*) c FROM organizations o WHERE o.user_limit IS NOT NULL "
        "AND (SELECT COUNT(*) FROM students s WHERE s.organization_id=o.id) >= o.user_limit * 0.9 "
        "AND o.status != 'inactive'"
    ).fetchone()["c"]
    if near_limit_count > 0:
        insights.append({"category": "Öneri", "anchor": "schools-table-card",
                          "text": f"{near_limit_count} okulun kullanıcı limiti dolmak üzere - paket yükseltme önerisi yapılabilir."})

    if not insights:
        insights.append({"category": "Analiz", "anchor": None,
                          "text": "Platform genelinde dikkat çeken bir değişiklik yok, her şey yolunda görünüyor."})

    return jsonify(insights)


def _compute_attention_items(db):
    """Komuta Merkezi (Ana Sayfa Geliştirme Önerileri, madde 2): 'şu an
    ilgilenmem gereken ne var' sorusunu tek bir listede cevaplar. Her satır
    zaten var olan bir sinyalin (limit/trial/inceleme/giriş/hatalı dosya)
    üzerine kurulu - burada YENİ bir hesaplama yok, sadece toplama +
    önceliklendirme (severity). 'key' alanı SABİT (madde 9 - Bildirim
    Merkezi'nin bu listeyi bildirime çevirirken tekrar tekrar aynı olayı
    YENİ bildirim olarak oluşturmaması için, bkz. _sync_notifications)."""
    _process_trial_lifecycle(db)
    items = []

    near_limit_schools = db.execute(
        "SELECT o.id, o.name, o.user_limit, (SELECT COUNT(*) FROM students s WHERE s.organization_id=o.id) AS c "
        "FROM organizations o WHERE o.user_limit IS NOT NULL "
        "AND (SELECT COUNT(*) FROM students s WHERE s.organization_id=o.id) >= o.user_limit * 0.9 "
        "AND o.status != 'inactive'"
    ).fetchall()
    if near_limit_schools:
        items.append({
            "key": "near_limit", "severity": "critical", "icon": "🔴",
            "text": f"{len(near_limit_schools)} okulun kullanıcı limiti %90'a ulaştı",
            "page": "schools", "count": len(near_limit_schools),
            "detail": [{"id": r["id"], "name": r["name"], "usage": f"{r['c']}/{r['user_limit']}"} for r in near_limit_schools],
        })

    soon_cutoff = (datetime.now() + timedelta(days=7)).isoformat()
    expiring_trials = db.execute(
        "SELECT id, name, trial_ends_at FROM organizations "
        "WHERE status='trial' AND trial_ends_at IS NOT NULL AND trial_ends_at <= ?",
        (soon_cutoff,),
    ).fetchall()
    if expiring_trials:
        items.append({
            "key": "expiring_trial", "severity": "warning", "icon": "🟡",
            "text": f"{len(expiring_trials)} okulun aboneliği 7 gün içinde bitecek",
            "page": "schools", "count": len(expiring_trials),
            "detail": [{"id": r["id"], "name": r["name"], "trialEndsAt": r["trial_ends_at"]} for r in expiring_trials],
        })

    pending_questions = db.execute(
        "SELECT COUNT(*) c FROM question_bank WHERE status IN ('pending_review','reviewed')"
    ).fetchone()["c"]
    if pending_questions:
        items.append({
            "key": "pending_questions", "severity": "info", "icon": "🟠",
            "text": f"{pending_questions} soru incelenmeyi bekliyor",
            "page": "question-bank", "count": pending_questions,
        })

    # created_at < 30 gun kosulu: yeni olusturulmus (henuz giris yapma
    # firsati olmamis) bir okulu yanlislikla "hareketsiz" diye isaretlememek icin.
    inactive_cutoff = (datetime.now() - timedelta(days=30)).isoformat()
    dormant_schools = db.execute(
        "SELECT o.id, o.name FROM organizations o WHERE o.status != 'inactive' AND o.created_at < ? "
        "AND NOT EXISTS (SELECT 1 FROM users u WHERE u.organization_id=o.id AND u.last_login >= ?)",
        (inactive_cutoff, inactive_cutoff),
    ).fetchall()
    if dormant_schools:
        items.append({
            "key": "dormant_schools", "severity": "critical", "icon": "🔴",
            "text": f"{len(dormant_schools)} okul son 30 gündür sisteme giriş yapmadı",
            "page": "schools", "count": len(dormant_schools),
            "detail": [{"id": r["id"], "name": r["name"]} for r in dormant_schools],
        })

    failed_batches = db.execute(
        "SELECT COUNT(*) c FROM question_import_batches WHERE status='failed'"
    ).fetchone()["c"]
    if failed_batches:
        items.append({
            "key": "failed_batches", "severity": "warning", "icon": "🟡",
            "text": f"{failed_batches} dosya hatalı format nedeniyle işlenemedi",
            "page": "question-bank", "count": failed_batches,
        })

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    items.sort(key=lambda it: severity_order.get(it["severity"], 3))
    return items


@app.route("/api/superadmin/attention-items")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_attention_items():
    return jsonify(_compute_attention_items(get_db()))


@app.route("/api/superadmin/system-health")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_system_health():
    """Komuta Merkezi (Ana Sayfa Geliştirme Önerileri, Faz H): basitleştirilmiş
    sistem sağlığı sinyali - gerçek altyapı izleme (CPU/RAM/ağ) DEĞİL, zaten
    var olan DB üzerinden ölçülebilen üç sinyal: bağlantı gecikmesi, dosya
    boyutu, ve son 24 saatteki başarısız soru-havuzu içe aktarmaları (bkz.
    _compute_attention_items'taki 'failed_batches' ile aynı kaynak, burada
    platform genelinde ve zaman pencereli)."""
    db = get_db()

    db_start = datetime.now()
    db.execute("SELECT 1").fetchone()
    db_latency_ms = round((datetime.now() - db_start).total_seconds() * 1000, 1)

    page_count = db.execute("PRAGMA page_count").fetchone()[0]
    page_size = db.execute("PRAGMA page_size").fetchone()[0]
    db_size_mb = round(page_count * page_size / (1024 * 1024), 1)

    cutoff_24h = (datetime.now() - timedelta(hours=24)).isoformat()
    failed_24h = db.execute(
        "SELECT COUNT(*) c FROM question_import_batches WHERE status='failed' AND created_at >= ?",
        (cutoff_24h,),
    ).fetchone()["c"]

    uptime_seconds = int((datetime.now() - _SERVER_STARTED_AT).total_seconds())

    if db_latency_ms > 200 or failed_24h >= 5:
        status = "critical"
    elif db_latency_ms > 50 or failed_24h > 0:
        status = "warning"
    else:
        status = "ok"

    return jsonify({
        "status": status,
        "dbLatencyMs": db_latency_ms,
        "dbSizeMb": db_size_mb,
        "failedImportsLast24h": failed_24h,
        "uptimeSeconds": uptime_seconds,
    })


def _sync_notifications(db, user_id):
    """Dikkat Gerekenler listesini (_compute_attention_items) bu adminin
    bildirimlerine yansıtır. 'archived' bir bildirime DOKUNULMAZ (kullanıcı
    kapattı - aynı olay devam ediyor diye tekrar tekrar geri gelmesin).
    'unread'/'read' bir bildirimin METNİ güncellenir (ör. sayı değişmişse)
    ama durumu KORUNUR. Artık gerçekleşmeyen (attention-items'ta olmayan)
    unread/read bildirimler otomatik 'read' yapılır - sorun kendiliğinden
    çözülmüş demektir, bildirim merkezinde eski/yanıltıcı kalmasın."""
    now = datetime.now().isoformat()
    items = _compute_attention_items(db)
    active_keys = set()
    for item in items:
        active_keys.add(item["key"])
        existing = db.execute(
            "SELECT id, status FROM platform_notifications WHERE user_id=? AND notif_key=?",
            (user_id, item["key"]),
        ).fetchone()
        if existing and existing["status"] == "archived":
            continue
        if existing:
            db.execute(
                "UPDATE platform_notifications SET text=?, severity=?, page=?, updated_at=? WHERE id=?",
                (item["text"], item["severity"], item["page"], now, existing["id"]),
            )
        else:
            db.execute(
                "INSERT INTO platform_notifications (user_id, notif_key, text, severity, page, status, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (user_id, item["key"], item["text"], item["severity"], item["page"], "unread", now, now),
            )
    # artik gecerli olmayan (cozulmus) unread/read bildirimleri sessizce 'read' yap
    stale = db.execute(
        "SELECT id, notif_key FROM platform_notifications WHERE user_id=? AND status != 'archived'", (user_id,)
    ).fetchall()
    for row in stale:
        if row["notif_key"] not in active_keys:
            db.execute("UPDATE platform_notifications SET status='read', updated_at=? WHERE id=?", (now, row["id"]))
    db.commit()


@app.route("/api/superadmin/notifications")
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_list_notifications():
    db = get_db()
    _sync_notifications(db, session["user_id"])
    rows = db.execute(
        "SELECT * FROM platform_notifications WHERE user_id=? AND status != 'archived' ORDER BY "
        "CASE status WHEN 'unread' THEN 0 ELSE 1 END, created_at DESC",
        (session["user_id"],),
    ).fetchall()
    unread_count = sum(1 for r in rows if r["status"] == "unread")
    return jsonify({
        "unreadCount": unread_count,
        "notifications": [{
            "id": r["id"], "text": r["text"], "severity": r["severity"], "page": r["page"],
            "status": r["status"], "createdAt": r["created_at"],
        } for r in rows],
    })


@app.route("/api/superadmin/notifications/<int:notif_id>/read", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_read_notification(notif_id):
    db = get_db()
    db.execute(
        "UPDATE platform_notifications SET status='read', updated_at=? WHERE id=? AND user_id=?",
        (datetime.now().isoformat(), notif_id, session["user_id"]),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/superadmin/notifications/<int:notif_id>/archive", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_archive_notification(notif_id):
    db = get_db()
    db.execute(
        "UPDATE platform_notifications SET status='archived', updated_at=? WHERE id=? AND user_id=?",
        (datetime.now().isoformat(), notif_id, session["user_id"]),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/superadmin/organizations", methods=["GET"])
@login_required(role=("admin", "super_admin"), permission="organizations.view")
def api_superadmin_list_organizations():
    db = get_db()
    _process_trial_lifecycle(db)  # bu listeyi her goruntuleyen, suresi gecmis trial'lari da tetikler
    rows = db.execute(
        "SELECT o.id, o.name, o.slug, o.email, o.phone, o.address, o.status, o.created_at, "
        "o.user_limit, o.trial_ends_at, "
        "(SELECT COUNT(*) FROM users WHERE organization_id=o.id AND role='admin') AS admin_count, "
        "(SELECT COUNT(*) FROM students WHERE organization_id=o.id) AS student_count, "
        "(SELECT MAX(last_login) FROM users WHERE organization_id=o.id) AS last_activity "
        "FROM organizations o ORDER BY o.created_at DESC"
    ).fetchall()
    # Ana Sayfa Geliştirme Önerileri madde 3: okul listesine "Sistem Sağlığı"
    # skoru eklenir - okul sayısı bu ölçekte küçük olduğu için (N sorgu x
    # okul sayısı) burada kabul edilebilir, mevcut admin_count/student_count
    # alt sorguları da zaten aynı desende.
    return jsonify([{
        "id": r["id"], "name": r["name"], "slug": r["slug"], "email": r["email"],
        "phone": r["phone"], "address": r["address"], "status": r["status"],
        "createdAt": r["created_at"], "adminCount": r["admin_count"], "studentCount": r["student_count"],
        "userLimit": r["user_limit"], "trialEndsAt": r["trial_ends_at"], "lastActivity": r["last_activity"],
        "health": _compute_school_health(db, r["id"]),
    } for r in rows])


@app.route("/api/superadmin/organizations", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="organizations.create")
def api_superadmin_create_organization():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    admin_username = (data.get("adminUsername") or "").strip()
    admin_password = data.get("adminPassword") or ""
    admin_display_name = (data.get("adminDisplayName") or "").strip() or admin_username
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None
    address = (data.get("address") or "").strip() or None
    user_limit = data.get("userLimit")
    user_limit = int(user_limit) if user_limit not in (None, "") else None
    if user_limit is not None and user_limit < 1:
        return jsonify({"error": "Kullanıcı limiti en az 1 olmalı."}), 400
    trial_ends_at = (data.get("trialEndsAt") or "").strip() or None
    status = "trial" if trial_ends_at else "active"

    if not name or not admin_username or not admin_password:
        return jsonify({"error": "Okul adı, yönetici kullanıcı adı ve şifresi gerekli."}), 400
    if len(admin_password) < 4:
        return jsonify({"error": "Şifre en az 4 karakter olmalı."}), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE username = ?", (admin_username,)).fetchone():
        return jsonify({"error": "Bu kullanıcı adı zaten kullanılıyor."}), 400

    base_slug = _slugify(name)
    slug = base_slug
    suffix = 2
    while db.execute("SELECT id FROM organizations WHERE slug = ?", (slug,)).fetchone():
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    now = datetime.now().isoformat()
    cur = db.execute(
        "INSERT INTO organizations (name, slug, email, phone, address, status, user_limit, trial_ends_at, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (name, slug, email, phone, address, status, user_limit, trial_ends_at, now, now),
    )
    org_id = cur.lastrowid
    admin_cur = db.execute(
        "INSERT INTO users (username, password_hash, role, display_name, organization_id, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (admin_username, hash_password(admin_password), "admin", admin_display_name, org_id, now),
    )
    db.commit()
    # Yeni admin'in user_roles (INSTITUTION_ADMIN) kaydini almasi icin -
    # aksi halde has_permission() kontrolleri (login_required(permission=...))
    # bu yeni hesap icin hep basarisiz olurdu.
    run_v2_migration(db)
    log_audit(db, "ORGANIZATION_CREATED", resource_type="organization", resource_id=org_id)
    return jsonify({
        "ok": True,
        "organization": {"id": org_id, "name": name, "slug": slug},
        "admin": {"id": admin_cur.lastrowid, "username": admin_username},
    })


@app.route("/api/superadmin/organizations/<int:org_id>", methods=["PATCH"])
@login_required(role=("admin", "super_admin"), permission="organizations.update")
def api_superadmin_update_organization(org_id):
    """Bir okulun ad/iletisim bilgilerini kismi gunceller - status (aktif/
    pasif) BURADAN degil, ayri toggle-status ucundan degistirilir (bkz.
    asagisi) - iki farkli niyet (metadata duzenleme vs. erisimi kesme)
    tek bir PATCH gövdesinde karışmasın."""
    db = get_db()
    org = db.execute("SELECT id FROM organizations WHERE id = ?", (org_id,)).fetchone()
    if not org:
        return jsonify({"error": "Okul bulunamadı."}), 404

    data = request.get_json(silent=True) or {}
    fields, values = [], []
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Okul adı boş olamaz."}), 400
        fields.append("name = ?")
        values.append(name)
    if "email" in data:
        fields.append("email = ?")
        values.append((data.get("email") or "").strip() or None)
    if "phone" in data:
        fields.append("phone = ?")
        values.append((data.get("phone") or "").strip() or None)
    if "address" in data:
        fields.append("address = ?")
        values.append((data.get("address") or "").strip() or None)
    if "userLimit" in data:
        user_limit = data.get("userLimit")
        user_limit = int(user_limit) if user_limit not in (None, "") else None
        if user_limit is not None and user_limit < 1:
            return jsonify({"error": "Kullanıcı limiti en az 1 olmalı."}), 400
        fields.append("user_limit = ?")
        values.append(user_limit)

    if not fields:
        return jsonify({"error": "Güncellenecek bir alan gönderilmedi."}), 400

    fields.append("updated_at = ?")
    values.append(datetime.now().isoformat())
    values.append(org_id)
    db.execute(f"UPDATE organizations SET {', '.join(fields)} WHERE id = ?", values)
    db.commit()
    log_audit(db, "ORGANIZATION_UPDATED", resource_type="organization", resource_id=org_id)
    return jsonify({"ok": True})


@app.route("/api/superadmin/organizations/<int:org_id>/toggle-status", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="organizations.archive")
def api_superadmin_toggle_organization_status(org_id):
    """Bir okulu aktif/pasif yapar (soft archive - hard delete YOK, bkz. plan
    context). Pasif bir okulun kullanicilari giris yapamaz (bkz. api_login),
    ama platform sahibi ?school_id= ile o okulu goruntulemeye/yeniden aktive
    etmeye devam edebilir - _effective_org_id'ye kasitli olarak dokunulmadi."""
    db = get_db()
    org = db.execute("SELECT status FROM organizations WHERE id = ?", (org_id,)).fetchone()
    if not org:
        return jsonify({"error": "Okul bulunamadı."}), 404
    # 'trial' de "erisimi acik" sayilir - manuel Pasiflestir bir trial okulu
    # da kapatabilmeli (bkz. buton: her iki durumda da tek bir "Pasiflestir"
    # aksiyonu var, ayri bir "trial'i iptal et" UI'i yok). trial_ends_at
    # BILEREK temizlenmiyor - Aktiflestir'e basilirsa okul yeniden trial'a
    # DONMEZ (dogrudan 'active' olur), bu yuzden eski tarih ortada kalmasi
    # zararsiz (bkz. _process_trial_lifecycle: sadece status='trial' iken bakar).
    new_status = "inactive" if org["status"] in ("active", "trial") else "active"
    db.execute(
        "UPDATE organizations SET status = ?, updated_at = ? WHERE id = ?",
        (new_status, datetime.now().isoformat(), org_id),
    )
    db.commit()
    log_audit(db, "ORGANIZATION_STATUS_CHANGED", resource_type="organization", resource_id=org_id)
    return jsonify({"ok": True, "status": new_status})


@app.route("/api/superadmin/organizations/<int:org_id>/extend-trial", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="organizations.archive")
def api_superadmin_extend_trial(org_id):
    """Trial bitis tarihini manuel olarak degistirir (bolum 4: 'Super Admin
    manuel olarak trial suresini uzatabilir'). Suresi zaten dolup 'inactive'e
    dusmus bir okulu da (yeni bir gelecek tarih verilerek) trial'a GERI
    DONDURUR - aksi halde bir okulu kurtarmanin tek yolu status'u dogrudan
    'active' yapmak olurdu ki bu trial baglamini tamamen kaybederdi."""
    db = get_db()
    org = db.execute("SELECT id, status FROM organizations WHERE id = ?", (org_id,)).fetchone()
    if not org:
        return jsonify({"error": "Okul bulunamadı."}), 404

    data = request.get_json(silent=True) or {}
    trial_ends_at = (data.get("trialEndsAt") or "").strip()
    if not trial_ends_at:
        return jsonify({"error": "Yeni trial bitiş tarihi gerekli."}), 400
    if trial_ends_at <= datetime.now().isoformat():
        return jsonify({"error": "Trial bitiş tarihi gelecekte olmalı."}), 400

    db.execute(
        "UPDATE organizations SET status = 'trial', trial_ends_at = ?, updated_at = ? WHERE id = ?",
        (trial_ends_at, datetime.now().isoformat(), org_id),
    )
    db.commit()
    log_audit(db, "ORGANIZATION_TRIAL_EXTENDED", resource_type="organization", resource_id=org_id)
    return jsonify({"ok": True, "status": "trial", "trialEndsAt": trial_ends_at})


# ============================================================
# API: Süper admin - admin hesapları yönetimi (admin-panel-prompt.md bölüm 1)
# ============================================================
# "Admin oluşturma/silme" SADECE admins.manage iznine sahip hesaplara açık
# (bugün: PLATFORM_ADMIN - platform sahibi). ASSISTANT_ADMIN (Admin
# Yardımcısı) kasıtlı olarak bu izne sahip DEĞİL - PERMISSION_SEED'in geri
# kalanının tamamına sahip olsa da bu uçlara giremez (bkz. ROLE_PERMISSIONS_SEED).
ADMIN_SUBROLES = {
    "PLATFORM_ADMIN": {"label": "Süper Admin", "requiresOrg": False},
    "ASSISTANT_ADMIN": {"label": "Admin Yardımcısı", "requiresOrg": False},
    "INSTITUTION_ADMIN": {"label": "Okul Admini", "requiresOrg": True},
    "DATA_ADMIN": {"label": "Veri Giriş Admini", "requiresOrg": True},
}
# Bu ekrandan doğrudan oluşturulabilen/atanabilen roller - PLATFORM_ADMIN
# (Süper Admin) kasıtlı olarak dışarıda: platform sahipliği kadar hassas bir
# atama bugün sadece grant_platform_admin.py script'i (doğrudan sunucu
# erişimi) üzerinden yapılabilir.
ASSIGNABLE_ADMIN_SUBROLES = ("ASSISTANT_ADMIN", "INSTITUTION_ADMIN", "DATA_ADMIN")


def _admin_subrole(db, user_id, legacy_role):
    """role IN ('admin','super_admin') olan bir kullanıcının v2 rollerinden
    admin-panel-prompt.md'deki 4 rolden hangisine karşılık geldiğini türetir.
    NOT: DATA_ADMIN, legacy role='admin' + organization_id üzerine EK bir v2
    rol olarak verilir - ama organization_id'si olan her 'admin' otomatik
    olarak INSTITUTION_ADMIN'i de taşır (bkz. LEGACY_ROLE_TO_NEW_ROLE), bu
    yüzden DATA_ADMIN önce kontrol edilir (varsa "Veri Giriş Admini" olarak
    gösterilir) ama bugün itibarıyla bu hesap fiilen INSTITUTION_ADMIN'in tüm
    izinlerini de taşımaya devam eder - has_permission() OR mantığıyla
    çalıştığı için (bkz. exams.create ile ilgili yorum, admin-panel-prompt.md
    bölüm 7 - ayrı, gelecekteki bir iş)."""
    if legacy_role == "super_admin":
        return "PLATFORM_ADMIN"
    names = {r["name"] for r in db.execute(
        "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?",
        (user_id,),
    ).fetchall()}
    if "PLATFORM_ADMIN" in names:
        return "PLATFORM_ADMIN"
    if "DATA_ADMIN" in names:
        return "DATA_ADMIN"
    if "ASSISTANT_ADMIN" in names:
        return "ASSISTANT_ADMIN"
    return "INSTITUTION_ADMIN"


@app.route("/api/superadmin/admins", methods=["GET"])
@login_required(role=("admin", "super_admin"), permission="admins.manage")
def api_superadmin_list_admins():
    db = get_db()
    rows = db.execute(
        "SELECT u.id, u.username, u.display_name, u.email, u.phone, u.role, "
        "u.organization_id, u.active, u.created_at, o.name AS org_name "
        "FROM users u LEFT JOIN organizations o ON o.id = u.organization_id "
        "WHERE u.role IN ('admin', 'super_admin') ORDER BY u.created_at DESC"
    ).fetchall()
    result = []
    for r in rows:
        sub_role = _admin_subrole(db, r["id"], r["role"])
        result.append({
            "id": r["id"], "username": r["username"], "displayName": r["display_name"],
            "email": r["email"], "phone": r["phone"], "active": bool(r["active"]),
            "createdAt": r["created_at"], "organizationId": r["organization_id"],
            "organizationName": r["org_name"], "subRole": sub_role,
            "subRoleLabel": ADMIN_SUBROLES[sub_role]["label"],
            "isSelf": r["id"] == session["user_id"],
        })
    return jsonify(result)


@app.route("/api/superadmin/admins", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="admins.manage")
def api_superadmin_create_admin():
    """Yeni bir admin-katmanı hesabı oluşturur - Admin Yardımcısı / Okul
    Admini / Veri Girişi Admini (bkz. ASSIGNABLE_ADMIN_SUBROLES)."""
    data = request.get_json(silent=True) or {}
    sub_role = (data.get("subRole") or "").strip().upper()
    if sub_role not in ASSIGNABLE_ADMIN_SUBROLES:
        return jsonify({"error": "Geçersiz rol."}), 400

    display_name = (data.get("displayName") or "").strip()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None

    if not display_name or not username or not password:
        return jsonify({"error": "Ad soyad, kullanıcı adı ve şifre gerekli."}), 400
    if len(password) < 4:
        return jsonify({"error": "Şifre en az 4 karakter olmalı."}), 400

    db = get_db()
    requires_org = ADMIN_SUBROLES[sub_role]["requiresOrg"]
    org_id = None
    if requires_org:
        org_id = data.get("organizationId")
        if not org_id:
            return jsonify({"error": "Bu rol için bir okul seçilmeli."}), 400
        org_id = int(org_id)
        if not db.execute("SELECT id FROM organizations WHERE id = ?", (org_id,)).fetchone():
            return jsonify({"error": "Okul bulunamadı."}), 404

    if db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
        return jsonify({"error": "Bu kullanıcı adı zaten kullanılıyor."}), 400

    now = datetime.now().isoformat()
    cur = db.execute(
        "INSERT INTO users (username, password_hash, role, display_name, email, phone, organization_id, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (username, hash_password(password), "admin", display_name, email, phone, org_id, now),
    )
    user_id = cur.lastrowid
    db.commit()
    # ONEMLI SIRA: ASSISTANT_ADMIN/DATA_ADMIN'in ek v2 rolu run_v2_migration'dan
    # ONCE atanmali. run_v2_migration -> _seed_reference_data, organization_id
    # NULL olan ve "organization.manage" izni VERMEYEN her admin'i varsayilan
    # okula geri baglar (bkz. o fonksiyondaki NOT IN alt sorgusu) - eger once
    # migration calisip SONRA rol verilseydi, org_id=NULL kalmasi gereken bir
    # Admin Yardimcisi bu backfill tarafindan yanlislikla varsayilan okula
    # atanirdi (grant_platform_admin.py'nin de zaten bu sirayla calismasinin
    # nedeni ayni).
    if sub_role in ("ASSISTANT_ADMIN", "DATA_ADMIN"):
        role_row = db.execute("SELECT id FROM roles WHERE name = ?", (sub_role,)).fetchone()
        db.execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", (user_id, role_row["id"]))
        db.commit()
    # legacy role='admin' -> organization_id varsa INSTITUTION_ADMIN'i otomatik eşitler.
    run_v2_migration(db)
    log_audit(db, "ADMIN_CREATED", resource_type="user", resource_id=user_id)
    return jsonify({"ok": True, "id": user_id, "username": username})


@app.route("/api/superadmin/admins/<int:user_id>", methods=["PATCH"])
@login_required(role=("admin", "super_admin"), permission="admins.manage")
def api_superadmin_update_admin(user_id):
    db = get_db()
    user = db.execute(
        "SELECT id FROM users WHERE id = ? AND role IN ('admin','super_admin')", (user_id,)
    ).fetchone()
    if not user:
        return jsonify({"error": "Admin bulunamadı."}), 404

    data = request.get_json(silent=True) or {}
    fields, values = [], []
    if "displayName" in data:
        display_name = (data.get("displayName") or "").strip()
        if not display_name:
            return jsonify({"error": "Ad soyad boş olamaz."}), 400
        fields.append("display_name = ?")
        values.append(display_name)
    if "email" in data:
        fields.append("email = ?")
        values.append((data.get("email") or "").strip() or None)
    if "phone" in data:
        fields.append("phone = ?")
        values.append((data.get("phone") or "").strip() or None)

    if "subRole" in data:
        if user_id == session["user_id"]:
            return jsonify({"error": "Kendi rolünüzü değiştiremezsiniz."}), 400
        sub_role = (data.get("subRole") or "").strip().upper()
        if sub_role not in ASSIGNABLE_ADMIN_SUBROLES:
            return jsonify({"error": "Geçersiz rol."}), 400
        requires_org = ADMIN_SUBROLES[sub_role]["requiresOrg"]
        org_id = None
        if requires_org:
            org_id = data.get("organizationId")
            if not org_id:
                return jsonify({"error": "Bu rol için bir okul seçilmeli."}), 400
            org_id = int(org_id)
            if not db.execute("SELECT id FROM organizations WHERE id = ?", (org_id,)).fetchone():
                return jsonify({"error": "Okul bulunamadı."}), 404
        fields.append("organization_id = ?")
        values.append(org_id)
        # eski ASSISTANT_ADMIN/DATA_ADMIN ek v2 rolünü temizleyip yenisini ver
        # (INSTITUTION_ADMIN kasıtlı olarak silinmiyor - kaldırılsa bile
        # ASSISTANT_ADMIN/PLATFORM_ADMIN'in izin kümesi zaten onu kapsıyor,
        # bkz. _admin_subrole yorumu).
        for extra in ("ASSISTANT_ADMIN", "DATA_ADMIN"):
            role_row = db.execute("SELECT id FROM roles WHERE name = ?", (extra,)).fetchone()
            db.execute("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?", (user_id, role_row["id"]))
        if sub_role in ("ASSISTANT_ADMIN", "DATA_ADMIN"):
            role_row = db.execute("SELECT id FROM roles WHERE name = ?", (sub_role,)).fetchone()
            db.execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", (user_id, role_row["id"]))

    if not fields:
        return jsonify({"error": "Güncellenecek bir alan gönderilmedi."}), 400

    fields_sql = ", ".join(fields)
    db.execute(f"UPDATE users SET {fields_sql} WHERE id = ?", values + [user_id])
    db.commit()
    log_audit(db, "ADMIN_UPDATED", resource_type="user", resource_id=user_id)
    return jsonify({"ok": True})


@app.route("/api/superadmin/admins/<int:user_id>/toggle-status", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="admins.manage")
def api_superadmin_toggle_admin_status(user_id):
    if user_id == session["user_id"]:
        return jsonify({"error": "Kendi hesabınızı pasifleştiremezsiniz."}), 400
    db = get_db()
    user = db.execute(
        "SELECT id, active FROM users WHERE id = ? AND role IN ('admin','super_admin')", (user_id,)
    ).fetchone()
    if not user:
        return jsonify({"error": "Admin bulunamadı."}), 404

    new_active = 0 if user["active"] else 1
    if not new_active:
        # Platformun kilitlenmemesi icin en az bir aktif admins.manage
        # sahibi (Süper Admin) her zaman kalmali.
        others = db.execute(
            "SELECT COUNT(*) AS c FROM users u "
            "JOIN user_roles ur ON ur.user_id = u.id "
            "JOIN role_permissions rp ON rp.role_id = ur.role_id "
            "JOIN permissions p ON p.id = rp.permission_id "
            "WHERE p.name = 'admins.manage' AND u.active = 1 AND u.id != ?",
            (user_id,),
        ).fetchone()["c"]
        if others == 0:
            return jsonify({"error": "Son aktif Süper Admin hesabı pasifleştirilemez."}), 400

    db.execute("UPDATE users SET active = ? WHERE id = ?", (new_active, user_id))
    db.commit()
    log_audit(db, "ADMIN_STATUS_CHANGED", resource_type="user", resource_id=user_id)
    return jsonify({"ok": True, "active": bool(new_active)})


@app.route("/api/superadmin/audit-logs")
@login_required(role=("admin", "super_admin"), permission="system.logs")
def api_superadmin_audit_logs():
    """Denetim kaydi goruntuleyici. audit_logs.organization_id, ISLEMI YAPAN
    kullanicinin okulunu tutar (bkz. log_audit) - yani filtre "bu okulun
    KENDI personelinin yaptigi islemler" anlamina gelir, "bu okulu etkileyen
    islemler" degil (ornegin platform sahibinin baska bir okulu duzenlemesi
    kendi okulunun logunda gorunur, duzenlenen okulun degil - mevcut
    log_audit tasarimi boyle, burada degistirilmiyor).
    organization.manage izni olmayan (normal okul admini/delege) sadece
    kendi okulunun loglarini gorur, ?school_id= YOK SAYILIR (_effective_org_id
    ile ayni IDOR-guvenli desen)."""
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    limit = min(request.args.get("limit", 50, type=int) or 50, 200)
    before_id = request.args.get("before_id", type=int)
    query = (
        "SELECT al.id, al.action, al.resource_type, al.resource_id, al.ip_address, al.created_at, "
        "u.username, u.display_name "
        "FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id "
        "WHERE al.organization_id = ?"
    )
    params = [org_id]
    if before_id:
        query += " AND al.id < ?"
        params.append(before_id)
    query += " ORDER BY al.id DESC LIMIT ?"
    params.append(limit)
    rows = db.execute(query, params).fetchall()
    return jsonify([{
        "id": r["id"], "action": r["action"], "resourceType": r["resource_type"],
        "resourceId": r["resource_id"], "ipAddress": r["ip_address"], "createdAt": r["created_at"],
        "actorUsername": r["username"], "actorDisplayName": r["display_name"],
    } for r in rows])


# ============================================================
# API: Okul kodu / davet linkiyle kendi kendine kayıt
# ============================================================
# Iki ayri mekanizma: ogretmen okul-geneli TEK koda (organizations.
# teacher_invite_code) baglanir - belirli bir ogrenci kaydina bagli
# olmadigi icin. Veli/ogrenci ise MUTLAKA var olan bir students satirina
# baglanmali - school_number guvenilir bir kanit alani olmadigi icin
# (UNIQUE/NOT NULL degil), bunun yerine ogrenciye ozel, tahmin edilemez
# bir token (student_invite_tokens) kullanilir.

@app.route("/api/admin/teacher-invite", methods=["GET"])
@login_required(role=("admin", "teacher", "super_admin"), permission="users.manage")
def api_admin_get_teacher_invite():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    org = db.execute("SELECT teacher_invite_code FROM organizations WHERE id = ?", (org_id,)).fetchone()
    code = org["teacher_invite_code"] if org else None
    if not code:
        code = secrets.token_urlsafe(9)
        db.execute("UPDATE organizations SET teacher_invite_code = ? WHERE id = ?", (code, org_id))
        db.commit()
    url = f"{_external_base_url()}/kayit-ogretmen.html?kod={code}"
    return jsonify({"code": code, "url": url})


@app.route("/api/admin/teacher-invite/regenerate", methods=["POST"])
@login_required(role=("admin", "super_admin"))
def api_admin_regenerate_teacher_invite():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    code = secrets.token_urlsafe(9)
    db.execute("UPDATE organizations SET teacher_invite_code = ? WHERE id = ?", (code, org_id))
    db.commit()
    log_audit(db, "TEACHER_INVITE_REGENERATED", resource_type="organization", resource_id=org_id)
    url = f"{_external_base_url()}/kayit-ogretmen.html?kod={code}"
    return jsonify({"code": code, "url": url})


@app.route("/api/register/teacher/<code>")
def api_register_teacher_lookup(code):
    if _register_rate_limited(request.remote_addr):
        return jsonify({"error": "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin."}), 429
    db = get_db()
    org = db.execute(
        "SELECT id, name FROM organizations WHERE teacher_invite_code = ? AND status IN ('active','trial')", (code,)
    ).fetchone()
    if not org:
        _register_record_attempt(request.remote_addr)
        return jsonify({"error": "Geçersiz veya süresi dolmuş davet kodu."}), 404
    class_names = [r["class_name"] for r in db.execute(
        "SELECT DISTINCT class_name FROM students WHERE organization_id = ? "
        "AND class_name IS NOT NULL AND class_name != '' ORDER BY class_name",
        (org["id"],),
    ).fetchall()]
    return jsonify({"organizationName": org["name"], "classNames": class_names})


@app.route("/api/register/teacher", methods=["POST"])
def api_register_teacher():
    if _register_rate_limited(request.remote_addr):
        return jsonify({"error": "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin."}), 429
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("displayName") or "").strip() or username
    class_name = (data.get("className") or "").strip()

    db = get_db()
    org = db.execute(
        "SELECT id FROM organizations WHERE teacher_invite_code = ? AND status IN ('active','trial')", (code,)
    ).fetchone()
    if not org:
        _register_record_attempt(request.remote_addr)
        return jsonify({"error": "Geçersiz veya süresi dolmuş davet kodu."}), 404
    if not username or not password or not class_name:
        return jsonify({"error": "Kullanıcı adı, şifre ve sınıf gerekli."}), 400
    if len(password) < 4:
        return jsonify({"error": "Şifre en az 4 karakter olmalı."}), 400
    if db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
        return jsonify({"error": "Bu kullanıcı adı zaten kullanılıyor."}), 400

    # Guvenlik: className frontend'deki acilir listeden geldigi VARSAYILIYORDU,
    # ama bu uc dogrudan cagrilirsa (davet kodu tek basina yeterli, admin
    # onayi yok) hicbir dogrulama yoktu - "*" (teacher_class_list() bunu TUM
    # siniflara sinirsiz erisim olarak yorumluyor) veya virgullu coklu sinif
    # listesi gonderilerek bir okulun butun ogrenci/sinav/sonuc verisine
    # okul-ici yetki yukseltmesi yapilabiliyordu (bkz. audit). Self-kayit
    # SADECE o okulda GERCEKTEN var olan TEK bir sinifa izin vermeli; coklu
    # sinif/"*" erisimi yalnizca admin'in bilerek verdigi bir yetki devri
    # olabilir (bkz. /api/admin/users/<id>/delegate), self-servis degil.
    if "*" in class_name or "," in class_name:
        return jsonify({"error": "Geçersiz sınıf adı."}), 400
    valid_classes = {r["class_name"] for r in db.execute(
        "SELECT DISTINCT class_name FROM students WHERE organization_id = ? "
        "AND class_name IS NOT NULL AND class_name != ''",
        (org["id"],),
    ).fetchall()}
    if class_name not in valid_classes:
        return jsonify({"error": "Geçersiz sınıf. Lütfen listeden bir sınıf seçin."}), 400

    cur = db.execute(
        "INSERT INTO users (username, password_hash, role, display_name, class_name, "
        "organization_id, created_at) VALUES (?,?,?,?,?,?,?)",
        (username, hash_password(password), "teacher", display_name, class_name,
         org["id"], datetime.now().isoformat()),
    )
    db.commit()
    run_v2_migration(db)
    log_audit(db, "TEACHER_SELF_REGISTERED", resource_type="user", resource_id=cur.lastrowid)
    return jsonify({"ok": True})


@app.route("/api/admin/students/<int:student_id>/invite", methods=["POST"])
@login_required(role=("admin", "teacher", "super_admin"), permission="users.manage")
def api_admin_get_student_invite(student_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    student = db.execute(
        "SELECT id FROM students WHERE id = ? AND organization_id = ?", (student_id, org_id)
    ).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404

    existing = db.execute(
        "SELECT token FROM student_invite_tokens WHERE student_id = ? AND organization_id = ? "
        "AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
        (student_id, org_id),
    ).fetchone()
    if existing:
        token = existing["token"]
    else:
        token = secrets.token_urlsafe(16)
        db.execute(
            "INSERT INTO student_invite_tokens (student_id, organization_id, token, created_at, created_by) "
            "VALUES (?,?,?,?,?)",
            (student_id, org_id, token, datetime.now().isoformat(), session.get("user_id")),
        )
        db.commit()
    url = f"{_external_base_url()}/kayit-ogrenci.html?token={token}"
    return jsonify({"token": token, "url": url})


@app.route("/api/admin/students/<int:student_id>/invite/revoke", methods=["POST"])
@login_required(role=("admin", "super_admin"))
def api_admin_revoke_student_invite(student_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    db.execute(
        "UPDATE student_invite_tokens SET revoked_at = ? "
        "WHERE student_id = ? AND organization_id = ? AND revoked_at IS NULL",
        (datetime.now().isoformat(), student_id, org_id),
    )
    db.commit()
    log_audit(db, "STUDENT_INVITE_REVOKED", resource_type="student", resource_id=student_id)
    return jsonify({"ok": True})


@app.route("/api/register/student/<token>")
def api_register_student_lookup(token):
    if _register_rate_limited(request.remote_addr):
        return jsonify({"error": "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin."}), 429
    db = get_db()
    row = db.execute(
        "SELECT sit.student_id, o.name AS org_name, s.first_name, s.last_name "
        "FROM student_invite_tokens sit "
        "JOIN organizations o ON o.id = sit.organization_id "
        "JOIN students s ON s.id = sit.student_id "
        "WHERE sit.token = ? AND sit.revoked_at IS NULL",
        (token,),
    ).fetchone()
    if not row:
        _register_record_attempt(request.remote_addr)
        return jsonify({"error": "Geçersiz veya iptal edilmiş davet linki."}), 404
    last_initial = (row["last_name"] or "").strip()[:1]
    masked_name = f"{row['first_name']} {last_initial}." if last_initial else row["first_name"]
    has_student_account = bool(db.execute(
        "SELECT 1 FROM users WHERE role = 'student' AND student_id = ?", (row["student_id"],)
    ).fetchone())
    return jsonify({
        "organizationName": row["org_name"],
        "studentName": masked_name,
        "studentAccountTaken": has_student_account,
    })


@app.route("/api/register/student", methods=["POST"])
def api_register_student():
    if _register_rate_limited(request.remote_addr):
        return jsonify({"error": "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin."}), 429
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    role = data.get("role")
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("displayName") or "").strip() or username

    if role not in ("parent", "student"):
        return jsonify({"error": "Geçersiz rol."}), 400
    db = get_db()
    row = db.execute(
        "SELECT sit.student_id, sit.organization_id FROM student_invite_tokens sit "
        "WHERE sit.token = ? AND sit.revoked_at IS NULL",
        (token,),
    ).fetchone()
    if not row:
        _register_record_attempt(request.remote_addr)
        return jsonify({"error": "Geçersiz veya iptal edilmiş davet linki."}), 404
    if not username or not password:
        return jsonify({"error": "Kullanıcı adı ve şifre gerekli."}), 400
    if len(password) < 4:
        return jsonify({"error": "Şifre en az 4 karakter olmalı."}), 400
    if db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
        return jsonify({"error": "Bu kullanıcı adı zaten kullanılıyor."}), 400

    student_id, org_id = row["student_id"], row["organization_id"]
    if role == "student":
        existing_student_acc = db.execute(
            "SELECT 1 FROM users WHERE role = 'student' AND student_id = ?", (student_id,)
        ).fetchone()
        if existing_student_acc:
            return jsonify({"error": "Bu öğrenci için zaten bir hesap var."}), 400
        cur = db.execute(
            "INSERT INTO users (username, password_hash, role, student_id, display_name, "
            "organization_id, created_at) VALUES (?,?,?,?,?,?,?)",
            (username, hash_password(password), "student", student_id, display_name,
             org_id, datetime.now().isoformat()),
        )
    else:
        cur = db.execute(
            "INSERT INTO users (username, password_hash, role, display_name, "
            "organization_id, created_at) VALUES (?,?,?,?,?,?)",
            (username, hash_password(password), "parent", display_name,
             org_id, datetime.now().isoformat()),
        )
        db.execute(
            "INSERT OR IGNORE INTO parent_students (parent_user_id, student_id) VALUES (?,?)",
            (cur.lastrowid, student_id),
        )
    db.commit()
    run_v2_migration(db)
    log_audit(db, "STUDENT_SELF_REGISTERED" if role == "student" else "PARENT_SELF_REGISTERED",
              resource_type="user", resource_id=cur.lastrowid)
    return jsonify({"ok": True})


# ============================================================
# API: Admin - veri senkronizasyonu (tarayıcıdaki IndexedDB -> sunucu)
# ============================================================

@app.route("/api/admin/sync", methods=["POST"])
@login_required(role="admin")
def api_admin_sync():
    payload = request.get_json(silent=True) or {}
    students = payload.get("students") or []
    exams = payload.get("exams") or []
    results = payload.get("results") or []
    force = bool(payload.get("force"))

    db = get_db()
    org_id = _current_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    # GUVENLIK KILIDI: bu uc nokta gonderilen veriyle BU OKULUN sunucudaki
    # verisinin (students/exams/results) yerini alir - bu, hicbir yerel
    # verisi olmayan (or: ilk kez acilan bir telefon/tarayici) bir cihazdan
    # yanlislikla gelen BOS bir senkronun, gercek veriyle dolu sunucuyu
    # sessizce sifirlamasina yol acabilir (2026-09-04'te tam olarak bu
    # yasandi - bir telefonda ilk kez acilan bos admin paneli otomatik
    # senkronla tum ogrenci/deneme/sonuc verisini sildi). Gelen veri, var
    # olan veriye kiyasla anlamli sekilde daha azsa (ve var olan veri bossa
    # degil) islemi reddet; admin bilerek/istemli bosaltmak isterse client
    # "force" gonderebilir. Sayimlar SADECE bu okula ait - baska bir okulun
    # veri hacmi bu okulun senkronunu asla etkilemez.
    if not force:
        current_counts = {
            "students": db.execute(
                "SELECT COUNT(*) FROM students WHERE organization_id=?", (org_id,)).fetchone()[0],
            "exams": db.execute(
                "SELECT COUNT(*) FROM exams WHERE organization_id=?", (org_id,)).fetchone()[0],
            "results": db.execute(
                "SELECT COUNT(*) FROM results WHERE organization_id=?", (org_id,)).fetchone()[0],
        }
        incoming_counts = {"students": len(students), "exams": len(exams), "results": len(results)}
        for key, current in current_counts.items():
            incoming = incoming_counts[key]
            if current >= 3 and incoming < current * 0.5:
                return jsonify({
                    "error": (
                        f"Güvenlik: gönderilen veri sunucudakinden çok daha az "
                        f"({key}: sunucuda {current}, gönderilen {incoming}). Bu genelde "
                        f"boş/yeni bir cihazdan yanlışlıkla gönderim anlamına gelir ve "
                        f"gerçek veriyi silebilir. Gerçekten bu veriyle değiştirmek "
                        f"istediğinizden eminseniz tekrar deneyip onaylayın."
                    ),
                    "requiresForce": True,
                    "currentCounts": current_counts,
                    "incomingCounts": incoming_counts,
                }), 409

    # students/exams/results.id istemcinin (tarayici IndexedDB) kendi
    # sayacindan gelir - farkli okullarin ayni id'yi kullanmasi olasi/
    # kacinilmaz. Sunucuda gercekten benzersiz olsun diye her okula ayrilmis
    # id blogu icine tasiriz (bkz. _org_scoped_id) - 1. okul icin bu bir
    # NO-OP'tur (offset 0), yani mevcut gercek veri hicbir sekilde degismez.
    def sid(client_id):
        return _org_scoped_id(org_id, client_id)

    # parent_students.student_id -> students(id) ON DELETE CASCADE tanimli;
    # asagidaki DELETE FROM students bu yuzden BU OKULUN veli-ogrenci
    # baglantilarini da siler. Ayni id'yle geri gelen ogrenciler icin bu
    # baglantilari geri kurabilmek icin once yedekliyoruz (bkz. asagidaki
    # geri yukleme) - sadece bu okulun ogrencilerine ait baglantilar.
    existing_parent_links = db.execute(
        "SELECT ps.parent_user_id, ps.student_id FROM parent_students ps "
        "JOIN students s ON s.id = ps.student_id WHERE s.organization_id = ?",
        (org_id,),
    ).fetchall()

    # SADECE bu okulun kendi tarayicisindan gelen ('browser_sync') satirlar
    # silinir - platform sahibinin dogrudan ekledigi ('platform_admin')
    # kayitlar (bkz. _platform_admin_next_id) bu okulun kendi senkronundan
    # HICBIR ZAMAN etkilenmez.
    db.execute("DELETE FROM students WHERE organization_id=? AND source='browser_sync'", (org_id,))
    db.execute("DELETE FROM exams WHERE organization_id=? AND source='browser_sync'", (org_id,))
    db.execute("DELETE FROM results WHERE organization_id=? AND source='browser_sync'", (org_id,))

    # Kritik (500 ogrenci + 10 admin olcek analizi): tek tek db.execute()
    # yerine executemany() - satir basina Python<->SQLite gidis-gelisini
    # ortadan kaldirir, bu YAZMA transaction'ini (WAL altinda bile diger
    # YAZICILARI busy_timeout suresince bekletebilen) mumkun oldugunca
    # kisaltir.
    if students:
        db.executemany(
            "INSERT INTO students (id, organization_id, school_number, first_name, last_name, class_name, source) "
            "VALUES (?,?,?,?,?,?,'browser_sync')",
            [(sid(s.get("id")), org_id, s.get("schoolNumber"), s.get("firstName"), s.get("lastName"),
              s.get("className")) for s in students],
        )
    if exams:
        db.executemany(
            "INSERT INTO exams (id, organization_id, name, date, exam_type, data_json, source) "
            "VALUES (?,?,?,?,?,?,'browser_sync')",
            [(sid(e.get("id")), org_id, e.get("name"), e.get("date"), e.get("examType"), json.dumps(e))
             for e in exams],
        )
    if results:
        db.executemany(
            "INSERT INTO results (id, organization_id, student_id, exam_id, data_json, source) "
            "VALUES (?,?,?,?,?,'browser_sync')",
            [(sid(r.get("id")), org_id, sid(r.get("studentId")), sid(r.get("examId")), json.dumps(r))
             for r in results],
        )

    new_student_ids = {sid(s.get("id")) for s in students}
    for link in existing_parent_links:
        if link["student_id"] in new_student_ids:
            db.execute(
                "INSERT OR IGNORE INTO parent_students (parent_user_id, student_id) VALUES (?,?)",
                (link["parent_user_id"], link["student_id"]),
            )
    db.commit()

    # v2: normalize edilmiş tabloları (sınıflar, kayıtlar, sınav sonuçları,
    # Başarı Pusulası içgörüleri) yeni veriyle eşitle.
    run_v2_migration(db)
    db.execute(
        "INSERT INTO imports (organization_id, uploaded_by, file_type, status, total_records, "
        "success_records, failed_records, created_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (org_id, session.get("user_id"), "admin_sync", "completed",
         len(students) + len(exams) + len(results), len(students) + len(exams) + len(results), 0,
         datetime.now().isoformat(), datetime.now().isoformat()),
    )
    db.commit()
    log_audit(db, "DATA_SYNCED", resource_type="admin_sync")

    return jsonify({
        "ok": True,
        "counts": {"students": len(students), "exams": len(exams), "results": len(results)},
    })


# ============================================================
# API: Platform sahibinin bir okula DOGRUDAN veri girisi
# ============================================================
# Bu uc noktalar, platform sahibinin (legacy role='admin'/'super_admin')
# "Okula Gir" ile baktigi HERHANGI BIR okula ogrenci/deneme/sonuc
# eklemesini saglar - okulun kendi admininin tarayicisindan BAGIMSIZ olarak.
# Yazilan satirlar source='platform_admin' ile damgalanir ve
# _platform_admin_next_id ile rezerve bir id araligindan numaralanir, boylece
# o okulun kendi /api/admin/sync'i (SADECE source='browser_sync' satirlarini
# siler) bu kayitlari ASLA silmez/ezmez. Ayni uclar, platform sahibi
# OLMAYAN normal bir okul admininin KENDI okuluna veri girmesi icin de
# calisir (org_id = _effective_org_id(db) kendi sabit organization_id'sine
# duser) - IDOR korumasi tamamen _effective_org_id'ye devredilmistir.

@app.route("/api/teacher/students", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="students.create")
def api_platform_add_student():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    data = request.get_json(silent=True) or {}
    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    school_number = (data.get("schoolNumber") or "").strip() or None
    class_name = (data.get("className") or "").strip() or None
    if not first_name or not last_name:
        return jsonify({"error": "Ad ve soyad gerekli."}), 400

    new_id = _platform_admin_next_id(db, "students", org_id)
    db.execute(
        "INSERT INTO students (id, organization_id, school_number, first_name, last_name, class_name, source) "
        "VALUES (?,?,?,?,?,?,'platform_admin')",
        (new_id, org_id, school_number, first_name, last_name, class_name),
    )
    db.commit()
    log_audit(db, "STUDENT_CREATED_BY_PLATFORM", resource_type="student", resource_id=new_id)
    return jsonify({"ok": True, "id": new_id})


# ============================================================
# e-Okul "Sınıf Listesi" PDF'inden toplu öğrenci içe aktarma
# ============================================================
# MEB e-Okul'un okul/kademe bazında ürettiği resmi sınıf listesi PDF'i
# (S.No/Öğrenci No/Adı/Soyadı/Cinsiyeti sütunlu, her şube ayrı bir
# başlıkla) - bir okulun TÜM sınıf ve öğrencilerini tek PDF yüklemeyle
# eklemek/güncellemek için. İki adımlı: (1) parse-roster-pdf sadece
# ayrıştırır, HİÇBİR ŞEY YAZMAZ (admin önizlemeyi görüp onaylar - AI
# taksonomi önerileri gibi "asla sessizce yazma" ilkesiyle tutarlı);
# (2) import-roster onaylanan listeyi gerçekten yazar.

def _tr_lower(s):
    """Python'un str.lower()'ı Türkçe İ/I harflerini yanlış çevirir (İ->'i̇',
    I->'i') - eşleştirme için tr-TR doğru küçük harfe çevirme."""
    return s.replace("İ", "i").replace("I", "ı").lower()


def _normalize_tr_text(text):
    """js/db.js normalizeTrText'in Python karşılığı - aynı öğrenciyi farklı
    yazımlarla (büyük/küçük harf, noktalama) eşleştirebilmek için."""
    if not text:
        return ""
    s = _tr_lower(str(text))
    s = re.sub(r"[.,/#!$%^&*;:{}=\-_`~()?\"']", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_school_no_py(num):
    """js/db.js normalizeSchoolNo'nun Python karşılığı - baştaki sıfırları
    ve ondalık kalıntısını temizler (ör. '00557' ve '557' aynı öğrenci)."""
    if not num:
        return ""
    s = str(num).strip()
    if s.endswith(".0"):
        s = s[:-2]
    if s.isdigit():
        return str(int(s))
    return s


_ROSTER_HEADER_RE = re.compile(
    r"(\d{1,2})\.\s*Sınıf(?:-[^/]+)?\s*/\s*([A-ZÇĞİÖŞÜ])\s*Şubesi\s*Sınıf\s*Listesi",
    re.IGNORECASE,
)
_ROSTER_COL_LABELS = {"S.No": "sno", "Öğrenci No": "no", "Adı": "ad", "Soyadı": "soyad", "Cinsiyeti": "cinsiyet"}
_ROSTER_COL_TOLERANCE_PT = 8.0


def _parse_student_roster_pdf(pdf_bytes):
    """e-Okul sınıf listesi PDF'ini ayrıştırır. Sütun x-konumları HER
    SAYFANIN KENDİ başlık satırından okunur (sabit kodlanmaz) - farklı okul/
    kenar boşluğu varyasyonlarına dayanıklı olsun diye. Satırlar y0'a göre
    kümelenir (S.No hücresi diğer 4 sütuna göre ~1-2pt kaymış olabiliyor,
    bu yüzden tolerans payı kullanılır). Bir satır kümesinde no/ad/soyad/
    cinsiyet alanlarının HEPSİ net bir sütuna oturmuyorsa (ör. alt bilgi
    satırı "Kız Öğrenci Sayısı: ...") o küme sessizce atlanır - ayrı bir
    "alt bilgiyi tanı" kuralına gerek kalmadan doğal bir güvenlik filtresi."""
    doc = pdf_question_extractor.fitz.open(stream=pdf_bytes, filetype="pdf")
    classes = []
    school_name_guess = None

    for pno in range(doc.page_count):
        page = doc[pno]
        raw_lines = []
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
                if not text:
                    continue
                bbox = line["bbox"]
                raw_lines.append((bbox[1], bbox[0], text))  # y0, x0, text

        header_match = None
        col_x = {}
        col_header_y0 = None  # sütun başlık satırının (S.No/Öğrenci No/...) y0'ı - başlık kendisi veri satırı sayılmasın diye
        for y0, x0, text in raw_lines:
            if header_match is None:
                m = _ROSTER_HEADER_RE.search(text)
                if m:
                    header_match = m
            key = _ROSTER_COL_LABELS.get(text.strip())
            if key:
                col_x[key] = x0
                col_header_y0 = y0 if col_header_y0 is None else max(col_header_y0, y0)
        if not header_match or len(col_x) < 5:
            continue  # bu sayfa tanınan bir sınıf listesi sayfası değil

        if school_name_guess is None:
            for _y0, _x0, text in raw_lines:
                if "Müdürlüğü" in text:
                    school_name_guess = text
                    break

        grade = int(header_match.group(1))
        sube = header_match.group(2).upper()

        data_lines = [(y0, x0, text) for y0, x0, text in raw_lines if y0 > col_header_y0 + 3]
        data_lines.sort()

        rows = []  # her biri {"y0": ref_y0, "no":.., "ad":.., "soyad":.., "cinsiyet":..}
        for y0, x0, text in data_lines:
            best_key, best_dist = None, _ROSTER_COL_TOLERANCE_PT
            for key, kx in col_x.items():
                dist = abs(kx - x0)
                if dist < best_dist:
                    best_key, best_dist = key, dist
            if not best_key:
                continue
            row = next((r for r in rows if abs(r["_y0"] - y0) <= 3.0), None)
            if not row:
                row = {"_y0": y0}
                rows.append(row)
            row[best_key] = text.strip()

        students = []
        for row in rows:
            if not all(k in row for k in ("no", "ad", "soyad", "cinsiyet")):
                continue  # eksik alanlı küme (ör. alt bilgi satırı) - atla
            students.append({
                "schoolNumber": row["no"],
                "firstName": row["ad"],
                "lastName": row["soyad"],
                "gender": row["cinsiyet"],
            })
        if not students:
            continue

        # Kalabalık bir şube (ör. 57 öğrenci) e-Okul dışa aktarımında BİRDEN
        # FAZLA sayfaya (her sayfa kendi başlığını tekrarlayarak) yayılabilir
        # - aynı (grade, sube) ile daha önce görülmüş bir sınıf varsa yeni
        # sayfa AYRI bir sınıf değil, o sınıfın DEVAMI sayılıp birleştirilir.
        existing_class = next((c for c in classes if c["grade"] == grade and c["sube"] == sube), None)
        if existing_class:
            existing_class["students"].extend(students)
        else:
            classes.append({
                "grade": grade, "sube": sube, "className": f"{grade}/{sube}",
                "label": header_match.group(0), "students": students,
            })

    doc.close()
    return {"schoolNameGuess": school_name_guess, "classes": classes}


@app.route("/api/admin/students/parse-roster-pdf", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="students.create")
def api_parse_roster_pdf():
    file = request.files.get("file")
    if not file or not (file.filename or "").lower().endswith(".pdf"):
        return jsonify({"error": "Geçerli bir PDF dosyası seçin."}), 400
    try:
        result = _parse_student_roster_pdf(file.read())
    except Exception as exc:
        return jsonify({"error": f"PDF ayrıştırılamadı: {exc}"}), 400
    if not result["classes"]:
        return jsonify({"error": "Bu PDF'te tanınan bir sınıf listesi bulunamadı (beklenen format: e-Okul 'Sınıf Listesi')."}), 400
    total_students = sum(len(c["students"]) for c in result["classes"])
    return jsonify({
        "schoolNameGuess": result["schoolNameGuess"],
        "classes": result["classes"],
        "totalClasses": len(result["classes"]),
        "totalStudents": total_students,
    })


@app.route("/api/admin/students/import-roster", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="students.create")
def api_import_roster():
    """parse-roster-pdf'in döndürdüğü (admin panelinde önizlenip onaylanan)
    öğrenci listesini gerçekten yazar. Eşleştirme js/db.js
    findOrMatchStudent ile AYNI iki aşamalı mantığı izler (okul no, sonra
    ad-soyad) - farkı: burada eşleşen bir kayıt bulunduğunda sınıf VE isim
    HER ZAMAN PDF'teki (resmi e-Okul) değerine güncellenir, sadece boşsa
    doldurulmaz - admin panelinde bu davranış açıkça onaylanmadan
    çağrılmaz."""
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    data = request.get_json(silent=True) or {}
    incoming = data.get("students")
    if not isinstance(incoming, list) or not incoming:
        return jsonify({"error": "students (liste) gerekli."}), 400

    existing = db.execute(
        "SELECT id, school_number, first_name, last_name, class_name FROM students WHERE organization_id=?",
        (org_id,),
    ).fetchall()
    by_school_no = {}
    by_name = {}
    for r in existing:
        no_key = _normalize_school_no_py(r["school_number"])
        if no_key:
            by_school_no[no_key] = r
        name_key = _normalize_tr_text(f"{r['first_name']} {r['last_name']}")
        if name_key:
            by_name[name_key] = r

    next_id = _platform_admin_next_id(db, "students", org_id)
    created, updated, unchanged = 0, 0, 0
    now = datetime.now().isoformat()

    for s in incoming:
        first_name = (s.get("firstName") or "").strip()
        last_name = (s.get("lastName") or "").strip()
        school_number = (s.get("schoolNumber") or "").strip()
        class_name = (s.get("className") or "").strip()
        if not first_name or not last_name:
            continue

        no_key = _normalize_school_no_py(school_number)
        name_key = _normalize_tr_text(f"{first_name} {last_name}")
        match = by_school_no.get(no_key) if no_key else None
        # Ada göre eşleştirme SADECE gelen satırda güvenilir bir okul no'su
        # YOKSA denenir (js/db.js findOrMatchStudent'taki isAutoSNum kontrolüyle
        # aynı ilke) - aksi halde aynı okulda aynı ada sahip İKİ FARKLI gerçek
        # öğrenci (büyük bir okulda kaçınılmaz) yanlışlıkla TEK KAYITTA
        # birleştirilir. e-Okul listesinde her satırın gerçek bir okul no'su
        # olduğu için bu yol pratikte hemen hiç tetiklenmez - sadece savunma.
        if not match and not no_key:
            match = by_name.get(name_key)

        if match:
            fields, params = [], []
            if class_name and match["class_name"] != class_name:
                fields.append("class_name=?"); params.append(class_name)
            if match["first_name"] != first_name or match["last_name"] != last_name:
                fields.append("first_name=?"); params.append(first_name)
                fields.append("last_name=?"); params.append(last_name)
            if school_number and _normalize_school_no_py(match["school_number"]) != no_key:
                fields.append("school_number=?"); params.append(school_number)
            if fields:
                params.append(match["id"])
                db.execute(f"UPDATE students SET {', '.join(fields)} WHERE id=?", params)
                updated += 1
            else:
                unchanged += 1
            continue

        db.execute(
            "INSERT INTO students (id, organization_id, school_number, first_name, last_name, class_name, source) "
            "VALUES (?,?,?,?,?,?,'platform_admin')",
            (next_id, org_id, school_number or None, first_name, last_name, class_name or None),
        )
        # yeni eklenen ogrenci de sonraki eslesmeler icin (ayni PDF icinde
        # tekrar gecmez ama tutarlilik icin) arama tablolarina eklenir
        new_row = {"id": next_id, "school_number": school_number, "first_name": first_name,
                   "last_name": last_name, "class_name": class_name}
        if no_key:
            by_school_no[no_key] = new_row
        if name_key:
            by_name[name_key] = new_row
        next_id += 1
        created += 1

    db.commit()
    log_audit(db, "STUDENT_ROSTER_IMPORTED", resource_type="organization", resource_id=org_id)
    return jsonify({"ok": True, "created": created, "updated": updated, "unchanged": unchanged})


@app.route("/api/teacher/exams", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="exams.create")
def api_platform_add_exam():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    date = (data.get("date") or "").strip()
    exam_type = (data.get("examType") or "").strip() or "LGS"
    if not name or not date:
        return jsonify({"error": "Deneme adı ve tarihi gerekli."}), 400

    new_id = _platform_admin_next_id(db, "exams", org_id)
    exam_payload = {**data, "id": new_id}
    db.execute(
        "INSERT INTO exams (id, organization_id, name, date, exam_type, data_json, source) "
        "VALUES (?,?,?,?,?,?,'platform_admin')",
        (new_id, org_id, name, date, exam_type, json.dumps(exam_payload)),
    )
    db.commit()
    log_audit(db, "EXAM_CREATED_BY_PLATFORM", resource_type="exam", resource_id=new_id)
    return jsonify({"ok": True, "id": new_id})


@app.route("/api/teacher/results", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="results.create")
def api_platform_add_result():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    data = request.get_json(silent=True) or {}
    student_id = data.get("studentId")
    exam_id = data.get("examId")
    subjects = data.get("subjects")
    if not student_id or not exam_id or not isinstance(subjects, dict):
        return jsonify({"error": "Öğrenci, deneme ve sonuçlar gerekli."}), 400

    # student_id/exam_id istemciden AYNEN geldigi haliyle (offsetsiz) kullanilir -
    # bunlar zaten sunucudaki gercek satir id'leridir (browser_sync veya
    # platform_admin kaynakli), IDOR karsiligi asagida DOGRUDAN dogrulanir:
    # baska bir okulun ogrencisine/denemesine sonuc yazilamaz.
    student = db.execute(
        "SELECT id FROM students WHERE id = ? AND organization_id = ?", (student_id, org_id)
    ).fetchone()
    exam = db.execute(
        "SELECT id FROM exams WHERE id = ? AND organization_id = ?", (exam_id, org_id)
    ).fetchone()
    if not student or not exam:
        return jsonify({"error": "Öğrenci ya da deneme bu okula ait değil."}), 400

    # Kapsam bilerek "yeni kayit ekleme" ile sinirli (bkz. plan) - var olan bir
    # sonucu DUZENLEMEK bu turda yok. browser_sync kaynakli bir sonuc varsa
    # dokunulmaz (bir sonraki gercek okul senkronuyla CAKISABILIRDI); daha
    # once platform_admin tarafindan eklenmis kendi kaydini guncellemeye izin
    # verilir (o zaten senkrondan bagimsizdir, cakisma riski yok).
    existing = db.execute(
        "SELECT id, source FROM results WHERE student_id = ? AND exam_id = ?", (student_id, exam_id)
    ).fetchone()
    if existing and existing["source"] == "browser_sync":
        return jsonify({
            "error": "Bu öğrenci/deneme için zaten bir sonuç var (okulun kendi verisinden). "
                     "Bu turda var olan sonuçların düzenlenmesi desteklenmiyor.",
        }), 409

    result_payload = {"studentId": student_id, "examId": exam_id, "subjects": subjects}
    if existing:
        new_id = existing["id"]
        result_payload["id"] = new_id
        db.execute(
            "UPDATE results SET data_json = ? WHERE id = ?",
            (json.dumps(result_payload), new_id),
        )
    else:
        new_id = _platform_admin_next_id(db, "results", org_id)
        result_payload["id"] = new_id
        db.execute(
            "INSERT INTO results (id, organization_id, student_id, exam_id, data_json, source) "
            "VALUES (?,?,?,?,?,'platform_admin')",
            (new_id, org_id, student_id, exam_id, json.dumps(result_payload)),
        )
    db.commit()
    log_audit(db, "RESULT_CREATED_BY_PLATFORM", resource_type="result", resource_id=new_id)
    return jsonify({"ok": True, "id": new_id})


# ============================================================
# API: Admin - kullanıcı (öğretmen/veli) yönetimi
# ============================================================

@app.route("/api/admin/users", methods=["GET"])
@login_required(role=("admin", "teacher", "super_admin"), permission="users.manage")
def api_admin_list_users():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    rows = db.execute(
        "SELECT id, username, role, display_name, class_name, student_id, active, subject FROM users "
        "WHERE role NOT IN ('admin', 'super_admin') AND organization_id = ? ORDER BY role, username",
        (org_id,),
    ).fetchall()
    out = []
    for r in rows:
        student_names = []
        if r["role"] == "student" and r["student_id"]:
            st = db.execute("SELECT first_name, last_name FROM students WHERE id = ?",
                             (r["student_id"],)).fetchone()
            if st:
                student_names = [f'{st["first_name"]} {st["last_name"]}'.strip()]
        elif r["role"] == "parent":
            rows2 = db.execute(
                "SELECT s.first_name, s.last_name FROM parent_students ps "
                "JOIN students s ON s.id = ps.student_id WHERE ps.parent_user_id = ? "
                "ORDER BY s.last_name, s.first_name",
                (r["id"],),
            ).fetchall()
            student_names = [f'{s["first_name"]} {s["last_name"]}'.strip() for s in rows2]
        out.append({
            "id": r["id"], "username": r["username"], "role": r["role"],
            "displayName": r["display_name"],
            "className": teacher_class_display(r["class_name"]) if r["role"] == "teacher" else r["class_name"],
            "studentId": r["student_id"], "studentName": ", ".join(student_names) or None,
            "active": bool(r["active"]),
            "isDelegate": r["role"] == "teacher" and has_permission(db, r["id"], "users.manage"),
            "subject": r["subject"] if r["role"] == "teacher" else None,
        })
    return jsonify(out)


@app.route("/api/admin/students", methods=["GET"])
# İzin bilerek "students.view" değil "users.manage" - TEACHER v2 rolünde
# zaten students.view var (kendi paneli için), o izni burada da kabul
# etseydik yetki devri olmayan HER öğretmen bu admin listesine erişirdi.
# Bu uç sadece js/adminUsers.js'in hesap-oluşturma dropdown'ı için var.
@login_required(role=("admin", "teacher", "super_admin"), permission="users.manage")
def api_admin_students_list():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    rows = db.execute(
        "SELECT id, first_name, last_name, class_name, school_number FROM students "
        "WHERE organization_id = ? ORDER BY class_name, last_name",
        (org_id,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/users", methods=["POST"])
@login_required(role=("admin", "teacher", "super_admin"), permission="users.manage")
def api_admin_create_user():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = data.get("role")
    display_name = (data.get("displayName") or "").strip() or username
    class_name = (data.get("className") or "").strip() or None
    student_id = data.get("studentId") or None
    student_ids = [int(x) for x in (data.get("studentIds") or []) if x]
    subject = (data.get("subject") or "").strip() or None

    if not username or not password or role not in ("teacher", "parent", "student"):
        return jsonify({"error": "Kullanıcı adı, şifre ve geçerli bir rol (teacher/parent/student) gerekli."}), 400
    if role == "teacher" and not class_name:
        return jsonify({"error": "Öğretmen hesabı için sınıf adı gerekli (örn: 8/A)."}), 400
    if role == "parent" and not student_ids:
        return jsonify({"error": "Veli hesabı için en az bir öğrenci seçilmeli."}), 400
    if role == "student" and not student_id:
        return jsonify({"error": "Öğrenci hesabı için bir öğrenci kaydı seçilmeli."}), 400

    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        return jsonify({"error": "Bu kullanıcı adı zaten kullanılıyor."}), 400

    # IDOR koruması: secilen ogrenci kayitlarinin gercekten bu okula ait
    # oldugunu dogrula - aksi halde bir admin (id'yi tahmin ederek) baska
    # bir okulun ogrencisine veli/ogrenci hesabi baglayabilirdi.
    ids_to_check = list(student_ids) + ([student_id] if student_id else [])
    if ids_to_check:
        placeholders = ",".join("?" * len(ids_to_check))
        owned_count = db.execute(
            f"SELECT COUNT(*) FROM students WHERE id IN ({placeholders}) AND organization_id = ?",
            (*ids_to_check, org_id),
        ).fetchone()[0]
        if owned_count != len(set(ids_to_check)):
            return jsonify({"error": "Seçilen öğrenci kaydı bulunamadı."}), 400

    cur = db.execute(
        "INSERT INTO users (username, password_hash, role, display_name, class_name, "
        "student_id, organization_id, subject, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (username, hash_password(password), role, display_name,
         class_name, student_id if role == "student" else None, org_id,
         subject if role == "teacher" else None, datetime.now().isoformat()),
    )
    if role == "parent":
        new_user_id = cur.lastrowid
        for sid in student_ids:
            db.execute(
                "INSERT OR IGNORE INTO parent_students (parent_user_id, student_id) VALUES (?,?)",
                (new_user_id, sid),
            )
    else:
        new_user_id = cur.lastrowid
    db.commit()
    run_v2_migration(db)
    log_audit(db, "USER_CREATED", resource_type="user", resource_id=new_user_id)
    return jsonify({"ok": True})


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
@login_required(role=("admin", "super_admin"), permission="users.manage")
def api_admin_delete_user(user_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    db.execute(
        "DELETE FROM users WHERE id = ? AND role NOT IN ('admin', 'super_admin') AND organization_id = ?",
        (user_id, org_id),
    )
    db.commit()
    log_audit(db, "USER_DELETED", resource_type="user", resource_id=user_id)
    return jsonify({"ok": True})


@app.route("/api/admin/users/<int:user_id>/toggle-active", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="users.manage")
def api_admin_toggle_active(user_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    user = db.execute(
        "SELECT active FROM users WHERE id = ? AND role NOT IN ('admin', 'super_admin') AND organization_id = ?",
        (user_id, org_id),
    ).fetchone()
    if not user:
        return jsonify({"error": "Kullanıcı bulunamadı."}), 404
    new_active = 0 if user["active"] else 1
    db.execute("UPDATE users SET active = ? WHERE id = ?", (new_active, user_id))
    db.commit()
    log_audit(db, "USER_STATUS_CHANGED", resource_type="user", resource_id=user_id)
    return jsonify({"ok": True, "active": bool(new_active)})


@app.route("/api/admin/users/<int:user_id>/password", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="users.manage")
def api_admin_reset_password(user_id):
    data = request.get_json(silent=True) or {}
    new_password = data.get("password") or ""
    if len(new_password) < 4:
        return jsonify({"error": "Şifre en az 4 karakter olmalı."}), 400
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ? AND role NOT IN ('admin', 'super_admin') AND organization_id = ?",
        (hash_password(new_password), user_id, org_id),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<int:user_id>/delegate", methods=["POST"])
@login_required(role=("admin", "super_admin"), permission="users.manage")
def api_admin_set_delegate(user_id):
    """Okul admini (ya da bir okula girmis super_admin) kendi
    ogretmenlerinden birine hesap ekleme/listeleme yetkisi verir/geri alir -
    bir delege kendini/baskasini yetkilendiremez (role listesi delege'nin
    kendi 'teacher' rolunu icermiyor)."""
    data = request.get_json(silent=True) or {}
    grant = bool(data.get("grant"))

    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    target = db.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'teacher' AND organization_id = ?",
        (user_id, org_id),
    ).fetchone()
    if not target:
        return jsonify({"error": "Öğretmen bulunamadı."}), 404

    role_row = db.execute("SELECT id FROM roles WHERE name = 'SCHOOL_ADMIN_DELEGATE'").fetchone()
    if not role_row:
        # run_v2_migration henuz hic calismamis olabilir (cok erken bir
        # cagiri) - once onu calistirip rolun var oldugundan emin ol.
        run_v2_migration(db)
        role_row = db.execute("SELECT id FROM roles WHERE name = 'SCHOOL_ADMIN_DELEGATE'").fetchone()

    if grant:
        db.execute(
            "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)",
            (user_id, role_row["id"]),
        )
    else:
        db.execute(
            "DELETE FROM user_roles WHERE user_id = ? AND role_id = ?",
            (user_id, role_row["id"]),
        )
    db.commit()
    log_audit(db, "DELEGATE_GRANTED" if grant else "DELEGATE_REVOKED",
              resource_type="user", resource_id=user_id)
    return jsonify({"ok": True, "isDelegate": grant})


@app.route("/api/me/password", methods=["POST"])
@login_required()
def api_change_own_password():
    data = request.get_json(silent=True) or {}
    current = data.get("currentPassword") or ""
    new_password = data.get("newPassword") or ""
    if len(new_password) < 4:
        return jsonify({"error": "Yeni şifre en az 4 karakter olmalı."}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not user or not verify_password(user["password_hash"], current)[0]:
        return jsonify({"error": "Mevcut şifre yanlış."}), 401
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
               (hash_password(new_password), user["id"]))
    db.commit()
    return jsonify({"ok": True})


# ============================================================
# API: Öğretmen - yalnızca kendi sınıfı + genel istatistikler
# ============================================================

def _all_class_averages(db, org_id, exam_id=None):
    """Tüm sınıfların (isim vermeden) ortalama net karşılaştırması - SADECE
    verilen okula ait. class_name tek başına okul-güvenli değil (iki okul
    aynı "8/A" adını paylaşabilir), bu yüzden organization_id filtresi
    zorunlu - yoksa iki okulun aynı isimli sınıfları tek grupta karışır."""
    exam_filter = "AND r.exam_id = ?" if exam_id else ""
    params = (org_id, exam_id) if exam_id else (org_id,)
    rows = db.execute(
        f"SELECT r.data_json, r.student_id, s.class_name FROM results r "
        f"JOIN students s ON s.id = r.student_id "
        f"WHERE s.organization_id = ? {exam_filter}", params
    ).fetchall()
    by_class = {}
    students_by_class = {}
    for r in rows:
        data = json.loads(r["data_json"])
        cls = r["class_name"] or "Bilinmiyor"
        by_class.setdefault(cls, []).append(calc_total_net(data.get("subjects")))
        # Bir öğrencinin birden fazla denemesi olabilir - "öğrenci sayısı" sonuç
        # SATIRI sayısı değil, DISTINCT öğrenci sayısı olmalı (aksi halde 3
        # deneme giren 50 kişilik bir sınıf "150 öğrenci" gösterir).
        students_by_class.setdefault(cls, set()).add(r["student_id"])
    out = []
    for cls, nets in sorted(by_class.items()):
        out.append({
            "className": cls,
            "studentCount": len(students_by_class[cls]),
            "avgNet": round(sum(nets) / len(nets), 2) if nets else 0,
        })
    return out


def _build_teacher_insights(db, student_ids):
    """Öğretmenin 'Bugün Ne Yapmalıyım?' ana sayfası için sınıf geneli
    öngörüler: son 3 denemede düşüşe geçen ders, kişisel rekorlar, sınıf net
    trendi, konu başarı haritası ve öğrenci radarı (yükselişte/takip
    gerekli/dalgalı). Tamamı gerçek verilerden hesaplanır - şablon metinler
    yalnızca hesaplanan sayıları/isimleri cümleye yerleştirir, üretken bir
    yapay zekâ çağrısı yoktur. student_ids: öğretmenin erişebildiği (tek ya da
    birden fazla sınıf/tüm okul) öğrenci id listesi - bkz. get_allowed_student_ids."""
    if not student_ids:
        return None
    placeholders0 = ",".join("?" * len(student_ids))
    students = db.execute(
        f"SELECT id, first_name, last_name FROM students WHERE id IN ({placeholders0})", tuple(student_ids)
    ).fetchall()
    student_ids = [s["id"] for s in students]
    if not student_ids:
        return None
    student_map = {s["id"]: s for s in students}

    placeholders = ",".join("?" * len(student_ids))
    result_rows = db.execute(
        f"SELECT r.student_id, r.data_json, e.id as exam_id, e.name as exam_name, "
        f"e.date as exam_date FROM results r JOIN exams e ON e.id = r.exam_id "
        f"WHERE r.student_id IN ({placeholders}) ORDER BY e.date ASC",
        tuple(student_ids),
    ).fetchall()

    by_student = {}
    for r in result_rows:
        data = json.loads(r["data_json"])
        by_student.setdefault(r["student_id"], []).append({
            "examId": r["exam_id"], "examName": r["exam_name"], "examDate": r["exam_date"],
            "totalNet": calc_total_net(data.get("subjects")),
            "subjects": data.get("subjects", {}),
        })

    # ---- 1) Son 3 denemede düşüşe geçen ders (öncelikli uyarı) ----
    decline_counts = {}
    for sid, results in by_student.items():
        if len(results) < 3:
            continue
        last3 = results[-3:]
        keys = set()
        for r in last3:
            keys.update(r["subjects"].keys())
        for key in keys:
            nets = [r["subjects"].get(key, {}).get("net") for r in last3]
            if any(n is None for n in nets):
                continue
            if nets[0] > nets[1] > nets[2]:
                decline_counts.setdefault(key, []).append(sid)
    decline = None
    if decline_counts:
        key, ids = max(decline_counts.items(), key=lambda kv: len(kv[1]))
        decline = {
            "subjectKey": key, "count": len(ids),
            "students": [{"id": sid, "firstName": student_map[sid]["first_name"],
                          "lastName": student_map[sid]["last_name"]} for sid in ids],
        }

    # ---- 2) Kişisel rekor kıran öğrenciler (başarı) ----
    personal_records = []
    for sid, results in by_student.items():
        if len(results) < 2:
            continue
        nets = [r["totalNet"] for r in results]
        if nets[-1] >= max(nets[:-1]) and nets[-1] > nets[-2]:
            personal_records.append({
                "id": sid, "firstName": student_map[sid]["first_name"], "lastName": student_map[sid]["last_name"],
                "totalNet": nets[-1], "examName": results[-1]["examName"],
            })

    # ---- 3) Sınıf net trendi (son 10 deneme) + en başarılı öğrenci ----
    exam_order = db.execute("SELECT id, name, date FROM exams ORDER BY date ASC").fetchall()
    trend_exams = []
    for e in exam_order:
        nets = [r["totalNet"] for results in by_student.values() for r in results if r["examId"] == e["id"]]
        if nets:
            trend_exams.append({"examId": e["id"], "examName": e["name"], "avgNet": round(sum(nets) / len(nets), 2)})
    trend_exams = trend_exams[-10:]

    best_student_id, best_avg = None, -999
    for sid, results in by_student.items():
        avg = sum(r["totalNet"] for r in results) / len(results)
        if avg > best_avg:
            best_avg, best_student_id = avg, sid

    best_student_trend = []
    if best_student_id is not None:
        wanted = {t["examId"] for t in trend_exams}
        best_student_trend = [{"examId": r["examId"], "totalNet": r["totalNet"]}
                               for r in by_student[best_student_id] if r["examId"] in wanted]

    growth_pct = None
    if len(trend_exams) >= 2 and trend_exams[0]["avgNet"]:
        growth_pct = round((trend_exams[-1]["avgNet"] - trend_exams[0]["avgNet"]) / trend_exams[0]["avgNet"] * 100, 1)

    # ---- 4) Konu başarı haritası: cevap anahtarı olan en güncel deneme ----
    topic_heatmap, ai_comment = None, None
    for e in reversed(exam_order):
        exam_row = db.execute("SELECT data_json FROM exams WHERE id = ?", (e["id"],)).fetchone()
        exam_data = json.loads(exam_row["data_json"]) if exam_row["data_json"] else {}
        if not exam_data.get("topicMap"):
            continue
        class_raw = [{"subjects": r["subjects"]} for results in by_student.values() for r in results if r["examId"] == e["id"]]
        if not class_raw:
            continue
        qs = build_question_stats(exam_data, class_raw)
        if qs:
            topic_heatmap = build_topic_stats(qs)[:8]
            if topic_heatmap:
                weakest = topic_heatmap[0]
                ai_comment = (f"Öğrencilerin en çok zorlandığı alan {weakest['kazanim']} "
                               f"(%{weakest['successRate']} başarı). Önümüzdeki hafta kısa bir tekrar yapılması öneriliyor.")
            break

    below_avg_topic = None
    if topic_heatmap:
        overall_avg = sum(t["successRate"] for t in topic_heatmap) / len(topic_heatmap)
        weak = [t for t in topic_heatmap if t["successRate"] < overall_avg]
        if weak:
            below_avg_topic = min(weak, key=lambda t: t["successRate"])

    # ---- 5) Öğrenci Radarı: son 2-3 denemedeki net yönü ----
    # delta/latestNet, Risk Haritası (scatter) için eksen değerleri olarak da kullanılır.
    rising, attention, fluctuating = [], [], []
    for sid, results in by_student.items():
        if len(results) < 2:
            continue
        window = results[-3:] if len(results) >= 3 else results[-2:]
        nets = [r["totalNet"] for r in window]
        info = {
            "id": sid, "firstName": student_map[sid]["first_name"], "lastName": student_map[sid]["last_name"],
            "delta": round(nets[-1] - nets[0], 2), "latestNet": nets[-1],
        }
        if all(nets[i] < nets[i + 1] for i in range(len(nets) - 1)):
            rising.append(info)
        elif all(nets[i] > nets[i + 1] for i in range(len(nets) - 1)):
            attention.append(info)
        else:
            fluctuating.append(info)

    # ---- 6) Mini trend (sparkline): son 5 denemenin net değerleri ----
    sparklines = {
        sid: [r["totalNet"] for r in results[-5:]]
        for sid, results in by_student.items() if len(results) >= 2
    }

    return {
        "priority": {
            "decline": decline,
            "belowAvgTopic": below_avg_topic,
            "personalRecords": personal_records,
        },
        "trend": {
            "exams": trend_exams,
            "bestStudent": ({"id": best_student_id, "firstName": student_map[best_student_id]["first_name"],
                              "lastName": student_map[best_student_id]["last_name"], "data": best_student_trend}
                             if best_student_id is not None else None),
            "growthPct": growth_pct,
        },
        "topicHeatmap": topic_heatmap,
        "aiComment": ai_comment,
        "radar": {"rising": rising, "attention": attention, "fluctuating": fluctuating},
        "sparklines": sparklines,
    }


@app.route("/api/teacher/insights")
@login_required(role="teacher", permission="students.view")
def api_teacher_insights():
    db = get_db()
    insights = _build_teacher_insights(db, get_allowed_student_ids(db))
    if not insights:
        return jsonify({"error": "Sınıfınıza kayıtlı öğrenci bulunamadı."}), 404
    return jsonify(insights)


@app.route("/api/teacher/overview")
@login_required(role=("teacher", "admin", "super_admin"), permission="students.view")
def api_teacher_overview():
    db = get_db()
    org_id = _effective_org_id(db)
    classes = None if session.get("role") in ("admin", "super_admin") else teacher_class_list(session.get("class_name"))
    my_class = "Tüm Sınıflar" if classes is None else ", ".join(classes)

    allowed_ids = get_allowed_student_ids(db)
    # None => sinirsiz (admin/class_name='*' degil, sadece admin - bkz.
    # get_allowed_student_ids) - okulun TUM ogrencileri. `if not allowed_ids`
    # ile bunu bos kumeyle KARISTIRMAMAK kritik, aksi halde admin kendi
    # okulunun ogrencilerini hic goremezdi.
    if allowed_ids is None:
        students = db.execute(
            "SELECT * FROM students WHERE organization_id = ? ORDER BY last_name, first_name",
            (org_id,)
        ).fetchall()
    elif not allowed_ids:
        students = []
    else:
        placeholders = ",".join("?" * len(allowed_ids))
        students = db.execute(
            f"SELECT * FROM students WHERE id IN ({placeholders}) ORDER BY last_name, first_name",
            tuple(allowed_ids)
        ).fetchall()
    # DUZELTME: bu sorgu daha once organization_id filtresi icermiyordu -
    # herhangi bir ogretmen TUM okullarin deneme listesini goruyordu (isim/
    # tarih). Ikinci gercek okul eklenince bu bir sizinti olurdu.
    exams = db.execute(
        "SELECT id, name, date, exam_type FROM exams WHERE organization_id = ? ORDER BY date DESC",
        (org_id,),
    ).fetchall()

    # admin-panel-prompt.md bolum 7: kademeye gore gruplu liste + katilimci/
    # ortalama/en yuksek/en dusuk. Denemenin kendi bir "kademe" alani yok -
    # katilimcilarinin sinif adlarindan (bkz. js/app.js parseClassName ile
    # AYNI mantik) baskin kademe (>=%60) turetilir.
    exam_stats = {}
    for e in exams:
        rows = db.execute(
            "SELECT r.data_json, s.class_name FROM results r "
            "JOIN students s ON s.id = r.student_id WHERE r.exam_id = ?",
            (e["id"],),
        ).fetchall()
        if not rows:
            exam_stats[e["id"]] = None
            continue
        nets = []
        grade_counts = {}
        for r in rows:
            data = json.loads(r["data_json"]) if r["data_json"] else {}
            nets.append(calc_total_net(data.get("subjects", {})))
            m = re.match(r"^(\d+)", (r["class_name"] or "").strip())
            if m:
                grade_counts[m.group(1)] = grade_counts.get(m.group(1), 0) + 1
        dominant_grade = None
        if grade_counts:
            top_grade, top_count = max(grade_counts.items(), key=lambda kv: kv[1])
            if top_count / len(rows) >= 0.6:
                dominant_grade = top_grade
        exam_stats[e["id"]] = {
            "studentCount": len(nets),
            "totalNet": round(sum(nets) / len(nets), 2),
            "highestNet": round(max(nets), 2),
            "lowestNet": round(min(nets), 2),
            "dominantGrade": dominant_grade,
        }

    student_list = []
    for s in students:
        s_dict = dict(s)
        res_rows = db.execute(
            "SELECT r.exam_id, r.data_json, e.name as exam_name, e.date as exam_date "
            "FROM results r JOIN exams e ON e.id = r.exam_id "
            "WHERE r.student_id = ? ORDER BY e.date ASC",
            (s["id"],)
        ).fetchall()

        nets = []
        for r in res_rows:
            data = json.loads(r["data_json"]) if r["data_json"] else {}
            subj = data.get("subjects", {})
            total_net = calc_total_net(subj)
            nets.append(total_net)

        s_dict["examCount"] = len(nets)
        s_dict["latestNet"] = nets[-1] if nets else None
        s_dict["prevNet"] = nets[-2] if len(nets) >= 2 else None
        s_dict["netChange"] = round(nets[-1] - nets[-2], 2) if len(nets) >= 2 else None
        s_dict["avgNet"] = round(sum(nets) / len(nets), 2) if nets else None
        s_dict["bestNet"] = max(nets) if nets else None
        s_dict["sparkline"] = nets[-5:] if len(nets) >= 2 else nets

        if len(nets) >= 2:
            window = nets[-3:] if len(nets) >= 3 else nets[-2:]
            if all(window[i] < window[i + 1] for i in range(len(window) - 1)):
                s_dict["status"] = "rising"
            elif all(window[i] > window[i + 1] for i in range(len(window) - 1)):
                s_dict["status"] = "attention"
            elif max(window) - min(window) >= 5:
                s_dict["status"] = "fluctuating"
            else:
                s_dict["status"] = "stable"
        else:
            s_dict["status"] = "new"

        student_list.append(s_dict)

    sorted_by_net = sorted(
        student_list,
        key=lambda x: (x["latestNet"] is not None, x["latestNet"] or 0, x["avgNet"] or 0),
        reverse=True
    )
    for idx, s_item in enumerate(sorted_by_net, 1):
        s_item["rank"] = idx if s_item["latestNet"] is not None else None

    exams_with_stats = []
    for e in exams:
        e_dict = dict(e)
        e_dict["stats"] = exam_stats.get(e["id"])
        exams_with_stats.append(e_dict)

    return jsonify({
        "className": my_class,
        "students": student_list,
        "exams": exams_with_stats,
        "classAverages": _all_class_averages(db, org_id),
    })


@app.route("/api/teacher/exam/<int:exam_id>")
@login_required(role=("teacher", "admin", "super_admin"), permission="students.view")
def api_teacher_exam_detail(exam_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    classes = None if session.get("role") in ("admin", "super_admin") else teacher_class_list(session.get("class_name"))
    my_class = "Tüm Sınıflar" if classes is None else ", ".join(classes)

    exam_row = db.execute(
        "SELECT * FROM exams WHERE id = ? AND organization_id = ?", (exam_id, org_id)
    ).fetchone()
    if not exam_row:
        return jsonify({"error": "Deneme bulunamadı."}), 404
    exam_data = json.loads(exam_row["data_json"])

    # None => sinirsiz (admin) - okulun TUM ogrencileri. `or set()` bunu bos
    # kumeyle karistirip admin'in kendi "siralama" tablosunu hep bos
    # dondururdu (bkz. api_teacher_overview'deki ayni sinif hata).
    _allowed = get_allowed_student_ids(db)
    if _allowed is None:
        my_student_ids = {r["id"] for r in db.execute(
            "SELECT id FROM students WHERE organization_id = ?", (org_id,)
        ).fetchall()}
    else:
        my_student_ids = _allowed
    if my_student_ids:
        placeholders_s = ",".join("?" * len(my_student_ids))
        my_students = db.execute(
            f"SELECT id, first_name, last_name, school_number FROM students WHERE id IN ({placeholders_s})",
            tuple(my_student_ids)
        ).fetchall()
    else:
        my_students = []

    # Okul sıralaması için bu denemeye ait TÜM okulun sonuçları gerekiyor,
    # sınıf sıralaması için ise yalnızca kendi sınıfının sonuçları.
    all_result_rows = db.execute(
        "SELECT r.student_id, r.data_json FROM results r WHERE r.exam_id = ? AND r.organization_id = ?",
        (exam_id, org_id),
    ).fetchall()

    all_totals = []
    my_results = []
    my_results_raw = []
    for r in all_result_rows:
        data = json.loads(r["data_json"])
        total_net = calc_total_net(data.get("subjects"))
        all_totals.append(total_net)
        if r["student_id"] in my_student_ids:
            student = next(s for s in my_students if s["id"] == r["student_id"])
            my_results.append({
                "studentId": r["student_id"],
                "studentName": f'{student["first_name"]} {student["last_name"]}'.strip(),
                "schoolNumber": student["school_number"],
                "subjects": data.get("subjects", {}),
                "totalNet": total_net,
            })
            my_results_raw.append(data)

    school_size = len(all_totals)
    class_size = len(my_results)

    # Bir önceki deneme netleri (bu denemeden önceki en yakın tarihli deneme) -
    # artış/azalış göstergesi için. Tarihe göre sıralayıp her öğrencinin en
    # son (en yakın) önceki sonucunu alıyoruz.
    prev_net_by_student = {}
    if my_student_ids and exam_row["date"]:
        placeholders = ",".join("?" * len(my_student_ids))
        prev_rows = db.execute(
            f"SELECT r.student_id, r.data_json FROM results r "
            f"JOIN exams e ON e.id = r.exam_id "
            f"WHERE r.student_id IN ({placeholders}) AND r.organization_id = ? "
            f"AND e.date < ? AND e.id != ? "
            f"ORDER BY e.date DESC",
            (*my_student_ids, org_id, exam_row["date"], exam_id),
        ).fetchall()
        for r in prev_rows:
            if r["student_id"] in prev_net_by_student:
                continue
            prev_data = json.loads(r["data_json"])
            prev_net_by_student[r["student_id"]] = calc_total_net(prev_data.get("subjects"))

    for item in my_results:
        # Eşitlik durumunda aynı sırayı paylaşırlar (kendinden yüksek net
        # sayısı + 1) - _build_student_report'taki class_rank ile aynı yöntem.
        item["classRank"] = sum(1 for t in (x["totalNet"] for x in my_results) if t > item["totalNet"]) + 1
        item["classSize"] = class_size
        item["schoolRank"] = sum(1 for t in all_totals if t > item["totalNet"]) + 1
        item["schoolSize"] = school_size
        prev_net = prev_net_by_student.get(item["studentId"])
        item["prevNet"] = prev_net
        item["netChange"] = round(item["totalNet"] - prev_net, 2) if prev_net is not None else None

    question_stats = build_question_stats(exam_data, my_results_raw)
    topic_stats = build_topic_stats(question_stats) if question_stats else None

    # classes is None => sinirsiz goruntuleyici (class_name='*' ogretmen ya da
    # super_admin) - "kendi sinifim" diye bir sey yok, o yuzden HICBIR sinif
    # haric tutulmadan TUM sinif ortalamalari donuyor. Daha once bu durumda
    # (classes is None oldugunda) liste her zaman BOS donuyordu - duzeltildi.
    all_class_averages = _all_class_averages(db, org_id, exam_id)
    other_class_averages = all_class_averages if classes is None else [
        c for c in all_class_averages if c["className"] not in classes
    ]

    return jsonify({
        "exam": {"id": exam_row["id"], "name": exam_row["name"], "date": exam_row["date"],
                 "examType": exam_row["exam_type"]},
        "myClassResults": sorted(my_results, key=lambda x: -x["totalNet"]),
        "otherClassAverages": other_class_averages,
        "topicStats": topic_stats,
        "questionStats": question_stats,
    })


@app.route("/api/teacher/student/<int:student_id>")
@login_required(role=("teacher", "admin", "super_admin"), permission="students.view")
def api_teacher_student_detail(student_id):
    """Öğretmenin kendi sınıfındaki tek bir öğrencinin ayrıntılı raporu (deneme
    geçmişi, net trendi, konu analizi, Başarı Pusulası) - veli tarafındaki
    _build_student_report ile aynı veri şekli, yalnızca kendi sınıfıyla
    sınırlı erişim (bkz. can_view_student -> get_allowed_student_ids)."""
    db = get_db()
    if not can_view_student(db, student_id):
        return jsonify({"error": "Bu öğrenciye erişim yetkiniz yok."}), 403
    exam_id = request.args.get("exam_id", type=int)
    report = _build_student_report(db, student_id, exam_id=exam_id)
    if not report:
        return jsonify({"error": "Öğrenci kaydı bulunamadı."}), 404
    return jsonify(report)


@app.route("/api/teacher/student/<int:student_id>/skills")
@login_required(role=("teacher", "admin", "super_admin"), permission="students.view")
def api_teacher_student_skills(student_id):
    """admin-panel-soru-havuzu-2 bölüm 10.6: bir öğrencinin beceri bazlı
    mastery durumu - aynı can_view_student ile IDOR korumalı (bkz.
    api_teacher_student_detail ile aynı desen). Henüz bir dashboard'a
    bağlanmadı (bölüm 10.13/10.14, ayrı bir iş) - bu, veri katmanının
    (10.6) test edilebilir/erişilebilir olması için minimal bir okuma ucu."""
    db = get_db()
    if not can_view_student(db, student_id):
        return jsonify({"error": "Bu öğrenciye erişim yetkiniz yok."}), 403
    rows = db.execute(
        "SELECT ss.skill_id, sk.name, ss.mastery_percentage, ss.attempts_count, "
        "ss.distinct_patterns_count, ss.mastery_confirmed, ss.confirmed_at, ss.updated_at "
        "FROM student_skills ss JOIN skills sk ON sk.id = ss.skill_id "
        "WHERE ss.student_id = ? ORDER BY ss.mastery_percentage ASC",
        (student_id,),
    ).fetchall()
    return jsonify({"skills": [dict(r) | {"mastery_confirmed": bool(r["mastery_confirmed"])} for r in rows]})


@app.route("/api/teacher/message", methods=["POST"])
@login_required()
def api_teacher_send_message():
    """Öğretmenin kendi sınıfından (ya da admin'in herhangi bir öğrenciye)
    kısa bir mesaj/tebrik göndermesi - öğrenci bunu kendi panelinde görür
    (bkz. api_student_overview)."""
    if session.get("role") not in ("teacher", "admin"):
        return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403
    db = get_db()
    data = request.get_json(silent=True) or {}
    student_id = data.get("studentId")
    message = (data.get("message") or "").strip()[:500]

    if not student_id or not message:
        return jsonify({"error": "Öğrenci ve mesaj metni gerekli."}), 400
    if not can_view_student(db, student_id):
        return jsonify({"error": "Bu öğrenciye erişim yetkiniz yok."}), 403

    db.execute(
        "INSERT INTO teacher_messages (student_id, teacher_user_id, message, created_at) VALUES (?,?,?,?)",
        (student_id, session["user_id"], message, datetime.now().isoformat()),
    )
    db.commit()
    return jsonify({"ok": True})


# ============================================================
# API: Ödev (Assignment) modülü
# ============================================================
# Icerik kaynagi HER ZAMAN question_bank (status='approved') - bkz.
# assignments tablosunun yorumu. Scope: TEACHER=ASSIGNED (sadece kendi
# class_name'i - teacher_class_list ile ayni desen), SCHOOL_ADMIN/
# SUPER_ADMIN=ORGANIZATION (org icindeki HERHANGI bir sinif).

@app.route("/api/teacher/question-bank/approved")
@login_required(role=("teacher", "admin", "super_admin"), permission="questions.view")
def api_teacher_approved_questions():
    """Ogretmenin odev olustururken secebilecegi, YAYINLANMIS (published)
    sorularin sade (batch/inceleme detaylari olmadan) listesi - tam admin
    soru bankasi ekranindan FARKLI, kasitli olarak basit bir secim listesi.
    'approved' henuz yayina hazir degil - published olmadan odeve
    eklenemez (bkz. questions.publish, _migrate_question_bank_lifecycle)."""
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    rows = db.execute(
        "SELECT qb.id, qb.display_code, qb.question_text, qb.image_path, qb.subject_id, "
        "qb.topic_id, qb.difficulty, s.name as subject_name, t.name as topic_name "
        "FROM question_bank qb LEFT JOIN subjects s ON s.id = qb.subject_id "
        "LEFT JOIN topics t ON t.id = qb.topic_id "
        "WHERE qb.organization_id = ? AND qb.status = 'published' "
        "ORDER BY s.name, qb.display_code",
        (org_id,),
    ).fetchall()
    return jsonify([{
        "id": r["id"], "displayCode": r["display_code"],
        "questionText": r["question_text"], "hasImage": bool(r["image_path"]),
        "subjectId": r["subject_id"], "subjectName": r["subject_name"],
        "topicId": r["topic_id"], "topicName": r["topic_name"], "difficulty": r["difficulty"],
    } for r in rows])


def _teacher_can_use_class(class_name):
    """Oturumdaki kullanici (teacher/admin/super_admin) verilen sinifa odev
    verebilir mi? Admin/super_admin icin sinir yok (ORGANIZATION scope -
    org filtresi zaten cagiran tarafta uygulaniyor); teacher icin
    get_allowed_student_ids ile AYNI teacher_class_list mantigi (ASSIGNED scope)."""
    if session.get("role") in ("admin", "super_admin"):
        return True
    allowed = teacher_class_list(session.get("class_name"))
    return allowed is None or class_name in allowed


def _auto_select_questions(db, org_id, subject_id, topic_id, difficulty, count, exclude_ids=None):
    """admin-panel-soru-havuzu-2 bölüm 10.7 (Otomatik ödev): öğretmenin
    verdiği filtrelere uyan `count` kadar yayınlanmış soru seçer. Yeterli
    soru yoksa BULUNAN kadarıyla döner (çağıran taraf sayıyı kontrol eder) -
    sessizce eksik bir ödev oluşturmak yerine."""
    exclude_ids = exclude_ids or set()
    query = "SELECT id FROM question_bank WHERE organization_id=? AND status='published' "
    params = [org_id]
    if subject_id:
        query += "AND subject_id=? "
        params.append(subject_id)
    if topic_id:
        query += "AND topic_id=? "
        params.append(topic_id)
    if difficulty:
        query += "AND difficulty=? "
        params.append(difficulty)
    if exclude_ids:
        query += f"AND id NOT IN ({','.join('?' * len(exclude_ids))}) "
        params += list(exclude_ids)
    query += "ORDER BY RANDOM() LIMIT ?"
    params.append(count)
    return [r["id"] for r in db.execute(query, params).fetchall()]


def _smart_select_questions_for_student(db, org_id, student_id, subject_id, grade_level, count):
    """admin-panel-soru-havuzu-2 bölüm 10.7 (Akıllı ödev): bu öğrencinin
    (varsa) en zayıf becerilerinden başlayarak, her biri için bölüm 10.8'in
    aynı gevşeme algoritmasıyla bir soru seçer - mastery verisi olmayan bir
    öğrenci için (henüz hiç çözüm geçmişi yok) rastgele/filtre gevşetilmiş
    seçime düşer (bkz. _auto_select_questions çağrısı en sonda)."""
    weak_skills = db.execute(
        "SELECT ss.skill_id FROM student_skills ss "
        "JOIN question_skills qs ON qs.skill_id = ss.skill_id "
        "JOIN question_bank qb ON qb.id = qs.question_id AND qb.subject_id = ? AND qb.organization_id = ? "
        "WHERE ss.student_id = ? GROUP BY ss.skill_id ORDER BY ss.mastery_percentage ASC LIMIT ?",
        (subject_id, org_id, student_id, count),
    ).fetchall()

    selected = []
    seen = set()
    for row in weak_skills:
        qid = _find_similar_question(
            db, org_id, subject_id, grade_level, None, row["skill_id"], "orta", exclude_ids=seen,
        )
        if qid:
            selected.append(qid)
            seen.add(qid)
    if len(selected) < count:
        filler = _auto_select_questions(
            db, org_id, subject_id, None, None, count - len(selected), exclude_ids=seen,
        )
        selected.extend(filler)
    return selected


@app.route("/api/teacher/assignments", methods=["POST"])
@login_required(role=("teacher", "admin", "super_admin"), permission="assignments.create")
def api_teacher_create_assignment():
    """Üç mod (bölüm 10.7, 'hepsi aynı anda' geliştirilir):
    - manual: öğretmen questionIds ile soruları tek tek seçer (mevcut/
      değişmemiş davranış) - tüm sınıf AYNI soruları görür (student_id NULL).
    - auto: öğretmen filtre (subjectId/topicId/difficulty) + questionCount
      verir, sistem _auto_select_questions ile seçer - yine sınıf geneli
      PAYLAŞIMLI tek bir set (student_id NULL).
    - smart: öğretmen sadece subjectId + questionCount verir, sistem HER
      öğrenci için AYRI, kişiselleştirilmiş bir set üretir (assignment_
      questions.student_id = o öğrenci) - bkz. _smart_select_questions_for_student."""
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    data = request.get_json(silent=True) or {}
    mode = (data.get("mode") or "manual").strip().lower()
    if mode not in ("manual", "auto", "smart"):
        return jsonify({"error": "Geçersiz ödev modu."}), 400
    class_name = (data.get("className") or "").strip()
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip() or None
    due_date = (data.get("dueDate") or "").strip() or None

    if not class_name or not title:
        return jsonify({"error": "Sınıf ve başlık gerekli."}), 400
    if not _teacher_can_use_class(class_name):
        return jsonify({"error": "Bu sınıfa ödev verme yetkiniz yok."}), 403

    # (student_id, question_id) çiftleri - manual/auto'da tüm liste tek bir
    # None student_id (paylaşımlı) taşır, smart'ta öğrenci başına ayrı liste.
    assignments_to_insert = []  # [(student_id_or_None, [question_id, ...])]

    if mode == "manual":
        question_ids = data.get("questionIds") or []
        if not isinstance(question_ids, list) or not question_ids:
            return jsonify({"error": "En az bir soru seçilmeli."}), 400
        placeholders = ",".join("?" * len(question_ids))
        valid_rows = db.execute(
            f"SELECT id FROM question_bank WHERE id IN ({placeholders}) AND organization_id = ? AND status = 'published'",
            (*question_ids, org_id),
        ).fetchall()
        if len({r["id"] for r in valid_rows}) != len(set(question_ids)):
            return jsonify({"error": "Seçilen sorulardan biri veya birden fazlası bulunamadı ya da henüz yayınlanmamış."}), 400
        assignments_to_insert.append((None, question_ids))

    elif mode == "auto":
        subject_id = data.get("subjectId")
        topic_id = data.get("topicId")
        difficulty = (data.get("difficulty") or "").strip() or None
        count = data.get("questionCount")
        if not subject_id or not count or int(count) < 1:
            return jsonify({"error": "Ders ve soru sayısı gerekli."}), 400
        question_ids = _auto_select_questions(db, org_id, subject_id, topic_id, difficulty, int(count))
        if not question_ids:
            return jsonify({"error": "Bu filtrelerle eşleşen yayınlanmış soru bulunamadı."}), 404
        assignments_to_insert.append((None, question_ids))

    else:  # smart
        subject_id = data.get("subjectId")
        count = data.get("questionCount")
        if not subject_id or not count or int(count) < 1:
            return jsonify({"error": "Ders ve soru sayısı gerekli."}), 400
        students = db.execute(
            "SELECT id, class_name FROM students WHERE organization_id=? AND class_name=?",
            (org_id, class_name),
        ).fetchall()
        if not students:
            return jsonify({"error": "Bu sınıfta öğrenci bulunamadı."}), 404
        for s in students:
            grade_level = (s["class_name"] or "").split("/")[0].strip()
            qids = _smart_select_questions_for_student(db, org_id, s["id"], subject_id, grade_level, int(count))
            if qids:
                assignments_to_insert.append((s["id"], qids))
        if not assignments_to_insert:
            return jsonify({"error": "Bu ders için hiçbir öğrenciye uygun soru bulunamadı."}), 404

    now = datetime.now().isoformat()
    cur = db.execute(
        "INSERT INTO assignments (organization_id, teacher_id, class_name, title, description, due_date, "
        "status, assignment_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (org_id, session["user_id"], class_name, title, description, due_date, "active", mode, now, now),
    )
    assignment_id = cur.lastrowid
    for student_id, question_ids in assignments_to_insert:
        for i, qid in enumerate(question_ids):
            db.execute(
                "INSERT INTO assignment_questions (assignment_id, question_bank_id, order_index, student_id) "
                "VALUES (?,?,?,?)",
                (assignment_id, qid, i, student_id),
            )
    db.commit()
    log_audit(db, "ASSIGNMENT_CREATED", resource_type="assignment", resource_id=assignment_id)
    return jsonify({"ok": True, "id": assignment_id})


@app.route("/api/teacher/assignments")
@login_required(role=("teacher", "admin", "super_admin"), permission="assignments.view")
def api_teacher_list_assignments():
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400

    query = "SELECT * FROM assignments WHERE organization_id = ?"
    params = [org_id]
    if session.get("role") == "teacher":
        query += " AND teacher_id = ?"
        params.append(session["user_id"])
    query += " ORDER BY created_at DESC"
    rows = db.execute(query, params).fetchall()

    out = []
    for a in rows:
        total_students = db.execute(
            "SELECT COUNT(*) c FROM students WHERE organization_id = ? AND class_name = ?",
            (org_id, a["class_name"]),
        ).fetchone()["c"]
        # Akilli modda her ogrencinin soru sayisi farkli olabilir (bkz.
        # _smart_select_questions_for_student) - liste gorunumu icin "ogrenci
        # basina ortalama" gosterilir, manuel/otomatikte zaten tek bir
        # paylasimli (student_id IS NULL) set oldugu icin bu ortalama = tam sayi.
        if a["assignment_type"] == "smart":
            avg_row = db.execute(
                "SELECT CAST(COUNT(*) AS REAL) / COUNT(DISTINCT student_id) c FROM assignment_questions "
                "WHERE assignment_id=? AND student_id IS NOT NULL", (a["id"],),
            ).fetchone()
            total_questions = round(avg_row["c"], 1) if avg_row["c"] else 0
        else:
            total_questions = db.execute(
                "SELECT COUNT(*) c FROM assignment_questions WHERE assignment_id = ?", (a["id"],)
            ).fetchone()["c"]
        submitted_students = db.execute(
            "SELECT COUNT(DISTINCT student_id) c FROM assignment_submissions WHERE assignment_id = ?", (a["id"],)
        ).fetchone()["c"]
        out.append({
            "id": a["id"], "className": a["class_name"], "title": a["title"],
            "description": a["description"], "dueDate": a["due_date"], "status": a["status"],
            "createdAt": a["created_at"], "totalStudents": total_students,
            "totalQuestions": total_questions, "submittedStudents": submitted_students,
            "assignmentType": a["assignment_type"],
        })
    return jsonify(out)


@app.route("/api/teacher/assignments/<int:assignment_id>/results")
@login_required(role=("teacher", "admin", "super_admin"), permission="assignments.view_results")
def api_teacher_assignment_results(assignment_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    assignment = db.execute(
        "SELECT * FROM assignments WHERE id = ? AND organization_id = ?", (assignment_id, org_id)
    ).fetchone()
    if not assignment:
        return jsonify({"error": "Ödev bulunamadı."}), 404
    if session.get("role") == "teacher" and assignment["teacher_id"] != session["user_id"]:
        return jsonify({"error": "Bu ödeve erişim yetkiniz yok."}), 403

    # student_id IS NULL: paylasimli sorular (manuel/otomatik - HERKESE ait).
    # dolu: akilli moddaki kisisellestirilmis sorular (SADECE o ogrenciye ait) -
    # bkz. api_teacher_create_assignment. Asagida her ogrenci icin kendi
    # gecerli soru kumesi (paylasimli + varsa kendine ozel) ayri hesaplanir.
    all_questions = db.execute(
        "SELECT aq.student_id, aq.question_bank_id, qb.display_code, qb.question_text, qb.correct_answer "
        "FROM assignment_questions aq JOIN question_bank qb ON qb.id = aq.question_bank_id "
        "WHERE aq.assignment_id = ? ORDER BY aq.order_index",
        (assignment_id,),
    ).fetchall()
    shared_questions = [q for q in all_questions if q["student_id"] is None]
    personal_questions = {}
    for q in all_questions:
        if q["student_id"] is not None:
            personal_questions.setdefault(q["student_id"], []).append(q)

    students = db.execute(
        "SELECT id, first_name, last_name, school_number FROM students "
        "WHERE organization_id = ? AND class_name = ? ORDER BY last_name, first_name",
        (org_id, assignment["class_name"]),
    ).fetchall()
    submissions = db.execute(
        "SELECT student_id, question_bank_id, answer, is_correct FROM assignment_submissions WHERE assignment_id = ?",
        (assignment_id,),
    ).fetchall()
    sub_map = {(s["student_id"], s["question_bank_id"]): s for s in submissions}

    student_results = []
    for s in students:
        questions = shared_questions + personal_questions.get(s["id"], [])
        answers = []
        correct_count = 0
        submitted = False
        for q in questions:
            sub = sub_map.get((s["id"], q["question_bank_id"]))
            if sub:
                submitted = True
                if sub["is_correct"]:
                    correct_count += 1
            answers.append({
                "questionBankId": q["question_bank_id"], "displayCode": q["display_code"],
                "answer": sub["answer"] if sub else None,
                "isCorrect": bool(sub["is_correct"]) if sub else None,
            })
        student_results.append({
            "studentId": s["id"], "firstName": s["first_name"], "lastName": s["last_name"],
            "schoolNumber": s["school_number"], "submitted": submitted,
            "correctCount": correct_count, "totalQuestions": len(questions), "answers": answers,
        })

    return jsonify({
        "assignment": {
            "id": assignment["id"], "title": assignment["title"], "className": assignment["class_name"],
            "description": assignment["description"], "dueDate": assignment["due_date"],
            "status": assignment["status"],
        },
        "students": student_results,
    })


@app.route("/api/teacher/assignments/<int:assignment_id>/cancel", methods=["POST"])
@login_required(role=("teacher", "admin", "super_admin"), permission="assignments.cancel")
def api_teacher_cancel_assignment(assignment_id):
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    assignment = db.execute(
        "SELECT teacher_id FROM assignments WHERE id = ? AND organization_id = ?", (assignment_id, org_id)
    ).fetchone()
    if not assignment:
        return jsonify({"error": "Ödev bulunamadı."}), 404
    if session.get("role") == "teacher" and assignment["teacher_id"] != session["user_id"]:
        return jsonify({"error": "Bu ödeve erişim yetkiniz yok."}), 403
    db.execute(
        "UPDATE assignments SET status = 'cancelled', updated_at = ? WHERE id = ?",
        (datetime.now().isoformat(), assignment_id),
    )
    db.commit()
    log_audit(db, "ASSIGNMENT_CANCELLED", resource_type="assignment", resource_id=assignment_id)
    return jsonify({"ok": True})


@app.route("/api/student/assignments")
@login_required(role="student", permission="assignments.view")
def api_student_list_assignments():
    student_id = session.get("student_id")
    if not student_id:
        return jsonify([])
    db = get_db()
    student = db.execute(
        "SELECT organization_id, class_name FROM students WHERE id = ?", (student_id,)
    ).fetchone()
    if not student or not student["class_name"]:
        return jsonify([])
    rows = db.execute(
        "SELECT * FROM assignments WHERE organization_id = ? AND class_name = ? AND status = 'active' "
        "ORDER BY created_at DESC",
        (student["organization_id"], student["class_name"]),
    ).fetchall()
    out = []
    for a in rows:
        total_questions = db.execute(
            "SELECT COUNT(*) c FROM assignment_questions WHERE assignment_id = ? AND (student_id IS NULL OR student_id = ?)",
            (a["id"], student_id),
        ).fetchone()["c"]
        answered = db.execute(
            "SELECT COUNT(*) c FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?",
            (a["id"], student_id),
        ).fetchone()["c"]
        out.append({
            "id": a["id"], "title": a["title"], "description": a["description"],
            "dueDate": a["due_date"], "totalQuestions": total_questions,
            "completed": answered >= total_questions and total_questions > 0,
        })
    return jsonify(out)


@app.route("/api/student/assignments/<int:assignment_id>")
@login_required(role="student", permission="assignments.view")
def api_student_assignment_detail(assignment_id):
    student_id = session.get("student_id")
    db = get_db()
    student = db.execute("SELECT organization_id, class_name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404
    assignment = db.execute(
        "SELECT * FROM assignments WHERE id = ? AND organization_id = ? AND class_name = ?",
        (assignment_id, student["organization_id"], student["class_name"]),
    ).fetchone()
    if not assignment:
        return jsonify({"error": "Ödev bulunamadı."}), 404

    # student_id IS NULL: paylasimli (manuel/otomatik) - herkes ayni soruyu
    # gorur. dolu: akilli moddaki KISISELLESTIRILMIS set - SADECE o ogrenciye
    # ait olanlar (bkz. api_teacher_create_assignment mode='smart').
    questions = db.execute(
        "SELECT aq.question_bank_id, qb.display_code, qb.question_text, qb.image_path, qb.question_type "
        "FROM assignment_questions aq JOIN question_bank qb ON qb.id = aq.question_bank_id "
        "WHERE aq.assignment_id = ? AND (aq.student_id IS NULL OR aq.student_id = ?) ORDER BY aq.order_index",
        (assignment_id, student_id),
    ).fetchall()
    my_submissions = {
        r["question_bank_id"]: dict(r) for r in db.execute(
            "SELECT question_bank_id, answer, is_correct FROM assignment_submissions "
            "WHERE assignment_id = ? AND student_id = ?", (assignment_id, student_id),
        ).fetchall()
    }
    return jsonify({
        "id": assignment["id"], "title": assignment["title"], "description": assignment["description"],
        "dueDate": assignment["due_date"], "status": assignment["status"],
        "questions": [{
            "questionBankId": q["question_bank_id"], "displayCode": q["display_code"],
            "questionText": q["question_text"], "questionType": q["question_type"],
            "hasImage": bool(q["image_path"]),
            "myAnswer": (my_submissions.get(q["question_bank_id"]) or {}).get("answer"),
            "isCorrect": (my_submissions.get(q["question_bank_id"]) or {}).get("is_correct"),
        } for q in questions],
    })


_DIFFICULTY_POINTS = {"kolay": 1, "orta": 2, "zor": 3}
MASTERY_MIN_ATTEMPTS = 3
MASTERY_MIN_PATTERNS = 2
MASTERY_THRESHOLD = 75.0


def _record_attempt(db, student_id, question_id, assignment_id=None, exam_id=None,
                     answer=None, is_correct=None, score=None, started_at=None, duration_seconds=None):
    """admin-panel-soru-havuzu-2 bölüm 10.6: HER anlamlı çözümü kalıcı,
    APPEND-ONLY olarak kaydeder (assignment_submissions'ın aksine üzerine
    yazmaz - bkz. tablo yorumu) ve etkilenen becerilerin mastery'sini
    yeniden hesaplar. question_bank.difficulty/question_pattern o ANKİ
    değeriyle denormalize edilir."""
    q = db.execute(
        "SELECT difficulty, question_pattern FROM question_bank WHERE id = ?", (question_id,)
    ).fetchone()
    now = datetime.now().isoformat()
    db.execute(
        "INSERT INTO student_question_attempts (student_id, question_id, assignment_id, exam_id, answer, "
        "is_correct, score, difficulty_at_attempt, question_pattern_at_attempt, started_at, answered_at, "
        "duration_seconds, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (student_id, question_id, assignment_id, exam_id, answer,
         None if is_correct is None else (1 if is_correct else 0), score,
         q["difficulty"] if q else None, q["question_pattern"] if q else None,
         started_at, now, duration_seconds, now),
    )
    skill_ids = [r["skill_id"] for r in db.execute(
        "SELECT skill_id FROM question_skills WHERE question_id = ?", (question_id,)
    ).fetchall()]
    for skill_id in skill_ids:
        _recompute_student_skill_mastery(db, student_id, skill_id)
    db.commit()


def _recompute_student_skill_mastery(db, student_id, skill_id):
    """Bir (öğrenci, beceri) çiftinin mastery_percentage'ını TÜM geçmiş
    çözümlerden (student_question_attempts) yeniden hesaplar. Formül (bölüm
    10.6): Kolay doğru=1p, Orta=2p, Zor=3p, yanlış=0p; bir soru birden fazla
    beceri ölçüyorsa (question_skills.weight) bu puana o oranda katkı verir.
    Henüz notlandırılmamış (is_correct IS NULL - örn. açık uçlu, manuel
    değerlendirme bekleyen) denemeler sayılmaz."""
    rows = db.execute(
        "SELECT sqa.is_correct, sqa.difficulty_at_attempt, sqa.question_pattern_at_attempt, qs.weight "
        "FROM student_question_attempts sqa "
        "JOIN question_skills qs ON qs.question_id = sqa.question_id AND qs.skill_id = ? "
        "WHERE sqa.student_id = ? AND sqa.is_correct IS NOT NULL",
        (skill_id, student_id),
    ).fetchall()
    now = datetime.now().isoformat()
    if not rows:
        db.execute("DELETE FROM student_skills WHERE student_id=? AND skill_id=?", (student_id, skill_id))
        return

    earned = possible = 0.0
    patterns = set()
    for r in rows:
        points = _DIFFICULTY_POINTS.get(r["difficulty_at_attempt"], 2)  # bilinmeyen zorluk -> 'orta' varsay
        weight_frac = (r["weight"] or 100) / 100.0
        possible += points * weight_frac
        if r["is_correct"]:
            earned += points * weight_frac
        if r["question_pattern_at_attempt"]:
            patterns.add(r["question_pattern_at_attempt"])

    mastery_pct = round((earned / possible * 100), 2) if possible > 0 else 0.0
    attempts_count = len(rows)
    distinct_patterns = len(patterns)
    is_confirmed_now = (
        attempts_count >= MASTERY_MIN_ATTEMPTS
        and distinct_patterns >= MASTERY_MIN_PATTERNS
        and mastery_pct >= MASTERY_THRESHOLD
    )

    existing = db.execute(
        "SELECT mastery_confirmed, confirmed_at FROM student_skills WHERE student_id=? AND skill_id=?",
        (student_id, skill_id),
    ).fetchone()
    if is_confirmed_now:
        # Ilk onaylandigi tarihi koru (tekrar tekrar "simdi onaylandi" gibi
        # gorunmesin) - zaten onayliysa eski confirmed_at'i tasi.
        confirmed_at = existing["confirmed_at"] if (existing and existing["mastery_confirmed"] and existing["confirmed_at"]) else now
    else:
        confirmed_at = None

    db.execute(
        "INSERT INTO student_skills (student_id, skill_id, mastery_percentage, attempts_count, "
        "distinct_patterns_count, mastery_confirmed, confirmed_at, updated_at) VALUES (?,?,?,?,?,?,?,?) "
        "ON CONFLICT(student_id, skill_id) DO UPDATE SET "
        "mastery_percentage=excluded.mastery_percentage, attempts_count=excluded.attempts_count, "
        "distinct_patterns_count=excluded.distinct_patterns_count, mastery_confirmed=excluded.mastery_confirmed, "
        "confirmed_at=excluded.confirmed_at, updated_at=excluded.updated_at",
        (student_id, skill_id, mastery_pct, attempts_count, distinct_patterns,
         int(is_confirmed_now), confirmed_at, now),
    )


_DIFFICULTY_ORDER = ["kolay", "orta", "zor"]


def _next_difficulty(current_difficulty, recent_is_correct_desc):
    """admin-panel-soru-havuzu-2 bölüm 10.5 (zorluk otomatik ayarlama).
    recent_is_correct_desc: en YENİDEN en ESKİYE sıralı, en az son 3 denemenin
    doğru/yanlış (bool) listesi. Sadece 2 ardışık yanlış / 3 ardışık yanlış /
    3 ardışık doğru zorluğu DEĞİŞTİRİR - 1 yanlış, 1 doğru, 2 doğru aynı
    zorlukta kalır (sadece farklı soru kalıbı önerilir, bkz. çağıran yer).
    Tavanda/tabanda taşma yok. Döner: (yeni_zorluk, destek_gerekiyor_mu)."""
    idx = _DIFFICULTY_ORDER.index(current_difficulty) if current_difficulty in _DIFFICULTY_ORDER else 1
    if not recent_is_correct_desc:
        return _DIFFICULTY_ORDER[idx], False

    consecutive_wrong = 0
    for correct in recent_is_correct_desc:
        if correct is False:
            consecutive_wrong += 1
        else:
            break
    consecutive_right = 0
    for correct in recent_is_correct_desc:
        if correct is True:
            consecutive_right += 1
        else:
            break

    if consecutive_wrong >= 3:
        return _DIFFICULTY_ORDER[0], True
    if consecutive_wrong == 2:
        return _DIFFICULTY_ORDER[max(0, idx - 1)], False
    if consecutive_right >= 3:
        return _DIFFICULTY_ORDER[min(len(_DIFFICULTY_ORDER) - 1, idx + 1)], False
    return _DIFFICULTY_ORDER[idx], False


def _find_similar_question(db, org_id, subject_id, grade_level, topic_id, skill_id,
                            difficulty, exclude_ids=None, exclude_pattern=None):
    """admin-panel-soru-havuzu-2 bölüm 10.8 (benzer soru bulma). Sıralı
    gevşetme: bulunamazsa EN SONDAKİ (en az önemli) kısıtlamadan başlayarak
    düşürülür - Ders/Sınıf (organization_id/subject_id/grade_level) HİÇBİR
    AŞAMADA gevşetilmez. 'Farklı soru kalıbı' bir filtre değil ÖNCELİKtir -
    her aşamada bulunan aday kümesi içinde varsa tercih edilir, yoksa
    aday kümesinin ilk sorusuna düşülür."""
    exclude_ids = exclude_ids or set()
    stages = [
        {"topic": True,  "skill": True,  "difficulty": True,  "avoid_recent": True},
        {"topic": True,  "skill": True,  "difficulty": True,  "avoid_recent": False},
        {"topic": True,  "skill": True,  "difficulty": False, "avoid_recent": False},
        {"topic": True,  "skill": False, "difficulty": False, "avoid_recent": False},
        {"topic": False, "skill": False, "difficulty": False, "avoid_recent": False},
    ]
    for stage in stages:
        query = "SELECT DISTINCT qb.id, qb.question_pattern FROM question_bank qb "
        params = []
        if stage["skill"] and skill_id:
            query += "JOIN question_skills qs ON qs.question_id = qb.id AND qs.skill_id = ? "
            params.append(skill_id)
        query += "WHERE qb.organization_id=? AND qb.status='published' AND qb.subject_id=? AND qb.grade_level=? "
        params += [org_id, subject_id, grade_level]
        if stage["topic"] and topic_id:
            query += "AND qb.topic_id=? "
            params.append(topic_id)
        if stage["difficulty"] and difficulty:
            query += "AND qb.difficulty=? "
            params.append(difficulty)
        if stage["avoid_recent"] and exclude_ids:
            query += f"AND qb.id NOT IN ({','.join('?' * len(exclude_ids))}) "
            params += list(exclude_ids)
        rows = db.execute(query, params).fetchall()
        if not rows:
            continue
        if exclude_pattern:
            preferred = [r for r in rows if r["question_pattern"] != exclude_pattern]
            if preferred:
                return preferred[0]["id"]
        return rows[0]["id"]
    return None


def _compute_next_recommendation(db, org_id, student_id, question_id):
    """admin-panel-soru-havuzu-2 bölüm 10.5+10.8'i birleştirir: öğrenci
    question_id'yi çözdükten SONRA, performansına göre önerilen bir sonraki
    soruyu hesaplar. Hem GET /next-question (ödev bağlamında) hem POST
    /practice/answer (bölüm 10.7 öncesi minimal pratik modu) tarafından
    kullanılan tek ortak çekirdek - iki uç aynı mantığı KOPYALAMASIN diye."""
    q = db.execute(
        "SELECT subject_id, grade_level, topic_id, difficulty, question_pattern, explanation "
        "FROM question_bank WHERE id=? AND organization_id=?",
        (question_id, org_id),
    ).fetchone()
    if not q:
        return None

    skill_row = db.execute(
        "SELECT skill_id FROM question_skills WHERE question_id=? ORDER BY weight DESC LIMIT 1",
        (question_id,),
    ).fetchone()
    skill_id = skill_row["skill_id"] if skill_row else None

    recent_rows = db.execute(
        "SELECT is_correct FROM student_question_attempts "
        "WHERE student_id=? AND question_id=? AND is_correct IS NOT NULL "
        "ORDER BY answered_at DESC LIMIT 5",
        (student_id, question_id),
    ).fetchall()
    recent_is_correct = [bool(r["is_correct"]) for r in recent_rows]

    next_difficulty, needs_support = _next_difficulty(q["difficulty"], recent_is_correct)

    recent_solved_ids = {
        r["question_id"] for r in db.execute(
            "SELECT DISTINCT question_id FROM student_question_attempts "
            "WHERE student_id=? AND answered_at >= ?",
            (student_id, (datetime.now() - timedelta(days=7)).isoformat()),
        ).fetchall()
    }
    recent_solved_ids.add(question_id)

    next_id = _find_similar_question(
        db, org_id, q["subject_id"], q["grade_level"], q["topic_id"], skill_id,
        next_difficulty, exclude_ids=recent_solved_ids, exclude_pattern=q["question_pattern"],
    )

    return {
        "recommendedDifficulty": next_difficulty,
        "needsSupport": needs_support,
        "supportExplanation": q["explanation"] if needs_support else None,
        "nextQuestionId": next_id,
        "nextQuestionImageUrl": f"/api/student/question-image/{next_id}" if next_id else None,
    }


@app.route("/api/student/next-question/<int:question_id>")
@login_required(role="student", permission="assignments.view")
def api_student_next_question(question_id):
    """Yetkilendirme: bu öğrencinin bu soru için GERÇEKTEN en az bir
    denemesi olması şart (student_question_attempts) - aksi halde rastgele
    question_id deneyerek başka konulara/becerilere ait soru/zorluk bilgisi
    sızdırılabilirdi (IDOR)."""
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    db = get_db()
    student = db.execute("SELECT organization_id FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404

    attempt = db.execute(
        "SELECT 1 FROM student_question_attempts WHERE student_id=? AND question_id=? LIMIT 1",
        (student_id, question_id),
    ).fetchone()
    if not attempt:
        return jsonify({"error": "Bu soruya ait bir çözüm kaydınız yok."}), 404

    result = _compute_next_recommendation(db, student["organization_id"], student_id, question_id)
    if result is None:
        return jsonify({"error": "Soru bulunamadı."}), 404
    return jsonify(result)


@app.route("/api/student/practice/subjects")
@login_required(role="student", permission="assignments.view")
def api_student_practice_subjects():
    """Pratik modu (bölüm 10.5+10.8'in öğrenci tarafında kullanılabilir
    hale gelmesi) - öğrencinin kendi sınıf seviyesinde (class_name'den
    türetilen grade_level) yayınlanmış sorusu bulunan dersleri listeler."""
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    db = get_db()
    student = db.execute("SELECT organization_id, class_name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404
    grade_level = (student["class_name"] or "").split("/")[0].strip()

    rows = db.execute(
        "SELECT DISTINCT s.id, s.name FROM subjects s "
        "JOIN question_bank qb ON qb.subject_id = s.id "
        "WHERE qb.organization_id=? AND qb.status='published' AND qb.grade_level=? "
        "ORDER BY s.name",
        (student["organization_id"], grade_level),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/student/practice/start")
@login_required(role="student", permission="assignments.view")
def api_student_practice_start():
    """Pratik moduna 'soğuk başlangıç' - bir önceki soru olmadığı için
    _compute_next_recommendation kullanılamaz. Konu seçimi: bu öğrencinin bu
    dersteki (varsa) EN ZAYIF becerisine bağlı konu öncelikli - hiç veri
    yoksa/eşit sıradaysa ilk uygun konuya düşülür (COALESCE(...,0) ile hiç
    denenmemiş beceriler 0 mastery gibi davranıp doğal olarak öne çıkar).
    Başlangıç zorluğu 'orta' - bilinmeyen seviye için makul, aşırı kolay/zor
    başlayıp gereksiz sallanmayı önleyen standart bir varsayılan."""
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    subject_id = request.args.get("subjectId", type=int)
    if not subject_id:
        return jsonify({"error": "subjectId gerekli."}), 400
    db = get_db()
    student = db.execute("SELECT organization_id, class_name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404
    grade_level = (student["class_name"] or "").split("/")[0].strip()
    org_id = student["organization_id"]

    topic_row = db.execute(
        "SELECT qb.topic_id, MIN(COALESCE(ss.mastery_percentage, 0)) AS min_mastery "
        "FROM question_bank qb "
        "LEFT JOIN question_skills qs ON qs.question_id = qb.id "
        "LEFT JOIN student_skills ss ON ss.skill_id = qs.skill_id AND ss.student_id = ? "
        "WHERE qb.organization_id=? AND qb.subject_id=? AND qb.grade_level=? "
        "AND qb.status='published' AND qb.topic_id IS NOT NULL "
        "GROUP BY qb.topic_id ORDER BY min_mastery ASC LIMIT 1",
        (student_id, org_id, subject_id, grade_level),
    ).fetchone()
    topic_id = topic_row["topic_id"] if topic_row else None

    question_id = _find_similar_question(
        db, org_id, subject_id, grade_level, topic_id, None, "orta", exclude_ids=set(),
    )
    if not question_id:
        return jsonify({"error": "Bu ders/sınıf seviyesinde uygun soru bulunamadı."}), 404
    return jsonify({
        "questionId": question_id,
        "questionImageUrl": f"/api/student/question-image/{question_id}",
    })


@app.route("/api/student/practice/answer", methods=["POST"])
@login_required(role="student", permission="assignments.complete")
def api_student_practice_answer():
    """Pratik modunda (herhangi bir ödeve bağlı OLMAYAN) tek bir cevabı
    kaydeder ve aynı anda bir sonraki öneriyi döner - tek round-trip'te hem
    _record_attempt hem _compute_next_recommendation çalışır."""
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    data = request.get_json(silent=True) or {}
    question_id = data.get("questionId")
    answer_text = (data.get("answer") or "").strip()
    if not question_id or not answer_text:
        return jsonify({"error": "questionId ve answer gerekli."}), 400

    db = get_db()
    student = db.execute("SELECT organization_id FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404
    org_id = student["organization_id"]

    q = db.execute(
        "SELECT correct_answer FROM question_bank WHERE id=? AND organization_id=? AND status='published'",
        (question_id, org_id),
    ).fetchone()
    if not q:
        return jsonify({"error": "Soru bulunamadı."}), 404

    is_correct_tristate = None
    if q["correct_answer"]:
        is_correct_tristate = answer_text.lower() == q["correct_answer"].strip().lower()
    _record_attempt(db, student_id, question_id, answer=answer_text, is_correct=is_correct_tristate)

    result = _compute_next_recommendation(db, org_id, student_id, question_id) or {}
    result["isCorrect"] = is_correct_tristate
    return jsonify(result)


@app.route("/api/student/study-plan/generate", methods=["POST"])
@login_required(role="student", permission="assignments.view")
def api_student_generate_study_plan():
    """admin-panel-soru-havuzu-2 bölüm 10.10: 'Deneme biter -> zayıf
    kazanımlar -> kişisel çalışma planı' zincirini ON-DEMAND (öğrenci
    butona bastığında) tetikler - senkron (bkz. api_admin_sync) gibi zaten
    kırılgan/kritik bir yola OTOMATİK kanca takmak yerine (bkz. tasarım
    kararı: bu entegrasyon isteğe bağlı bir eylem olarak başlatılıyor,
    sync pipeline'ına dokunulmuyor)."""
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404
    data = request.get_json(silent=True) or {}
    exam_id = data.get("examId")

    plan_id, error = _generate_study_plan(db, student, exam_id)
    if error:
        return jsonify({"error": error}), 404
    return jsonify({"ok": True, "planId": plan_id})


@app.route("/api/student/study-plan/latest")
@login_required(role="student", permission="assignments.view")
def api_student_latest_study_plan():
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    db = get_db()
    plan = db.execute(
        "SELECT * FROM personal_study_plans WHERE student_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",
        (student_id,),
    ).fetchone()
    if not plan:
        return jsonify(None)

    rows = db.execute(
        "SELECT pq.question_id, pq.matched_kazanim, pq.order_index "
        "FROM personal_study_plan_questions pq WHERE pq.plan_id=? ORDER BY pq.order_index",
        (plan["id"],),
    ).fetchall()
    attempted = {
        r["question_id"] for r in db.execute(
            "SELECT DISTINCT question_id FROM student_question_attempts "
            "WHERE student_id=? AND question_id IN ({})".format(",".join("?" * len(rows)) or "NULL"),
            (student_id, *[r["question_id"] for r in rows]),
        ).fetchall()
    } if rows else set()

    return jsonify({
        "planId": plan["id"], "createdAt": plan["created_at"],
        "questions": [{
            "questionId": r["question_id"],
            "questionImageUrl": f"/api/student/question-image/{r['question_id']}",
            "matchedKazanim": r["matched_kazanim"],
            "solved": r["question_id"] in attempted,
        } for r in rows],
    })


@app.route("/api/student/assignments/<int:assignment_id>/submit", methods=["POST"])
@login_required(role="student", permission="assignments.complete")
def api_student_submit_assignment(assignment_id):
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    db = get_db()
    student = db.execute("SELECT organization_id, class_name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404
    assignment = db.execute(
        "SELECT * FROM assignments WHERE id = ? AND organization_id = ? AND class_name = ?",
        (assignment_id, student["organization_id"], student["class_name"]),
    ).fetchone()
    if not assignment:
        return jsonify({"error": "Ödev bulunamadı."}), 404
    if assignment["status"] != "active":
        return jsonify({"error": "Bu ödev artık aktif değil."}), 400

    data = request.get_json(silent=True) or {}
    answers = data.get("answers") or []
    if not isinstance(answers, list) or not answers:
        return jsonify({"error": "En az bir cevap gerekli."}), 400

    # Akilli modda (bkz. api_teacher_create_assignment) her ogrencinin
    # KENDINE ozel bir soru seti vardir - student_id filtresi olmadan bu
    # ogrenci, ayni odevdeki BASKA bir ogrenciye ozel bir soruyu da
    # cevaplayabilir/kaydedebilirdi.
    valid_question_ids = {
        r["question_bank_id"] for r in db.execute(
            "SELECT question_bank_id FROM assignment_questions WHERE assignment_id = ? "
            "AND (student_id IS NULL OR student_id = ?)",
            (assignment_id, student_id),
        ).fetchall()
    }
    now = datetime.now().isoformat()
    saved = 0
    for a in answers:
        qid = a.get("questionBankId")
        answer_text = (a.get("answer") or "").strip()
        if qid not in valid_question_ids or not answer_text:
            continue
        correct_answer = db.execute(
            "SELECT correct_answer FROM question_bank WHERE id = ?", (qid,)
        ).fetchone()
        is_correct = (
            correct_answer and correct_answer["correct_answer"]
            and answer_text.strip().lower() == correct_answer["correct_answer"].strip().lower()
        )
        db.execute(
            "INSERT INTO assignment_submissions (assignment_id, student_id, question_bank_id, answer, "
            "is_correct, submitted_at) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(assignment_id, student_id, question_bank_id) DO UPDATE SET "
            "answer=excluded.answer, is_correct=excluded.is_correct, submitted_at=excluded.submitted_at",
            (assignment_id, student_id, qid, answer_text, 1 if is_correct else 0, now),
        )
        # bölüm 10.6: aynı cevap AYRICA kalıcı deneme geçmişine (append-only)
        # yazılır ve etkilenen becerilerin mastery'si güncellenir - has_correct_answer
        # yoksa (örn. açık uçlu/cevap anahtarsız soru) is_correct BİLEREK None
        # (yukarıdaki assignment_submissions'tan farklı olarak "yanlış" ile
        # "henüz notlandırılmadı" karıştırılmasın diye, bkz. _recompute_student_skill_mastery).
        is_correct_tristate = bool(is_correct) if (correct_answer and correct_answer["correct_answer"]) else None
        _record_attempt(db, student_id, qid, assignment_id=assignment_id,
                         answer=answer_text, is_correct=is_correct_tristate)
        saved += 1
    db.commit()
    return jsonify({"ok": True, "saved": saved})


@app.route("/api/student/question-image/<int:question_id>")
@login_required(role="student", permission="assignments.view")
def api_student_question_image(question_id):
    """Bir ödev sorusunun kırpılmış görselini öğrenciye sunar. Admin'in
    /api/admin/question-bank/image ucunun ogrenci-guvenli esdegeri - o uc
    role='admin' ister ve bu yuzden ogrenciler icin her zaman 403 dondururdu
    (bkz. js/student/ogrenci.js'teki "(Görsel soru - öğretmeninize danışın)"
    yer tutucusu - gorsel sorular ODEV SISTEMININ ANA icerik turu oldugu icin
    bu ogrenciler icin odevleri fiilen kullanilmaz kiliyordu).

    IDOR korumasi: ID tahmin ederek BASKA bir sorunun (ya da baska bir
    okulun/sinifin) gorselini gormeyi engellemek icin, sorunun GERCEKTEN bu
    ogrencinin kendi okulundaki, kendi sinifini hedefleyen bir odevin
    parcasi olmasi sart - assignment_questions -> assignments uzerinden
    dogrulanir (bkz. api_student_assignment_detail'deki ayni desen).

    Bolum 10.5+10.8 (adaptif motor, bkz. api_student_next_question) BUNA EK
    olarak, herhangi bir odevin parcasi OLMAYAN (adaptif olarak onerilen)
    'published' bir soruyu da - SADECE kendi okuluna ait olmak sartiyla -
    gosterebilir. 'published' zaten dort-goz onayindan gecmis, okul-genelinde
    (herhangi bir sinifin herhangi bir odevinde) her an kullanilabilir nihai
    durum oldugu icin bu, sinif-bazli gizliligi BOZMAZ - sadece odeve
    eklenmeden ONCE de erisilebilir kilar."""
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Öğrenci hesabı bulunamadı."}), 400
    db = get_db()
    student = db.execute("SELECT organization_id, class_name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Öğrenci bulunamadı."}), 404

    row = db.execute(
        "SELECT qb.image_path FROM question_bank qb "
        "JOIN assignment_questions aq ON aq.question_bank_id = qb.id "
        "JOIN assignments a ON a.id = aq.assignment_id "
        "WHERE qb.id = ? AND a.organization_id = ? AND a.class_name = ? LIMIT 1",
        (question_id, student["organization_id"], student["class_name"]),
    ).fetchone()
    if not row:
        row = db.execute(
            "SELECT image_path FROM question_bank WHERE id = ? AND organization_id = ? AND status = 'published'",
            (question_id, student["organization_id"]),
        ).fetchone()
    if not row or not row["image_path"]:
        return jsonify({"error": "Bulunamadı."}), 404
    filename = os.path.basename(row["image_path"])
    resp = send_from_directory(QUESTION_IMAGES_DIR, filename)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/api/parent/assignments")
@login_required(role="parent", permission="assignments.view")
def api_parent_list_assignments():
    db = get_db()
    allowed_ids = get_allowed_student_ids(db)
    if not allowed_ids:
        return jsonify([])
    placeholders = ",".join("?" * len(allowed_ids))
    children = db.execute(
        f"SELECT id, first_name, last_name, organization_id, class_name FROM students WHERE id IN ({placeholders})",
        tuple(allowed_ids),
    ).fetchall()
    out = []
    for child in children:
        if not child["class_name"]:
            continue
        rows = db.execute(
            "SELECT * FROM assignments WHERE organization_id = ? AND class_name = ? AND status = 'active' "
            "ORDER BY created_at DESC",
            (child["organization_id"], child["class_name"]),
        ).fetchall()
        for a in rows:
            total_questions = db.execute(
                "SELECT COUNT(*) c FROM assignment_questions WHERE assignment_id = ?", (a["id"],)
            ).fetchone()["c"]
            answered = db.execute(
                "SELECT COUNT(*) c FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?",
                (a["id"], child["id"]),
            ).fetchone()["c"]
            out.append({
                "assignmentId": a["id"], "title": a["title"], "dueDate": a["due_date"],
                "studentId": child["id"],
                "studentName": f'{child["first_name"]} {child["last_name"]}'.strip(),
                "totalQuestions": total_questions,
                "completed": answered >= total_questions and total_questions > 0,
            })
    return jsonify(out)


# ============================================================
# API: AI (STUB) - gercek bir LLM cagrisi YAPMAZ, mevcut veriden kural
# tabanli basit ciktilar uretir. "placeholder": true alani her zaman
# donuyor - ileride gercek entegrasyon eklenirse frontend bunu ayirt edebilsin.
# ============================================================

@app.route("/api/teacher/ai/analyze-student/<int:student_id>", methods=["POST"])
@login_required(role=("teacher", "admin", "super_admin"), permission="ai.analyze")
def api_ai_analyze_student(student_id):
    db = get_db()
    if not can_view_student(db, student_id):
        return jsonify({"error": "Bu öğrenciye erişim yetkiniz yok."}), 403
    report = _build_student_report(db, student_id)
    if not report:
        return jsonify({"error": "Öğrenci kaydı bulunamadı."}), 404

    compass = report.get("compass") or {}
    strong = compass.get("strong") or []
    priority = compass.get("priority") or []
    lines = []
    if strong:
        lines.append(f"Güçlü olduğu konular: {', '.join(s['kazanim'] for s in strong[:3])}.")
    if priority:
        lines.append(f"Öncelikli çalışması gereken konular: {', '.join(p['kazanim'] for p in priority[:3])}.")
    if not lines:
        lines.append("Yeterli veri birikmedi - birkaç deneme daha girildikten sonra analiz daha anlamlı olacak.")
    return jsonify({"placeholder": True, "analysis": " ".join(lines)})


@app.route("/api/teacher/ai/generate-assignment", methods=["POST"])
@login_required(role=("teacher", "admin", "super_admin"), permission="ai.generate_assignment")
def api_ai_generate_assignment():
    """Sinifin en zayif konularina gore onaylanmis soru bankasindan basit,
    kural-tabanli bir soru onerisi - gercek bir icerik URETMEZ, var olan
    onaylanmis sorular arasindan ESLESTIRIR."""
    db = get_db()
    org_id = _effective_org_id(db)
    if org_id is None:
        return jsonify({"error": "Okul seçilmedi ya da bulunamadı."}), 400
    data = request.get_json(silent=True) or {}
    class_name = (data.get("className") or "").strip()
    if not class_name or not _teacher_can_use_class(class_name):
        return jsonify({"error": "Bu sınıf için öneri alma yetkiniz yok."}), 403

    rows = db.execute(
        "SELECT id, display_code FROM question_bank WHERE organization_id = ? AND status = 'published' "
        "ORDER BY RANDOM() LIMIT 5",
        (org_id,),
    ).fetchall()
    return jsonify({
        "placeholder": True,
        "suggestedQuestionIds": [r["id"] for r in rows],
        "note": "Bu, yayınlanmış soru bankasından rastgele bir öneri - gerçek yapay zekâ destekli eşleştirme yakında.",
    })


@app.route("/api/admin/question-bank/ai-generate", methods=["POST"])
@login_required(role="admin", permission="ai.generate_question")
def api_ai_generate_question():
    return jsonify({
        "placeholder": True,
        "message": "AI ile soru üretimi yakında gelecek. Şu an için Soru Girişi sayfasından PDF yükleyerek soru ekleyebilirsiniz.",
    })


# ============================================================
# API: Veli/Öğrenci - yalnızca kendi çocuğu/çocukları + genel istatistikler
# ============================================================

def _build_compass(subject_nets, topic_stats):
    """Başarı Pusulası: 4 kadranlı özet.
    subject_nets: {subjectKey: [net, net, ...]} kronolojik (eski->yeni) sıralı.
    topic_stats: en son denemenin konu/kazanım analizi (successRate artan sıralı) ya da None
    (optik dışı içe aktarmalarda konu analizi yoktur, bu durumda sadece 'developing' dolar)."""
    developing = []
    for key, nets in subject_nets.items():
        if len(nets) < 2:
            continue
        back = min(3, len(nets) - 1)
        delta = round(nets[-1] - nets[-1 - back], 2)
        if delta > 0:
            developing.append({"subjectKey": key, "delta": delta})
    developing.sort(key=lambda x: -x["delta"])

    strong, attention, priority = [], [], []
    if topic_stats:
        for t in topic_stats:
            item = {"subjectKey": t["subjectKey"], "kazanim": t["kazanim"], "successRate": t["successRate"]}
            if t["successRate"] >= 80:
                strong.append(item)
            elif t["successRate"] >= 50:
                attention.append(item)
            else:
                priority.append(item)
        strong.sort(key=lambda x: -x["successRate"])

    return {
        "strong": strong[:3],
        "developing": developing[:3],
        "attention": attention[:3],
        "priority": priority[:3],
    }


def _build_error_memory(result_rows):
    """Hata Hafızası (Bölüm 10): öğrencinin en son denemesindeki yanlışlarını,
    o konudaki KENDİ geçmiş başarı oranına göre sınıflandırır - uydurma bir
    "hata türü" etiketi değil, gerçek geçmiş performanstan türetilen bir sınıflandırma:
      - Dikkat Hatası : yanlış yaptı ama o konuda geçmişte genelde başarılıydı (>=%70)
      - Konu Eksikliği: yanlış yaptı ve o konuda geçmişte de zayıftı (<%50)
      - İşlem Hatası  : ikisi arasında (%50-%69), ya da o konuda hiç geçmiş veri yoksa
    Yalnızca cevap anahtarlı (optik) denemeler için hesaplanabilir; hiç yoksa None döner."""
    exam_entries = []
    for row in result_rows:
        exam_data = json.loads(row["exam_json"]) if row["exam_json"] else {}
        topic_map = exam_data.get("topicMap")
        if not topic_map:
            continue
        subjects = json.loads(row["data_json"]).get("subjects", {})
        exam_entries.append((topic_map, subjects))

    if not exam_entries:
        return None

    latest_topic_map, latest_subjects = exam_entries[-1]
    history_entries = exam_entries[:-1] or exam_entries

    kazanim_history = {}
    for topic_map, subjects in history_entries:
        for subject_key, entries in topic_map.items():
            answers = (subjects.get(subject_key) or {}).get("answers")
            if not answers:
                continue
            for idx, entry in enumerate(entries or []):
                if idx >= len(answers) or answers[idx] is None:
                    continue
                kazanim = entry.get("kazanim") or "(Kazanım belirtilmemiş)"
                stat = kazanim_history.setdefault((subject_key, kazanim), [0, 0])
                stat[1] += 1
                if answers[idx] == "D":
                    stat[0] += 1

    dikkat, islem, konu = [], [], []
    for subject_key, entries in latest_topic_map.items():
        answers = (latest_subjects.get(subject_key) or {}).get("answers")
        if not answers:
            continue
        for idx, entry in enumerate(entries or []):
            if idx >= len(answers) or answers[idx] != "Y":
                continue
            kazanim = entry.get("kazanim") or "(Kazanım belirtilmemiş)"
            hist = kazanim_history.get((subject_key, kazanim))
            rate = round(hist[0] / hist[1] * 100, 1) if hist and hist[1] else None
            item = {"subjectKey": subject_key, "kazanim": kazanim, "historicalRate": rate}
            if rate is None or 50 <= rate < 70:
                islem.append(item)
            elif rate >= 70:
                dikkat.append(item)
            else:
                konu.append(item)

    if not (dikkat or islem or konu):
        return None

    counts = {"Dikkat Hataları": len(dikkat), "İşlem Hataları": len(islem), "Konu Eksikliği": len(konu)}
    top_type = max(counts, key=counts.get)
    ai_comment = None
    if counts[top_type] > 0:
        ai_comment = {
            "Konu Eksikliği": "Öğrencinin temel problemi konu eksikliği gibi görünüyor - bu konuların yeniden anlatılması faydalı olabilir.",
            "Dikkat Hataları": "Öğrencinin temel problemi konu eksikliğinden çok dikkat hataları gibi görünüyor - bildiği konularda dikkatsiz cevaplıyor olabilir.",
            "İşlem Hataları": "Öğrencinin temel problemi işlem/uygulama hataları gibi görünüyor - konuyu biliyor ama uygulamada hata yapıyor.",
        }[top_type]

    return {
        "counts": counts,
        "dikkatHatalari": dikkat[:10], "islemHatalari": islem[:10], "konuEksikligi": konu[:10],
        "aiComment": ai_comment,
    }


def _match_kazanim_to_topic(db, subject_id, kazanim_text):
    """admin-panel-soru-havuzu-2 bölüm 10.10: eski deneme sisteminin serbest-
    metin 'kazanım'ı (bkz. _build_error_memory) ile yeni soru havuzunun
    topics.name'i arasında BAĞIMSIZ, birbirinden habersiz iki taksonomi var
    - aralarında id eşlemesi yok. Bu, gerçek bir metin-benzerliği köprüsü
    (difflib) - kusursuz değil (isimler örtüşmezse eşleşme bulunamaz), bu
    yüzden çağıran taraf None dönerse konuyu gevşetip derse düşmeli (bkz.
    _find_similar_question zaten topic_id=None'ı destekliyor)."""
    topics = db.execute("SELECT id, name FROM topics WHERE subject_id=?", (subject_id,)).fetchall()
    if not topics or not kazanim_text:
        return None
    names = [t["name"] for t in topics]
    matches = difflib.get_close_matches(kazanim_text, names, n=1, cutoff=0.45)
    if not matches:
        return None
    return next(t["id"] for t in topics if t["name"] == matches[0])


def _generate_study_plan(db, student, exam_id, max_questions=8):
    """admin-panel-soru-havuzu-2 bölüm 10.10: en son (ya da belirtilen)
    denemenin hata hafızasından ('Konu Eksikliği' + 'İşlem Hataları' -
    'Dikkat Hataları' KASITLI OLARAK dışarıda: öğrenci konuyu zaten
    biliyor, pratik değil dikkat gerektiriyor) zayıf kazanımları alır, her
    birini bir konuya eşler (bulamazsa derse geri düşer) ve bölüm 10.8'in
    aynı algoritmasıyla 'kolay' zorlukta birer telafi sorusu seçer.
    student: sqlite3.Row (id, organization_id, class_name gerekli)."""
    student_id = student["id"]
    result_rows = db.execute(
        "SELECT r.*, e.name as exam_name, e.date as exam_date, e.exam_type, e.data_json as exam_json "
        "FROM results r JOIN exams e ON e.id = r.exam_id WHERE r.student_id = ? ORDER BY e.date ASC",
        (student_id,),
    ).fetchall()
    if not result_rows:
        return None, "Henüz bir deneme sonucunuz yok."

    error_memory = _build_error_memory(result_rows)
    if not error_memory:
        return None, "Bu deneme için kazanım bazlı analiz mevcut değil (cevap anahtarlı/optik deneme gerekli)."

    weak_items = error_memory["konuEksikligi"] + error_memory["islemHatalari"]
    if not weak_items:
        return None, "Şu an belirgin bir zayıf konu tespit edilmedi - harika gidiyorsunuz! 🎉"

    subject_by_code = {r["code"]: r["id"] for r in db.execute("SELECT id, code FROM subjects").fetchall()}
    grade_level = (student["class_name"] or "").split("/")[0].strip()

    plan_rows = []  # (question_id, skill_id, matched_kazanim)
    seen_qids = set()
    for item in weak_items[:max_questions]:
        subject_id = subject_by_code.get(item["subjectKey"])
        if not subject_id:
            continue
        topic_id = _match_kazanim_to_topic(db, subject_id, item["kazanim"])
        qid = _find_similar_question(
            db, student["organization_id"], subject_id, grade_level, topic_id, None,
            "kolay", exclude_ids=seen_qids,
        )
        if qid:
            skill_row = db.execute(
                "SELECT skill_id FROM question_skills WHERE question_id=? ORDER BY weight DESC LIMIT 1", (qid,)
            ).fetchone()
            plan_rows.append((qid, skill_row["skill_id"] if skill_row else None, item["kazanim"]))
            seen_qids.add(qid)

    if not plan_rows:
        return None, "Zayıf konularınız için soru havuzunda uygun soru bulunamadı."

    now = datetime.now().isoformat()
    target_exam_id = exam_id or result_rows[-1]["exam_id"]
    cur = db.execute(
        "INSERT INTO personal_study_plans (student_id, exam_id, created_at, status, generated_from) "
        "VALUES (?,?,?,?,?)",
        (student_id, target_exam_id, now, "active", "EXAM_ANALYSIS"),
    )
    plan_id = cur.lastrowid
    for i, (qid, skill_id, kazanim) in enumerate(plan_rows):
        db.execute(
            "INSERT INTO personal_study_plan_questions (plan_id, question_id, skill_id, matched_kazanim, order_index) "
            "VALUES (?,?,?,?,?)",
            (plan_id, qid, skill_id, kazanim, i),
        )
    db.commit()
    return plan_id, None


def _build_student_report(db, student_id, exam_id=None):
    """Tek bir öğrencinin deneme geçmişi + konu analizi + güçlü/zayıf ders özeti.
    /api/parent/child/<id> ve /api/student/overview tarafından ortak kullanılır.
    exam_id verilirse konu analizi EN SON deneme yerine o denemeye göre
    hesaplanır (admin panelinin öğrenci profilinde geçmiş bir deneme
    seçilebilmesi için, bkz. api_teacher_student_detail) - verilmezse (veli/
    öğrenci panelindeki gibi) davranış değişmez."""
    student = db.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return None

    result_rows = db.execute(
        "SELECT r.*, e.name as exam_name, e.date as exam_date, e.exam_type, e.data_json as exam_json "
        "FROM results r JOIN exams e ON e.id = r.exam_id WHERE r.student_id = ? ORDER BY e.date ASC",
        (student_id,)
    ).fetchall()

    results = []
    subject_nets = {}
    for r in result_rows:
        data = json.loads(r["data_json"])
        subjects = data.get("subjects", {})
        results.append({
            "examId": r["exam_id"], "examName": r["exam_name"], "examDate": r["exam_date"],
            "examType": r["exam_type"], "subjects": subjects,
            "totalNet": calc_total_net(subjects),
        })
        for key, s in subjects.items():
            subject_nets.setdefault(key, []).append((s or {}).get("net") or 0)

    topic_stats = None
    topic_stats_exam_id = None
    if result_rows:
        target_row = None
        if exam_id:
            target_row = next((r for r in result_rows if r["exam_id"] == exam_id), None)
        if target_row is None:
            target_row = result_rows[-1]  # varsayilan: en son deneme
        topic_stats_exam_id = target_row["exam_id"]
        exam_data = json.loads(target_row["exam_json"])
        target_result_data = json.loads(target_row["data_json"])
        qs = build_question_stats(exam_data, [target_result_data])
        if qs:
            topic_stats = build_topic_stats(qs)

    subject_avgs = {k: round(sum(v) / len(v), 2) for k, v in subject_nets.items() if v}
    strongest = max(subject_avgs, key=subject_avgs.get) if subject_avgs else None
    weakest = min(subject_avgs, key=subject_avgs.get) if subject_avgs else None

    # Sınıf içi karşılaştırma (en son deneme): ders bazlı sınıf ortalaması (radar
    # grafiği için) ve sınıf sıralaması (skor kartı için) - "Türkiye geneli
    # yüzdelik dilim" gibi elimizde olmayan bir veri uydurmak yerine, gerçekten
    # sahip olduğumuz sınıf içi karşılaştırmayı kullanıyoruz.
    class_subject_averages, class_rank = None, None
    if results:
        latest_exam_id = results[-1]["examId"]
        # s.class_name tek basina okul-guvenli degil (iki okul ayni "8/A"
        # adini paylasabilir) - organization_id filtresi olmadan iki okulun
        # sinif ortalamasi/sirasi birbirine karisir.
        classmates = db.execute(
            "SELECT r.data_json FROM results r JOIN students s ON s.id = r.student_id "
            "WHERE r.exam_id = ? AND s.class_name = ? AND s.organization_id = ?",
            (latest_exam_id, student["class_name"], student["organization_id"]),
        ).fetchall()
        subject_sums, subject_counts, class_totals = {}, {}, []
        for cr in classmates:
            csubjects = json.loads(cr["data_json"]).get("subjects", {})
            for key, s in csubjects.items():
                net = (s or {}).get("net") or 0
                subject_sums[key] = subject_sums.get(key, 0) + net
                subject_counts[key] = subject_counts.get(key, 0) + 1
            class_totals.append(calc_total_net(csubjects))
        if subject_sums:
            class_subject_averages = {k: round(subject_sums[k] / subject_counts[k], 2) for k in subject_sums}
        if class_totals:
            my_total = results[-1]["totalNet"]
            rank = sum(1 for t in class_totals if t > my_total) + 1
            class_rank = {"rank": rank, "classSize": len(class_totals)}

    # ---- Genel Başarı Skoru (Bölüm 9): 4 eksen, hepsi gerçek veriden türetilir.
    # "Motivasyon" ve "Düzenlilik" gibi doğrudan ölçmediğimiz kavramlar için
    # makul, açıklanabilir vekil (proxy) ölçümler kullanılır - uydurma sayı yok:
    #   Akademik   = en son denemede mümkün olan maksimum net'e göre başarı yüzdesi
    #                (max = o denemede cevaplanan tüm soru sayısı: doğru+yanlış+boş)
    #   Motivasyon = son 5 denemedeki değişimlerin kaçının pozitif olduğu (gelişim ivmesi)
    #   Hedef      = en son denemede sınıfın o anki en yüksek netine göre yakınlık
    #   Düzenlilik = öğrencinin ilk denemesinden bu yana sınıfta yapılan denemelerin
    #                kaçına katıldığı (katılım tutarlılığı)
    score_breakdown, badges = None, []
    if results:
        latest = results[-1]
        subjects = latest["subjects"] or {}
        max_possible = sum((s or {}).get("correct", 0) + (s or {}).get("wrong", 0) + (s or {}).get("blank", 0)
                            for s in subjects.values())
        academic = round(max(0, min(100, latest["totalNet"] / max_possible * 100))) if max_possible else None

        recent = results[-5:]
        changes = [recent[i]["totalNet"] - recent[i - 1]["totalNet"] for i in range(1, len(recent))]
        motivation = round(sum(1 for c in changes if c > 0) / len(changes) * 100) if changes else None

        hedef = None
        if class_rank and class_totals and max(class_totals) > 0:
            hedef = round(max(0, min(100, latest["totalNet"] / max(class_totals) * 100)))

        regularity = None
        first_date = results[0]["examDate"]
        row = db.execute(
            "SELECT COUNT(DISTINCT r.exam_id) as cnt FROM results r "
            "JOIN students s ON s.id = r.student_id JOIN exams e ON e.id = r.exam_id "
            "WHERE s.class_name = ? AND e.date >= ?",
            (student["class_name"], first_date),
        ).fetchone()
        class_exam_count = row["cnt"] if row else 0
        if class_exam_count:
            regularity = round(min(100, len(results) / class_exam_count * 100))

        axes = {"academic": academic, "motivation": motivation, "hedef": hedef, "regularity": regularity}
        available = [v for v in axes.values() if v is not None]
        overall = round(sum(available) / len(available)) if available else None

        growth_delta = None
        if academic is not None and len(results) >= 2:
            back = min(3, len(results) - 1)
            prev_result = results[-1 - back]
            prev_subjects = prev_result["subjects"] or {}
            prev_max = sum((s or {}).get("correct", 0) + (s or {}).get("wrong", 0) + (s or {}).get("blank", 0)
                           for s in prev_subjects.values())
            if prev_max:
                growth_delta = academic - round(max(0, min(100, prev_result["totalNet"] / prev_max * 100)))

        score_breakdown = {"overall": overall, "growthDelta": growth_delta, "axes": axes}

        # ---- Başarı Rozetleri (Bölüm 14): öğrenciyi kendi geçmişiyle kıyaslar,
        # başka öğrencilerle değil - hepsi yukarıdaki gerçek verilerden.
        nets = [r["totalNet"] for r in results]
        if len(nets) >= 2 and nets[-1] >= max(nets[:-1]):
            badges.append({"icon": "📈", "label": "Kişisel Rekor"})
        if len(nets) >= 3 and nets[-3] < nets[-2] < nets[-1]:
            badges.append({"icon": "🔥", "label": "3 Deneme Üst Üste Yükseliş"})
        for i in range(1, len(nets)):
            if nets[i] - nets[i - 1] >= 5:
                badges.append({"icon": "🏅", "label": "İlk Büyük Gelişim"})
                break
        if (axes.get("hedef") or 0) >= 90:
            badges.append({"icon": "🎯", "label": "Hedefe Yaklaşıyor"})
        if (axes.get("regularity") or 0) >= 90:
            badges.append({"icon": "🧠", "label": "Düzenli Çalışan"})

    # Subject details across all exams
    subject_details = {}
    for key, nets in subject_nets.items():
        if not nets:
            continue
        c_tot = sum((r["subjects"].get(key) or {}).get("correct", 0) for r in results)
        w_tot = sum((r["subjects"].get(key) or {}).get("wrong", 0) for r in results)
        b_tot = sum((r["subjects"].get(key) or {}).get("blank", 0) for r in results)
        n_tot = sum((r["subjects"].get(key) or {}).get("net", 0) for r in results)
        count = len(results)
        q_tot = c_tot + w_tot + b_tot
        rate = round((c_tot / q_tot * 100), 1) if q_tot > 0 else 0
        subject_details[key] = {
            "avgNet": round(n_tot / count, 2) if count else 0,
            "latestNet": (results[-1]["subjects"].get(key) or {}).get("net", 0) if results else 0,
            "totalCorrect": c_tot,
            "totalWrong": w_tot,
            "totalBlank": b_tot,
            "accuracyRate": rate,
        }

    all_nets = [r["totalNet"] for r in results]
    avg_total_net = round(sum(all_nets) / len(all_nets), 2) if all_nets else None
    best_total_net = max(all_nets) if all_nets else None

    return {
        "student": {
            "id": student["id"],
            "firstName": student["first_name"], "lastName": student["last_name"],
            "className": student["class_name"], "schoolNumber": student["school_number"],
        },
        "results": list(reversed(results)),
        "netTrend": [{"examName": r["examName"], "examDate": r["examDate"], "totalNet": r["totalNet"]}
                     for r in results],
        "latestExamTopicStats": topic_stats,
        "topicStatsExamId": topic_stats_exam_id,
        "classSubjectAverages": class_subject_averages,
        "classRank": class_rank,
        "scoreBreakdown": score_breakdown,
        "badges": badges,
        "errorMemory": _build_error_memory(result_rows),
        "strongestSubject": strongest,
        "weakestSubject": weakest,
        "compass": _build_compass(subject_nets, topic_stats),
        "subjectDetails": subject_details,
        "averageNet": avg_total_net,
        "bestNet": best_total_net,
        "examCount": len(results),
    }


@app.route("/api/parent/overview")
@login_required(role="parent", permission="results.view")
def api_parent_overview():
    db = get_db()
    allowed_ids = get_allowed_student_ids(db)
    if not allowed_ids:
        return jsonify({
            "error": "Hesabınıza bağlı bir öğrenci bulunamadı. Lütfen okulunuzla iletişime geçin.",
            "children": [], "classAverages": [],
        }), 404

    placeholders = ",".join("?" * len(allowed_ids))
    rows = db.execute(
        f"SELECT id, first_name, last_name, class_name, school_number FROM students "
        f"WHERE id IN ({placeholders}) ORDER BY last_name, first_name",
        tuple(allowed_ids),
    ).fetchall()
    children = [{
        "id": r["id"], "firstName": r["first_name"], "lastName": r["last_name"],
        "className": r["class_name"], "schoolNumber": r["school_number"],
    } for r in rows]

    return jsonify({"children": children, "classAverages": _all_class_averages(db, _current_org_id(db))})


@app.route("/api/parent/child/<int:student_id>")
@login_required(role="parent", permission="results.view")
def api_parent_child_detail(student_id):
    db = get_db()
    if not can_view_student(db, student_id):
        return jsonify({"error": "Bu öğrenciye erişim yetkiniz yok."}), 403
    report = _build_student_report(db, student_id)
    if not report:
        return jsonify({"error": "Öğrenci kaydı bulunamadı."}), 404
    report["classAverages"] = _all_class_averages(db, _current_org_id(db))
    return jsonify(report)


# ============================================================
# API: Öğrenci - yalnızca kendi verisi + genel istatistikler
# ============================================================

@app.route("/api/student/overview")
@login_required(role="student", permission="results.view")
def api_student_overview():
    db = get_db()
    student_id = session.get("student_id")
    report = _build_student_report(db, student_id) if student_id else None
    if not report:
        return jsonify({"error": "Hesabınıza bağlı bir öğrenci kaydı bulunamadı. Lütfen okulunuzla iletişime geçin."}), 404
    report["classAverages"] = _all_class_averages(db, _current_org_id(db))
    message_rows = db.execute(
        "SELECT m.id, m.message, m.created_at, m.read_at, u.display_name FROM teacher_messages m "
        "JOIN users u ON u.id = m.teacher_user_id "
        "WHERE m.student_id = ? ORDER BY m.id DESC LIMIT 10",
        (student_id,),
    ).fetchall()
    report["messages"] = [
        {"id": r["id"], "message": r["message"], "createdAt": r["created_at"],
         "teacherName": r["display_name"], "isRead": r["read_at"] is not None}
        for r in message_rows
    ]
    report["unreadMessageCount"] = sum(1 for m in report["messages"] if not m["isRead"])
    return jsonify(report)


@app.route("/api/student/messages/mark-read", methods=["POST"])
@login_required(role="student", permission="results.view")
def api_student_mark_messages_read():
    """Öğrenci mesaj kutusunu (zarf ikonunu) açtığında, kendisine ait tüm
    okunmamış mesajları okunmuş olarak işaretler."""
    db = get_db()
    student_id = session.get("student_id")
    if not student_id:
        return jsonify({"error": "Hesabınıza bağlı bir öğrenci kaydı bulunamadı."}), 404
    db.execute(
        "UPDATE teacher_messages SET read_at = ? WHERE student_id = ? AND read_at IS NULL",
        (datetime.now().isoformat(), student_id),
    )
    db.commit()
    return jsonify({"ok": True})


# ============================================================
# API: EduPusula tanıtım sayfası - demo talebi (marketing/index.html)
# ============================================================
# Bu iki endpoint giriş sistemine dokunmaz; sadece tanıtım sayfasındaki
# "Demo Talep Et" formunun kaydettiği talepleri saklar/listeler.

MAX_DEMO_FIELD_LEN = 300


@app.route("/api/demo-talebi", methods=["POST"])
def api_demo_talebi():
    data = request.get_json(silent=True) or {}
    okul = (data.get("okul") or "").strip()[:MAX_DEMO_FIELD_LEN]
    yetkili_ad = (data.get("ad") or "").strip()[:MAX_DEMO_FIELD_LEN]
    eposta = (data.get("eposta") or "").strip()[:MAX_DEMO_FIELD_LEN]
    telefon = (data.get("tel") or "").strip()[:MAX_DEMO_FIELD_LEN]
    ogrenci_sayisi = (data.get("ogrenci_sayisi") or "").strip()[:MAX_DEMO_FIELD_LEN]

    if not okul or not yetkili_ad or not eposta:
        return jsonify({"error": "Okul adı, yetkili adı ve e-posta zorunludur."}), 400
    if "@" not in eposta:
        return jsonify({"error": "Lütfen geçerli bir e-posta adresi girin."}), 400

    db = get_db()
    db.execute(
        "INSERT INTO demo_requests (okul, yetkili_ad, telefon, eposta, ogrenci_sayisi, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (okul, yetkili_ad, telefon, eposta, ogrenci_sayisi, datetime.now().isoformat()),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/demo-talepleri")
@login_required(role="super_admin")
def api_admin_demo_talepleri():
    db = get_db()
    rows = db.execute(
        "SELECT id, okul, yetkili_ad, telefon, eposta, ogrenci_sayisi, created_at "
        "FROM demo_requests ORDER BY created_at DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ============================================================
# Soru Havuzu: PDF yükleme + otomatik kırpma tespiti
# ============================================================
# Akış: PDF yüklenir -> pdf_question_extractor ile soru sınırları ve varsa
# cevap anahtarı tespit edilir -> her soru question_bank'e "pending_review"
# durumuyla, kırpılmış görüntüsüyle birlikte yazılır. Hiçbir soru bu adımda
# "approved" olmaz - öğretmenin kırpma/konu/kazanım onayı ayrı bir adımdır
# (henüz yazılmadı, bkz. question_bank.status).

_MAX_PDF_PAGES = 60
# Kritik (500 ogrenci + 10 admin olcek analizi): pdf_question_extractor
# sayfa basina bir "tesseract" alt sureci baslatiyor (bkz. o dosyadaki
# _get_page_lines) - eskiden BIRDEN FAZLA istek ayni anda buraya dusunce
# (ornegin ayni admin coklu kitapcik yuklerken, ya da iki farkli admin ayni
# anda PDF yuklerken) her istek kendi tesseract sureclerini paralel
# baslatiyordu; bugun tam olarak bu yuzden (4 es zamanli tesseract sureci)
# VM'nin bellegi tukendi. Bu semaphore SURECe (worker'a) OZGU - ayni anda
# SADECE 1 PDF/OCR isi calisir, digerleri sirada bekler. gunicorn artik TEK
# worker calistirdigi icin (bkz. deploy notlari, bellek tasarrufu) bu artik
# PLATFORM GENELINDE tek bir OCR isi demek.
_OCR_SEMAPHORE = threading.Semaphore(1)
# Taranmis/OCR gerektiren gercek sinav PDF'leri 3-4 dakikaya kadar
# surebiliyor (olculdu - bkz. pdf_question_extractor.py sure tahmini
# sabitleri). Eskiden bu bekleme 60s'ydi - ikinci bir yukleme neredeyse HER
# ZAMAN "baska bir PDF isleniyor" hatasi aliyordu, cunku ilk isin gercek
# suresi zaten 60s'yi asiyordu. gunicorn --timeout (deploy notlarinda,
# ExecStart) bu bekleme + kendi isleme suresini karsilayacak kadar UZUN
# tutulmali - aksi halde worker, OCR bitmeden SIGKILL edilir (sessiz,
# "hayalet" bos set birakan DAHA KOTU bir hata).
_OCR_SEMAPHORE_WAIT_SECONDS = 240


@app.route("/api/admin/question-bank/upload", methods=["POST"])
@login_required(role="admin", permission="questions.create")
def api_question_bank_upload():
    file = request.files.get("file")
    if not file or not (file.filename or "").lower().endswith(".pdf"):
        return jsonify({"error": "Geçerli bir PDF dosyası seçin."}), 400

    subject_code = (request.form.get("subject_code") or "").strip()
    if not subject_code:
        return jsonify({"error": "Ders seçimi gerekli."}), 400

    booklet_code = (request.form.get("booklet_code") or "A").strip().upper()[:1] or "A"

    db = get_db()
    subject_row = db.execute("SELECT id, name FROM subjects WHERE code=?", (subject_code,)).fetchone()
    if not subject_row:
        return jsonify({"error": "Geçersiz ders."}), 400
    subject_id = subject_row["id"]
    subject_name = subject_row["name"]
    user_id = session["user_id"]
    org_id = _current_org_id(db)

    # 1.1(a): sınıf seviyesi ZORUNLU DEĞİL (mevcut PDF'ler zaten grade_level'sız
    # yüklendi, geriye dönük veri bozulmasın) - ama seçilirse tüm batch'e (bir
    # PDF neredeyse her zaman tek bir sınıf seviyesine ait olduğu için soru-soru
    # değil batch seviyesinde) aynı değer yazılır. grade_level_id'den TEXT
    # değeri sunucu tarafında çözülür - iki sütun asla desync olmasın diye
    # (bkz. 2.2, aynı desen api_question_bank_update'te de kullanılıyor).
    grade_level_id = request.form.get("grade_level_id", type=int)
    grade_level = None
    if grade_level_id:
        gl_row = db.execute("SELECT name FROM grade_levels WHERE id=?", (grade_level_id,)).fetchone()
        grade_level = gl_row["name"] if gl_row else None
        if not gl_row:
            grade_level_id = None

    now = datetime.now().isoformat()
    safe_name = secure_filename(file.filename) or "yuklenen.pdf"

    # 1.1 düzeltmesi: dosya önce GEÇİCİ bir ada kaydedilir, OCR kilidi
    # alınmadan question_import_batches satırı YAZILMAZ - eskiden kilit
    # açılmazsa (60s içinde) bile bir batch satırı zaten oluşmuş oluyordu,
    # bu da üretimde admin sayfayı yenileyip tekrar deneyince kalıcı, hiç
    # temizlenmeyen BOŞ ("hayalet") setler biriktiriyordu (gerçek olayla
    # doğrulandı, bkz. proje notu). Artık kilit alınamazsa hiçbir iz kalmaz.
    source_dir = os.path.join(UPLOADS_DIR, "source_pdfs")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(QUESTION_IMAGES_DIR, exist_ok=True)
    temp_pdf_path = os.path.join(source_dir, f"_pending_{secrets.token_hex(8)}.pdf")
    file.save(temp_pdf_path)

    if not _OCR_SEMAPHORE.acquire(timeout=_OCR_SEMAPHORE_WAIT_SECONDS):
        try:
            os.remove(temp_pdf_path)
        except OSError:
            pass
        return jsonify({"error": "Sistem şu anda başka bir PDF işliyor. Lütfen birkaç dakika sonra tekrar deneyin."}), 503

    cur = db.execute(
        "INSERT INTO question_import_batches (organization_id, uploaded_by, source_filename, status, booklet_code, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (org_id, user_id, safe_name, "processing", booklet_code, now),
    )
    batch_id = cur.lastrowid
    db.commit()
    pdf_path = os.path.join(source_dir, f"batch_{batch_id}.pdf")
    os.rename(temp_pdf_path, pdf_path)

    try:
        result = pdf_question_extractor.extract_questions(
            pdf_path, subject_name=subject_name, booklet_code=booklet_code,
        )
        if result["page_count"] > _MAX_PDF_PAGES:
            raise ValueError(f"PDF çok uzun ({result['page_count']} sayfa, sınır {_MAX_PDF_PAGES}).")
    except Exception as exc:
        _OCR_SEMAPHORE.release()
        pdf_question_extractor.release_pdf_cache()
        db.execute("UPDATE question_import_batches SET status='failed' WHERE id=?", (batch_id,))
        db.commit()
        return jsonify({"error": f"PDF işlenemedi: {exc}"}), 400
    _OCR_SEMAPHORE.release()

    created = []
    for q in result["questions"]:
        image_filename = f"{batch_id}_{q['number']}.png"
        pdf_question_extractor.render_question_crop(
            pdf_path, q["page"], q["rect"], os.path.join(QUESTION_IMAGES_DIR, image_filename)
        )
        answer = result["answer_key"].get(q["number"])
        rect = q["rect"]
        qcur = db.execute(
            "INSERT INTO question_bank (organization_id, batch_id, subject_id, grade_level, grade_level_id, image_path, "
            "question_number, source_page_number, crop_x, crop_y, crop_width, crop_height, "
            "correct_answer, correct_answer_source, status, source, created_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (org_id, batch_id, subject_id, grade_level, grade_level_id, f"questions/{image_filename}",
             q["number"], q["page"] + 1, rect.x0, rect.y0, rect.width, rect.height,
             answer, "answer_key" if answer else None, "pending_review", "pdf_import", user_id, now, now),
        )
        created.append({
            "id": qcur.lastrowid, "number": q["number"], "correctAnswer": answer,
            "imageUrl": f"/api/admin/question-bank/image/{qcur.lastrowid}",
        })

    pdf_question_extractor.release_pdf_cache()
    db.execute(
        "UPDATE question_import_batches SET status='ready_for_review', page_count=? WHERE id=?",
        (result["page_count"], batch_id),
    )
    db.commit()

    return jsonify({
        "batchId": batch_id,
        "pageCount": result["page_count"],
        "questionCount": len(created),
        "answerKeyFound": len(result["answer_key"]) > 0,
        "questions": created,
        "estimatedSeconds": result.get("estimated_seconds"),
    })


@app.route("/api/admin/question-bank/batches")
@login_required(role="admin", permission="questions.view")
def api_question_bank_batches():
    db = get_db()
    org_id = _current_org_id(db)
    rows = db.execute(
        "SELECT b.id, b.source_filename, b.status, b.page_count, b.booklet_code, b.created_at, "
        "COUNT(q.id) AS question_count, "
        "SUM(CASE WHEN q.status='pending_review' THEN 1 ELSE 0 END) AS pending_count, "
        "SUM(CASE WHEN q.status IN ('approved','published') THEN 1 ELSE 0 END) AS approved_count "
        "FROM question_import_batches b LEFT JOIN question_bank q ON q.batch_id = b.id "
        "WHERE b.organization_id=? GROUP BY b.id ORDER BY b.id DESC",
        (org_id,),
    ).fetchall()
    return jsonify({"batches": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/batches/<int:batch_id>")
@login_required(role="admin", permission="questions.view")
def api_question_bank_batch(batch_id):
    db = get_db()
    org_id = _current_org_id(db)
    batch = db.execute(
        "SELECT * FROM question_import_batches WHERE id=? AND organization_id=?",
        (batch_id, org_id),
    ).fetchone()
    if not batch:
        return jsonify({"error": "Bulunamadı."}), 404
    rows = db.execute(
        "SELECT id, subject_id, grade_level, grade_level_id, question_number, source_page_number, crop_x, crop_y, "
        "crop_width, crop_height, correct_answer, correct_answer_source, explanation, "
        "status, topic_id, learning_outcome_id, difficulty_level, question_type, display_code, "
        "difficulty, question_pattern, tags, source, ai_confidence, ai_suggested_json, ai_classified_at, "
        "created_by, rejection_reason "
        "FROM question_bank WHERE batch_id=? ORDER BY question_number, id",
        (batch_id,),
    ).fetchall()
    questions = []
    for r in rows:
        item = dict(r)
        item["imageUrl"] = f"/api/admin/question-bank/image/{r['id']}"
        # admin-panel-soru-havuzu-2 bolum 8 (dort goz): frontend'in "Onayla/
        # Hariç Tut" butonlarını gizleyebilmesi için - ham created_by (başka
        # bir kullanıcının id'si) yerine sadece "bu SORU BENİM Mİ" bilgisi
        # gönderilir.
        item["isOwn"] = (item.pop("created_by", None) == session.get("user_id"))
        # ai_confidence/ai_suggested_json DB'de JSON-string olarak tutulur -
        # frontend'in tekrar parse etmesine gerek kalmasin diye burada coz.
        for json_field in ("ai_confidence", "ai_suggested_json"):
            if item.get(json_field):
                try:
                    item[json_field] = json.loads(item[json_field])
                except (TypeError, ValueError):
                    item[json_field] = None
        questions.append(item)
    return jsonify({"batch": dict(batch), "questions": questions})


def _get_owned_question(db, question_id, org_id):
    return db.execute(
        "SELECT * FROM question_bank WHERE id=? AND organization_id=?", (question_id, org_id)
    ).fetchone()


def _source_pdf_path(batch_id):
    return os.path.join(UPLOADS_DIR, "source_pdfs", f"batch_{batch_id}.pdf")


# ============================================================
# AI destekli soru sınıflandırma (admin-panel-soru-havuzu-1.md bölüm 3.3)
# ============================================================
# Tek çağrıda hem metin çıkarımı (OCR) hem sınıflandırma yapılır (hız/
# maliyet için tercih edildi - bkz. proje notu, doğruluk için iki adımlı
# alternatif (önce metin onayı, sonra sınıflandırma) daha sonra eklenebilir).
# "admin serbest girsin + AI önersin" kararı geregi: unite/konu/beceri
# SADECE mevcut taksonomiyle TAM eslesirse otomatik baglanir, aksi halde
# oneri ai_suggested_json'da kalir ve admin'e gösterilir - AI asla sessizce
# yeni bir taksonomi kaydı OLUŞTURMAZ.
QUESTION_DIFFICULTIES = ("kolay", "orta", "zor")
QUESTION_PATTERNS = ("islem_sorusu", "problem_sorusu", "yorum_sorusu", "yeni_nesil_soru")
QUESTION_TYPES = ("coktan_secmeli", "acik_uclu", "dogru_yanlis", "eslestirme")

_AI_CLASSIFIER_SYSTEM_PROMPT = """Sen bir soru sınıflandırma asistanısın. Sana bir soru görseli verilecek.
Görseldeki soruyu analiz edip SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir açıklama ekleme:

{{
  "soru_metni": "görseldeki soru metninin tam transkripsiyonu",
  "zorluk": "kolay" | "orta" | "zor",
  "soru_tipi": "coktan_secmeli" | "acik_uclu" | "dogru_yanlis" | "eslestirme",
  "soru_kalibi": "islem_sorusu" | "problem_sorusu" | "yorum_sorusu" | "yeni_nesil_soru",
  "unite": "string (aşağıdaki mevcut ünite listesinden en yakın eşleşme, hiçbiri uymuyorsa yeni bir öneri)",
  "konu": "string (aşağıdaki mevcut konu listesinden en yakın eşleşme, hiçbiri uymuyorsa yeni bir öneri)",
  "beceri": "string (aşağıdaki mevcut beceri listesinden en yakın eşleşme, hiçbiri uymuyorsa yeni bir öneri)",
  "etiketler": ["#etiket1", "#etiket2"],
  "guven_skorlari": {{
    "soru_metni": 0.0-1.0, "zorluk": 0.0-1.0, "soru_tipi": 0.0-1.0, "soru_kalibi": 0.0-1.0,
    "unite": 0.0-1.0, "konu": 0.0-1.0, "beceri": 0.0-1.0
  }}
}}

Kurallar:
- "unite/konu/beceri" alanlarını verilen mevcut liste içinden seçmeye ÇALIŞ, emin değilsen
  en yakın tahmini yap ve o alanın güven skorunu düşük tut (<0.6).
- Mevcut listede hiçbir uygun seçenek yoksa yeni bir isim önerebilirsin (yine düşük güvenle).
- Ders: {subject_name}, Sınıf Seviyesi: {grade_level}
- Mevcut Üniteler: {units_list}
- Mevcut Konular: {topics_list}
- Mevcut Beceriler: {outcomes_list}
"""


class AIClassificationError(Exception):
    """AI sınıflandırma başarısız oldu - mesajı doğrudan kullanıcıya gösterilir."""


def _build_question_taxonomy_context(db, subject_id):
    units = [r["name"] for r in db.execute(
        "SELECT name FROM units WHERE subject_id=? ORDER BY name", (subject_id,)).fetchall()]
    topics = [r["name"] for r in db.execute(
        "SELECT name FROM topics WHERE subject_id=? ORDER BY name", (subject_id,)).fetchall()]
    outcomes = [r["name"] for r in db.execute(
        "SELECT DISTINCT lo.name FROM learning_outcomes lo JOIN topics t ON t.id=lo.topic_id "
        "WHERE t.subject_id=? ORDER BY lo.name", (subject_id,)).fetchall()]
    return units, topics, outcomes


def _classify_question_with_ai(db, question_row):
    if not GEMINI_SDK_AVAILABLE:
        raise AIClassificationError("AI sınıflandırma için gerekli kütüphane sunucuda kurulu değil.")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise AIClassificationError("AI sınıflandırma yapılandırılmamış (GEMINI_API_KEY ayarlanmamış).")

    image_full_path = os.path.join(QUESTION_IMAGES_DIR, os.path.basename(question_row["image_path"]))
    if not os.path.isfile(image_full_path):
        raise AIClassificationError("Soru görseli bulunamadı.")
    with open(image_full_path, "rb") as f:
        image_bytes = f.read()

    subject_row = db.execute("SELECT name FROM subjects WHERE id=?", (question_row["subject_id"],)).fetchone()
    subject_name = subject_row["name"] if subject_row else "Bilinmiyor"
    units, topics, outcomes = _build_question_taxonomy_context(db, question_row["subject_id"])
    system_prompt = _AI_CLASSIFIER_SYSTEM_PROMPT.format(
        subject_name=subject_name,
        grade_level=question_row["grade_level"] or "belirtilmemiş",
        units_list=", ".join(units) or "(henüz yok)",
        topics_list=", ".join(topics) or "(henüz yok)",
        outcomes_list=", ".join(outcomes) or "(henüz yok)",
    )

    client = gemini_sdk.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            # 2.5-flash yeni kullanıcılara kapatılmış (gerçek API çağrısıyla
            # doğrulandı, 2026-09) - Google'ın kendi hata mesajının önerdiği
            # güncel model.
            model="gemini-3.6-flash",
            contents=[
                gemini_types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                "Bu soruyu analiz et ve JSON formatında sınıflandır.",
            ],
            config=gemini_types.GenerateContentConfig(
                system_instruction=system_prompt,
                # Gemini'nin yerleşik JSON modu - Anthropic sürümündeki
                # kırılgan "```json bloğunu ayıkla" mantığına gerek bırakmıyor,
                # yanıt zaten geçerli JSON garantili geliyor.
                response_mime_type="application/json",
                max_output_tokens=2048,
            ),
        )
    except gemini_errors.ClientError as exc:
        if exc.code in (401, 403):
            raise AIClassificationError("AI sınıflandırma yapılandırılmamış (GEMINI_API_KEY eksik veya geçersiz).")
        if exc.code == 429:
            raise AIClassificationError("AI servisi şu an yoğun (rate limit). Birazdan tekrar deneyin.")
        raise AIClassificationError(f"AI servisi hata döndü: {exc.message or exc}")
    except gemini_errors.ServerError as exc:
        raise AIClassificationError(f"AI servisi hata döndü: {exc.message or exc}")
    except gemini_errors.APIError as exc:
        raise AIClassificationError(f"AI servisi hata döndü: {exc.message or exc}")
    except Exception as exc:
        # DNS/timeout gibi baglanti hatalari SDK'nin kendi hata tiplerinin
        # disinda kalabiliyor - kullaniciya yine de anlasilir bir mesaj
        # dönmesi icin genel bir fallback.
        raise AIClassificationError(f"AI servisine bağlanılamadı: {exc}")

    text_content = (response.text or "").strip()
    try:
        return json.loads(text_content)
    except ValueError:
        raise AIClassificationError("AI yanıtı ayrıştırılamadı (beklenmeyen format).")


@app.route("/api/admin/question-bank/batches/<int:batch_id>", methods=["DELETE"])
@login_required(role="admin", permission="questions.delete")
def api_question_bank_delete_batch(batch_id):
    """Bir yükleme setini ve içindeki TÜM soruları (onaylanmış olsa da)
    kalıcı olarak siler - kırpma görselleri ve kaynak PDF'i diskten de
    kaldırır. question_booklet_numbers, question_bank silinince FK CASCADE
    ile otomatik temizlenir (bkz. get_db()'deki PRAGMA foreign_keys=ON)."""
    db = get_db()
    org_id = _current_org_id(db)
    batch = db.execute(
        "SELECT id FROM question_import_batches WHERE id=? AND organization_id=?",
        (batch_id, org_id),
    ).fetchone()
    if not batch:
        return jsonify({"error": "Bulunamadı."}), 404

    image_rows = db.execute(
        "SELECT image_path FROM question_bank WHERE batch_id=?", (batch_id,)
    ).fetchall()

    db.execute("DELETE FROM question_bank WHERE batch_id=?", (batch_id,))
    db.execute("DELETE FROM question_import_batches WHERE id=?", (batch_id,))
    db.commit()
    # Bu islem KALICI ve GERI ALINAMAZ (onaylanmis/yayinlanmis sorular dahil
    # her seyi siler) - daha once hicbir izi yoktu, gercek bir olayda
    # (bkz. proje notu) hangi setlerin ne zaman/kim tarafindan silindigini
    # gostermenin imkansiz oldugu ortaya cikti.
    log_audit(db, "QUESTION_BATCH_DELETED", resource_type="question_import_batch", resource_id=batch_id)

    for r in image_rows:
        path = os.path.join(QUESTION_IMAGES_DIR, os.path.basename(r["image_path"]))
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
    pdf_path = _source_pdf_path(batch_id)
    if os.path.isfile(pdf_path):
        try:
            os.remove(pdf_path)
        except OSError:
            pass

    return jsonify({"ok": True})


@app.route("/api/admin/question-bank/image/<int:question_id>")
@login_required(role="admin", permission="questions.view")
def api_question_bank_image(question_id):
    db = get_db()
    row = db.execute(
        "SELECT image_path, organization_id FROM question_bank WHERE id=?", (question_id,)
    ).fetchone()
    if not row or row["organization_id"] != _current_org_id(db):
        return jsonify({"error": "Bulunamadı."}), 404
    filename = os.path.basename(row["image_path"])
    resp = send_from_directory(QUESTION_IMAGES_DIR, filename)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/api/admin/question-bank/questions/<int:question_id>/context-image")
@login_required(role="admin", permission="questions.view")
def api_question_bank_context_image(question_id):
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404
    pdf_path = _source_pdf_path(row["batch_id"])
    if not os.path.isfile(pdf_path):
        return jsonify({"error": "Kaynak PDF bulunamadı (silinmiş olabilir)."}), 404
    try:
        png_bytes, page_w, page_h = pdf_question_extractor.render_page_image_bytes(
            pdf_path, row["source_page_number"] - 1
        )
    except Exception as exc:
        return jsonify({"error": f"Sayfa görüntüsü oluşturulamadı: {exc}"}), 400
    resp = Response(png_bytes, mimetype="image/png")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Page-Width-Pt"] = str(page_w)
    resp.headers["X-Page-Height-Pt"] = str(page_h)
    resp.headers["X-Dpi"] = str(pdf_question_extractor.CONTEXT_DPI)
    return resp


@app.route("/api/admin/question-bank/questions/<int:question_id>/recrop", methods=["POST"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_recrop(question_id):
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404

    data = request.get_json(silent=True) or {}
    try:
        x, y, w, h = float(data["x"]), float(data["y"]), float(data["width"]), float(data["height"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Geçersiz kırpma sınırları."}), 400
    if w <= 0 or h <= 0:
        return jsonify({"error": "Kırpma alanı geçersiz."}), 400

    pdf_path = _source_pdf_path(row["batch_id"])
    if not os.path.isfile(pdf_path):
        return jsonify({"error": "Kaynak PDF bulunamadı (silinmiş olabilir)."}), 404

    out_path = os.path.join(QUESTION_IMAGES_DIR, os.path.basename(row["image_path"]))
    try:
        rect = pdf_question_extractor.render_question_crop_from_bounds(
            pdf_path, row["source_page_number"] - 1, x, y, x + w, y + h, out_path
        )
    except Exception as exc:
        return jsonify({"error": f"Yeniden kırpma başarısız: {exc}"}), 400

    now = datetime.now().isoformat()
    db.execute(
        "UPDATE question_bank SET crop_x=?, crop_y=?, crop_width=?, crop_height=?, updated_at=? WHERE id=?",
        (rect.x0, rect.y0, rect.width, rect.height, now, question_id),
    )
    db.commit()
    return jsonify({
        "cropX": rect.x0, "cropY": rect.y0, "cropWidth": rect.width, "cropHeight": rect.height,
        "imageUrl": f"/api/admin/question-bank/image/{question_id}?t={int(datetime.now().timestamp())}",
    })


@app.route("/api/admin/question-bank/questions/<int:question_id>/ai-classify", methods=["POST"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_ai_classify(question_id):
    """Bir soru görselini AI'ya gönderip metin çıkarımı + metadata önerisi
    alır (bkz. yukarısı - _classify_question_with_ai). Taksonomiye (ünite/
    konu/beceri) sadece mevcut bir kayıtla TAM eşleşirse otomatik bağlanır;
    eşleşmeyen öneriler sadece ai_suggested_json'da saklanıp admin'e
    gösterilir - admin panelinde onaylanana/düzeltilene kadar hiçbir yeni
    taksonomi kaydı sessizce oluşturulmaz."""
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404

    try:
        suggestion = _classify_question_with_ai(db, row)
    except AIClassificationError as exc:
        return jsonify({"error": str(exc)}), 503

    def _match_id(table, name_col, where_col, where_val, suggested_name):
        if not suggested_name:
            return None
        r = db.execute(
            f"SELECT id FROM {table} WHERE {where_col}=? AND LOWER({name_col})=LOWER(?)",
            (where_val, suggested_name),
        ).fetchone()
        return r["id"] if r else None

    # 1.2: unite önerisi önceden hiç kullanılmıyordu - units eşleşirse, topic
    # aramasını sadece subject_id'ye göre değil o unit_id'ye göre de daraltır
    # (isim çakışması riskini azaltır). unit_id BULUNAMAZSA eski davranışa
    # (sadece subject_id) düşülür - geriye dönük kırılma olmaz. unit_id
    # question_bank'e YAZILMAZ (şemada doğrudan sütunu yok, topic_id ->
    # topics.unit_id üzerinden dolaylı geliyor) - sadece topic eşleşmesini
    # isabetli hale getirmek için ara adım.
    unit_id = _match_id("units", "name", "subject_id", row["subject_id"], suggestion.get("unite"))
    if unit_id:
        konu_name = suggestion.get("konu")
        topic_row = (
            db.execute(
                "SELECT id FROM topics WHERE subject_id=? AND unit_id=? AND LOWER(name)=LOWER(?)",
                (row["subject_id"], unit_id, konu_name),
            ).fetchone()
            if konu_name else None
        )
        topic_id = topic_row["id"] if topic_row else None
    else:
        topic_id = _match_id("topics", "name", "subject_id", row["subject_id"], suggestion.get("konu"))
    outcome_id = (
        _match_id("learning_outcomes", "name", "topic_id", topic_id, suggestion.get("beceri"))
        if topic_id else None
    )

    difficulty = suggestion.get("zorluk") if suggestion.get("zorluk") in QUESTION_DIFFICULTIES else None
    question_pattern = suggestion.get("soru_kalibi") if suggestion.get("soru_kalibi") in QUESTION_PATTERNS else None
    # 1.3: soru_tipi AI önerisinden geliyordu ama hiçbir zaman question_type
    # sütununa yazılmıyordu - difficulty/question_pattern ile AYNI "zaten
    # doluysa üzerine yazma" deseni korunur.
    question_type = suggestion.get("soru_tipi") if suggestion.get("soru_tipi") in QUESTION_TYPES else None
    tags = ",".join(suggestion.get("etiketler") or []) or None
    question_text = (suggestion.get("soru_metni") or "").strip() or None
    now = datetime.now().isoformat()

    fields = ["ai_confidence=?", "ai_suggested_json=?", "ai_classified_at=?", "updated_at=?"]
    params = [
        json.dumps(suggestion.get("guven_skorlari") or {}, ensure_ascii=False),
        json.dumps(suggestion, ensure_ascii=False), now, now,
    ]
    if difficulty and not row["difficulty"]:
        fields.append("difficulty=?"); params.append(difficulty)
    if question_pattern and not row["question_pattern"]:
        fields.append("question_pattern=?"); params.append(question_pattern)
    if question_type and not row["question_type"]:
        fields.append("question_type=?"); params.append(question_type)
    if tags and not row["tags"]:
        fields.append("tags=?"); params.append(tags)
    if question_text and not row["question_text"]:
        fields.append("question_text=?"); params.append(question_text)
    if topic_id and not row["topic_id"]:
        fields.append("topic_id=?"); params.append(topic_id)
    if outcome_id and not row["learning_outcome_id"]:
        fields.append("learning_outcome_id=?"); params.append(outcome_id)

    params.append(question_id)
    db.execute(f"UPDATE question_bank SET {', '.join(fields)} WHERE id=?", params)
    db.commit()
    log_audit(db, "QUESTION_AI_CLASSIFIED", resource_type="question", resource_id=question_id)

    return jsonify({
        "ok": True,
        "suggestion": suggestion,
        "matched": {"topicId": topic_id, "learningOutcomeId": outcome_id},
    })


_QUESTION_STATUSES = ("pending_review", "reviewed", "excluded", "approved", "published", "archived")


def _check_four_eyes(row, user_id, status):
    """'Dört göz prensibi' (admin-panel-soru-havuzu-2 bölüm 8): bir soruyu
    approved/excluded yapacak kişi, o soruyu GİREN kişiyle AYNI olamaz -
    başka bir yetkili incelemeli. Sadece nihai karar adımlarında (approved/
    excluded) uygulanır; pending_review/reviewed/published/archived bu
    kısıtın dışında (published zaten approved sonrası ayrı bir yetki
    istiyor, archived bir "silme" kararı, sahiplik burada önemsiz)."""
    if status in ("approved", "excluded") and row["created_by"] == user_id:
        return jsonify({"error": "Kendi girdiğiniz soruyu onaylayamaz/reddedemezsiniz - başka bir yetkili incelemeli."}), 403
    return None


def _apply_question_status(db, row, status, user_id, rejection_reason=None):
    """question_bank satırının durumunu değiştirir; 'approved' olduğunda
    henüz display_code atanmamışsa <DERS_KODU>-00001 kalıbıyla üretir.
    'published'/'archived' için ayrıca published_at/archived_at damgalanır -
    bunlar terminal, geri döndürülmesi beklenmeyen durumlar (arşivleme =
    yumuşak silme, hard delete YOK).
    Hem tekil PATCH hem toplu bulk-update endpoint'i bu fonksiyonu kullanır."""
    now = datetime.now().isoformat()
    db.execute(
        "UPDATE question_bank SET status=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
        (status, user_id, now, now, row["id"]),
    )
    if status == "published":
        db.execute("UPDATE question_bank SET published_at=? WHERE id=?", (now, row["id"]))
    if status == "archived":
        db.execute("UPDATE question_bank SET archived_at=? WHERE id=?", (now, row["id"]))
    # Reddedilirken gerekce kaydedilir; onaylanirken (yeniden inceleme sonrasi
    # duzeltilip tekrar gonderilmis olabilir) bir onceki red gerekcesi artik
    # gecerli olmadigi icin temizlenir.
    if status == "excluded":
        db.execute("UPDATE question_bank SET rejection_reason=? WHERE id=?", (rejection_reason, row["id"]))
    elif status in ("approved", "pending_review"):
        db.execute("UPDATE question_bank SET rejection_reason=NULL WHERE id=?", (row["id"],))
    display_code = row["display_code"]
    if status == "approved" and not display_code:
        subject_row = db.execute("SELECT code FROM subjects WHERE id=?", (row["subject_id"],)).fetchone()
        subject_code = (subject_row["code"] if subject_row else "soru").upper()
        display_code = f"{subject_code}-{row['id']:05d}"
        db.execute("UPDATE question_bank SET display_code=? WHERE id=?", (display_code, row["id"]))
    return display_code


@app.route("/api/admin/question-bank/questions/<int:question_id>", methods=["PATCH"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_update(question_id):
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404

    data = request.get_json(silent=True) or {}
    fields, params = [], []

    for key, column in (
        ("topicId", "topic_id"), ("learningOutcomeId", "learning_outcome_id"),
        ("difficultyLevel", "difficulty_level"), ("questionType", "question_type"),
        ("explanation", "explanation"),
        # admin-panel-soru-havuzu-1.md: admin AI önerisini burada düzeltebilir/
        # onaylayabilir - düzeltme, sonraki AI çağrılarının kalibrasyonu için
        # ayrıca loglanmıyor henüz (bkz. tasarım önerisi #3, ayrı bir iş).
        ("difficulty", "difficulty"), ("questionPattern", "question_pattern"),
    ):
        if key in data:
            fields.append(f"{column}=?")
            params.append(data[key] or None)

    if "tags" in data:
        tags_value = data["tags"]
        if isinstance(tags_value, list):
            tags_value = ",".join(t.strip() for t in tags_value if str(t).strip())
        fields.append("tags=?")
        params.append((tags_value or "").strip() or None)

    if "correctAnswer" in data:
        fields.append("correct_answer=?")
        params.append((data["correctAnswer"] or "").strip() or None)
        fields.append("correct_answer_source=?")
        params.append("edited")

    # 1.1(b) + 2.2: grade_level_id (FK) ve grade_level (TEXT, öğrenci eşleştirme
    # için - bkz. init_db()'deki sütun yorumu) TEK giriş noktasından, AYNI ANDA
    # set edilir ki iki sütun asla birbirinden kopmasın (correctAnswer/
    # correct_answer_source ile aynı çift-sütun deseni, yukarıda).
    if "gradeLevelId" in data:
        gl_id = data.get("gradeLevelId")
        gl_name = None
        if gl_id:
            gl_row = db.execute("SELECT name FROM grade_levels WHERE id=?", (gl_id,)).fetchone()
            gl_name = gl_row["name"] if gl_row else None
            if not gl_row:
                gl_id = None
        fields.append("grade_level_id=?")
        params.append(gl_id)
        fields.append("grade_level=?")
        params.append(gl_name)

    status = data.get("status")
    if status and status not in _QUESTION_STATUSES:
        return jsonify({"error": "Geçersiz durum."}), 400
    # Durum degisikligi, salt metadata duzenlemekten (questions.update, decorator'da
    # zaten kontrol edildi) ayri bir yetki gerektirir: incelemeye gonderme
    # (pending_review -> reviewed) vs. nihai karar (excluded/approved).
    if status == "reviewed" and not has_permission(db, session["user_id"], "questions.submit_review"):
        return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403
    if status in ("excluded", "approved") and not has_permission(db, session["user_id"], "questions.approve"):
        return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403
    if status == "published":
        if row["status"] != "approved":
            return jsonify({"error": "Sadece onaylanmış bir soru yayınlanabilir."}), 400
        if not has_permission(db, session["user_id"], "questions.publish"):
            return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403
    if status == "archived" and not has_permission(db, session["user_id"], "questions.delete"):
        return jsonify({"error": "Bu işlem için yetkiniz yok."}), 403

    four_eyes_error = _check_four_eyes(row, session["user_id"], status) if status else None
    if four_eyes_error:
        return four_eyes_error

    rejection_reason = None
    if status == "excluded":
        rejection_reason = (data.get("rejectionReason") or "").strip()
        if not rejection_reason:
            return jsonify({"error": "Reddetme gerekçesi zorunlu."}), 400

    # 2.1: yayına almadan önce minimum etiket kontrolü - approved için değil
    # (hâlâ düzeltilebilir bir ara durum), SADECE published için hard-block
    # (öğrenciye görünür hale gelen nihai adım). Bu istekte AYNI ANDA
    # gönderilmiş olabilecek alan güncellemeleri (bkz. _qbSaveFields, admin
    # panelinde "Yayınla" butonu formdaki TÜM alanları status ile birlikte
    # tek PATCH'te gönderiyor) satırdaki eski değerin üzerine yazılacağı için,
    # kontrol `row`'un değil bu isteğin GEÇERLİ OLACAK değerlerine bakar.
    if status == "published":
        effective_topic_id = data["topicId"] if "topicId" in data else row["topic_id"]
        effective_difficulty = data["difficulty"] if "difficulty" in data else row["difficulty"]
        effective_grade_level = gl_name if "gradeLevelId" in data else row["grade_level"]
        missing = []
        if not effective_topic_id:
            missing.append("konu")
        if not effective_difficulty:
            missing.append("zorluk")
        if not effective_grade_level:
            missing.append("sınıf seviyesi")
        if missing:
            return jsonify({"error": f"Yayınlanmadan önce eksik alanlar tamamlanmalı: {', '.join(missing)}."}), 400

    if not fields and not status:
        return jsonify({"error": "Güncellenecek alan gönderilmedi."}), 400

    if fields:
        fields.append("updated_at=?")
        params.append(datetime.now().isoformat())
        params.append(question_id)
        db.execute(f"UPDATE question_bank SET {', '.join(fields)} WHERE id=?", params)

    display_code = row["display_code"]
    if status:
        display_code = _apply_question_status(db, row, status, session["user_id"], rejection_reason)

    db.commit()
    return jsonify({"ok": True, "displayCode": display_code})


@app.route("/api/admin/question-bank/questions/bulk-update", methods=["PATCH"])
@login_required(role="admin", permission="questions.approve")
def api_question_bank_bulk_update():
    """Onay ekranındaki ızgara görünümünden birden çok soruyu tek istekte
    onaylamak/hariç tutmak için - tek tek inceleme akışını değiştirmez,
    ona bir kısayol ekler."""
    data = request.get_json(silent=True) or {}
    question_ids = data.get("questionIds") or []
    status = data.get("status")
    if status not in ("approved", "excluded"):
        return jsonify({"error": "Geçersiz durum."}), 400
    if not isinstance(question_ids, list) or not question_ids:
        return jsonify({"error": "questionIds gerekli."}), 400
    rejection_reason = (data.get("rejectionReason") or "").strip()
    if status == "excluded" and not rejection_reason:
        return jsonify({"error": "Reddetme gerekçesi zorunlu."}), 400

    db = get_db()
    org_id = _current_org_id(db)
    user_id = session["user_id"]
    updated = 0
    skipped_own = 0
    for qid in question_ids:
        row = _get_owned_question(db, qid, org_id)
        if not row:
            continue
        # Dort goz: kendi sordugu sorulari toplu onay/red'den SESSIZCE
        # atlar - tek tek PATCH gibi 403 ile tum istegi durdurmaz, aksi
        # halde bir admin karisik bir secimde tek bir kendi sorusu yuzunden
        # butun toplu islemi kaybederdi.
        if status in ("approved", "excluded") and row["created_by"] == user_id:
            skipped_own += 1
            continue
        _apply_question_status(db, row, status, user_id, rejection_reason if status == "excluded" else None)
        updated += 1
    db.commit()
    return jsonify({"updated": updated, "skippedOwn": skipped_own})


@app.route("/api/admin/question-bank/grade-levels")
@login_required(role="admin", permission="questions.view")
def api_question_bank_grade_levels():
    db = get_db()
    rows = db.execute("SELECT id, name FROM grade_levels ORDER BY CAST(name AS INTEGER)").fetchall()
    return jsonify({"gradeLevels": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/grade-levels", methods=["POST"])
@login_required(role="admin", permission="questions.create")
def api_question_bank_create_grade_level():
    db = get_db()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name gerekli."}), 400
    now = datetime.now().isoformat()
    db.execute("INSERT OR IGNORE INTO grade_levels (name, created_at) VALUES (?,?)", (name, now))
    db.commit()
    row = db.execute("SELECT id, name FROM grade_levels WHERE name=?", (name,)).fetchone()
    return jsonify(dict(row))


@app.route("/api/admin/question-bank/units")
@login_required(role="admin", permission="questions.view")
def api_question_bank_units():
    db = get_db()
    subject_id = request.args.get("subject_id", type=int)
    if not subject_id:
        return jsonify({"error": "subject_id gerekli."}), 400
    rows = db.execute(
        "SELECT id, name, grade_level_id FROM units WHERE subject_id=? ORDER BY name", (subject_id,)
    ).fetchall()
    return jsonify({"units": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/units", methods=["POST"])
@login_required(role="admin", permission="questions.create")
def api_question_bank_create_unit():
    db = get_db()
    data = request.get_json(silent=True) or {}
    subject_id = data.get("subjectId")
    grade_level_id = data.get("gradeLevelId") or None
    name = (data.get("name") or "").strip()
    if not subject_id or not name:
        return jsonify({"error": "subjectId ve name gerekli."}), 400
    now = datetime.now().isoformat()
    existing_unit = db.execute("SELECT id FROM units WHERE subject_id=? AND name=?", (subject_id, name)).fetchone()
    if existing_unit:
        if grade_level_id:
            db.execute("UPDATE units SET grade_level_id=? WHERE id=?", (grade_level_id, existing_unit["id"]))
            db.commit()
        row = db.execute("SELECT id, name, grade_level_id FROM units WHERE id=?", (existing_unit["id"],)).fetchone()
        return jsonify(dict(row))
    db.execute(
        "INSERT INTO units (subject_id, grade_level_id, name, created_at) VALUES (?,?,?,?)",
        (subject_id, grade_level_id, name, now),
    )
    db.commit()
    row = db.execute(
        "SELECT id, name, grade_level_id FROM units WHERE subject_id=? AND name=?", (subject_id, name)
    ).fetchone()
    return jsonify(dict(row))


@app.route("/api/admin/question-bank/topics")
@login_required(role="admin", permission="questions.view")
def api_question_bank_topics():
    db = get_db()
    subject_id = request.args.get("subject_id", type=int)
    unit_id = request.args.get("unit_id", type=int)
    if not subject_id:
        return jsonify({"error": "subject_id gerekli."}), 400
    # unit_id verilmemisse (unite henuz secilmemis/atanmamis sorular icin)
    # o dersin TUM konularini doner - unite alani opsiyonel oldugu icin
    # (bkz. admin-panel-soru-havuzu-1.md "admin serbest girsin") bu geriye
    # donuk uyumluluk icin de gerekli.
    if unit_id:
        rows = db.execute(
            "SELECT id, name, unit_id FROM topics WHERE subject_id=? AND unit_id=? ORDER BY name",
            (subject_id, unit_id),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, name, unit_id FROM topics WHERE subject_id=? ORDER BY name", (subject_id,)
        ).fetchall()
    return jsonify({"topics": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/topics", methods=["POST"])
@login_required(role="admin", permission="questions.create")
def api_question_bank_create_topic():
    db = get_db()
    data = request.get_json(silent=True) or {}
    subject_id = data.get("subjectId")
    unit_id = data.get("unitId") or None
    name = (data.get("name") or "").strip()
    if not subject_id or not name:
        return jsonify({"error": "subjectId ve name gerekli."}), 400
    now = datetime.now().isoformat()
    existing = db.execute(
        "SELECT id FROM topics WHERE subject_id=? AND name=?", (subject_id, name)
    ).fetchone()
    if existing:
        if unit_id:
            db.execute("UPDATE topics SET unit_id=? WHERE id=?", (unit_id, existing["id"]))
            db.commit()
    else:
        db.execute(
            "INSERT INTO topics (subject_id, unit_id, name, created_at) VALUES (?,?,?,?)",
            (subject_id, unit_id, name, now),
        )
        db.commit()
    row = db.execute(
        "SELECT id, name, unit_id FROM topics WHERE subject_id=? AND name=?", (subject_id, name)
    ).fetchone()
    return jsonify(dict(row))


@app.route("/api/admin/question-bank/learning-outcomes")
@login_required(role="admin", permission="questions.view")
def api_question_bank_learning_outcomes():
    db = get_db()
    topic_id = request.args.get("topic_id", type=int)
    if not topic_id:
        return jsonify({"error": "topic_id gerekli."}), 400
    rows = db.execute(
        "SELECT id, name FROM learning_outcomes WHERE topic_id=? ORDER BY name", (topic_id,)
    ).fetchall()
    return jsonify({"learningOutcomes": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/learning-outcomes", methods=["POST"])
@login_required(role="admin", permission="questions.create")
def api_question_bank_create_learning_outcome():
    db = get_db()
    data = request.get_json(silent=True) or {}
    topic_id = data.get("topicId")
    name = (data.get("name") or "").strip()
    if not topic_id or not name:
        return jsonify({"error": "topicId ve name gerekli."}), 400
    now = datetime.now().isoformat()
    db.execute(
        "INSERT OR IGNORE INTO learning_outcomes (topic_id, name, created_at) VALUES (?,?,?)",
        (topic_id, name, now),
    )
    db.commit()
    row = db.execute(
        "SELECT id, name FROM learning_outcomes WHERE topic_id=? AND name=?", (topic_id, name)
    ).fetchone()
    return jsonify(dict(row))


# ============================================================
# MEB müfredat ağacı (curriculum_nodes) - topics/learning_outcomes'ın
# (yukarıda, hâlâ boş) yerini alan asıl taksonomi; seeds/curriculum_seed.json
# ile doldurulur (bkz. _load_curriculum_seed). Sadece 'kazanim' seviyesindeki
# düğümler bir soruya etiketlenebilir (bkz. api_question_bank_question_curriculum_tags).
# ============================================================

@app.route("/api/admin/question-bank/curriculum")
@login_required(role="admin", permission="questions.view")
def api_question_bank_curriculum():
    db = get_db()
    subject_id = request.args.get("subject_id", type=int)
    grade_level = request.args.get("grade_level")
    if not subject_id or not grade_level:
        return jsonify({"error": "subject_id ve grade_level gerekli."}), 400
    rows = db.execute(
        "SELECT id, code, parent_id, level, name, sort_order FROM curriculum_nodes "
        "WHERE subject_id=? AND grade_level=? ORDER BY sort_order",
        (subject_id, str(grade_level)),
    ).fetchall()
    nodes = {r["id"]: dict(r) | {"children": []} for r in rows}
    tree = []
    for r in rows:
        node = nodes[r["id"]]
        if r["parent_id"] and r["parent_id"] in nodes:
            nodes[r["parent_id"]]["children"].append(node)
        else:
            tree.append(node)
    return jsonify({"curriculum": tree})


# ============================================================
# Beceri (Skill) sistemi - admin-panel-soru-havuzu-2 bölüm 10.3
# ============================================================
# organization_id YOK: merkezi soru bankası gibi TÜM okullarda ortak/
# paylaşılan bir kaynak. Hem admin hem öğretmen yeni beceri ÖNERebilir
# (created_by), ama onay her zaman soru onayıyla AYNI "dört göz" ilkesiyle
# (_check_four_eyes) bir admin (questions.approve) tarafından verilir -
# öneren bir admin olsa bile KENDİ önerdiği beceriyi onaylayamaz.

def _propose_skill(db, name, description, user_id):
    name = (name or "").strip()
    if not name:
        return None, "Beceri adı gerekli."
    now = datetime.now().isoformat()
    existing = db.execute("SELECT id, status FROM skills WHERE LOWER(name)=LOWER(?)", (name,)).fetchone()
    if existing:
        return None, f"Bu isimde bir beceri zaten var (durum: {existing['status']})."
    cur = db.execute(
        "INSERT INTO skills (name, description, status, created_by, created_at, updated_at) "
        "VALUES (?,?,'pending_review',?,?,?)",
        (name, (description or "").strip() or None, user_id, now, now),
    )
    db.commit()
    return cur.lastrowid, None


@app.route("/api/admin/question-bank/skills")
@login_required(role="admin", permission="questions.view")
def api_question_bank_list_skills():
    db = get_db()
    status = request.args.get("status")
    query = (
        "SELECT sk.id, sk.name, sk.description, sk.status, sk.rejection_reason, sk.created_at, "
        "u.display_name AS created_by_name, sk.created_by = ? AS is_own "
        "FROM skills sk LEFT JOIN users u ON u.id = sk.created_by"
    )
    params = [session["user_id"]]
    if status:
        query += " WHERE sk.status = ?"
        params.append(status)
    query += " ORDER BY sk.created_at DESC"
    rows = db.execute(query, params).fetchall()
    return jsonify({"skills": [dict(r) | {"is_own": bool(r["is_own"])} for r in rows]})


@app.route("/api/admin/question-bank/skills", methods=["POST"])
@login_required(role="admin", permission="questions.create")
def api_question_bank_create_skill():
    db = get_db()
    data = request.get_json(silent=True) or {}
    skill_id, error = _propose_skill(db, data.get("name"), data.get("description"), session["user_id"])
    if error:
        return jsonify({"error": error}), 400
    log_audit(db, "SKILL_PROPOSED", resource_type="skill", resource_id=skill_id)
    return jsonify({"ok": True, "id": skill_id})


@app.route("/api/teacher/skills", methods=["POST"])
@login_required(role="teacher", permission="questions.create")
def api_teacher_create_skill():
    """Öğretmenler de yeni beceri önerebilir (bölüm 10.3) - legacy role
    hala 'teacher', onay hâlâ bir admin'in questions.approve iznine
    bağlı (bkz. _check_four_eyes ile aynı desen aşağıda)."""
    db = get_db()
    data = request.get_json(silent=True) or {}
    skill_id, error = _propose_skill(db, data.get("name"), data.get("description"), session["user_id"])
    if error:
        return jsonify({"error": error}), 400
    log_audit(db, "SKILL_PROPOSED", resource_type="skill", resource_id=skill_id)
    return jsonify({"ok": True, "id": skill_id})


@app.route("/api/admin/question-bank/skills/<int:skill_id>", methods=["PATCH"])
@login_required(role="admin", permission="questions.approve")
def api_question_bank_review_skill(skill_id):
    db = get_db()
    row = db.execute("SELECT * FROM skills WHERE id=?", (skill_id,)).fetchone()
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("active", "rejected"):
        return jsonify({"error": "Geçersiz durum."}), 400
    # Aynı dört göz ilkesi (bkz. _check_four_eyes / server.py bölüm 8) -
    # burada question_bank değil skills satırı olduğu için ayrı, küçük bir
    # kontrol; ortak bir yardımcıya çıkarmak (created_by/status/user_id
    # imzası aynı olsa da) bu iki farklı tablo için gereksiz bir soyutlama
    # olurdu.
    if row["created_by"] == session["user_id"]:
        return jsonify({"error": "Kendi önerdiğiniz beceriyi onaylayamaz/reddedemezsiniz - başka bir yetkili incelemeli."}), 403
    rejection_reason = None
    if status == "rejected":
        rejection_reason = (data.get("rejectionReason") or "").strip()
        if not rejection_reason:
            return jsonify({"error": "Reddetme gerekçesi zorunlu."}), 400
    now = datetime.now().isoformat()
    db.execute(
        "UPDATE skills SET status=?, approved_by=?, rejection_reason=?, updated_at=? WHERE id=?",
        (status, session["user_id"], rejection_reason, now, skill_id),
    )
    db.commit()
    log_audit(db, "SKILL_APPROVED" if status == "active" else "SKILL_REJECTED", resource_type="skill", resource_id=skill_id)
    return jsonify({"ok": True, "status": status})


@app.route("/api/admin/question-bank/questions/<int:question_id>/skills", methods=["GET", "PUT"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_question_skills(question_id):
    """Bir soruya bağlı becerileri (ve ağırlıklarını) okur/günceller. Sadece
    status='active' beceriler bağlanabilir - henüz onaylanmamış/reddedilmiş
    bir beceriyle soru etiketlemek, mastery hesaplamasına asla ACTIVE
    olmayacak bir beceri sızdırırdı."""
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404

    if request.method == "GET":
        rows = db.execute(
            "SELECT qs.skill_id, qs.weight, sk.name FROM question_skills qs "
            "JOIN skills sk ON sk.id = qs.skill_id WHERE qs.question_id=?",
            (question_id,),
        ).fetchall()
        return jsonify({"skills": [dict(r) for r in rows]})

    data = request.get_json(silent=True) or {}
    items = data.get("skills")
    if not isinstance(items, list):
        return jsonify({"error": "skills (liste) gerekli."}), 400
    total_weight = 0.0
    clean_items = []
    for item in items:
        skill_id = item.get("skillId")
        weight = item.get("weight")
        try:
            weight = float(weight)
        except (TypeError, ValueError):
            return jsonify({"error": "Geçersiz ağırlık değeri."}), 400
        if not skill_id or weight <= 0:
            return jsonify({"error": "Her beceri için geçerli bir id ve pozitif ağırlık gerekli."}), 400
        skill_row = db.execute("SELECT status FROM skills WHERE id=?", (skill_id,)).fetchone()
        if not skill_row or skill_row["status"] != "active":
            return jsonify({"error": "Sadece onaylı (aktif) beceriler bir soruya bağlanabilir."}), 400
        clean_items.append((skill_id, weight))
        total_weight += weight
    if clean_items and abs(total_weight - 100.0) > 0.01:
        return jsonify({"error": f"Ağırlıkların toplamı %100 olmalı (şu an: %{total_weight:.1f})."}), 400

    db.execute("DELETE FROM question_skills WHERE question_id=?", (question_id,))
    for skill_id, weight in clean_items:
        db.execute(
            "INSERT INTO question_skills (question_id, skill_id, weight) VALUES (?,?,?)",
            (question_id, skill_id, weight),
        )
    db.commit()
    return jsonify({"ok": True, "count": len(clean_items)})


@app.route("/api/admin/question-bank/questions/<int:question_id>/curriculum-tags", methods=["GET", "PUT"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_question_curriculum_tags(question_id):
    """Bir soruya bağlı kazanımları (ve ağırlıklarını) okur/günceller - bkz.
    question_skills sync deseni (yukarıda) ile aynı yaklaşım, farkla: ağırlık
    toplamı %100 değil 1.00 ve tam olarak bir kazanım is_primary olmalı
    (radio seçim - hangi kazanımın 'asıl' olduğunu netleştirir)."""
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404

    if request.method == "GET":
        rows = db.execute(
            "SELECT qct.curriculum_node_id, qct.weight, qct.is_primary, "
            "cn.code, cn.name, cn.level FROM question_curriculum_tags qct "
            "JOIN curriculum_nodes cn ON cn.id = qct.curriculum_node_id "
            "WHERE qct.question_id=? ORDER BY qct.is_primary DESC, qct.weight DESC",
            (question_id,),
        ).fetchall()
        return jsonify({"tags": [dict(r) | {"is_primary": bool(r["is_primary"])} for r in rows]})

    data = request.get_json(silent=True) or {}
    items = data.get("tags")
    if not isinstance(items, list):
        return jsonify({"error": "tags (liste) gerekli."}), 400
    total_weight = 0.0
    primary_count = 0
    clean_items = []
    for item in items:
        node_id = item.get("curriculumNodeId")
        weight = item.get("weight")
        is_primary = bool(item.get("isPrimary"))
        try:
            weight = float(weight)
        except (TypeError, ValueError):
            return jsonify({"error": "Geçersiz ağırlık değeri."}), 400
        if not node_id or not (0 < weight <= 1):
            return jsonify({"error": "Her etiket için geçerli bir kazanım id ve 0-1 arası ağırlık gerekli."}), 400
        node_row = db.execute("SELECT level FROM curriculum_nodes WHERE id=?", (node_id,)).fetchone()
        if not node_row or node_row["level"] != "kazanim":
            return jsonify({"error": "Sadece kazanım seviyesindeki düğümler bir soruya etiketlenebilir."}), 400
        clean_items.append((node_id, weight, is_primary))
        total_weight += weight
        if is_primary:
            primary_count += 1
    if clean_items and abs(total_weight - 1.0) > 0.01:
        return jsonify({"error": f"Ağırlıkların toplamı 1.00 olmalı (şu an: {total_weight:.2f})."}), 400
    if clean_items and primary_count != 1:
        return jsonify({"error": "Tam olarak bir kazanım birincil (isPrimary) olarak işaretlenmeli."}), 400

    db.execute("DELETE FROM question_curriculum_tags WHERE question_id=?", (question_id,))
    now = datetime.now().isoformat()
    for node_id, weight, is_primary in clean_items:
        db.execute(
            "INSERT INTO question_curriculum_tags (question_id, curriculum_node_id, weight, is_primary, created_at) "
            "VALUES (?,?,?,?,?)",
            (question_id, node_id, weight, int(is_primary), now),
        )
    db.commit()
    return jsonify({"ok": True, "count": len(clean_items)})


@app.route("/api/admin/question-bank/export")
@login_required(role="admin", permission="questions.publish")
def api_question_bank_export():
    """Yayınlanmış soruları (status='published') resim + manifest.csv olarak
    tek bir ZIP'te indirir - sadece onaylanmış (approved) ama henüz
    yayınlanmamış sorular DAHİL EDİLMEZ, questions.publish ile ayrıca
    yayınlanmaları gerekir (bkz. _migrate_question_bank_lifecycle)."""
    db = get_db()
    org_id = _current_org_id(db)
    subject_code = (request.args.get("subject_code") or "").strip()
    subject_id = None
    if subject_code:
        subject_row = db.execute("SELECT id FROM subjects WHERE code=?", (subject_code,)).fetchone()
        if not subject_row:
            return jsonify({"error": "Geçersiz ders."}), 400
        subject_id = subject_row["id"]

    query = (
        "SELECT q.id, q.display_code, q.question_number, q.image_path, q.difficulty_level, "
        "q.question_type, q.correct_answer, s.name AS subject_name, t.name AS topic_name, "
        "lo.name AS learning_outcome_name, b.source_filename, b.id AS batch_id "
        "FROM question_bank q "
        "JOIN subjects s ON s.id = q.subject_id "
        "LEFT JOIN topics t ON t.id = q.topic_id "
        "LEFT JOIN learning_outcomes lo ON lo.id = q.learning_outcome_id "
        "LEFT JOIN question_import_batches b ON b.id = q.batch_id "
        "WHERE q.organization_id=? AND q.status='published'"
    )
    params = [org_id]
    if subject_id:
        query += " AND q.subject_id=?"
        params.append(subject_id)
    query += " ORDER BY s.name, q.question_number, q.id"
    rows = db.execute(query, params).fetchall()

    if not rows:
        return jsonify({"error": "Dışa aktarılacak yayınlanmış soru bulunamadı."}), 404

    manifest_buf = io.StringIO()
    writer = csv.writer(manifest_buf)
    writer.writerow([
        "display_code", "question_number", "subject", "topic", "learning_outcome",
        "difficulty_level", "question_type", "correct_answer", "source_filename", "batch_id",
    ])

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for r in rows:
            src_path = os.path.join(QUESTION_IMAGES_DIR, os.path.basename(r["image_path"]))
            if not os.path.isfile(src_path):
                continue
            arcname = f"images/{r['display_code'] or r['id']}.png"
            zf.write(src_path, arcname)
            writer.writerow([
                r["display_code"] or "", r["question_number"] or "", r["subject_name"] or "",
                r["topic_name"] or "", r["learning_outcome_name"] or "", r["difficulty_level"] or "",
                r["question_type"] or "", r["correct_answer"] or "", r["source_filename"] or "",
                r["batch_id"] or "",
            ])
        zf.writestr("manifest.csv", manifest_buf.getvalue())

    resp = Response(zip_buf.getvalue(), mimetype="application/zip")
    resp.headers["Content-Disposition"] = "attachment; filename=soru-havuzu-export.zip"
    return resp


@app.route("/api/admin/question-bank/questions/<int:question_id>/booklet-numbers")
@login_required(role="admin", permission="questions.view")
def api_question_bank_get_booklet_numbers(question_id):
    db = get_db()
    row = _get_owned_question(db, question_id, _current_org_id(db))
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404
    native_booklet = None
    if row["batch_id"]:
        batch = db.execute(
            "SELECT booklet_code FROM question_import_batches WHERE id=?", (row["batch_id"],)
        ).fetchone()
        native_booklet = batch["booklet_code"] if batch else None
    rows = db.execute(
        "SELECT booklet_code, question_number FROM question_booklet_numbers "
        "WHERE question_id=? ORDER BY booklet_code",
        (question_id,),
    ).fetchall()
    return jsonify({
        "nativeBookletCode": native_booklet,
        "nativeQuestionNumber": row["question_number"],
        "numbers": [{"bookletCode": r["booklet_code"], "questionNumber": r["question_number"]} for r in rows],
    })


@app.route("/api/admin/question-bank/questions/<int:question_id>/booklet-numbers", methods=["PUT"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_set_booklet_numbers(question_id):
    """Bir sorunun DİĞER kitapçıklardaki numaralarını topluca değiştirir -
    body: {numbers: {"B": 5, "C": 12}}. Sorunun kendi (native) kitapçık
    kodu question_import_batches.booklet_code'da zaten var, question_number
    de question_bank'te - burada tekrar edilmez/kabul edilmez."""
    db = get_db()
    org_id = _current_org_id(db)
    row = _get_owned_question(db, question_id, org_id)
    if not row:
        return jsonify({"error": "Bulunamadı."}), 404

    native_booklet = None
    if row["batch_id"]:
        batch = db.execute(
            "SELECT booklet_code FROM question_import_batches WHERE id=?", (row["batch_id"],)
        ).fetchone()
        native_booklet = batch["booklet_code"] if batch else None

    data = request.get_json(silent=True) or {}
    numbers = data.get("numbers") or {}
    if not isinstance(numbers, dict):
        return jsonify({"error": "Geçersiz eşleme verisi."}), 400

    now = datetime.now().isoformat()
    db.execute("DELETE FROM question_booklet_numbers WHERE question_id=?", (question_id,))
    for booklet_code, number in numbers.items():
        code = (booklet_code or "").strip().upper()[:1]
        if not code or code == native_booklet:
            continue
        try:
            num = int(number)
        except (TypeError, ValueError):
            continue
        db.execute(
            "INSERT INTO question_booklet_numbers (question_id, booklet_code, question_number, created_at) "
            "VALUES (?,?,?,?)",
            (question_id, code, num, now),
        )
    db.commit()
    return jsonify({"ok": True})


def _parse_booklet_map_rows(file):
    """CSV VEYA JSON yükler (dosya uzantısına göre ayırt edilir), her satırı
    {KİTAPÇIK_KODU: numara} sözlüğüne normalize eder - böylece çağıran taraf
    kaynak formatla ilgilenmeden aynı eşleme mantığını uygulayabilir.

    CSV: başlık satırı kitapçık kodları (örn. A,B,C,D).
    JSON: {"mappings": [{"A": 1, "B": 5, ...}, ...]} veya doğrudan
    [{"A": 1, "B": 5, ...}, ...] - "question_id"/"exam_id" gibi tek harfli
    olmayan alanlar kitapçık kodu olarak yorumlanmaz, otomatik yok sayılır.
    """
    filename = (file.filename or "").lower()
    raw = file.read()

    if filename.endswith(".json"):
        try:
            payload = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"JSON ayrıştırılamadı: {exc}")
        entries = payload.get("mappings", []) if isinstance(payload, dict) else payload
        if not isinstance(entries, list):
            raise ValueError("JSON bir eşleme listesi ya da {'mappings': [...]} içermeli.")
        rows = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            rows.append({
                str(k).strip().upper(): v for k, v in entry.items()
                if len(str(k).strip()) == 1 and str(k).strip().isalpha()
            })
        return rows

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("CSV UTF-8 kodlamasında olmalı.")
    reader = csv.reader(io.StringIO(text))
    try:
        header = [h.strip().upper() for h in next(reader)]
    except StopIteration:
        raise ValueError("CSV boş.")
    rows = []
    for raw_row in reader:
        if not raw_row or all(not c.strip() for c in raw_row):
            continue
        rows.append({header[i]: raw_row[i].strip() for i in range(min(len(header), len(raw_row)))})
    return rows


@app.route("/api/admin/question-bank/batches/<int:batch_id>/import-booklet-map", methods=["POST"])
@login_required(role="admin", permission="questions.update")
def api_question_bank_import_booklet_map(batch_id):
    """CSV veya JSON yükler: her satır/kayıt bir mantıksal sorunun kitapçık
    başına numarası (bkz. _parse_booklet_map_rows). Bu batch'in kendi
    kitapçık kodu ÇAPA kabul edilir - o değer bu batch içindeki
    question_bank.question_number ile eşleştirilip question_id bulunur,
    satırdaki diğer kitapçık kodları o soru için question_booklet_numbers'a
    yazılır. Çapa numarası bu batch'te bulunamayan satırlar atlanır."""
    db = get_db()
    org_id = _current_org_id(db)
    batch = db.execute(
        "SELECT id, booklet_code FROM question_import_batches WHERE id=? AND organization_id=?",
        (batch_id, org_id),
    ).fetchone()
    if not batch:
        return jsonify({"error": "Bulunamadı."}), 404

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "CSV veya JSON dosyası gerekli."}), 400
    try:
        rows = _parse_booklet_map_rows(file)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    anchor_code = batch["booklet_code"]
    if not any(anchor_code in row for row in rows):
        return jsonify({"error": f"Dosyada bu batch'in kitapçık kodu ({anchor_code}) hiçbir satırda yok."}), 400

    question_by_number = {
        r["question_number"]: r["id"]
        for r in db.execute(
            "SELECT id, question_number FROM question_bank WHERE batch_id=?", (batch_id,)
        ).fetchall()
    }

    now = datetime.now().isoformat()
    mapped, skipped = 0, 0
    for row in rows:
        try:
            anchor_num = int(str(row.get(anchor_code, "")).strip())
        except (TypeError, ValueError):
            skipped += 1
            continue
        question_id = question_by_number.get(anchor_num)
        if not question_id:
            skipped += 1
            continue
        for code, value in row.items():
            if code == anchor_code:
                continue
            try:
                num = int(str(value).strip())
            except (TypeError, ValueError):
                continue
            db.execute(
                "INSERT INTO question_booklet_numbers (question_id, booklet_code, question_number, created_at) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT(question_id, booklet_code) DO UPDATE SET question_number=excluded.question_number",
                (question_id, code, num, now),
            )
        mapped += 1
    db.commit()
    return jsonify({"mapped": mapped, "skipped": skipped})


# ============================================================
# Başlatma
# ============================================================

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def print_banner(ip):
    local_url = f"http://localhost:{PORT}"
    network_url = f"http://{ip}:{PORT}"
    print("\n" + "=" * 65)
    print("   📊 LGS DENEME TAKIP SİSTEMİ - YETKİLENDİRMELİ SUNUCU 🔐")
    print("=" * 65)
    print(f"\n  💻 Bu Bilgisayardan (Admin):  {local_url}")
    print(f"  📱 Öğretmen/Veli Girişi     :  {network_url}/login.html")
    print("\n  Sunucuyu durdurmak için: Ctrl + C\n")
    print("=" * 65 + "\n")


def main():
    ip = get_local_ip()
    print_banner(ip)
    try:
        webbrowser.open(f"http://localhost:{PORT}")
    except Exception:
        pass
    app.run(host="0.0.0.0", port=PORT, debug=False)


# gunicorn "server:app" ile MODUL olarak import eder, __name__ != "__main__"
# olur - bu yuzden os.chdir/init_db() burada, kosulsuz, modul yuklenirken
# calisir. --preload olmadan HER worker sureci modulu kendi basina import
# eder (init_db() worker sayisi kadar calisir) - TEK TEK calistiginda
# zararsiz (CREATE TABLE IF NOT EXISTS / idempotent ALTER TABLE), ama AYNI
# ANDA calisirlarsa yarisiyorlar: "if col not in cols: ALTER TABLE" gibi
# check-then-act desenlerinde iki worker de sutunu "yok" gorup ikisi de
# eklemeye kalkinca "duplicate column name" / "database is locked" ile
# worker cokup gunicorn'un onu yeniden baslatmasina yol aciyordu (uretimde
# 2026-09-08'de uc ayri deploy'da gozlemlendi - systemd her seferinde
# otomatik toparladi, veri kaybi olmadi, ama birkac saniyelik kesinti
# riski var). Dosya kilidi (fcntl.flock, POSIX - uretim/staging Linux VM)
# init_db()'yi TEK SEFERDE bir worker'a kilitler; digerleri kilidi
# beklerken sema zaten guncellenmis olur, onlarin kendi init_db()
# cagrilari da idempotent kontroller sayesinde hizli birer no-op'a doner.
os.chdir(BASE_DIR)
try:
    import fcntl
    with open(os.path.join(BASE_DIR, ".init_db.lock"), "w") as _init_db_lock_file:
        fcntl.flock(_init_db_lock_file, fcntl.LOCK_EX)
        init_db()
        fcntl.flock(_init_db_lock_file, fcntl.LOCK_UN)
except ImportError:
    # fcntl Windows'ta yok - yerel gelistirmede tek surec (python server.py)
    # calistigi icin zaten yaris riski olmuyor, kilide gerek yok.
    init_db()

if __name__ == "__main__":
    main()
