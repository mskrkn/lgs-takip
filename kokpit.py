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
    built_at TEXT, tur TEXT
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
        if "tur" not in [r[1] for r in conn.execute("PRAGMA table_info(kokpit_deneme)").fetchall()]:
            conn.execute("ALTER TABLE kokpit_deneme ADD COLUMN tur TEXT")
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
        tur = (e["exam_type"] or data.get("examType") or "LGS")
        lgs = K.lgs_turu(tur)
        acc, satirlar, grade_say, eksik = {}, [], {}, 0
        if genel:
            for r in db.execute("SELECT student_id, data_json FROM results WHERE exam_id = ?", (exam_id,)).fetchall():
                sid = r["student_id"]
                if sid not in ogrenci:
                    continue
                veri = json.loads(r["data_json"]) if r["data_json"] else {}
                o = K.sonuc_ozeti(veri, sorular, lgs)
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
            "INSERT OR REPLACE INTO kokpit_deneme (exam_id, organization_id, ad, tarih, grade, genel, soru_json, katilan, "
            "eksik_karne, anahtar_var, kazanim_durumu, built_at, tur) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (exam_id, org_id, e["name"], (e["date"] or "")[:10], grade, genel, json.dumps(sorular), len(satirlar),
             eksik, 1 if (ak.get("A") if isinstance(ak, dict) else ak) else 0,
             _kazanim_durumu(data, sorular), simdi, tur))
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


