"""Okul Kokpiti - sunucu katmani (ozet tablo + API + aksiyonlar + raporlar).

server.py yalnizca `kokpit.register(app, sys.modules[__name__])` ve
`kokpit.init_schema(DB_PATH)` cagirir; bu modul server'in yardimcilarini
(get_db, has_permission, _admin_subrole, ...) o modul nesnesi uzerinden kullanir
(python server.py ile calisinca modul adi __main__ oldugu icin `import server`
ikinci bir kopya yaratirdi).

Kokpit mevcut ekranlardan YALNIZCA OKUR (students/exams/results/question_bank)
ve sadece kendi tablolarina, `notifications` tablosuna (panel ici bildirim) ve
kendi taslak odev tablosuna yazar. Gercek odev, ogretmen taslagi onaylayinca
mevcut POST /api/teacher/assignments ucuyla olusturulur.

Ozet tablo (sartname 10.2): results/exams/students tablolarindaki her degisiklik
SQLite tetikleyicileriyle ilgili denemeyi `kokpit_kirli`ye isaretler; kokpit
okunurken yalnizca kirli denemelerin ozet satirlari yeniden kurulur. Boylece
mevcut yazma yollarinin (senkron, sihirbaz, OMR, ogretmen girisi) hicbirine
dokunulmaz, acilis ekrani her seferinde tum sonuclari JSON'dan cozmez.
"""
import hashlib
import hmac
import io
import json
import os
import re
import sqlite3
import threading
import time
import uuid
import zipfile
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, redirect, request, send_file, session

import kokpit_hesap as K

S = None  # server modulu (register ile atanir)
bp = Blueprint("kokpit", __name__)

RAPOR_DIR_ADI = ".kokpit_raporlar"   # nokta ile baslar -> statik sunumda engelli
RAPOR_LINK_OMRU = 600                # imzali indirme baglantisi (sn)
ONAY_OMRU = 1800                     # onizleme -> gonderim arasi en fazla (sn)

SCHEMA = """
CREATE TABLE IF NOT EXISTS kokpit_meta (anahtar TEXT PRIMARY KEY, deger TEXT);
CREATE TABLE IF NOT EXISTS kokpit_kirli (
    exam_id INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS kokpit_deneme (
    exam_id INTEGER PRIMARY KEY,
    organization_id INTEGER,
    ad TEXT, tarih TEXT, grade TEXT, genel INTEGER NOT NULL DEFAULT 1,
    soru_json TEXT, katilan INTEGER NOT NULL DEFAULT 0, eksik_karne INTEGER NOT NULL DEFAULT 0,
    anahtar_var INTEGER NOT NULL DEFAULT 0, kazanim_durumu TEXT,
    built_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kokpit_deneme_org ON kokpit_deneme(organization_id);
CREATE TABLE IF NOT EXISTS kokpit_ozet (
    organization_id INTEGER NOT NULL, exam_id INTEGER NOT NULL, grade TEXT,
    class_name TEXT NOT NULL, subject TEXT NOT NULL,
    n INTEGER NOT NULL, sum_d REAL NOT NULL, sum_y REAL NOT NULL, sum_b REAL NOT NULL,
    sum_net REAL NOT NULL, sum_q REAL NOT NULL, sum_puan REAL NOT NULL, n_puan INTEGER NOT NULL,
    PRIMARY KEY (exam_id, class_name, subject)
);
CREATE INDEX IF NOT EXISTS idx_kokpit_ozet_org ON kokpit_ozet(organization_id, grade);
CREATE TABLE IF NOT EXISTS kokpit_ogrenci (
    organization_id INTEGER NOT NULL, exam_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
    class_name TEXT, grade TEXT, toplam_net REAL, d REAL, y REAL, b REAL, puan REAL,
    ders_json TEXT, eksik INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_kokpit_ogrenci_org ON kokpit_ogrenci(organization_id, grade);
CREATE TABLE IF NOT EXISTS kokpit_ayarlar (
    organization_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL, updated_at TEXT, updated_by INTEGER
);
CREATE TABLE IF NOT EXISTS kokpit_aksiyonlar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL, user_id INTEGER, tur TEXT NOT NULL,
    uyari_kodu TEXT, uyari_anahtari TEXT, hedef_json TEXT, metin TEXT,
    alici_json TEXT, alici_sayisi INTEGER NOT NULL DEFAULT 0, sonuc_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kokpit_aksiyon_org ON kokpit_aksiyonlar(organization_id, uyari_anahtari);
CREATE TABLE IF NOT EXISTS kokpit_odev_taslaklari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL, class_name TEXT NOT NULL,
    subject TEXT, title TEXT NOT NULL, description TEXT, mode TEXT NOT NULL DEFAULT 'auto',
    question_ids_json TEXT, question_count INTEGER, kazanimlar_json TEXT,
    status TEXT NOT NULL DEFAULT 'taslak', assignment_id INTEGER,
    aksiyon_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kokpit_taslak_ogretmen ON kokpit_odev_taslaklari(teacher_id, status);
CREATE TABLE IF NOT EXISTS kokpit_rapor_isleri (
    id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    format TEXT NOT NULL, filtre_json TEXT, durum TEXT NOT NULL, hata TEXT, dosya TEXT,
    created_at TEXT NOT NULL, finished_at TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_kokpit_results_ins AFTER INSERT ON results BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) SELECT NEW.exam_id WHERE NEW.exam_id IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_results_upd AFTER UPDATE ON results BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) SELECT NEW.exam_id WHERE NEW.exam_id IS NOT NULL;
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) SELECT OLD.exam_id WHERE OLD.exam_id IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_results_del AFTER DELETE ON results BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) SELECT OLD.exam_id WHERE OLD.exam_id IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_exams_ins AFTER INSERT ON exams BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) VALUES (NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_exams_upd AFTER UPDATE ON exams BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) VALUES (NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_exams_del AFTER DELETE ON exams BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id) VALUES (OLD.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_students_upd AFTER UPDATE OF class_name ON students BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id)
        SELECT DISTINCT exam_id FROM results WHERE student_id = NEW.id AND exam_id IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_kokpit_students_del AFTER DELETE ON students BEGIN
    INSERT OR IGNORE INTO kokpit_kirli(exam_id)
        SELECT DISTINCT exam_id FROM results WHERE student_id = OLD.id AND exam_id IS NOT NULL;
END;
"""


