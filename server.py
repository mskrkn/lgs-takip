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
import webbrowser
from datetime import datetime
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

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "yetki_veritabani.db")
SECRET_PATH = os.path.join(BASE_DIR, ".flask_secret_key")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
QUESTION_IMAGES_DIR = os.path.join(UPLOADS_DIR, "questions")
PORT = int(os.environ.get("PORT", 8080))

# development / staging / production - her checkout kendi ortamini
# EDUPUSULA_ENV ortam degiskeniyle bildirir (systemd servis dosyasinda
# Environment= ile ayarlanir). production disindaki ortamlarda karisikligi
# onlemek icin sayfalarin basina goze carpan bir seritli banner enjekte
# edilir - kodda dallanma yok, sadece gorsel isaret.
APP_ENV = os.environ.get("EDUPUSULA_ENV", "production")

app = Flask(__name__, static_folder=None)


@app.after_request
def _inject_env_banner(resp):
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
# Veritabanı
# ============================================================

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
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
        org_col_def = ",\n                organization_id INTEGER REFERENCES organizations(id)" if has_org else ""
        org_col_name = ", organization_id" if has_org else ""
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
                created_at TEXT{org_col_def}
            );
            INSERT INTO users_new (id, username, password_hash, role, display_name,
                                    class_name, student_id, active, created_at{org_col_name})
                SELECT id, username, password_hash, role, display_name,
                       class_name, student_id, active, created_at{org_col_name} FROM users;
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

ROLE_SEED = ["SUPER_ADMIN", "PLATFORM_ADMIN", "INSTITUTION_ADMIN", "TEACHER", "PARENT", "STUDENT"]

PERMISSION_SEED = [
    "students.view", "students.create", "students.update", "students.delete",
    "classes.view", "classes.create", "classes.update", "classes.delete",
    "exams.view", "exams.create", "exams.update", "exams.delete",
    "results.view", "analytics.view", "organization.manage", "users.manage",
]

ROLE_PERMISSIONS_SEED = {
    "SUPER_ADMIN": PERMISSION_SEED,
    "PLATFORM_ADMIN": PERMISSION_SEED,
    "INSTITUTION_ADMIN": PERMISSION_SEED,
    "TEACHER": ["students.view", "classes.view", "exams.view", "results.view", "analytics.view"],
    "PARENT": ["results.view", "analytics.view"],
    "STUDENT": ["results.view", "analytics.view"],
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
            slug TEXT UNIQUE NOT NULL,
            logo_url TEXT, email TEXT, phone TEXT, address TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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

        CREATE TABLE IF NOT EXISTS teacher_classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
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
            ip_address TEXT, created_at TEXT NOT NULL
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
                CHECK(status IN ('pending_review','reviewed','excluded','approved')),
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TEXT,
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

    # Var olan kurulumlarda booklet_code sütunu eklenmeden önce oluşturulmuş
    # question_import_batches tablosuna, çoklu kitapçık eşleştirmesinin
    # dayandığı "bu batch hangi kitapçık" bilgisini kaybetmeden ekler.
    batch_cols = [r[1] for r in conn.execute("PRAGMA table_info(question_import_batches)").fetchall()]
    if batch_cols and "booklet_code" not in batch_cols:
        conn.execute("ALTER TABLE question_import_batches ADD COLUMN booklet_code TEXT NOT NULL DEFAULT 'A'")
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
    return (org_row["organization_id"] if org_row and org_row["organization_id"] else None) \
        or _get_default_org_id(db)


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


def _seed_reference_data(conn):
    """Statik referans veriler: kurum, roller, izinler, dersler, eğitim yılı.
    Hepsi INSERT OR IGNORE ile idempotent - tekrar tekrar çağrılması güvenli."""
    now = datetime.now().isoformat()
    org_id = _get_default_org_id(conn)

    # super_admin hicbir okula ait degildir (organization_id = NULL kalmali) -
    # aksi halde her sunucu yeniden baslatmasinda yanlislikla varsayilan
    # okula atanir ve _current_org_id o okula sabitlenmis gibi davranir.
    conn.execute(
        "UPDATE users SET organization_id = ? WHERE organization_id IS NULL AND role != 'super_admin'",
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

    for code, name in SUBJECT_SEED:
        conn.execute("INSERT OR IGNORE INTO subjects (code, name) VALUES (?,?)", (code, name))

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


def init_db():
    os.makedirs(QUESTION_IMAGES_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)

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
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if "user_id" not in session:
                return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
            if role and session.get("role") != role:
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
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/")
def root():
    role = session.get("role")
    if role in ("admin", "super_admin"):
        return _safe_send("index.html")
    if role == "teacher":
        return redirect("/ogretmen.html")
    if role == "parent":
        return redirect("/veli.html")
    if role == "student":
        return redirect("/ogrenci.html")
    return _safe_send("landing.html")


@app.route("/index.html")
def index_html():
    if session.get("role") not in ("admin", "super_admin"):
        return redirect("/login.html")
    return _safe_send("index.html")


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
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user:
        return jsonify({"error": "Kullanıcı adı veya şifre hatalı."}), 401
    ok, needs_rehash = verify_password(user["password_hash"], password)
    if not ok:
        return jsonify({"error": "Kullanıcı adı veya şifre hatalı."}), 401
    if not user["active"]:
        return jsonify({"error": "Bu hesap pasifleştirilmiş. Yöneticinizle iletişime geçin."}), 403
    if needs_rehash:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user["id"]))
        db.commit()

    session.clear()
    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session["display_name"] = user["display_name"]
    session["class_name"] = user["class_name"]
    session["student_id"] = user["student_id"]
    session.permanent = True

    log_audit(db, "LOGIN_SUCCESS", resource_type="user", resource_id=user["id"], user_id=user["id"])

    return jsonify({
        "ok": True, "role": user["role"], "displayName": user["display_name"],
        "className": teacher_class_display(user["class_name"]) if user["role"] == "teacher" else user["class_name"],
        "studentId": user["student_id"],
    })


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    if "user_id" not in session:
        return jsonify({"authenticated": False})
    return jsonify({
        "authenticated": True, "role": session.get("role"),
        "displayName": session.get("display_name"),
        "className": teacher_class_display(session.get("class_name")) if session.get("role") == "teacher" else session.get("class_name"),
        "studentId": session.get("student_id"),
    })


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


