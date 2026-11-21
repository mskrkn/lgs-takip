"""Kokpit ozet tablosu + tetikleyiciler (gecici SQLite, sunucu gerekmez).

Calistirma: python -m unittest tests.test_kokpit_ozet -v
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import kokpit  # noqa: E402
import kokpit_hesap as K  # noqa: E402

MIN_SCHEMA = """
CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
CREATE TABLE students (id INTEGER PRIMARY KEY, school_number TEXT, first_name TEXT, last_name TEXT,
                       class_name TEXT, organization_id INTEGER);
CREATE TABLE exams (id INTEGER PRIMARY KEY, name TEXT, date TEXT, exam_type TEXT, data_json TEXT,
                    organization_id INTEGER);
CREATE TABLE results (id INTEGER PRIMARY KEY, student_id INTEGER, exam_id INTEGER, data_json TEXT,
                      organization_id INTEGER);
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT,
                            message TEXT, is_read INTEGER DEFAULT 0, created_at TEXT);
"""


def sonuc(d, y, b=0):
    return {"subjects": {k: {"correct": d, "wrong": y, "blank": b} for k in K.VARSAYILAN_SORU}}


class OzetTablosuTestleri(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        c = sqlite3.connect(self.path)
        c.executescript(MIN_SCHEMA)
        c.commit()
        c.close()
        kokpit.init_schema(self.path)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        db = self.db
        db.execute("INSERT INTO organizations VALUES (1,'A Okulu','active'),(2,'B Okulu','active')")
        for i, cls in enumerate(["8-A", "8-A", "8-B", "8-B", "7-A"], start=1):
            db.execute("INSERT INTO students VALUES (?,?,?,?,?,1)", (i, str(i), f"Ad{i}", "Soyad", cls))
        db.execute("INSERT INTO students VALUES (99,'99','Baska','Okul','8-A',2)")
        db.execute("INSERT INTO exams VALUES (1,'D1','2026-10-10','LGS',?,1)", (json.dumps({"gradeLevel": 8}),))
        db.execute("INSERT INTO exams VALUES (2,'D2','2026-11-05','LGS','{}',1)")
        db.execute("INSERT INTO exams VALUES (3,'Yuklenmedi','2026-11-08','LGS',?,1)", (json.dumps({"gradeLevel": 8}),))
        db.execute("INSERT INTO exams VALUES (4,'OMR','2026-11-09','optik_kamera','{}',1)")
        rid = 1
        for exam, sid, d, y in [(1, 1, 15, 3), (1, 2, 12, 6), (1, 3, 18, 0), (2, 1, 16, 3), (2, 3, 10, 9),
                                (2, 99, 20, 0)]:
            db.execute("INSERT INTO results VALUES (?,?,?,?,1)", (rid, sid, exam, json.dumps(sonuc(d, y))))
            rid += 1
        db.commit()

    def tearDown(self):
        self.db.close()
        for ext in ("", "-wal", "-shm"):
            try:
                os.remove(self.path + ext)
            except OSError:
                pass

    def ozet(self):
        return [dict(r) for r in self.db.execute("SELECT * FROM kokpit_ozet WHERE organization_id=1")]

    def test_ilk_kurulum_ve_toplamlar(self):
        self.assertEqual(kokpit.ozet_guncelle(self.db, 1), 4)
        d = {r["exam_id"]: dict(r) for r in self.db.execute("SELECT * FROM kokpit_deneme")}
        self.assertEqual(d[1]["katilan"], 3)
        self.assertEqual(d[2]["katilan"], 2)  # baska okulun ogrencisi (99) sayilmaz
        self.assertEqual(d[2]["grade"], "8")  # gradeLevel yok -> katilimcilarin baskin kademesi
        self.assertEqual(d[3]["katilan"], 0)
        self.assertEqual(d[4]["genel"], 0)
        katilim = [(r["exam_id"], r["student_id"], r["class_name"]) for r in self.db.execute(
            "SELECT * FROM kokpit_ogrenci WHERE organization_id=1")]
        s = K.istatistik(self.ozet(), katilim, {1, 2})
        # ders neti 6 ders x (d - y/3); ogrenci-deneme ortalamasi
        beklenen_mat = ((15 - 1) + (12 - 2) + 18 + (16 - 1) + (10 - 3)) / 5
        self.assertAlmostEqual(s["dersler"]["matematik"]["net"], beklenen_mat)
        self.assertAlmostEqual(s["toplamNet"], 6 * beklenen_mat)
        self.assertAlmostEqual(s["yanlis"], 6 * (3 + 6 + 0 + 3 + 9) / 5)
        self.assertEqual(s["subeler"]["8-A"]["ogrenci"], 2)
        self.assertEqual(s["subeler"]["8-B"]["ogrenci"], 1)
        self.assertIsNotNone(s["puan"])
        # tekrar cagri: kirli yok -> hicbir sey yeniden kurulmaz
        self.assertEqual(kokpit.ozet_guncelle(self.db, 1), 0)

    def test_tetikleyiciler(self):
        kokpit.ozet_guncelle(self.db, 1)
        # yeni sonuc -> o deneme kirli
        self.db.execute("INSERT INTO results VALUES (50,2,2,?,1)", (json.dumps(sonuc(20, 0)),))
        self.db.commit()
        self.assertEqual([r[0] for r in self.db.execute("SELECT exam_id FROM kokpit_kirli")], [2])
        self.assertEqual(kokpit.ozet_guncelle(self.db, 1), 1)
        self.assertEqual(self.db.execute("SELECT katilan FROM kokpit_deneme WHERE exam_id=2").fetchone()[0], 3)
        # ogrenci sube degisikligi -> girdigi denemeler kirli, satirlar yeni subeye gecer
        self.db.execute("UPDATE students SET class_name='8-B' WHERE id=2")
        self.db.commit()
        self.assertEqual(sorted(r[0] for r in self.db.execute("SELECT exam_id FROM kokpit_kirli")), [1, 2])
        kokpit.ozet_guncelle(self.db, 1)
        self.assertEqual(self.db.execute(
            "SELECT class_name FROM kokpit_ogrenci WHERE student_id=2 AND exam_id=1").fetchone()[0], "8-B")
        # sonuc silme ve deneme silme
        self.db.execute("DELETE FROM results WHERE exam_id=1")
        self.db.execute("DELETE FROM exams WHERE id=1")
        self.db.commit()
        kokpit.ozet_guncelle(self.db, 1)
        self.assertIsNone(self.db.execute("SELECT 1 FROM kokpit_deneme WHERE exam_id=1").fetchone())
        self.assertIsNone(self.db.execute("SELECT 1 FROM kokpit_ozet WHERE exam_id=1").fetchone())

    def test_null_exam_id_tetikleyiciyi_bozmaz(self):
        kokpit.ozet_guncelle(self.db, 1)
        self.db.execute("INSERT INTO results VALUES (60,1,NULL,'{}',1)")
        self.db.commit()
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM kokpit_kirli").fetchone()[0], 0)

    def test_eksik_karne(self):
        self.db.execute("INSERT INTO results VALUES (70,4,1,?,1)",
                        (json.dumps({"subjects": {"turkce": {"correct": 10, "wrong": 0}}}),))
        self.db.commit()
        kokpit.ozet_guncelle(self.db, 1)
        self.assertEqual(self.db.execute("SELECT eksik_karne FROM kokpit_deneme WHERE exam_id=1").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