def init_schema(db_path):
    """Kokpit tablolari + tetikleyiciler (idempotent). notifications tablosuna
    baglanti/okul/kaynak sutunlari eklenir (tablo bugune kadar hic kullanilmiyordu)."""
    conn = sqlite3.connect(db_path, timeout=20)
    try:
        conn.executescript(SCHEMA)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(notifications)").fetchall()]
        if cols:
            for col in ("link", "organization_id", "kaynak"):
                if col not in cols:
                    conn.execute(f"ALTER TABLE notifications ADD COLUMN {col} {'INTEGER' if col == 'organization_id' else 'TEXT'}")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)")
        r = conn.execute("SELECT deger FROM kokpit_meta WHERE anahtar = 'hesap_surumu'").fetchone()
        if not r or r[0] != K.HESAP_SURUMU:
            # hesap kurali degisti: tum ozet satirlari bir sonraki okumada yeniden kurulur
            conn.execute("INSERT OR IGNORE INTO kokpit_kirli(exam_id) SELECT id FROM exams")
            conn.execute("INSERT OR REPLACE INTO kokpit_meta VALUES ('hesap_surumu', ?)", (K.HESAP_SURUMU,))
        conn.commit()
    finally:
        conn.close()


def register(app, server_module):
    global S
    S = server_module
    app.register_blueprint(bp)


# ================================================================ yetki
class _Red(Exception):
    def __init__(self, mesaj, kod):
        super().__init__(mesaj)
        self.mesaj, self.kod = mesaj, kod


def _yetki(db, okul_id, analiz=True, aksiyon=False):
    """Sartname 2: (kapsam) doner ya da _Red firlatir.
    kapsam: 'platform' (Super Admin / Admin Yardimcisi, Aktif Okul ile her okul),
            'okul' (Okul Admini, yalniz kendi okulu), 'veri' (Veri Giris Admini,
            yalniz Veri Durumu). Ogretmen/ogrenci/veli: 403."""
    if "user_id" not in session:
        raise _Red("Giriş yapmanız gerekiyor.", 401)
    rol = session.get("role")
    if rol not in ("admin", "super_admin"):
        raise _Red("Okul Kokpiti yalnızca okul yöneticilerine açıktır.", 403)
    uid = session["user_id"]
    if not db.execute("SELECT 1 FROM organizations WHERE id = ?", (okul_id,)).fetchone():
        raise _Red("Okul bulunamadı.", 404)
    if rol == "super_admin" or S.has_permission(db, uid, "organization.manage"):
        kapsam = "platform"
    else:
        own = db.execute("SELECT organization_id FROM users WHERE id = ?", (uid,)).fetchone()
        if not own or own["organization_id"] != okul_id:
            raise _Red("Bu okulun verisine erişim yetkiniz yok.", 403)
        kapsam = "veri" if S._admin_subrole(db, uid, rol) == "DATA_ADMIN" else "okul"
    if kapsam == "veri" and (analiz or aksiyon):
        raise _Red("Veri Giriş Admini yalnızca Veri Durumu ekranını görebilir.", 403)
    return kapsam


def _korumali(analiz=True, aksiyon=False):
    def deco(fn):
        def wrapper(okul_id, *a, **kw):
            db = S.get_db()
            try:
                kapsam = _yetki(db, okul_id, analiz=analiz, aksiyon=aksiyon)
            except _Red as e:
                return jsonify({"error": e.mesaj}), e.kod
            return fn(db, okul_id, kapsam, *a, **kw)
        wrapper.__name__ = fn.__name__
        return wrapper
    return deco


# ================================================================ ozet tablo
def _grade(cls):
    m = re.match(r"^\s*(\d+)", cls or "")
    return m.group(1) if m else None


def _kazanim_durumu(data, sorular):
    tmap = data.get("topicMap") or {}
    if not tmap:
        return "yok"
    for k, q in sorular.items():
        entries = tmap.get(k) or []
        if len(entries) < q or any(not (e or {}).get("kazanim") for e in entries[:q]):
            return "eksik"
    return "tam"