@app.route("/api/superadmin/organizations", methods=["GET"])
@login_required(role="super_admin", permission="organization.manage")
def api_superadmin_list_organizations():
    db = get_db()
    rows = db.execute(
        "SELECT o.id, o.name, o.slug, o.email, o.phone, o.address, o.status, o.created_at, "
        "(SELECT COUNT(*) FROM users WHERE organization_id=o.id AND role='admin') AS admin_count, "
        "(SELECT COUNT(*) FROM students WHERE organization_id=o.id) AS student_count "
        "FROM organizations o ORDER BY o.created_at DESC"
    ).fetchall()
    return jsonify([{
        "id": r["id"], "name": r["name"], "slug": r["slug"], "email": r["email"],
        "phone": r["phone"], "address": r["address"], "status": r["status"],
        "createdAt": r["created_at"], "adminCount": r["admin_count"], "studentCount": r["student_count"],
    } for r in rows])


@app.route("/api/superadmin/organizations", methods=["POST"])
@login_required(role="super_admin", permission="organization.manage")
def api_superadmin_create_organization():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    admin_username = (data.get("adminUsername") or "").strip()
    admin_password = data.get("adminPassword") or ""
    admin_display_name = (data.get("adminDisplayName") or "").strip() or admin_username
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None
    address = (data.get("address") or "").strip() or None

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
        "INSERT INTO organizations (name, slug, email, phone, address, status, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (name, slug, email, phone, address, "active", now, now),
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

    db.execute("DELETE FROM students WHERE organization_id=?", (org_id,))
    db.execute("DELETE FROM exams WHERE organization_id=?", (org_id,))
    db.execute("DELETE FROM results WHERE organization_id=?", (org_id,))

    for s in students:
        db.execute(
            "INSERT INTO students (id, organization_id, school_number, first_name, last_name, class_name) "
            "VALUES (?,?,?,?,?,?)",
            (sid(s.get("id")), org_id, s.get("schoolNumber"), s.get("firstName"), s.get("lastName"),
             s.get("className")),
        )
    for e in exams:
        db.execute(
            "INSERT INTO exams (id, organization_id, name, date, exam_type, data_json) VALUES (?,?,?,?,?,?)",
            (sid(e.get("id")), org_id, e.get("name"), e.get("date"), e.get("examType"), json.dumps(e)),
        )
    for r in results:
        db.execute(
            "INSERT INTO results (id, organization_id, student_id, exam_id, data_json) VALUES (?,?,?,?,?)",
            (sid(r.get("id")), org_id, sid(r.get("studentId")), sid(r.get("examId")), json.dumps(r)),
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
# API: Admin - kullanıcı (öğretmen/veli) yönetimi
# ============================================================

@app.route("/api/admin/users", methods=["GET"])
@login_required(role="admin", permission="users.manage")
def api_admin_list_users():
    db = get_db()
    org_id = _current_org_id(db)
    rows = db.execute(
        "SELECT id, username, role, display_name, class_name, student_id, active FROM users "
        "WHERE role != 'admin' AND organization_id = ? ORDER BY role, username",
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
        })
    return jsonify(out)