def _baglam(veri, ids=None):
    """Secili seviye + denemelerin turu -> ders adlari ve katsayilar. Donemdeki
    denemelerin HEPSI LGS turundeyse LGS katsayilari uygulanir."""
    d = [x for x in veri["denemeler"] if ids is None or x["exam_id"] in ids]
    lgs = all(K.lgs_turu(x.get("tur")) for x in d) if d else True
    return K.baglam(veri["seviye"], lgs)


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
    analiz = K.acilis_analizi(cur, once, sonra, katilim, ayar, dict(donem, kod=capa), _baglam(veri, cur_ids))
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
    bag = _baglam(veri, cur_ids)
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
        dersler.append({"ders": k, "ad": bag["ad"].get(k, k), "net": dd["net"], "soru": dd["soru"], "oran": dd["oran"],
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
            "risk": risk, "denemeSayisi": len(cur_ids), "lgs": bag["lgs"]}


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
    bag = _baglam(veri, cur_ids)
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
        "ders": ders, "ad": bag["ad"].get(ders, ders), "katsayi": bag["katsayi"].get(ders, 1), "lgs": bag["lgs"],
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


# ================================================================ aksiyonlar (sartname 9)
# Hicbir aksiyon onizlemesiz gonderilmez: once ?onizleme=1 ile cagrilir, sunucu
# alici listesini hesaplayip imzali bir onayKodu dondurur; gonderim istegi bu
# kodu (ayni kullanici, ayni okul, ayni tur/uyari, ayni alicilar, ONAY_OMRU
# icinde) tasimazsa 409/400 doner. Metni kullanici onizlemede duzenleyebilir.
AKSIYON_TURLERI = ("ogretmen_bildirim", "odev_oneri", "veli_bildirim")
ODEV_VARSAYILAN_SORU = 10


def _imza(*parcalar):
    msg = "|".join(str(p) for p in parcalar).encode("utf-8")
    key = S.app.secret_key if isinstance(S.app.secret_key, bytes) else str(S.app.secret_key).encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def _onay_kodu(okul_id, tur, anahtar, alici_ids, ts=None):
    ts = int(ts if ts is not None else time.time())
    ids = ",".join(str(i) for i in sorted(alici_ids))
    return f"{ts}.{_imza('aksiyon', session['user_id'], okul_id, tur, anahtar, ids, ts)}"


def _onay_dogrula(kod, okul_id, tur, anahtar, alici_ids):
    try:
        ts_s, imza = str(kod).split(".", 1)
        ts = int(ts_s)
    except (ValueError, AttributeError):
        return "Önce önizleme yapılmalı."
    if time.time() - ts > ONAY_OMRU:
        return "Önizlemenin süresi doldu, lütfen yeniden önizleyin."
    beklenen = _onay_kodu(okul_id, tur, anahtar, alici_ids, ts).split(".", 1)[1]
    if not hmac.compare_digest(beklenen, imza):
        return "Alıcı listesi önizlemeden sonra değişti, lütfen yeniden önizleyin."
    return None


def _ogretmenler(db, org_id):
    return [dict(r) for r in db.execute(
        "SELECT id, display_name, username, class_name, homeroom_class_name, subject FROM users "
        "WHERE organization_id = ? AND role = 'teacher' AND active = 1 ORDER BY display_name", (org_id,)).fetchall()]


def _sube_ogretmenleri(db, org_id, sube, dersler=None):
    """(alicilar, not): subenin ilgili ders(ler) ogretmenleri + sinif ogretmeni.
    Ders ogretmeni bulunamazsa subeye giren tum ogretmenlere duser (notla)."""
    tum = _ogretmenler(db, org_id)
    girer, ders_ogr, sinif_ogr = [], [], []
    for t in tum:
        siniflar = S.teacher_class_list(t["class_name"])
        anahtar = S.branch_subject_key(t["subject"])
        subeye_girer = (siniflar is None and anahtar in (dersler or [])) or (siniflar is not None and sube in siniflar)
        if t["homeroom_class_name"] == sube:
            sinif_ogr.append(t)
            subeye_girer = True
        if not subeye_girer:
            continue
        girer.append(t)
        if dersler and anahtar in dersler:
            ders_ogr.append(t)
    secim, not_ = [], None
    if dersler:
        secim = ders_ogr + [t for t in sinif_ogr if t not in ders_ogr]
        if not ders_ogr:
            not_ = "Bu şubede ilgili dersin öğretmeni tanımlı değil; şubeye giren öğretmenlere gönderilecek."
            secim = girer
    else:
        secim = girer
    return secim, not_


def _alici(t, aciklama=""):
    return {"id": t["id"], "ad": t["display_name"] or t["username"], "aciklama": aciklama}


def _uyari_bul(db, okul_id, anahtar, args):
    """Uyariyi istemciye guvenmeden SUNUCUDA yeniden uretir (metin/hedef
    sahteciligine karsi). KAZANIM_ZAYIF ders detayindan gelir, uyari listesinde yok."""
    veri = _okul_verisi(db, okul_id, args.get("seviye"))
    donem = K.donem_coz(args.get("donem"), [d["tarih"] for d in veri["denemeler"] if d["katilanSeviye"]],
                        bas=args.get("bas"), bit=args.get("bit"))
    ayar, _ = _ayarlar(db, okul_id)
    cur, _, _, katilim, analiz = _analiz_paketi(db, okul_id, veri, donem, ayar)
    u = next((x for x in analiz["uyarilar"] if x["anahtar"] == anahtar), None)
    return u, veri, donem, cur, katilim


def _odev_dersi(db, org_id, cur, sube):
    """YANLIS_YUKSEK / SUBE_ACIK icin ders: subenin okula gore en geride
    kaldigi dersler (basari orani farki) sirasiyla; o subede ders ogretmeni
    VE soru havuzunda yayinlanmis sorusu olan ilk ders secilir (yoksa ogretmeni
    olan ilk ders, o da yoksa en geride kalan ders)."""
    s = cur["subeler"].get(sube) if cur else None
    if not s or not s["dersler"]:
        return None

    def fark(k):
        o = cur["dersler"].get(k)
        return (s["dersler"][k]["oran"] or 0) - ((o or {}).get("oran") or 0)
    sira = sorted(s["dersler"], key=lambda k: (fark(k), s["dersler"][k]["oran"] or 0))
    ogretmenli = [k for k in sira if any(S.branch_subject_key(t["subject"]) == k
                                         for t in _sube_ogretmenleri(db, org_id, sube, [k])[0])]
    for k in ogretmenli:
        if db.execute("SELECT 1 FROM question_bank qb JOIN subjects sj ON sj.id = qb.subject_id "
                      "WHERE qb.organization_id = ? AND qb.status = 'published' AND sj.code = ? LIMIT 1",
                      (org_id, k)).fetchone():
            return k
    return (ogretmenli or sira)[0]


def _soru_oner(db, org_id, ders, kazanimlar, adet):
    """Mevcut soru havuzundan oneri: once zayif kazanimlara etiketli yayinlanmis
    sorular (kazanim kodu, ör. 'M.8.1.3 - ...'), sonra mevcut 'otomatik' odev
    modunun secicisiyle (_auto_select_questions) ayni dersten tamamlanir."""
    subj = db.execute("SELECT id FROM subjects WHERE code = ?", (ders,)).fetchone()
    if not subj:
        return None, []
    secilen = []
    kodlar = [k.split(" - ")[0].strip() for k in (kazanimlar or []) if k and k != "Etiketsiz"]
    for kod in kodlar:
        if len(secilen) >= adet:
            break
        for r in db.execute(
                "SELECT DISTINCT qb.id FROM question_bank qb JOIN question_curriculum_tags t ON t.question_id = qb.id "
                "JOIN curriculum_nodes n ON n.id = t.curriculum_node_id "
                "WHERE qb.organization_id = ? AND qb.status = 'published' AND qb.subject_id = ? "
                "AND (n.code = ? OR n.code LIKE ?) LIMIT ?",
                (org_id, subj["id"], kod, kod + ".%", adet - len(secilen))).fetchall():
            if r["id"] not in secilen:
                secilen.append(r["id"])
    if len(secilen) < adet:
        secilen += S._auto_select_questions(db, org_id, subj["id"], None, None, adet - len(secilen),
                                            exclude_ids=set(secilen))
    return subj["id"], secilen


def _sorular(db, ids):
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    rows = {r["id"]: r for r in db.execute(
        f"SELECT id, display_code, question_text, image_path, difficulty_level FROM question_bank WHERE id IN ({ph})",
        list(ids)).fetchall()}
    return [{"id": i, "kod": rows[i]["display_code"], "metin": (rows[i]["question_text"] or "")[:160],
             "gorsel": bool(rows[i]["image_path"]), "zorluk": rows[i]["difficulty_level"]} for i in ids if i in rows]


def aksiyon_plani(db, okul_id, govde, args):
    """Onizleme ve gonderimin ORTAK hesabi: (plan, hata). plan: tur, anahtar,
    kod, alicilar, metin, baslik, link, ek (odev taslaklari / veli-ogrenci)."""
    tur = govde.get("tur")
    if tur not in AKSIYON_TURLERI:
        return None, "Geçersiz aksiyon türü."
    anahtar = str(govde.get("uyariAnahtari") or "")
    hedef = govde.get("hedef") or {}
    if anahtar.startswith("KAZANIM_ZAYIF:"):
        if tur != "odev_oneri":
            return None, "Bu uyarı için yalnızca ödev önerilebilir."
        ders = hedef.get("ders")
        if ders not in K.DERS_AD:
            return None, "Geçersiz ders."
        veri = _okul_verisi(db, okul_id, args.get("seviye"))
        kaz = [str(k)[:300] for k in (hedef.get("kazanimlar") or [])][:5]
        if hedef.get("kazanim"):
            kaz = [str(hedef["kazanim"])[:300]] + [k for k in kaz if k != hedef["kazanim"]]
        u = {"kod": "KAZANIM_ZAYIF", "anahtar": anahtar[:400], "baslik": f"{K.baglam(veri['seviye'])['ad'][ders]}: zayıf kazanım",
             "detay": "; ".join(kaz[:3]), "hedef": {"sube": hedef.get("sube"), "ders": ders}}
        subeler = [hedef["sube"]] if hedef.get("sube") else sorted({s["class_name"] for s in veri["kayitli"]})
        cur = None
    else:
        u, veri, donem, cur, katilim = _uyari_bul(db, okul_id, anahtar, args)
        if not u:
            return None, "Uyarı artık geçerli değil (veri ya da dönem değişmiş olabilir). Kokpiti yenileyin."
        if u["aksiyon"]["tur"] != tur:
            return None, "Bu uyarı için bu aksiyon kullanılamaz."
        subeler = [u["hedef"]["sube"]] if u["hedef"].get("sube") else []
        kaz = []
    okul_ad = _okul_adi(db, okul_id)
    AD = K.baglam(veri["seviye"])["ad"]
    plan = {"tur": tur, "anahtar": u["anahtar"], "kod": u["kod"], "hedef": u["hedef"], "uyari": u,
            "alicilar": [], "not": None, "ek": {}}

    if tur == "ogretmen_bildirim":
        sube = u["hedef"]["sube"]
        dersler = [u["hedef"]["ders"]] if u["hedef"].get("ders") else \
            [x["ders"] for x in (u.get("veri") or {}).get("dersler", [])]
        alicilar, not_ = _sube_ogretmenleri(db, okul_id, sube, dersler or None)
        plan["alicilar"] = [_alici(t, ", ".join(filter(None, [t["subject"] or "",
                                                              "sınıf öğretmeni" if t["homeroom_class_name"] == sube else ""])))
                            for t in alicilar]
        plan["not"] = not_
        plan["baslik"] = f"Okul Kokpiti: {u['baslik']}"
        plan["metin"] = (f"{u['baslik']}. {u['detay']}\n\nOkul yönetimi bu durumu birlikte değerlendirmek istiyor. "
                         f"Sınıf ayrıntıları için öğretmen panelinizdeki Sınıflarım ekranına bakabilirsiniz.")
        plan["link"] = "/ogretmen.html"
    elif tur == "odev_oneri":
        adet = govde.get("soruSayisi") or ODEV_VARSAYILAN_SORU
        try:
            adet = max(1, min(40, int(adet)))
        except (TypeError, ValueError):
            adet = ODEV_VARSAYILAN_SORU
        ders = u["hedef"].get("ders") or _odev_dersi(db, okul_id, cur, subeler[0] if subeler else None)
        if not ders:
            return None, "Ödev için ders belirlenemedi."
        taslaklar, alicilar = [], []
        subject_id, soru_ids = _soru_oner(db, okul_id, ders, kaz, adet)
        for sube in subeler:
            ogr, _ = _sube_ogretmenleri(db, okul_id, sube, [ders])
            ders_ogr = [t for t in ogr if S.branch_subject_key(t["subject"]) == ders]
            if not ders_ogr:
                # dersin ogretmeni yoksa sinif ogretmenine (o da yoksa subeye giren ilk ogretmene)
                ders_ogr = [t for t in ogr if t["homeroom_class_name"] == sube] or ogr[:1]
                if ders_ogr:
                    plan["not"] = f"{sube} şubesinde {AD[ders]} öğretmeni tanımlı değil; taslak {ders_ogr[0]['display_name']} adlı öğretmene gidecek."
            if not ders_ogr:
                continue
            t = ders_ogr[0]
            alicilar.append(_alici(t, f"{sube} · {AD[ders]}"))
            taslaklar.append({"ogretmen": t["id"], "sube": sube})
        if not alicilar:
            return None, "İlgili şube(ler)de bu dersin öğretmeni bulunamadı; önce öğretmen branş/sınıf atamasını yapın."
        plan["alicilar"] = alicilar
        plan["ek"] = {"ders": ders, "dersAd": AD[ders], "subjectId": subject_id, "soruSayisi": adet,
                      "soruIds": soru_ids, "sorular": _sorular(db, soru_ids), "taslaklar": taslaklar,
                      "kazanimlar": kaz, "mod": "auto"}
        if len(soru_ids) < adet and not plan["not"]:
            plan["not"] = (f"Soru havuzunda bu derste yalnızca {len(soru_ids)} yayınlanmış soru bulundu. "
                           "Öğretmen taslağı yayınlarken akıllı modu seçebilir.")
        plan["baslik"] = f"Taslak ödev önerisi: {AD[ders]}"
        plan["metin"] = (f"{u['baslik']}. Okul yönetimi {AD[ders]} dersi için {adet} soruluk bir ödev öneriyor"
                         + (f" (kazanımlar: {', '.join(kaz[:3])})" if kaz else "")
                         + ". Taslağı inceleyip uygun görürseniz yayınlayabilirsiniz; öğrencilere siz yayınlayınca gider.")
        plan["link"] = None  # taslak id'si gonderimde belli olur
    else:  # veli_bildirim
        exam_id = u["hedef"].get("denemeId")
        girenler = {sid for e, sid, _ in veri["katilim"] if e == exam_id}
        girmeyen = [s for s in veri["kayitli"] if s["id"] not in girenler]
        dn = next((d for d in veri["denemeler"] if d["exam_id"] == exam_id), None)
        veliler = {}
        ids = [s["id"] for s in girmeyen]
        if ids:
            ph = ",".join("?" * len(ids))
            for r in db.execute(
                    f"SELECT ps.student_id, u.id uid, u.display_name, u.username FROM parent_students ps "
                    f"JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id IN ({ph}) AND u.role = 'parent' "
                    f"AND u.active = 1", ids).fetchall():
                v = veliler.setdefault(r["uid"], {"id": r["uid"], "ad": r["display_name"] or r["username"], "ogr": []})
                v["ogr"].append(r["student_id"])
        ad = {s["id"]: _ogr_ad(s) for s in girmeyen}
        plan["alicilar"] = [{"id": v["id"], "ad": v["ad"], "aciklama": ", ".join(ad[x] for x in v["ogr"])}
                            for v in sorted(veliler.values(), key=lambda v: v["ad"] or "")]
        velili = {x for v in veliler.values() for x in v["ogr"]}
        plan["ek"] = {"ogrenciSayisi": len(girmeyen), "velisiOlmayan": len([s for s in girmeyen if s["id"] not in velili]),
                      "deneme": dn["ad"] if dn else None, "tarih": dn["tarih"] if dn else None,
                      "veliOgrenci": {str(v["id"]): v["ogr"] for v in veliler.values()}, "ogrAd": {str(k): v for k, v in ad.items()}}
        if plan["ek"]["velisiOlmayan"]:
            plan["not"] = f"{plan['ek']['velisiOlmayan']} öğrencinin sisteme bağlı velisi yok; onlara bildirim gitmeyecek."
        plan["baslik"] = f"{okul_ad}: deneme katılımı"
        plan["metin"] = (f"Sayın veli, çocuğunuz okulumuzda {K._kisa_tarih(dn['tarih']) if dn else ''} tarihinde yapılan "
                         f"{dn['ad'] if dn else 'son'} denemesine katılmadı. Düzenli deneme katılımı LGS hazırlığında "
                         f"önemlidir; bir sonraki denemeye katılımını rica ederiz.")
        plan["link"] = "/veli.html"
    if not plan["alicilar"]:
        return None, plan.get("not") or "Bu aksiyon için alıcı bulunamadı."
    return plan, None


def _onceki_aksiyon(db, okul_id, anahtar):
    r = db.execute("SELECT tur, created_at, alici_sayisi FROM kokpit_aksiyonlar WHERE organization_id = ? "
                   "AND uyari_anahtari = ? ORDER BY id DESC LIMIT 1", (okul_id, anahtar)).fetchone()
    return {"tur": r["tur"], "tarih": r["created_at"], "aliciSayisi": r["alici_sayisi"]} if r else None


def _bildirim_ekle(db, user_id, okul_id, baslik, metin, link):
    db.execute("INSERT INTO notifications (user_id, type, title, message, is_read, created_at, link, organization_id, kaynak) "
               "VALUES (?,?,?,?,0,?,?,?,'kokpit')",
               (user_id, "kokpit", baslik[:200], metin, datetime.now().isoformat(timespec="seconds"), link, okul_id))


@bp.route("/api/okullar/<int:okul_id>/kokpit/aksiyonlar", methods=["GET", "POST"])
@_korumali(aksiyon=True)
def api_aksiyonlar(db, okul_id, kapsam):
    if request.method == "GET":
        rows = db.execute(
            "SELECT a.*, u.display_name FROM kokpit_aksiyonlar a LEFT JOIN users u ON u.id = a.user_id "
            "WHERE a.organization_id = ? ORDER BY a.id DESC LIMIT 100", (okul_id,)).fetchall()
        return jsonify({"aksiyonlar": [{
            "id": r["id"], "tur": r["tur"], "uyariKodu": r["uyari_kodu"], "uyariAnahtari": r["uyari_anahtari"],
            "hedef": json.loads(r["hedef_json"] or "{}"), "metin": r["metin"], "aliciSayisi": r["alici_sayisi"],
            "gonderen": r["display_name"], "tarih": r["created_at"], "sonuc": json.loads(r["sonuc_json"] or "{}"),
        } for r in rows]})
    if kapsam not in ("platform", "okul"):
        return jsonify({"error": "Aksiyon alma yetkiniz yok."}), 403
    govde = request.get_json(silent=True) or {}
    filtre = govde.get("filtreler") or {}
    plan, hata = aksiyon_plani(db, okul_id, govde, filtre)
    if hata:
        return jsonify({"error": hata}), 400
    alici_ids = [a["id"] for a in plan["alicilar"]]
    onizleme = request.args.get("onizleme") in ("1", "true") or govde.get("onizleme")
    if onizleme:
        return jsonify({
            "onizleme": True, "tur": plan["tur"], "uyariAnahtari": plan["anahtar"], "uyari": {
                "kod": plan["kod"], "baslik": plan["uyari"]["baslik"], "detay": plan["uyari"].get("detay")},
            "alicilar": plan["alicilar"], "aliciSayisi": len(alici_ids), "baslik": plan["baslik"],
            "metin": plan["metin"], "not": plan["not"], "ek": {k: v for k, v in plan["ek"].items()
                                                               if k not in ("veliOgrenci", "ogrAd")},
            "oncekiAksiyon": _onceki_aksiyon(db, okul_id, plan["anahtar"]),
            "onayKodu": _onay_kodu(okul_id, plan["tur"], plan["anahtar"], alici_ids),
        })
    if not govde.get("onay"):
        return jsonify({"error": "Gönderim için açık onay gerekli."}), 400
    hata = _onay_dogrula(govde.get("onayKodu"), okul_id, plan["tur"], plan["anahtar"], alici_ids)
    if hata:
        return jsonify({"error": hata, "yenidenOnizle": True}), 409
    metin = str(govde.get("metin") or plan["metin"]).strip()[:4000]
    if not metin:
        return jsonify({"error": "Mesaj metni boş olamaz."}), 400
    simdi = datetime.now().isoformat(timespec="seconds")
    sonuc = {}
    cur = db.execute(
        "INSERT INTO kokpit_aksiyonlar (organization_id, user_id, tur, uyari_kodu, uyari_anahtari, hedef_json, metin, "
        "alici_json, alici_sayisi, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (okul_id, session["user_id"], plan["tur"], plan["kod"], plan["anahtar"],
         json.dumps(plan["hedef"], ensure_ascii=False), metin,
         json.dumps(plan["alicilar"], ensure_ascii=False), len(alici_ids), simdi))
    aksiyon_id = cur.lastrowid
    if plan["tur"] == "ogretmen_bildirim":
        for uid in alici_ids:
            _bildirim_ekle(db, uid, okul_id, plan["baslik"], metin, plan["link"])
    elif plan["tur"] == "odev_oneri":
        ek = plan["ek"]
        taslak_ids = []
        for t in ek["taslaklar"]:
            c2 = db.execute(
                "INSERT INTO kokpit_odev_taslaklari (organization_id, teacher_id, class_name, subject, title, description, "
                "mode, question_ids_json, question_count, kazanimlar_json, status, aksiyon_id, created_by, created_at, "
                "updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'taslak', ?,?,?,?)",
                (okul_id, t["ogretmen"], t["sube"], ek["ders"], f"{ek['dersAd']} tekrar ödevi ({t['sube']})", metin,
                 ek["mod"], json.dumps(ek["soruIds"]), ek["soruSayisi"], json.dumps(ek["kazanimlar"], ensure_ascii=False),
                 aksiyon_id, session["user_id"], simdi, simdi))
            taslak_ids.append(c2.lastrowid)
            _bildirim_ekle(db, t["ogretmen"], okul_id, plan["baslik"], metin, f"/bildirimler.html?taslak={c2.lastrowid}")
        sonuc["taslaklar"] = taslak_ids
    else:
        ek = plan["ek"]
        for uid in alici_ids:
            cocuklar = [ek["ogrAd"].get(str(s), "") for s in ek["veliOgrenci"].get(str(uid), [])]
            _bildirim_ekle(db, uid, okul_id, plan["baslik"],
                           metin + (f"\n\nÖğrenci: {', '.join(cocuklar)}" if cocuklar else ""), plan["link"])
    db.execute("UPDATE kokpit_aksiyonlar SET sonuc_json = ? WHERE id = ?", (json.dumps(sonuc), aksiyon_id))
    db.commit()
    S.log_audit(db, f"KOKPIT_AKSIYON_{plan['tur'].upper()}", resource_type="kokpit_aksiyon", resource_id=aksiyon_id)
    return jsonify({"ok": True, "id": aksiyon_id, "aliciSayisi": len(alici_ids), "tarih": simdi, "sonuc": sonuc})