def ozet_guncelle(db, org_id):
    """Okulun kirli/eksik denemelerinin ozet satirlarini yeniden kurar.
    Donus: yeniden kurulan deneme sayisi."""
    hedef = {r[0] for r in db.execute(
        "SELECT k.exam_id FROM kokpit_kirli k LEFT JOIN exams e ON e.id = k.exam_id "
        "WHERE e.organization_id = ? OR e.id IS NULL", (org_id,)).fetchall()}
    hedef |= {r[0] for r in db.execute(
        "SELECT e.id FROM exams e LEFT JOIN kokpit_deneme d ON d.exam_id = e.id "
        "WHERE e.organization_id = ? AND d.exam_id IS NULL", (org_id,)).fetchall()}
    if not hedef:
        return 0
    ogrenci = {r["id"]: r["class_name"] for r in db.execute(
        "SELECT id, class_name FROM students WHERE organization_id = ?", (org_id,)).fetchall()}
    simdi = datetime.now().isoformat(timespec="seconds")
    for exam_id in hedef:
        for t in ("kokpit_ozet", "kokpit_ogrenci", "kokpit_deneme"):
            db.execute(f"DELETE FROM {t} WHERE exam_id = ?", (exam_id,))
        e = db.execute("SELECT id, name, date, exam_type, data_json, organization_id FROM exams WHERE id = ?",
                       (exam_id,)).fetchone()
        if not e or e["organization_id"] != org_id:
            continue
        data = json.loads(e["data_json"]) if e["data_json"] else {}
        sorular = K.soru_sayilari(data.get("questionCounts"))
        genel = 0 if e["exam_type"] == "optik_kamera" else 1
        acc, satirlar, grade_say, eksik = {}, [], {}, 0
        if genel:
            for r in db.execute("SELECT student_id, data_json FROM results WHERE exam_id = ?", (exam_id,)).fetchall():
                sid = r["student_id"]
                if sid not in ogrenci:
                    continue
                veri = json.loads(r["data_json"]) if r["data_json"] else {}
                o = K.sonuc_ozeti(veri, sorular)
                cls = ogrenci[sid] or "(Şubesiz)"
                g = _grade(cls)
                grade_say[g] = grade_say.get(g, 0) + 1
                eksik += 1 if o["eksik"] else 0
                satirlar.append((org_id, exam_id, sid, cls, g, o["toplamNet"], o["d"], o["y"], o["b"], o["puan"],
                                 json.dumps({k: [v["d"], v["y"], v["b"], v["net"]] for k, v in o["dersler"].items()}),
                                 1 if o["eksik"] else 0))
                for k, v in o["dersler"].items():
                    a = acc.setdefault((cls, g, k), [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0])
                    a[0] += 1; a[1] += v["d"]; a[2] += v["y"]; a[3] += v["b"]; a[4] += v["net"]; a[5] += sorular.get(k, 0)
                a = acc.setdefault((cls, g, "*"), [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0])
                a[0] += 1; a[1] += o["d"]; a[2] += o["y"]; a[3] += o["b"]; a[4] += o["toplamNet"]
                a[5] += sum(sorular.values())
                if o["puan"] is not None:
                    a[6] += o["puan"]; a[7] += 1
        grade = str(data.get("gradeLevel")) if data.get("gradeLevel") else None
        if not grade and grade_say:
            top, cnt = max(grade_say.items(), key=lambda kv: kv[1])
            if top and cnt / max(1, sum(grade_say.values())) >= 0.6:
                grade = top
        db.executemany("INSERT OR REPLACE INTO kokpit_ogrenci VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", satirlar)
        db.executemany(
            "INSERT OR REPLACE INTO kokpit_ozet VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(org_id, exam_id, g, cls, k, *a) for (cls, g, k), a in acc.items()])
        ak = data.get("answerKey") or {}
        db.execute(
            "INSERT OR REPLACE INTO kokpit_deneme VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (exam_id, org_id, e["name"], (e["date"] or "")[:10], grade, genel, json.dumps(sorular), len(satirlar),
             eksik, 1 if (ak.get("A") if isinstance(ak, dict) else ak) else 0,
             _kazanim_durumu(data, sorular), simdi))
    db.executemany("DELETE FROM kokpit_kirli WHERE exam_id = ?", [(x,) for x in hedef])
    db.commit()
    return len(hedef)


# ================================================================ veri yukleme
def _ayarlar(db, org_id):
    r = db.execute("SELECT data_json FROM kokpit_ayarlar WHERE organization_id = ?", (org_id,)).fetchone()
    try:
        kayitli = json.loads(r["data_json"]) if r else {}
    except ValueError:
        kayitli = {}
    return K.ayarlari_birlestir(kayitli), kayitli