@app.route("/api/admin/students", methods=["GET"])
@login_required(role="admin", permission="students.view")
def api_admin_students_list():
    db = get_db()
    org_id = _current_org_id(db)
    rows = db.execute(
        "SELECT id, first_name, last_name, class_name FROM students "
        "WHERE organization_id = ? ORDER BY class_name, last_name",
        (org_id,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/users", methods=["POST"])
@login_required(role="admin", permission="users.manage")
def api_admin_create_user():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = data.get("role")
    display_name = (data.get("displayName") or "").strip() or username
    class_name = (data.get("className") or "").strip() or None
    student_id = data.get("studentId") or None
    student_ids = [int(x) for x in (data.get("studentIds") or []) if x]

    if not username or not password or role not in ("teacher", "parent", "student"):
        return jsonify({"error": "Kullanıcı adı, şifre ve geçerli bir rol (teacher/parent/student) gerekli."}), 400
    if role == "teacher" and not class_name:
        return jsonify({"error": "Öğretmen hesabı için sınıf adı gerekli (örn: 8/A)."}), 400
    if role == "parent" and not student_ids:
        return jsonify({"error": "Veli hesabı için en az bir öğrenci seçilmeli."}), 400
    if role == "student" and not student_id:
        return jsonify({"error": "Öğrenci hesabı için bir öğrenci kaydı seçilmeli."}), 400

    db = get_db()
    org_id = _current_org_id(db)
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
        "student_id, organization_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (username, hash_password(password), role, display_name,
         class_name, student_id if role == "student" else None, org_id, datetime.now().isoformat()),
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
@login_required(role="admin", permission="users.manage")
def api_admin_delete_user(user_id):
    db = get_db()
    org_id = _current_org_id(db)
    db.execute(
        "DELETE FROM users WHERE id = ? AND role != 'admin' AND organization_id = ?",
        (user_id, org_id),
    )
    db.commit()
    log_audit(db, "USER_DELETED", resource_type="user", resource_id=user_id)
    return jsonify({"ok": True})


@app.route("/api/admin/users/<int:user_id>/toggle-active", methods=["POST"])
@login_required(role="admin", permission="users.manage")
def api_admin_toggle_active(user_id):
    db = get_db()
    org_id = _current_org_id(db)
    user = db.execute(
        "SELECT active FROM users WHERE id = ? AND role != 'admin' AND organization_id = ?",
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
@login_required(role="admin", permission="users.manage")
def api_admin_reset_password(user_id):
    data = request.get_json(silent=True) or {}
    new_password = data.get("password") or ""
    if len(new_password) < 4:
        return jsonify({"error": "Şifre en az 4 karakter olmalı."}), 400
    db = get_db()
    org_id = _current_org_id(db)
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ? AND role != 'admin' AND organization_id = ?",
        (hash_password(new_password), user_id, org_id),
    )
    db.commit()
    return jsonify({"ok": True})


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
@login_required(role="teacher", permission="students.view")
def api_teacher_overview():
    db = get_db()
    classes = teacher_class_list(session.get("class_name"))
    my_class = "Tüm Sınıflar" if classes is None else ", ".join(classes)

    allowed_ids = get_allowed_student_ids(db)
    if not allowed_ids:
        students = []
    else:
        placeholders = ",".join("?" * len(allowed_ids))
        students = db.execute(
            f"SELECT * FROM students WHERE id IN ({placeholders}) ORDER BY last_name, first_name",
            tuple(allowed_ids)
        ).fetchall()
    exams = db.execute("SELECT id, name, date, exam_type FROM exams ORDER BY date DESC").fetchall()

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

    return jsonify({
        "className": my_class,
        "students": student_list,
        "exams": [dict(e) for e in exams],
        "classAverages": _all_class_averages(db, _current_org_id(db)),
    })


@app.route("/api/teacher/exam/<int:exam_id>")
@login_required(role="teacher", permission="students.view")
def api_teacher_exam_detail(exam_id):
    db = get_db()
    org_id = _current_org_id(db)
    classes = teacher_class_list(session.get("class_name"))
    my_class = "Tüm Sınıflar" if classes is None else ", ".join(classes)

    exam_row = db.execute(
        "SELECT * FROM exams WHERE id = ? AND organization_id = ?", (exam_id, org_id)
    ).fetchone()
    if not exam_row:
        return jsonify({"error": "Deneme bulunamadı."}), 404
    exam_data = json.loads(exam_row["data_json"])

    my_student_ids = get_allowed_student_ids(db) or set()
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

    return jsonify({
        "exam": {"id": exam_row["id"], "name": exam_row["name"], "date": exam_row["date"],
                 "examType": exam_row["exam_type"]},
        "myClassResults": sorted(my_results, key=lambda x: -x["totalNet"]),
        "otherClassAverages": [c for c in _all_class_averages(db, _current_org_id(db), exam_id)
                                if classes is not None and c["className"] not in classes],
        "topicStats": topic_stats,
    })


@app.route("/api/teacher/student/<int:student_id>")
@login_required(role="teacher", permission="students.view")
def api_teacher_student_detail(student_id):
    """Öğretmenin kendi sınıfındaki tek bir öğrencinin ayrıntılı raporu (deneme
    geçmişi, net trendi, konu analizi, Başarı Pusulası) - veli tarafındaki
    _build_student_report ile aynı veri şekli, yalnızca kendi sınıfıyla
    sınırlı erişim (bkz. can_view_student -> get_allowed_student_ids)."""
    db = get_db()
    if not can_view_student(db, student_id):
        return jsonify({"error": "Bu öğrenciye erişim yetkiniz yok."}), 403
    report = _build_student_report(db, student_id)
    if not report:
        return jsonify({"error": "Öğrenci kaydı bulunamadı."}), 404
    return jsonify(report)


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


def _build_student_report(db, student_id):
    """Tek bir öğrencinin deneme geçmişi + konu analizi + güçlü/zayıf ders özeti.
    /api/parent/child/<id> ve /api/student/overview tarafından ortak kullanılır."""
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
    if result_rows:
        latest = result_rows[-1]
        exam_data = json.loads(latest["exam_json"])
        latest_result_data = json.loads(latest["data_json"])
        qs = build_question_stats(exam_data, [latest_result_data])
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


@app.route("/api/admin/question-bank/upload", methods=["POST"])
@login_required(role="admin")
def api_question_bank_upload():
    file = request.files.get("file")
    if not file or not (file.filename or "").lower().endswith(".pdf"):
        return jsonify({"error": "Geçerli bir PDF dosyası seçin."}), 400

    subject_code = (request.form.get("subject_code") or "").strip()
    if not subject_code:
        return jsonify({"error": "Ders seçimi gerekli."}), 400

    booklet_code = (request.form.get("booklet_code") or "A").strip().upper()[:1] or "A"

    db = get_db()
    subject_row = db.execute("SELECT id FROM subjects WHERE code=?", (subject_code,)).fetchone()
    if not subject_row:
        return jsonify({"error": "Geçersiz ders."}), 400
    subject_id = subject_row["id"]
    user_id = session["user_id"]
    org_id = _current_org_id(db)

    now = datetime.now().isoformat()
    safe_name = secure_filename(file.filename) or "yuklenen.pdf"
    cur = db.execute(
        "INSERT INTO question_import_batches (organization_id, uploaded_by, source_filename, status, booklet_code, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (org_id, user_id, safe_name, "processing", booklet_code, now),
    )
    batch_id = cur.lastrowid
    db.commit()

    source_dir = os.path.join(UPLOADS_DIR, "source_pdfs")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(QUESTION_IMAGES_DIR, exist_ok=True)
    pdf_path = os.path.join(source_dir, f"batch_{batch_id}.pdf")
    file.save(pdf_path)

    try:
        result = pdf_question_extractor.extract_questions(pdf_path)
        if result["page_count"] > _MAX_PDF_PAGES:
            raise ValueError(f"PDF çok uzun ({result['page_count']} sayfa, sınır {_MAX_PDF_PAGES}).")
    except Exception as exc:
        db.execute("UPDATE question_import_batches SET status='failed' WHERE id=?", (batch_id,))
        db.commit()
        return jsonify({"error": f"PDF işlenemedi: {exc}"}), 400

    created = []
    for q in result["questions"]:
        image_filename = f"{batch_id}_{q['number']}.png"
        pdf_question_extractor.render_question_crop(
            pdf_path, q["page"], q["rect"], os.path.join(QUESTION_IMAGES_DIR, image_filename)
        )
        answer = result["answer_key"].get(q["number"])
        rect = q["rect"]
        qcur = db.execute(
            "INSERT INTO question_bank (organization_id, batch_id, subject_id, image_path, "
            "question_number, source_page_number, crop_x, crop_y, crop_width, crop_height, "
            "correct_answer, correct_answer_source, status, created_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (org_id, batch_id, subject_id, f"questions/{image_filename}",
             q["number"], q["page"] + 1, rect.x0, rect.y0, rect.width, rect.height,
             answer, "answer_key" if answer else None, "pending_review", user_id, now, now),
        )
        created.append({
            "id": qcur.lastrowid, "number": q["number"], "correctAnswer": answer,
            "imageUrl": f"/api/admin/question-bank/image/{qcur.lastrowid}",
        })

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
    })