# ================================================================ bildirimler + taslak odevler (alici tarafi)
@bp.route("/bildirimler.html")
def bildirimler_sayfasi():
    if "user_id" not in session:
        return redirect("/login.html")
    return S._safe_send("bildirimler.html")


@bp.route("/api/bildirimler")
def api_bildirimler():
    if "user_id" not in session:
        return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
    db = S.get_db()
    rows = db.execute("SELECT id, type, title, message, is_read, created_at, link FROM notifications "
                      "WHERE user_id = ? ORDER BY id DESC LIMIT 50", (session["user_id"],)).fetchall()
    return jsonify({"bildirimler": [{"id": r["id"], "baslik": r["title"], "metin": r["message"],
                                     "okundu": bool(r["is_read"]), "tarih": r["created_at"], "link": r["link"]}
                                    for r in rows],
                    "okunmamis": sum(1 for r in rows if not r["is_read"]), "rol": session.get("role")})


@bp.route("/api/bildirimler/<int:bid>/okundu", methods=["POST"])
def api_bildirim_okundu(bid):
    if "user_id" not in session:
        return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
    db = S.get_db()
    db.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", (bid, session["user_id"]))
    db.commit()
    return jsonify({"ok": True})


def _taslak_json(db, r, detay=False):
    out = {"id": r["id"], "sube": r["class_name"], "ders": r["subject"], "dersAd": K.baglam(_grade(r["class_name"]))["ad"].get(r["subject"], r["subject"]),
           "baslik": r["title"], "aciklama": r["description"], "mod": r["mode"], "durum": r["status"],
           "soruSayisi": r["question_count"], "kazanimlar": json.loads(r["kazanimlar_json"] or "[]"),
           "odevId": r["assignment_id"], "tarih": r["created_at"]}
    if detay:
        ids = json.loads(r["question_ids_json"] or "[]")
        out["sorular"] = _sorular(db, ids)
        subj = db.execute("SELECT id FROM subjects WHERE code = ?", (r["subject"],)).fetchone()
        out["subjectId"] = subj["id"] if subj else None
    return out