def _okul_verisi(db, org_id, seviye=None):
    """Secili seviyenin denemeleri + ozet satirlari + katilim demetleri."""
    ozet_guncelle(db, org_id)
    ogrenciler = db.execute(
        "SELECT id, first_name, last_name, school_number, class_name FROM students WHERE organization_id = ?",
        (org_id,)).fetchall()
    seviye_say = {}
    for s in ogrenciler:
        g = _grade(s["class_name"])
        if g:
            seviye_say[g] = seviye_say.get(g, 0) + 1
    tum_denemeler = [dict(r) for r in db.execute(
        "SELECT * FROM kokpit_deneme WHERE organization_id = ? AND genel = 1 ORDER BY tarih, exam_id",
        (org_id,)).fetchall()]
    # seviye -> o seviyeden katilimcisi olan denemeler
    katilim_sev = {}
    for r in db.execute("SELECT exam_id, grade, SUM(n) n FROM kokpit_ozet WHERE organization_id = ? AND subject = '*' "
                        "GROUP BY exam_id, grade", (org_id,)).fetchall():
        katilim_sev.setdefault(r["grade"], {})[r["exam_id"]] = r["n"]
    seviyeler = sorted({g for g in katilim_sev if g} | {d["grade"] for d in tum_denemeler if d["grade"]}, key=int)
    if not seviye or seviye not in seviyeler:
        # varsayilan: en son deneme yapilan seviye
        son = None
        for d in tum_denemeler:
            g = d["grade"]
            if g and (son is None or (d["tarih"], d["exam_id"]) >= (son[0], son[1])):
                son = (d["tarih"], d["exam_id"], g)
        seviye = son[2] if son else (seviyeler[-1] if seviyeler else None)
    ks = katilim_sev.get(seviye, {})
    denemeler = []
    for d in tum_denemeler:
        if d["grade"] == seviye or (d["grade"] is None and (ks.get(d["exam_id"]) or d["katilan"] == 0)):
            d["katilanSeviye"] = ks.get(d["exam_id"], 0)
            d["sorular"] = json.loads(d["soru_json"] or "{}")
            denemeler.append(d)
    ozet = [dict(r) for r in db.execute(
        "SELECT * FROM kokpit_ozet WHERE organization_id = ? AND grade IS ?", (org_id, seviye)).fetchall()]
    katilim = [(r["exam_id"], r["student_id"], r["class_name"]) for r in db.execute(
        "SELECT exam_id, student_id, class_name FROM kokpit_ogrenci WHERE organization_id = ? AND grade IS ?",
        (org_id, seviye)).fetchall()]
    kayitli = [s for s in ogrenciler if _grade(s["class_name"]) == seviye]
    return {"seviye": seviye, "seviyeler": seviyeler, "denemeler": denemeler, "ozet": ozet,
            "katilim": katilim, "kayitli": kayitli, "seviyeSayilari": seviye_say}


def _donem(veri):
    a = request.args
    return K.donem_coz(a.get("donem"), [d["tarih"] for d in veri["denemeler"] if d["katilanSeviye"]],
                       bas=a.get("bas"), bit=a.get("bit"))


def _ids(denemeler, aralik, yalniz_yuklu=True):
    return {d["exam_id"] for d in denemeler if K.aralikta(d["tarih"], aralik)
            and (d["katilanSeviye"] or not yalniz_yuklu)}


def _katilim_listesi(denemeler, aralik, kayitli):
    return [{"id": d["exam_id"], "ad": d["ad"], "tarih": d["tarih"], "katilan": d["katilanSeviye"],
             "kayitli": kayitli, "eksikKarne": d["eksik_karne"]}
            for d in denemeler if K.aralikta(d["tarih"], aralik)]


def _donem_secenekleri(veri, donem):
    yuklu = [d for d in veri["denemeler"] if d["katilanSeviye"]]
    ey = donem["egitimYili"].split("–")[0]
    yb, ye = f"{ey}-09-01", f"{int(ey) + 1}-08-31"
    yil = [d for d in yuklu if yb <= d["tarih"] <= ye]
    out = [{"kod": "tum", "etiket": f"Tüm dönem ({len(yil)} deneme)"}]
    aylar = {}
    for d in yil:
        aylar[d["tarih"][:7]] = aylar.get(d["tarih"][:7], 0) + 1
    for ay in sorted(aylar, reverse=True):
        out.append({"kod": ay, "etiket": f"{K.AY_AD[int(ay[5:])]} ({aylar[ay]} deneme)"})
    out.append({"kod": "ozel", "etiket": "Özel aralık"})
    return out


def _analiz_paketi(db, org_id, veri, donem, ayar):
    d = veri["denemeler"]
    cur_ids = _ids(d, donem["secili"])
    once_ids = _ids(d, donem["once"]) if donem["once"] else set()
    sonra_ids = _ids(d, donem["sonra"]) if donem["sonra"] else set()
    cur = K.istatistik(veri["ozet"], veri["katilim"], cur_ids)
    once = K.istatistik(veri["ozet"], veri["katilim"], once_ids) if once_ids else None
    sonra = K.istatistik(veri["ozet"], veri["katilim"], sonra_ids) if sonra_ids else None
    katilim = _katilim_listesi(d, donem["secili"], len(veri["kayitli"]))
    capa = (donem["sonra"] or donem["secili"])["bas"][:7] if donem["kod"] != "ozel" else \
        donem["secili"]["bas"] + "_" + donem["secili"]["bit"]
    analiz = K.acilis_analizi(cur, once, sonra, katilim, ayar, dict(donem, kod=capa))
    return cur, once, sonra, katilim, analiz


def _veri_durumu_paketi(veri, donem):
    katilim = _katilim_listesi(veri["denemeler"], donem["secili"], len(veri["kayitli"]))
    vd = K.veri_durumu(katilim)
    vd["yuklenmemis"] = [{"id": x["id"], "ad": x["ad"], "tarih": x["tarih"]} for x in vd["yuklenmemis"]]
    return vd