@app.route("/api/admin/question-bank/batches")
@login_required(role="admin")
def api_question_bank_batches():
    db = get_db()
    org_id = _current_org_id(db)
    rows = db.execute(
        "SELECT b.id, b.source_filename, b.status, b.page_count, b.booklet_code, b.created_at, "
        "COUNT(q.id) AS question_count, "
        "SUM(CASE WHEN q.status='pending_review' THEN 1 ELSE 0 END) AS pending_count, "
        "SUM(CASE WHEN q.status='approved' THEN 1 ELSE 0 END) AS approved_count "
        "FROM question_import_batches b LEFT JOIN question_bank q ON q.batch_id = b.id "
        "WHERE b.organization_id=? GROUP BY b.id ORDER BY b.id DESC",
        (org_id,),
    ).fetchall()
    return jsonify({"batches": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/batches/<int:batch_id>")
@login_required(role="admin")
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
        "SELECT id, subject_id, question_number, source_page_number, crop_x, crop_y, "
        "crop_width, crop_height, correct_answer, correct_answer_source, explanation, "
        "status, topic_id, learning_outcome_id, difficulty_level, question_type, display_code "
        "FROM question_bank WHERE batch_id=? ORDER BY question_number, id",
        (batch_id,),
    ).fetchall()
    questions = []
    for r in rows:
        item = dict(r)
        item["imageUrl"] = f"/api/admin/question-bank/image/{r['id']}"
        questions.append(item)
    return jsonify({"batch": dict(batch), "questions": questions})


def _get_owned_question(db, question_id, org_id):
    return db.execute(
        "SELECT * FROM question_bank WHERE id=? AND organization_id=?", (question_id, org_id)
    ).fetchone()


def _source_pdf_path(batch_id):
    return os.path.join(UPLOADS_DIR, "source_pdfs", f"batch_{batch_id}.pdf")


@app.route("/api/admin/question-bank/batches/<int:batch_id>", methods=["DELETE"])
@login_required(role="admin")
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
@login_required(role="admin")
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
@login_required(role="admin")
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
@login_required(role="admin")
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


_QUESTION_STATUSES = ("pending_review", "reviewed", "excluded", "approved")


def _apply_question_status(db, row, status, user_id):
    """question_bank satırının durumunu değiştirir; 'approved' olduğunda
    henüz display_code atanmamışsa <DERS_KODU>-00001 kalıbıyla üretir.
    Hem tekil PATCH hem toplu bulk-update endpoint'i bu fonksiyonu kullanır."""
    now = datetime.now().isoformat()
    db.execute(
        "UPDATE question_bank SET status=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?",
        (status, user_id, now, now, row["id"]),
    )
    display_code = row["display_code"]
    if status == "approved" and not display_code:
        subject_row = db.execute("SELECT code FROM subjects WHERE id=?", (row["subject_id"],)).fetchone()
        subject_code = (subject_row["code"] if subject_row else "soru").upper()
        display_code = f"{subject_code}-{row['id']:05d}"
        db.execute("UPDATE question_bank SET display_code=? WHERE id=?", (display_code, row["id"]))
    return display_code


@app.route("/api/admin/question-bank/questions/<int:question_id>", methods=["PATCH"])
@login_required(role="admin")
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
    ):
        if key in data:
            fields.append(f"{column}=?")
            params.append(data[key] or None)

    if "correctAnswer" in data:
        fields.append("correct_answer=?")
        params.append((data["correctAnswer"] or "").strip() or None)
        fields.append("correct_answer_source=?")
        params.append("edited")

    status = data.get("status")
    if status and status not in _QUESTION_STATUSES:
        return jsonify({"error": "Geçersiz durum."}), 400

    if not fields and not status:
        return jsonify({"error": "Güncellenecek alan gönderilmedi."}), 400

    if fields:
        fields.append("updated_at=?")
        params.append(datetime.now().isoformat())
        params.append(question_id)
        db.execute(f"UPDATE question_bank SET {', '.join(fields)} WHERE id=?", params)

    display_code = row["display_code"]
    if status:
        display_code = _apply_question_status(db, row, status, session["user_id"])

    db.commit()
    return jsonify({"ok": True, "displayCode": display_code})