@bp.route("/api/kokpit/taslaklar")
def api_taslaklar():
    if session.get("role") != "teacher":
        return jsonify({"taslaklar": []})
    db = S.get_db()
    rows = db.execute("SELECT * FROM kokpit_odev_taslaklari WHERE teacher_id = ? ORDER BY id DESC LIMIT 50",
                      (session["user_id"],)).fetchall()
    return jsonify({"taslaklar": [_taslak_json(db, r) for r in rows]})


def _taslak_sahibi(db, tid):
    r = db.execute("SELECT * FROM kokpit_odev_taslaklari WHERE id = ?", (tid,)).fetchone()
    if not r or session.get("role") != "teacher" or r["teacher_id"] != session.get("user_id"):
        return None
    return r


@bp.route("/api/kokpit/taslaklar/<int:tid>")
def api_taslak(tid):
    if "user_id" not in session:
        return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
    db = S.get_db()
    r = _taslak_sahibi(db, tid)
    if not r:
        return jsonify({"error": "Taslak bulunamadı ya da size ait değil."}), 404
    return jsonify(_taslak_json(db, r, detay=True))


@bp.route("/api/kokpit/taslaklar/<int:tid>/durum", methods=["POST"])
def api_taslak_durum(tid):
    """Ogretmen taslagi yayinladiginda (odev mevcut POST /api/teacher/assignments
    ile olusturulduktan sonra) ya da reddettiginde taslagin durumunu isler."""
    if "user_id" not in session:
        return jsonify({"error": "Giriş yapmanız gerekiyor."}), 401
    db = S.get_db()
    r = _taslak_sahibi(db, tid)
    if not r:
        return jsonify({"error": "Taslak bulunamadı ya da size ait değil."}), 404
    if r["status"] != "taslak":
        return jsonify({"error": "Bu taslak zaten işlendi."}), 409
    g = request.get_json(silent=True) or {}
    durum = g.get("durum")
    odev_id = None
    if durum == "yayinlandi":
        odev_id = g.get("odevId")
        ok = db.execute("SELECT 1 FROM assignments WHERE id = ? AND teacher_id = ? AND organization_id = ?",
                        (odev_id, session["user_id"], r["organization_id"])).fetchone()
        if not ok:
            return jsonify({"error": "Yayınlanan ödev bulunamadı."}), 400
    elif durum != "reddedildi":
        return jsonify({"error": "Geçersiz durum."}), 400
    db.execute("UPDATE kokpit_odev_taslaklari SET status = ?, assignment_id = ?, updated_at = ? WHERE id = ?",
               (durum, odev_id, datetime.now().isoformat(timespec="seconds"), tid))
    db.commit()
    return jsonify({"ok": True})