def _aksiyon_gecmisi(db, org_id, anahtarlar):
    if not anahtarlar:
        return {}
    ph = ",".join("?" * len(anahtarlar))
    out = {}
    for r in db.execute(
            f"SELECT uyari_anahtari, tur, created_at, alici_sayisi FROM kokpit_aksiyonlar WHERE organization_id = ? "
            f"AND uyari_anahtari IN ({ph}) ORDER BY id", (org_id, *anahtarlar)).fetchall():
        out[r["uyari_anahtari"]] = {"tur": r["tur"], "tarih": r["created_at"], "aliciSayisi": r["alici_sayisi"]}
    return out


def _okul_adi(db, org_id):
    r = db.execute("SELECT name FROM organizations WHERE id = ?", (org_id,)).fetchone()
    return r["name"] if r else ""


def acilis_verisi(db, org_id, kapsam, seviye=None, args=None):
    t0 = time.perf_counter()
    veri = _okul_verisi(db, org_id, seviye)
    donem = _donem(veri) if args is None else K.donem_coz(
        args.get("donem"), [d["tarih"] for d in veri["denemeler"] if d["katilanSeviye"]],
        bas=args.get("bas"), bit=args.get("bit"))
    ayar, _ = _ayarlar(db, org_id)
    yuklu_cur = [d for d in veri["denemeler"] if d["katilanSeviye"] and K.aralikta(d["tarih"], donem["secili"])]
    son = yuklu_cur[-1] if yuklu_cur else None
    out = {
        "okul": {"id": org_id, "ad": _okul_adi(db, org_id)},
        "kapsam": kapsam,
        "yetki": {"analiz": kapsam != "veri", "aksiyon": kapsam in ("platform", "okul")},
        "seviye": veri["seviye"], "seviyeler": veri["seviyeler"], "kayitli": len(veri["kayitli"]),
        "donem": donem, "donemSecenekleri": _donem_secenekleri(veri, donem),
        "sonDeneme": {"id": son["exam_id"], "ad": son["ad"], "tarih": son["tarih"]} if son else None,
        "degerlendirilen": len(yuklu_cur),
        "veriDurumu": _veri_durumu_paketi(veri, donem),
        "lgsPuaniYaklasik": True,
    }
    if kapsam != "veri":
        _, _, _, _, analiz = _analiz_paketi(db, org_id, veri, donem, ayar)
        out.update(analiz)
        out["ayarlar"] = ayar
        out["aksiyonGecmisi"] = _aksiyon_gecmisi(db, org_id, [u["anahtar"] for u in analiz["uyarilar"]])
    out["sureMs"] = round((time.perf_counter() - t0) * 1000, 1)
    return out


# ================================================================ sayfa + okul listesi
@bp.route("/okul-kokpiti.html")
def kokpit_sayfasi():
    if session.get("role") not in ("admin", "super_admin"):
        return redirect("/login.html")
    return S._safe_send("okul-kokpiti.html")


@bp.route("/kokpit-taslak.html")
def taslak_sayfasi():
    if session.get("role") not in ("teacher", "admin", "super_admin"):
        return redirect("/login.html")
    return S._safe_send("kokpit-taslak.html")


@bp.route("/api/kokpit/okullar")
def api_okullar():
    """Kokpit acilisi icin okul secenekleri: Okul/Veri Admini -> kendi okulu,
    platform hesabi -> tum aktif okullar (Aktif Okul secicisi)."""
    if "user_id" not in session:
        return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
    if session.get("role") not in ("admin", "super_admin"):
        return jsonify({"error": "Okul Kokpiti yalnızca okul yöneticilerine açıktır."}), 403
    db = S.get_db()
    uid = session["user_id"]
    own = db.execute("SELECT organization_id FROM users WHERE id = ?", (uid,)).fetchone()
    own_id = own["organization_id"] if own else None
    platform = session.get("role") == "super_admin" or S.has_permission(db, uid, "organization.manage")
    if platform:
        rows = db.execute("SELECT id, name FROM organizations WHERE COALESCE(status,'active') != 'archived' "
                          "ORDER BY name").fetchall()
    else:
        rows = db.execute("SELECT id, name FROM organizations WHERE id = ?", (own_id,)).fetchall()
    kapsam = "platform" if platform else (
        "veri" if S._admin_subrole(db, uid, session.get("role")) == "DATA_ADMIN" else "okul")
    return jsonify({"okullar": [{"id": r["id"], "ad": r["name"]} for r in rows], "kendiOkulu": own_id,
                    "kapsam": kapsam})


# ================================================================ acilis ekrani
@bp.route("/api/okullar/<int:okul_id>/kokpit")
def api_kokpit(okul_id):
    db = S.get_db()
    try:
        kapsam = _yetki(db, okul_id, analiz=False)
    except _Red as e:
        return jsonify({"error": e.mesaj}), e.kod
    return jsonify(acilis_verisi(db, okul_id, kapsam, request.args.get("seviye")))


