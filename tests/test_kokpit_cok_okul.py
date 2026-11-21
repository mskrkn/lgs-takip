"""Okul Kokpiti - cok okullu test: kokpit her okul icin genel calisir.

Gercek kokpit rotalari (Flask test istemcisi) gecici bir SQLite uzerinde
calistirilir; server.py yerine yalnizca kokpit'in kullandigi yardimcilari
saglayan kucuk bir sahte katman kullanilir (gercek DB'ye dokunulmaz).

Dogrulananlar:
- yeni bir okul hicbir kurulum/ayar kaydi olmadan kokpit acar (varsayilan esikler)
- okul adi, sube adlari, ogrenci sayilari, seviyeler, dersler ve soru sayilari
  okulun kendi verisinden gelir (hicbiri Haruniye'ye ozel degil)
- 5-7. sinifta 'inkilap' Sosyal Bilgiler adini alir; LGS katsayilari/puani
  yalnizca LGS turu denemelerde uygulanir
- iki okulun verisi karismaz; okul A yoneticisi okul B'yi istediginde 403
- ozet tablo kurulduktan SONRA eklenen okul da otomatik calisir

Calistirma: python -m unittest tests.test_kokpit_cok_okul -v
"""
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from flask import Flask, g  # noqa: E402

import kokpit  # noqa: E402
import kokpit_hesap as K  # noqa: E402

SEMA = """
CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, display_name TEXT, class_name TEXT,
                    homeroom_class_name TEXT, subject TEXT, active INTEGER DEFAULT 1, organization_id INTEGER);
CREATE TABLE students (id INTEGER PRIMARY KEY, school_number TEXT, first_name TEXT, last_name TEXT,
                       class_name TEXT, organization_id INTEGER);
CREATE TABLE exams (id INTEGER PRIMARY KEY, name TEXT, date TEXT, exam_type TEXT, data_json TEXT, organization_id INTEGER);
CREATE TABLE results (id INTEGER PRIMARY KEY, student_id INTEGER, exam_id INTEGER, data_json TEXT, organization_id INTEGER);
CREATE TABLE parent_students (id INTEGER PRIMARY KEY, parent_user_id INTEGER, student_id INTEGER);
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT,
                            message TEXT, is_read INTEGER DEFAULT 0, created_at TEXT);
"""
PLATFORM = 99