# ================================================================ raporlar (sartname 7)
# Dosyalar herkese acik bir yolda DEGIL: BASE_DIR/.kokpit_raporlar (nokta ile
# baslayan yol statik sunumda engelli, .gitignore'da). Indirme yalnizca
# /api/kokpit/indir/<token> ile: token isi baslatan kullaniciya bagli, imzali
# ve RAPOR_LINK_OMRU saniyede gecersiz; ayrica oturum zorunlu.
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer  # noqa: E402

RAPOR_BEKLEME = 4.5  # bu surede biterse dogrudan baglanti doner, yoksa arka plan isi


def _rapor_dir():
    d = os.path.join(S.BASE_DIR, RAPOR_DIR_ADI)
    os.makedirs(d, exist_ok=True)
    return d


def _imzaci():
    return URLSafeTimedSerializer(S.app.secret_key, salt="kokpit-rapor-indir")


def _indir_linki(is_id, user_id):
    return "/api/kokpit/indir/" + _imzaci().dumps({"is": is_id, "u": user_id})


def ogrenci_net_listesi(db, org_id, seviye, exam_ids):
    if not exam_ids:
        return []
    ph = ",".join("?" * len(exam_ids))
    ogr = {s["id"]: s for s in db.execute(
        "SELECT id, first_name, last_name, school_number FROM students WHERE organization_id = ?", (org_id,)).fetchall()}
    den = {r["exam_id"]: r for r in db.execute(f"SELECT exam_id, ad, tarih FROM kokpit_deneme WHERE exam_id IN ({ph})",
                                               list(exam_ids)).fetchall()}
    out = []
    for r in db.execute(f"SELECT * FROM kokpit_ogrenci WHERE organization_id = ? AND grade IS ? AND exam_id IN ({ph}) "
                        f"ORDER BY class_name, student_id", (org_id, seviye, *exam_ids)).fetchall():
        s = ogr.get(r["student_id"])
        dersler = {k: v[3] for k, v in json.loads(r["ders_json"] or "{}").items()}
        out.append({"numara": s["school_number"] if s else None, "ad": _ogr_ad(s) if s else f"#{r['student_id']}",
                    "sube": r["class_name"], "deneme": den[r["exam_id"]]["ad"] if r["exam_id"] in den else r["exam_id"],
                    "tarih": den[r["exam_id"]]["tarih"] if r["exam_id"] in den else None, "dersler": dersler,
                    "toplamNet": r["toplam_net"], "d": r["d"], "y": r["y"], "puan": r["puan"]})
    out.sort(key=lambda o: (S._class_sort_key(o["sube"]), o["ad"], o["tarih"] or ""))
    return out