@bp.route("/api/okullar/<int:okul_id>/kokpit/katilmayanlar")
@_korumali()
def api_katilmayanlar(db, okul_id, kapsam):
    exam_id = request.args.get("deneme", type=int)
    veri = _okul_verisi(db, okul_id, request.args.get("seviye"))
    d = next((x for x in veri["denemeler"] if x["exam_id"] == exam_id), None)
    if not d:
        return jsonify({"error": "Deneme bulunamadı."}), 404
    girenler = {sid for e, sid, _ in veri["katilim"] if e == exam_id}
    liste = [{"id": s["id"], "ad": f"{s['first_name'] or ''} {s['last_name'] or ''}".strip(),
              "numara": s["school_number"], "sube": s["class_name"]}
             for s in sorted(veri["kayitli"], key=lambda s: (S._class_sort_key(s["class_name"]), s["last_name"] or ""))
             if s["id"] not in girenler]
    return jsonify({"deneme": {"id": exam_id, "ad": d["ad"], "tarih": d["tarih"], "katilan": d["katilanSeviye"],
                               "kayitli": len(veri["kayitli"])}, "ogrenciler": liste})


# ================================================================ ayarlar
@bp.route("/api/okullar/<int:okul_id>/kokpit/ayarlar", methods=["GET", "PUT"])
@_korumali()
def api_ayarlar(db, okul_id, kapsam):
    if request.method == "GET":
        ayar, kayitli = _ayarlar(db, okul_id)
        return jsonify({"ayarlar": ayar, "degistirilen": list(kayitli), "varsayilan": K.VARSAYILAN_AYARLAR,
                        "tanim": {k: {"min": v[1], "max": v[2]} for k, v in K.AYAR_TANIM.items()}})
    if kapsam not in ("platform", "okul"):
        return jsonify({"error": "Ayarları değiştirme yetkiniz yok."}), 403
    gelen = (request.get_json(silent=True) or {}).get("ayarlar") or {}
    temiz, hatalar = K.ayarlari_dogrula(gelen)
    if hatalar:
        return jsonify({"error": "; ".join(hatalar)}), 400
    # varsayilana esit olanlar saklanmaz (varsayilan ileride degisirse okul da izler)
    sakla = {k: v for k, v in temiz.items() if v != K.VARSAYILAN_AYARLAR[k]}
    db.execute("INSERT OR REPLACE INTO kokpit_ayarlar (organization_id, data_json, updated_at, updated_by) "
               "VALUES (?,?,?,?)", (okul_id, json.dumps(sakla), datetime.now().isoformat(timespec="seconds"),
                                    session["user_id"]))
    db.commit()
    S.log_audit(db, "KOKPIT_AYAR_GUNCELLE", resource_type="organization", resource_id=okul_id)
    ayar, kayitli = _ayarlar(db, okul_id)
    return jsonify({"ok": True, "ayarlar": ayar, "degistirilen": list(kayitli)})


def varsayilan_acilis(db):
    """Girişte kokpit mi acilsin? Yalnizca kendi okulu olan Okul Admini
    (platform hesabi ya da Veri Giris Admini degil)."""
    if session.get("role") != "admin" or "user_id" not in session:
        return False
    uid = session["user_id"]
    own = db.execute("SELECT organization_id FROM users WHERE id = ?", (uid,)).fetchone()
    if not own or not own["organization_id"]:
        return False
    if S.has_permission(db, uid, "organization.manage"):
        return False
    return S._admin_subrole(db, uid, "admin") != "DATA_ADMIN"


# ================================================================ detay ekranlari
def _ogr_ad(s):
    return f"{s['first_name'] or ''} {s['last_name'] or ''}".strip() or f"Öğrenci #{s['id']}"


def _ogrenci_ortalamalari(db, org_id, seviye, ids, sube=None):
    """{student_id: {"net","puan","y","n"}} - verilen denemelerdeki ortalamalar."""
    if not ids:
        return {}
    ph = ",".join("?" * len(ids))
    q = (f"SELECT student_id, AVG(toplam_net) net, AVG(puan) puan, AVG(y) y, COUNT(*) n FROM kokpit_ogrenci "
         f"WHERE organization_id = ? AND grade IS ? AND exam_id IN ({ph})")
    args = [org_id, seviye, *ids]
    if sube is not None:
        q += " AND class_name = ?"
        args.append(sube)
    q += " GROUP BY student_id"
    return {r["student_id"]: dict(r) for r in db.execute(q, args).fetchall()}


def _donem_istatistikleri(veri, donem):
    d = veri["denemeler"]
    cur_ids = _ids(d, donem["secili"])
    once_ids = _ids(d, donem["once"]) if donem["once"] else set()
    sonra_ids = _ids(d, donem["sonra"]) if donem["sonra"] else set()

    def ist(ids):
        return K.istatistik(veri["ozet"], veri["katilim"], ids) if ids else None
    return (cur_ids, once_ids, sonra_ids), (ist(cur_ids), ist(once_ids), ist(sonra_ids))


def _ortak(db, okul_id, veri, donem, kapsam):
    return {"okul": {"id": okul_id, "ad": _okul_adi(db, okul_id)}, "seviye": veri["seviye"],
            "seviyeler": veri["seviyeler"], "kayitli": len(veri["kayitli"]), "donem": donem,
            "donemSecenekleri": _donem_secenekleri(veri, donem),
            "yetki": {"analiz": kapsam != "veri", "aksiyon": kapsam in ("platform", "okul")}}