@app.route("/api/admin/question-bank/questions/bulk-update", methods=["PATCH"])
@login_required(role="admin")
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

    db = get_db()
    org_id = _current_org_id(db)
    user_id = session["user_id"]
    updated = 0
    for qid in question_ids:
        row = _get_owned_question(db, qid, org_id)
        if not row:
            continue
        _apply_question_status(db, row, status, user_id)
        updated += 1
    db.commit()
    return jsonify({"updated": updated})


@app.route("/api/admin/question-bank/topics")
@login_required(role="admin")
def api_question_bank_topics():
    db = get_db()
    subject_id = request.args.get("subject_id", type=int)
    if not subject_id:
        return jsonify({"error": "subject_id gerekli."}), 400
    rows = db.execute(
        "SELECT id, name FROM topics WHERE subject_id=? ORDER BY name", (subject_id,)
    ).fetchall()
    return jsonify({"topics": [dict(r) for r in rows]})


@app.route("/api/admin/question-bank/topics", methods=["POST"])
@login_required(role="admin")
def api_question_bank_create_topic():
    db = get_db()
    data = request.get_json(silent=True) or {}
    subject_id = data.get("subjectId")
    name = (data.get("name") or "").strip()
    if not subject_id or not name:
        return jsonify({"error": "subjectId ve name gerekli."}), 400
    now = datetime.now().isoformat()
    db.execute(
        "INSERT OR IGNORE INTO topics (subject_id, name, created_at) VALUES (?,?,?)",
        (subject_id, name, now),
    )
    db.commit()
    row = db.execute(
        "SELECT id, name FROM topics WHERE subject_id=? AND name=?", (subject_id, name)
    ).fetchone()
    return jsonify(dict(row))