def _rapor_uret(is_id, okul_id, kapsam, fmt_, filtre, user_id):
    """Arka plan is parcacigi: kendi DB baglantisiyla calisir (Flask g yok)."""
    import kokpit_rapor
    conn = sqlite3.connect(S.DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=20000")
    try:
        v = acilis_verisi(conn, okul_id, kapsam, filtre.get("seviye"), args=filtre)
        veri = _okul_verisi(conn, okul_id, v["seviye"])
        ids = _ids(veri["denemeler"], v["donem"]["secili"])
        if fmt_ == "pdf":
            icerik = kokpit_rapor.pdf(v)
        else:
            icerik = kokpit_rapor.excel(v, ogrenci_net_listesi(conn, okul_id, v["seviye"], ids))
        yol = os.path.join(_rapor_dir(), f"{is_id}.{fmt_}")
        with open(yol, "wb") as f:
            f.write(icerik)
        conn.execute("UPDATE kokpit_rapor_isleri SET durum = 'hazir', dosya = ?, finished_at = ? WHERE id = ?",
                     (os.path.basename(yol), datetime.now().isoformat(timespec="seconds"), is_id))
        conn.commit()
    except Exception as e:  # rapor hatasi kokpiti dusurmesin, is satirinda gorunsun
        conn.execute("UPDATE kokpit_rapor_isleri SET durum = 'hata', hata = ?, finished_at = ? WHERE id = ?",
                     (str(e)[:500], datetime.now().isoformat(timespec="seconds"), is_id))
        conn.commit()
    finally:
        conn.close()


def _eski_raporlari_sil():
    sinir = time.time() - 24 * 3600
    try:
        for ad in os.listdir(_rapor_dir()):
            yol = os.path.join(_rapor_dir(), ad)
            if os.path.getmtime(yol) < sinir:
                os.remove(yol)
    except OSError:
        pass


def _is_yaniti(db, okul_id, is_id):
    r = db.execute("SELECT * FROM kokpit_rapor_isleri WHERE id = ? AND organization_id = ? AND user_id = ?",
                   (is_id, okul_id, session["user_id"])).fetchone()
    if not r:
        return None
    out = {"isId": r["id"], "durum": r["durum"], "format": r["format"]}
    if r["durum"] == "hazir":
        out["indir"] = _indir_linki(r["id"], session["user_id"])
        out["gecerlilikSn"] = RAPOR_LINK_OMRU
    elif r["durum"] == "hata":
        out["hata"] = r["hata"]
    return out


@bp.route("/api/okullar/<int:okul_id>/kokpit/rapor", methods=["POST"])
@_korumali()
def api_rapor(db, okul_id, kapsam):
    g = request.get_json(silent=True) or {}
    fmt_ = g.get("format")
    if fmt_ not in ("pdf", "xlsx"):
        return jsonify({"error": "Geçersiz format (pdf ya da xlsx)."}), 400
    filtre = {k: str(v)[:20] for k, v in (g.get("filtreler") or {}).items() if k in ("seviye", "donem", "bas", "bit") and v}
    _eski_raporlari_sil()
    is_id = uuid.uuid4().hex
    db.execute("INSERT INTO kokpit_rapor_isleri (id, organization_id, user_id, format, filtre_json, durum, created_at) "
               "VALUES (?,?,?,?,?, 'calisiyor', ?)", (is_id, okul_id, session["user_id"], fmt_, json.dumps(filtre),
                                                       datetime.now().isoformat(timespec="seconds")))
    db.commit()
    th = threading.Thread(target=_rapor_uret, args=(is_id, okul_id, kapsam, fmt_, filtre, session["user_id"]), daemon=True)
    th.start()
    th.join(RAPOR_BEKLEME)
    if th.is_alive():
        # 5 sn'den uzun suren rapor arka planda biter; istemci durum ucunu yoklar
        # ve hazir olunca kullaniciya bildirim gosterir.
        return jsonify({"isId": is_id, "durum": "calisiyor"}), 202
    S.log_audit(db, f"KOKPIT_RAPOR_{fmt_.upper()}", resource_type="organization", resource_id=okul_id)
    return jsonify(_is_yaniti(db, okul_id, is_id))


@bp.route("/api/okullar/<int:okul_id>/kokpit/rapor/<is_id>")
@_korumali()
def api_rapor_durum(db, okul_id, kapsam, is_id):
    out = _is_yaniti(db, okul_id, is_id)
    if not out:
        return jsonify({"error": "Rapor işi bulunamadı."}), 404
    return jsonify(out)


@bp.route("/api/kokpit/indir/<token>")
def api_rapor_indir(token):
    if "user_id" not in session:
        return jsonify({"error": "Raporu indirmek için giriş yapmanız gerekiyor."}), 401
    try:
        veri = _imzaci().loads(token, max_age=RAPOR_LINK_OMRU)
    except SignatureExpired:
        return jsonify({"error": "İndirme bağlantısının süresi doldu. Raporu yeniden oluşturun."}), 410
    except BadSignature:
        return jsonify({"error": "Geçersiz indirme bağlantısı."}), 403
    if veri.get("u") != session["user_id"]:
        return jsonify({"error": "Bu bağlantı başka bir kullanıcıya ait."}), 403
    db = S.get_db()
    r = db.execute("SELECT * FROM kokpit_rapor_isleri WHERE id = ? AND user_id = ?", (veri.get("is"), session["user_id"])).fetchone()
    if not r or r["durum"] != "hazir" or not r["dosya"]:
        return jsonify({"error": "Rapor bulunamadı."}), 404
    # okul yetkisi indirme aninda da kontrol edilir (yetki bu arada kalkmis olabilir)
    try:
        _yetki(db, r["organization_id"])
    except _Red as e:
        return jsonify({"error": e.mesaj}), e.kod
    yol = os.path.join(_rapor_dir(), os.path.basename(r["dosya"]))
    if not os.path.isfile(yol):
        return jsonify({"error": "Rapor dosyası artık yok. Raporu yeniden oluşturun."}), 410
    okul = re.sub(r"[^A-Za-z0-9]+", "-", _okul_adi(db, r["organization_id"]).translate(
        str.maketrans("ıİşŞçÇğĞöÖüÜ", "iIsScCgGoOuU"))).strip("-") or "okul"
    ad = f"okul-kokpiti-{okul}-{datetime.now():%Y%m%d}.{r['format']}"
    mime = "application/pdf" if r["format"] == "pdf" else \
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    resp = send_file(yol, mimetype=mime, as_attachment=True, download_name=ad)
    resp.headers["Cache-Control"] = "no-store"
    return resp