def sube_detayi(db, okul_id, veri, donem, sube, ayar):
    (cur_ids, once_ids, sonra_ids), (cur, once, sonra) = _donem_istatistikleri(veri, donem)
    sc = cur["subeler"].get(sube) if cur else None
    so = once["subeler"].get(sube) if once else None
    ss = sonra["subeler"].get(sube) if sonra else None
    kartlar = {k: {"sube": sc.get(k) if sc else None, "okul": cur.get(k) if cur else None}
               for k in ("toplamNet", "puan", "yanlis", "dogru")}
    kartlar["ogrenci"] = {"sube": sc.get("ogrenci") if sc else 0,
                          "kayitli": sum(1 for s in veri["kayitli"] if s["class_name"] == sube)}
    kartlar["puanDegisim"] = (ss["puan"] - so["puan"]) if so and ss and so.get("puan") is not None \
        and ss.get("puan") is not None else None
    trend = []
    for dn in sorted((x for x in veri["denemeler"] if x["exam_id"] in cur_ids), key=lambda x: (x["tarih"], x["exam_id"])):
        e = K.istatistik(veri["ozet"], None, {dn["exam_id"]})
        es = e["subeler"].get(sube)
        trend.append({"id": dn["exam_id"], "ad": dn["ad"], "tarih": dn["tarih"],
                      "subeNet": es["toplamNet"] if es else None, "subePuan": es["puan"] if es else None,
                      "okulNet": e["toplamNet"], "okulPuan": e["puan"], "katilan": es["n"] if es else 0})
    dersler = []
    for k, dd in ((sc or {}).get("dersler") or {}).items():
        okul_d = cur["dersler"].get(k)
        a = ((so or {}).get("dersler") or {}).get(k)
        b = ((ss or {}).get("dersler") or {}).get(k)
        dersler.append({"ders": k, "ad": K.DERS_AD.get(k, k), "net": dd["net"], "soru": dd["soru"], "oran": dd["oran"],
                        "okulOran": okul_d["oran"] if okul_d else None, "okulNet": okul_d["net"] if okul_d else None,
                        "degisim": (b["net"] - a["net"]) if a and b else None})
    cur_o = _ogrenci_ortalamalari(db, okul_id, veri["seviye"], cur_ids, sube)
    once_o = _ogrenci_ortalamalari(db, okul_id, veri["seviye"], once_ids)
    sonra_o = _ogrenci_ortalamalari(db, okul_id, veri["seviye"], sonra_ids)
    ogrenciler = []
    for s in veri["kayitli"]:
        if s["class_name"] != sube:
            continue
        c, a, b = cur_o.get(s["id"]), once_o.get(s["id"]), sonra_o.get(s["id"])
        ogrenciler.append({
            "id": s["id"], "ad": _ogr_ad(s), "numara": s["school_number"],
            "net": c["net"] if c else None, "puan": c["puan"] if c else None, "yanlis": c["y"] if c else None,
            "deneme": c["n"] if c else 0, "degisim": (b["net"] - a["net"]) if a and b else None,
        })
    risk = K.risk_listesi([o for o in ogrenciler if o["net"] is not None], ayar)
    return {"sube": sube, "kartlar": kartlar, "trend": trend, "dersler": dersler, "ogrenciler": ogrenciler,
            "risk": risk, "denemeSayisi": len(cur_ids)}


@bp.route("/api/okullar/<int:okul_id>/kokpit/subeler/<path:sube>")
@_korumali()
def api_sube(db, okul_id, kapsam, sube):
    veri = _okul_verisi(db, okul_id, request.args.get("seviye"))
    subeler = {s["class_name"] for s in veri["kayitli"]} | {r["class_name"] for r in veri["ozet"]}
    if sube not in subeler:
        return jsonify({"error": "Şube bulunamadı."}), 404
    donem = _donem(veri)
    ayar, _ = _ayarlar(db, okul_id)
    out = _ortak(db, okul_id, veri, donem, kapsam)
    out.update(sube_detayi(db, okul_id, veri, donem, sube, ayar))
    out["ayarlar"] = ayar
    return jsonify(out)