class CokOkulTesti(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fd, cls.yol = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        c = sqlite3.connect(cls.yol)
        c.executescript(SEMA)
        c.commit()
        c.close()
        kokpit.init_schema(cls.yol)
        cls.c = sqlite3.connect(cls.yol)
        cls.c.row_factory = sqlite3.Row
        cls.sid = cls.eid = cls.rid = 0
        cls._veri_kur()

        app = Flask(__name__)
        app.secret_key = "test-anahtari"

        def get_db():
            if "db" not in g:
                g.db = sqlite3.connect(cls.yol)
                g.db.row_factory = sqlite3.Row
            return g.db

        @app.teardown_appcontext
        def kapat(_):
            db = g.pop("db", None)
            if db:
                db.close()

        sahte = types.SimpleNamespace(
            app=app, BASE_DIR=tempfile.gettempdir(), DB_PATH=cls.yol, get_db=get_db,
            has_permission=lambda db, uid, perm: uid == PLATFORM and perm == "organization.manage",
            _admin_subrole=lambda db, uid, rol: "INSTITUTION_ADMIN",
            log_audit=lambda *a, **k: None, _safe_send=lambda f: ("", 200),
            _class_sort_key=lambda c: (c or "",),
            teacher_class_list=lambda raw: None if (raw or "").strip() == "*" else [x.strip() for x in (raw or "").split(",") if x.strip()],
            branch_subject_key=lambda b: None, _auto_select_questions=lambda *a, **k: [],
        )
        kokpit.register(app, sahte)
        cls.app = app

    @classmethod
    def tearDownClass(cls):
        cls.c.close()
        for ext in ("", "-wal", "-shm"):
            try:
                os.remove(cls.yol + ext)
            except OSError:
                pass

    # ---------------------------------------------------------- veri
    @classmethod
    def _okul(cls, oid, ad, siniflar, admin_id):
        cls.c.execute("INSERT INTO organizations VALUES (?,?, 'active')", (oid, ad))
        cls.c.execute("INSERT INTO users (id, username, role, display_name, organization_id) VALUES (?,?, 'admin', ?, ?)",
                      (admin_id, f"admin{oid}", f"Müdür {oid}", oid))
        ogr = {}
        for cls_ad, n in siniflar.items():
            for _ in range(n):
                cls.sid += 1
                cls.c.execute("INSERT INTO students VALUES (?,?,?,?,?,?)",
                              (cls.sid, str(cls.sid), "Ad", f"Soyad{cls.sid}", cls_ad, oid))
                ogr.setdefault(cls_ad, []).append(cls.sid)
        return ogr

    @classmethod
    def _deneme(cls, oid, ad, tarih, grade, ogrenciler, d, y, tur="LGS", sorular=None):
        cls.eid += 1
        data = {"name": ad, "date": tarih, "gradeLevel": grade, "examType": tur}
        if sorular:
            data["questionCounts"] = sorular
        cls.c.execute("INSERT INTO exams VALUES (?,?,?,?,?,?)", (cls.eid, ad, tarih, tur, json.dumps(data), oid))
        sq = K.soru_sayilari(sorular)
        for sid in ogrenciler:
            cls.rid += 1
            subj = {k: {"correct": min(d, q), "wrong": min(y, q - min(d, q)), "blank": 0} for k, q in sq.items()}
            cls.c.execute("INSERT INTO results VALUES (?,?,?,?,?)", (cls.rid, sid, cls.eid, json.dumps({"subjects": subj}), oid))
        return cls.eid

    @classmethod
    def _veri_kur(cls):
        # Okul A: 8. siniflar, Haruniye'den farkli sube adlari
        a = cls._okul(1, "Atatürk Ortaokulu", {"8-A": 10, "8-C": 6}, 11)
        cls.A_8 = a
        cls._deneme(1, "A Deneme Ekim", "2026-10-10", 8, a["8-A"] + a["8-C"], 12, 3)
        cls._deneme(1, "A Deneme Kasım", "2026-11-12", 8, a["8-A"] + a["8-C"][:4], 14, 3)
        # Okul B: yalnizca 6. ve 7. siniflar, "6/1" bicimli sube adlari, 15 soruluk dersler
        b = cls._okul(2, "Cumhuriyet Ortaokulu", {"6/1": 7, "6/2": 5, "7/1": 4}, 22)
        cls.B = b
        s15 = {"turkce": 15, "matematik": 15, "fen": 15}
        cls._deneme(2, "B 6. sınıf Ekim", "2026-10-20", 6, b["6/1"] + b["6/2"], 8, 2, sorular=s15)
        cls._deneme(2, "B 6. sınıf Kasım", "2026-11-15", 6, b["6/1"] + b["6/2"], 9, 2, sorular=s15)
        # 7. sinif: LGS disi tur -> puan yok, katsayi x1
        cls._deneme(2, "B 7. sınıf konu tarama", "2026-11-01", 7, b["7/1"], 6, 1, tur="KONU")
        cls.c.execute("INSERT INTO users (id, username, role, display_name) VALUES (?, 'platform', 'super_admin', 'Platform')",
                      (PLATFORM,))
        cls.c.commit()

    def istemci(self, uid, rol="admin"):
        cl = self.app.test_client()
        with cl.session_transaction() as s:
            s["user_id"] = uid
            s["role"] = rol
        return cl

    def get(self, uid, yol, rol="admin"):
        r = self.istemci(uid, rol).get(yol)
        return r.status_code, r.get_json()

    # ---------------------------------------------------------- testler
    def test_okul_a_kendi_verisi(self):
        s, d = self.get(11, "/api/okullar/1/kokpit")
        self.assertEqual(s, 200)
        self.assertEqual(d["okul"]["ad"], "Atatürk Ortaokulu")
        self.assertEqual(d["seviyeler"], ["8"])
        self.assertEqual(d["kayitli"], 16)
        self.assertEqual([x["sube"] for x in d["subeler"]["satirlar"]], ["8-A", "8-C"])
        self.assertEqual(sum(c["katilan"] for c in d["katilim"]["cubuklar"]), 16 + 14)
        self.assertEqual(d["kartlar"]["toplamNet"]["soru"], 90)  # LGS varsayilan soru sayilari
        self.assertTrue(d["kartlar"]["puan"]["lgs"])
        self.assertIsNotNone(d["kartlar"]["puan"]["deger"])

    def test_okul_a_yoneticisi_okul_b_icin_403(self):
        for yol in ("", "/ayarlar", "/veri-durumu", "/subeler/6%2F1", "/dersler/matematik",
                    "/katilmayanlar?deneme=3", "/aksiyonlar"):
            s, _ = self.get(11, f"/api/okullar/2/kokpit{yol}")
            self.assertEqual(s, 403, yol)
        r = self.istemci(11).post("/api/okullar/2/kokpit/rapor", json={"format": "pdf"})
        self.assertEqual(r.status_code, 403)
        r = self.istemci(11).put("/api/okullar/2/kokpit/ayarlar", json={"ayarlar": {"katilimHedef": 50}})
        self.assertEqual(r.status_code, 403)
        s, _ = self.get(22, "/api/okullar/1/kokpit")
        self.assertEqual(s, 403)

    def test_yeni_okul_kurulumsuz_varsayilanlarla_calisir(self):
        self.assertIsNone(self.c.execute("SELECT 1 FROM kokpit_ayarlar WHERE organization_id = 2").fetchone())
        s, d = self.get(22, "/api/okullar/2/kokpit?seviye=6")
        self.assertEqual(s, 200)
        self.assertEqual(d["okul"]["ad"], "Cumhuriyet Ortaokulu")
        self.assertEqual(d["ayarlar"], K.VARSAYILAN_AYARLAR)
        self.assertEqual(d["seviyeler"], ["6", "7"])
        self.assertEqual(d["kayitli"], 12)
        self.assertEqual([x["sube"] for x in d["subeler"]["satirlar"]], ["6/1", "6/2"])
        # questionCounts: turkce/mat/fen 15, digerleri varsayilan 10 -> 75
        self.assertEqual(d["kartlar"]["toplamNet"]["soru"], 75)
        self.assertEqual(d["dersAdlari"]["inkilap"]["ad"], "Sosyal Bilgiler")
        self.assertIn(d["donem"]["once"]["etiket"], ("Ekim",))
        # okul A'nin hicbir subesi/ogrencisi B'de yok
        self.assertFalse({"8-A", "8-C"} & {x["sube"] for x in d["subeler"]["satirlar"]})

    def test_lgs_disi_turde_puan_ve_katsayi_yok(self):
        s, d = self.get(22, "/api/okullar/2/kokpit?seviye=7")
        self.assertEqual(s, 200)
        self.assertFalse(d["kartlar"]["puan"]["lgs"])
        self.assertIsNone(d["kartlar"]["puan"]["deger"])
        self.assertEqual({x["katsayi"] for x in d["dersler"]["liste"]}, {1})
        self.assertEqual(d["kartlar"]["kaldirac"]["katsayi"], 1)

    def test_varsayilan_seviye_okulun_en_son_denemesinden(self):
        s, d = self.get(22, "/api/okullar/2/kokpit")
        self.assertEqual(d["seviye"], "6")  # 15.11 (6. sinif) en son deneme

    def test_ozet_tablo_okullari_karistirmaz(self):
        self.get(11, "/api/okullar/1/kokpit")
        self.get(22, "/api/okullar/2/kokpit")
        for oid, sids in ((1, {s for v in self.A_8.values() for s in v}), (2, {s for v in self.B.values() for s in v})):
            satir = {r[0] for r in self.c.execute("SELECT student_id FROM kokpit_ogrenci WHERE organization_id = ?", (oid,))}
            self.assertTrue(satir and satir <= sids, oid)
        a_exams = {r[0] for r in self.c.execute("SELECT id FROM exams WHERE organization_id = 1")}
        self.assertEqual({r[0] for r in self.c.execute("SELECT DISTINCT exam_id FROM kokpit_ozet WHERE organization_id = 1")},
                         a_exams)

    def test_ayar_okula_ozel(self):
        r = self.istemci(11).put("/api/okullar/1/kokpit/ayarlar", json={"ayarlar": {"katilimHedef": 70}})
        self.assertEqual(r.status_code, 200)
        _, a = self.get(11, "/api/okullar/1/kokpit/ayarlar")
        _, b = self.get(22, "/api/okullar/2/kokpit/ayarlar")
        self.assertEqual(a["ayarlar"]["katilimHedef"], 70)
        self.assertEqual(b["ayarlar"]["katilimHedef"], K.VARSAYILAN_AYARLAR["katilimHedef"])
        self.istemci(11).put("/api/okullar/1/kokpit/ayarlar", json={"ayarlar": {"katilimHedef": 90}})

    def test_sonradan_eklenen_okul_otomatik_calisir(self):
        self.get(11, "/api/okullar/1/kokpit")  # ozet tablo zaten kurulu
        c = self._okul(3, "Yeni Eklenen Ortaokulu", {"5-A": 3}, 33)
        self._deneme(3, "İlk deneme", "2026-11-20", 5, c["5-A"], 10, 2, sorular={"turkce": 15, "matematik": 15, "fen": 15})
        self.c.commit()
        s, d = self.get(33, "/api/okullar/3/kokpit")
        self.assertEqual(s, 200)
        self.assertEqual((d["seviye"], d["kayitli"], d["degerlendirilen"]), ("5", 3, 1))
        self.assertEqual(d["kartlar"]["katilim"]["katilan"], 3)
        s, _ = self.get(11, "/api/okullar/3/kokpit")
        self.assertEqual(s, 403)

    def test_platform_iki_okulu_da_gorur(self):
        for oid in (1, 2):
            s, _ = self.get(PLATFORM, f"/api/okullar/{oid}/kokpit", rol="super_admin")
            self.assertEqual(s, 200)
        s, _ = self.get(PLATFORM, "/api/okullar/404/kokpit", rol="super_admin")
        self.assertEqual(s, 404)

    def test_ogretmen_ve_oturumsuz(self):
        s, _ = self.get(11, "/api/okullar/1/kokpit", rol="teacher")
        self.assertEqual(s, 403)
        self.assertEqual(self.app.test_client().get("/api/okullar/1/kokpit").status_code, 401)


if __name__ == "__main__":
    unittest.main()