@app.route("/api/admin/question-bank/learning-outcomes")
@login_required(role="admin")
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
@login_required(role="admin")
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


@app.route("/api/admin/question-bank/export")
@login_required(role="admin")
def api_question_bank_export():
    """Onaylanmış soruları (status='approved') resim + manifest.csv olarak
    tek bir ZIP'te indirir - havuza kesin girmiş sorular dışındakiler
    (pending_review/reviewed/excluded) dahil edilmez."""
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
        "WHERE q.organization_id=? AND q.status='approved'"
    )
    params = [org_id]
    if subject_id:
        query += " AND q.subject_id=?"
        params.append(subject_id)
    query += " ORDER BY s.name, q.question_number, q.id"
    rows = db.execute(query, params).fetchall()

    if not rows:
        return jsonify({"error": "Dışa aktarılacak onaylanmış soru bulunamadı."}), 404

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
@login_required(role="admin")
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
@login_required(role="admin")
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
@login_required(role="admin")
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
    os.chdir(BASE_DIR)
    init_db()
    ip = get_local_ip()
    print_banner(ip)
    try:
        webbrowser.open(f"http://localhost:{PORT}")
    except Exception:
        pass
    app.run(host="0.0.0.0", port=PORT, debug=False)


if __name__ == "__main__":
    main()