def kazanim_kirilimi(db, org_id, seviye, ders, exam_ids, sube=None):
    """Ders detayi: secili denemelerdeki kazanimlar icin dogru yuzdesi (A
    kitapcigi sirasindaki topicMap etiketi + sonuctaki answers D/Y/B).
    Etiketi olmayan sorular 'Etiketsiz' grubunda; en zayif 5 kazanim isaretli."""
    if not exam_ids:
        return []
    ids = list(exam_ids)
    ph = ",".join("?" * len(ids))
    sinif = {r["id"]: r["class_name"] for r in db.execute(
        "SELECT id, class_name FROM students WHERE organization_id = ?", (org_id,)).fetchall()}
    tmap = {}
    for e in db.execute(f"SELECT id, data_json FROM exams WHERE id IN ({ph})", ids).fetchall():
        data = json.loads(e["data_json"]) if e["data_json"] else {}
        tmap[e["id"]] = (data.get("topicMap") or {}).get(ders) or []
    acc = {}
    for r in db.execute(f"SELECT exam_id, student_id, data_json FROM results WHERE exam_id IN ({ph})", ids).fetchall():
        cls = sinif.get(r["student_id"])
        if cls is None or _grade(cls) != seviye or (sube is not None and cls != sube):
            continue
        veri = json.loads(r["data_json"]) if r["data_json"] else {}
        ans = (((veri.get("subjects") or {}).get(ders)) or {}).get("answers")
        if not ans:
            continue
        entries = tmap.get(r["exam_id"], [])
        for i, a in enumerate(ans):
            if a not in ("D", "Y", "B"):
                continue
            label = ((entries[i] if i < len(entries) else None) or {}).get("kazanim") or "Etiketsiz"
            x = acc.setdefault(label, {"d": 0, "y": 0, "b": 0, "sorular": set(), "subeler": {}})
            x["d"] += a == "D"
            x["y"] += a == "Y"
            x["b"] += a == "B"
            x["sorular"].add((r["exam_id"], i))
            sb = x["subeler"].setdefault(cls, [0, 0])
            sb[0] += a == "D"
            sb[1] += 1
    out = []
    for label, x in acc.items():
        t = x["d"] + x["y"] + x["b"]
        out.append({"kazanim": label, "soruSayisi": len(x["sorular"]), "cevap": t,
                    "dogruYuzde": x["d"] / t * 100, "yanlisYuzde": x["y"] / t * 100, "bosYuzde": x["b"] / t * 100,
                    "subeler": {c: v[0] / v[1] * 100 for c, v in x["subeler"].items() if v[1]},
                    "etiketsiz": label == "Etiketsiz", "zayif": False})
    out.sort(key=lambda r: r["dogruYuzde"])
    for r in [r for r in out if not r["etiketsiz"]][:5]:
        r["zayif"] = True
    return out


@bp.route("/api/okullar/<int:okul_id>/kokpit/dersler/<ders>")
@_korumali()
def api_ders(db, okul_id, kapsam, ders):
    veri = _okul_verisi(db, okul_id, request.args.get("seviye"))
    donem = _donem(veri)
    (cur_ids, _, _), (cur, once, sonra) = _donem_istatistikleri(veri, donem)
    if not cur or ders not in cur["dersler"]:
        return jsonify({"error": "Bu dönemde bu dersin verisi yok."}), 404
    subeler = []
    for cls in K._sube_sirala(cur["subeler"]):
        x = cur["subeler"][cls]["dersler"].get(ders)
        if not x:
            continue
        a = (((once or {}).get("subeler") or {}).get(cls) or {}).get("dersler", {}).get(ders)
        b = (((sonra or {}).get("subeler") or {}).get(cls) or {}).get("dersler", {}).get(ders)
        subeler.append({"sube": cls, "net": x["net"], "oran": x["oran"], "yanlis": x["yanlis"],
                        "degisim": (b["net"] - a["net"]) if a and b else None})
    o = cur["dersler"][ders]
    sube = request.args.get("sube") or None
    out = _ortak(db, okul_id, veri, donem, kapsam)
    out.update({
        "ders": ders, "ad": K.DERS_AD.get(ders, ders), "katsayi": K.KATSAYI.get(ders, 1),
        "ozet": {"net": o["net"], "soru": o["soru"], "oran": o["oran"], "yanlis": o["yanlis"],
                 "degisim": (sonra["dersler"][ders]["net"] - once["dersler"][ders]["net"])
                 if once and sonra and ders in once["dersler"] and ders in sonra["dersler"] else None},
        "subeler": subeler, "sube": sube, "denemeSayisi": len(cur_ids),
        "kazanimlar": kazanim_kirilimi(db, okul_id, veri["seviye"], ders, cur_ids, sube),
    })
    return jsonify(out)


def veri_durumu_detayi(db, veri, donem):
    kayitli = len(veri["kayitli"])
    ad = {s["id"]: _ogr_ad(s) for s in veri["kayitli"]}
    satirlar = []
    for dn in veri["denemeler"]:
        if not K.aralikta(dn["tarih"], donem["secili"]):
            continue
        eksikler = [ad.get(r["student_id"], f"#{r['student_id']}") for r in db.execute(
            "SELECT student_id FROM kokpit_ogrenci WHERE exam_id = ? AND eksik = 1 AND grade IS ?",
            (dn["exam_id"], veri["seviye"])).fetchall()]
        yuklu = dn["katilanSeviye"] > 0
        satirlar.append({
            "id": dn["exam_id"], "ad": dn["ad"], "tarih": dn["tarih"],
            "durum": "değerlendirildi" if yuklu else "yüklenmedi",
            "katilan": dn["katilanSeviye"], "kayitli": kayitli,
            "katilmayan": kayitli - dn["katilanSeviye"] if yuklu else None,
            "eksikKarne": len(eksikler), "eksikOgrenciler": eksikler[:50],
            "cevapAnahtari": bool(dn["anahtar_var"]), "kazanim": dn["kazanim_durumu"],
            "sorunsuz": yuklu and not eksikler and bool(dn["anahtar_var"]) and dn["kazanim_durumu"] == "tam",
        })
    return satirlar


@bp.route("/api/okullar/<int:okul_id>/kokpit/veri-durumu")
@_korumali(analiz=False)
def api_veri_durumu(db, okul_id, kapsam):
    veri = _okul_verisi(db, okul_id, request.args.get("seviye"))
    donem = _donem(veri)
    out = _ortak(db, okul_id, veri, donem, kapsam)
    out.update({"denemeler": veri_durumu_detayi(db, veri, donem), "ozet": _veri_durumu_paketi(veri, donem)})
    return jsonify(out)
