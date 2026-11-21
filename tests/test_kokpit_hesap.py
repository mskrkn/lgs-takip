"""Okul Kokpiti hesaplama modulu testleri (sartname Bolum 11).

Calistirma (repo kokunde):  python -m unittest tests.test_kokpit_hesap -v

Bolum 11'deki Haruniye degerleri edesis raporlarindan alinan ORTALAMALARDIR,
ogrenci duzeyinde veri yok ve sayilar kendi aralarinda birebir tutarli degil
(ör. sube puanlarinin katilimla agirlikli ortalamasi okul puanini vermiyor).
Bu yuzden sartnamenin izin verdigi gibi analiz katmani OZET TABLO SEVIYESINDE
test edilir: istatistik() ciktisiyla ayni bicimde donem istatistikleri bu
ortalamalardan kurulur ve acilis_analizi()/uyarilar() sonuclari +-0,01 ile
karsilastirilir. Toplama katmani (istatistik, sonuc_ozeti) ayrica kucuk
sentetik ogrenci verisiyle test edilir.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import kokpit_hesap as K  # noqa: E402

TOL = 0.01


def ders(net, soru):
    return {"net": net, "soru": soru, "oran": net / soru, "dogru": None, "yanlis": None, "bos": None, "n": 1}


def ist(dersler=None, puan=None, yanlis=None, dogru=None, n=1, deneme=1, subeler=None, toplam_net=None):
    """istatistik() cikti bicimi."""
    dersler = {k: ders(v, K.VARSAYILAN_SORU[k]) for k, v in (dersler or {}).items()}
    return {
        "n": n, "denemeSayisi": deneme, "dersler": dersler,
        "toplamNet": toplam_net if toplam_net is not None else sum(d["net"] for d in dersler.values()),
        "toplamSoru": sum(d["soru"] for d in dersler.values()),
        "puan": puan, "yanlis": yanlis, "dogru": dogru, "bos": None,
        "subeler": subeler or {}, "ogrenci": None,
    }


def sube(ogrenci=None, toplam_net=None, puan=None, dogru=None, yanlis=None, dersler=None, n=1):
    s = ist(dersler=dersler, puan=puan, yanlis=yanlis, dogru=dogru, n=n, toplam_net=toplam_net)
    s["ogrenci"] = ogrenci
    return s


# ------------------------------------------------------------ Bolum 11 verisi
OKUL_9 = {"turkce": 13.65, "inkilap": 7.28, "din": 6.80, "ingilizce": 5.27, "matematik": 10.86, "fen": 12.83}
EKIM = {"turkce": 13.62, "matematik": 11.14, "fen": 13.13, "inkilap": 7.40, "din": 6.16, "ingilizce": 5.15}
KASIM = {"turkce": 13.67, "matematik": 10.64, "fen": 12.59, "inkilap": 7.18, "din": 7.30, "ingilizce": 5.37}
# Okul ortalama yanlisi = subelerin ogrenci sayisiyla agirlikli ortalamasi (Bolum 11 notu)
OKUL_YANLIS = (44 * 15.71 + 40 * 19.09 + 39 * 26.28) / 123

KATILIM = [  # (tarih, ad, katilan) kayitli 125
    ("2026-10-13", "Ankara Güç.", 111), ("2026-10-14", "Newton", 71), ("2026-10-21", "Günay Zoom", 68),
    ("2026-10-23", "Mozaik", 119), ("2026-10-28", "Yanıt Prova", 0), ("2026-11-07", "İşleyen Zeka", 104),
    ("2026-11-10", "Paraf", 101), ("2026-11-15", "Sinan Kuzucu", 95), ("2026-11-17", "Paylaşım", 90),
    ("2026-11-18", "Krallar K.", 89),
]


def haruniye():
    cur = ist(OKUL_9, puan=378.80, yanlis=OKUL_YANLIS, n=848, deneme=9, subeler={
        "8-B": sube(44, 64.07, 407.08, 69.31, 15.71, n=300),
        "8-E": sube(40, 59.67, 389.98, 66.03, 19.09, n=280),
        "8-F": sube(39, 47.35, 343.70, 56.11, 26.28, n=268),
    })
    once = ist(EKIM, puan=379.48, n=369, deneme=4, subeler={
        "8-B": sube(puan=409.60, dersler={"turkce": 16.12}),
        "8-E": sube(puan=398.52, dersler={"matematik": 12.60, "fen": 14.31}),
        "8-F": sube(puan=342.65),
    })
    sonra = ist(KASIM, puan=378.27, n=479, deneme=5, subeler={
        "8-B": sube(puan=405.80, dersler={"turkce": 15.09}),
        "8-E": sube(puan=382.42, dersler={"matematik": 10.65, "fen": 12.57}),
        "8-F": sube(puan=344.67),
    })
    katilim = [{"id": i + 1, "ad": ad, "tarih": t, "katilan": n, "kayitli": 125}
               for i, (t, ad, n) in enumerate(KATILIM)]
    donem = K.donem_coz("tum", [t for t, _, _ in KATILIM])
    return cur, once, sonra, katilim, donem


class Bolum11Testleri(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cur, cls.once, cls.sonra, cls.katilim, cls.donem = haruniye()
        cls.ayar = K.ayarlari_birlestir()
        cls.a = K.acilis_analizi(cls.cur, cls.once, cls.sonra, cls.katilim, cls.ayar, cls.donem)

    def yakin(self, a, b):
        self.assertIsNotNone(a)
        self.assertAlmostEqual(a, b, delta=TOL)

    def test_donem_tum_karsilastirma_ekim_kasim(self):
        self.assertEqual(self.donem["egitimYili"], "2026–2027")
        self.assertEqual(self.donem["once"]["etiket"], "Ekim")
        self.assertEqual(self.donem["sonra"]["etiket"], "Kasım")

    def test_toplam_net_ve_puan_karti(self):
        k = self.a["kartlar"]
        self.yakin(k["toplamNet"]["deger"], 56.69)
        self.yakin(k["toplamNet"]["soru"], 90)
        self.yakin(k["puan"]["deger"], 378.80)
        self.yakin(k["puan"]["once"], 379.48)
        self.yakin(k["puan"]["sonra"], 378.27)
        self.yakin(k["puan"]["fark"], -1.21)

    def test_basari_oranlari(self):
        beklenen = {"inkilap": 73, "turkce": 68, "din": 68, "fen": 64, "matematik": 54, "ingilizce": 53}
        liste = self.a["dersler"]["liste"]
        self.assertEqual([d["ders"] for d in liste], ["inkilap", "turkce", "din", "fen", "matematik", "ingilizce"])
        for d in liste:
            self.assertEqual(round(d["oran"] * 100), beklenen[d["ders"]], d["ders"])
        self.assertEqual({d["ders"] for d in liste if d["esikAlti"]}, {"matematik", "ingilizce"})
        self.assertEqual(self.a["dersler"]["baslik"], "Matematik ve İngilizce %55'in altında")

    def test_kaldirac_matematik(self):
        k = self.a["kartlar"]["kaldirac"]
        self.assertEqual(k["ders"], "matematik")
        self.yakin(k["acik"], 36.56)
        self.yakin(k["degisim"], -0.50)
        self.assertEqual(k["katsayi"], 4)

    def test_donem_degisimi(self):
        d = {s["ders"]: s for s in self.a["degisim"]["dersler"]}
        for k, v in {"turkce": 0.05, "matematik": -0.50, "fen": -0.54, "inkilap": -0.22,
                     "din": 1.14, "ingilizce": 0.22}.items():
            self.yakin(d[k]["fark"], v)
        self.assertTrue(d["matematik"]["belirgin"])   # tam 0,50 -> belirgin
        self.assertFalse(d["inkilap"]["belirgin"])
        self.assertEqual(self.a["degisim"]["baslik"], "Kasımda fen ve matematik geriledi")

    def test_sube_tablosu(self):
        t = {s["sube"]: s for s in self.a["subeler"]["satirlar"]}
        self.assertEqual(list(t), ["8-B", "8-E", "8-F"])
        for cls, (ogr, net, puan, yanlis) in {"8-B": (44, 64.07, 407.08, 15.71), "8-E": (40, 59.67, 389.98, 19.09),
                                              "8-F": (39, 47.35, 343.70, 26.28)}.items():
            self.assertEqual(t[cls]["ogrenci"], ogr)
            self.yakin(t[cls]["toplamNet"], net)
            self.yakin(t[cls]["puan"], puan)
            self.yakin(t[cls]["yanlis"], yanlis)
        self.yakin(t["8-B"]["puanFark"], -3.80)
        self.yakin(t["8-E"]["puanFark"], -16.10)
        self.yakin(t["8-F"]["puanFark"], 2.02)
        self.assertEqual((t["8-B"]["trend"], t["8-E"]["trend"], t["8-F"]["trend"]), ("sabit", "dusus", "artis"))
        self.assertEqual(self.a["subeler"]["varsayilanDersler"], ["ingilizce", "matematik"])
        self.assertEqual(self.a["subeler"]["baslik"], "8-F, 8-B'nin 16,7 net gerisinde")

    def test_okul_ortalama_yanlis(self):
        self.yakin(OKUL_YANLIS, 20.16)

    def test_katilim(self):
        k = self.a["kartlar"]["katilim"]
        self.yakin(k["deger"], 0.712)
        self.assertEqual((k["katilan"], k["kayitli"], k["girmeyen"]), (89, 125, 36))
        g = self.a["katilim"]
        self.assertEqual([c["katilan"] for c in g["cubuklar"]], [n for _, _, n in KATILIM])
        self.assertFalse(g["cubuklar"][4]["yuklendi"])
        self.assertEqual([c["hedefAlti"] for c in g["cubuklar"]],
                         [n > 0 and n / 125 < 0.9 for _, _, n in KATILIM])
        self.assertEqual(g["baslik"], "Katılım kasımda 104'ten 89'a indi")

    def test_uyarilar(self):
        u = self.a["uyarilar"]
        self.assertEqual([x["kod"] for x in u],
                         ["SUBE_PUAN_DUSUS", "DERS_NET_DUSUS", "YANLIS_YUKSEK", "SUBE_ACIK", "KATILIM_DUSUK"])
        sp = u[0]
        self.assertEqual(sp["hedef"], {"sube": "8-E"})
        self.yakin(sp["veri"]["fark"], -16.10)
        self.assertEqual(sp["baslik"], "8-E kasımda 16,1 puan düştü")
        dd = {x["ders"]: x["fark"] for x in sp["veri"]["dersler"]}
        self.yakin(dd["matematik"], -1.95)
        self.yakin(dd["fen"], -1.74)
        self.assertTrue(sp["detay"].startswith("Matematik −1,95 net, Fen −1,74 net."))
        self.assertEqual(sp["aksiyon"]["tur"], "ogretmen_bildirim")

        dn = u[1]
        self.assertEqual(dn["hedef"], {"sube": "8-B", "ders": "turkce"})
        self.yakin(dn["veri"]["fark"], -1.03)

        y = u[2]
        self.assertEqual(y["hedef"], {"sube": "8-F"})
        self.yakin(y["veri"]["yanlis"], 26.28)
        self.yakin(y["veri"]["okulYanlis"], 20.16)
        self.assertEqual(round(y["veri"]["fazlaYuzde"]), 30)
        self.yakin(y["veri"]["kayipNet"], 8.76)
        self.assertEqual(y["baslik"], "8-F'de yanlış sayısı çok yüksek")
        self.assertEqual(y["aksiyon"]["tur"], "odev_oneri")

        a = u[3]
        self.assertEqual((a["hedef"]["sube"], a["veri"]["enIyi"]), ("8-F", "8-B"))
        self.yakin(a["veri"]["acik"], 16.72)

        k = u[4]
        self.yakin(k["veri"]["oran"], 0.712)
        self.assertEqual(k["baslik"], "Son deneme katılımı %71")
        self.assertEqual(k["aksiyon"]["tur"], "veli_bildirim")

    def test_veri_eksik(self):
        v = K.veri_durumu(self.katilim)
        self.assertEqual([d["tarih"] for d in v["yuklenmemis"]], ["2026-10-28"])
        self.assertEqual(v["uyari"]["kod"], "VERI_EKSIK")
        self.assertEqual(v["sorunsuzSayisi"], 9)

    def test_esik_ayari_uyarilari_degistirir(self):
        ayar = K.ayarlari_birlestir({"subePuanDusus": 20, "katilimHedef": 70})
        u = K.uyarilar(self.cur, self.once, self.sonra, self.katilim, ayar, "Kasım", "tum", self.donem["sonra"])
        kodlar = [(x["kod"], x["hedef"].get("sube"), x["hedef"].get("ders")) for x in u]
        self.assertNotIn(("SUBE_PUAN_DUSUS", "8-E", None), kodlar)
        # puan dususu uyarisi kalkinca 8-E'nin ders dususleri ayri satir olur
        self.assertIn(("DERS_NET_DUSUS", "8-E", "matematik"), kodlar)
        self.assertIn(("DERS_NET_DUSUS", "8-E", "fen"), kodlar)
        # %71 > %70 hedef ama son 3 deneme 95 > 90 > 89 surekli dusus -> yine uyari
        kat = [x for x in u if x["kod"] == "KATILIM_DUSUK"]
        self.assertTrue(kat and kat[0]["veri"]["surekliDusus"])


class TemelKuralTestleri(unittest.TestCase):
    def test_net(self):
        self.assertAlmostEqual(K.net(10, 3), 9.0)
        self.assertAlmostEqual(K.net(15, 4), 15 - 4 / 3)

    def test_lgs_puani_arayuzu(self):
        tam = K.lgs_puani(dict(K.VARSAYILAN_SORU))
        self.assertAlmostEqual(tam["puan"], 500.0)
        self.assertTrue(tam["yaklasik"])
        self.assertAlmostEqual(K.lgs_puani({})["puan"], K.PUAN_TABAN)
        # x4 dersler x1 derslerden dort kat agir
        a = K.lgs_puani({"matematik": 5})["puan"] - K.PUAN_TABAN
        b = K.lgs_puani({"din": 5})["puan"] - K.PUAN_TABAN
        self.assertAlmostEqual(a, 4 * b)

    def test_sonuc_ozeti_net_yeniden_hesaplanir(self):
        veri = {"subjects": {k: {"correct": 9, "wrong": 3, "blank": 0, "net": 99} for k in K.VARSAYILAN_SORU}}
        o = K.sonuc_ozeti(veri)
        self.assertAlmostEqual(o["dersler"]["turkce"]["net"], 8.0)
        self.assertAlmostEqual(o["toplamNet"], 48.0)
        self.assertFalse(o["eksik"])
        self.assertTrue(o["puanYaklasik"])

    def test_sonuc_ozeti_eksik_ve_hazir_puan(self):
        veri = {"lgsPuan": 412.5, "subjects": {"turkce": {"correct": 10, "wrong": 0}}}
        o = K.sonuc_ozeti(veri)
        self.assertTrue(o["eksik"])
        self.assertEqual(o["puan"], 412.5)
        self.assertFalse(o["puanYaklasik"])

    def test_bicim(self):
        self.assertEqual(K.fmt(16.104), "16,10")
        self.assertEqual(K.fmt_isaret(-0.5), "−0,50")
        self.assertEqual(K.fmt_isaret(1.14), "+1,14")
        self.assertEqual(K.ek("8-B", "in"), "8-B'nin")
        self.assertEqual(K.ek("18,1", "den"), "18,1'den")
        self.assertEqual(K.ek("20,0", "e"), "20,0'a")


class DonemTestleri(unittest.TestCase):
    def test_ay(self):
        d = K.donem_coz("2026-11", [])
        self.assertEqual((d["secili"]["bas"], d["secili"]["bit"]), ("2026-11-01", "2026-11-30"))
        self.assertEqual(d["once"]["etiket"], "Ekim")

    def test_ocak_onceki_aralik(self):
        d = K.donem_coz("2027-01", [])
        self.assertEqual((d["once"]["bas"], d["once"]["bit"]), ("2026-12-01", "2026-12-31"))

    def test_ozel_aralik_ayni_uzunluk(self):
        d = K.donem_coz("ozel", [], bas="2026-11-11", bit="2026-11-20")
        self.assertEqual((d["once"]["bas"], d["once"]["bit"]), ("2026-11-01", "2026-11-10"))

    def test_gecersiz_tum_doneme_duser(self):
        self.assertEqual(K.donem_coz("ozel", ["2026-10-01"], bas="x", bit="y")["kod"], "tum")
        self.assertEqual(K.donem_coz("2026-13", ["2026-10-01"])["kod"], "tum")


class ToplamaTestleri(unittest.TestCase):
    """istatistik(): donem ortalamasi ogrenci-deneme sonuclarinin ortalamasi."""

    def satir(self, exam, cls, subject, nets, puan=None, wrongs=None):
        wrongs = wrongs or [0] * len(nets)
        return {"exam_id": exam, "class_name": cls, "subject": subject, "n": len(nets),
                "sum_d": sum(n + w / 3 for n, w in zip(nets, wrongs)), "sum_y": sum(wrongs), "sum_b": 0,
                "sum_net": sum(nets), "sum_q": 20 * len(nets),
                "sum_puan": sum(puan) if puan else 0, "n_puan": len(puan) if puan else 0}

    def test_ogrenci_deneme_ortalamasi(self):
        ozet = [
            self.satir(1, "8-A", "matematik", [10, 20]), self.satir(1, "8-A", "*", [10, 20], [300, 400], [3, 6]),
            self.satir(2, "8-A", "matematik", [30]), self.satir(2, "8-A", "*", [30], [500], [0]),
        ]
        katilim = [(1, 1, "8-A"), (1, 2, "8-A"), (2, 1, "8-A")]
        s = K.istatistik(ozet, katilim)
        # (10+20+30)/3 = 20, deneme ortalamalarinin ortalamasi (15+30)/2 = 22,5 DEGIL
        self.assertAlmostEqual(s["dersler"]["matematik"]["net"], 20.0)
        self.assertAlmostEqual(s["puan"], 400.0)
        self.assertAlmostEqual(s["yanlis"], 3.0)
        self.assertEqual(s["n"], 3)
        self.assertEqual(s["subeler"]["8-A"]["ogrenci"], 2)  # en az bir denemeye giren
        self.assertEqual(s["denemeSayisi"], 2)
        # yalniz 2. deneme
        s2 = K.istatistik(ozet, katilim, deneme_idleri={2})
        self.assertAlmostEqual(s2["dersler"]["matematik"]["net"], 30.0)
        self.assertEqual(s2["subeler"]["8-A"]["ogrenci"], 1)

    def test_toplam_net_ders_ortalamalarinin_toplami(self):
        ozet = [self.satir(1, "8-A", "turkce", [10]), self.satir(1, "8-A", "matematik", [5, 7]),
                self.satir(1, "8-A", "*", [15, 7])]
        s = K.istatistik(ozet, [])
        self.assertAlmostEqual(s["toplamNet"], 10 + 6)

    def test_risk_listesi(self):
        ogr = [{"id": i, "ad": str(i), "net": float(n), "oncekiNet": p}
               for i, (n, p) in enumerate([(40, 50), (60, 61), (70, None), (80, 79), (90, 90)])]
        r = K.risk_listesi(ogr, K.ayarlari_birlestir())
        self.assertEqual([o["id"] for o in r], [0])
        self.assertEqual(len(r[0]["nedenler"]), 2)

    def test_ayar_dogrulama(self):
        temiz, hata = K.ayarlari_dogrula({"basariEsigi": "55,5", "katilimHedef": 150, "x": 1})
        self.assertEqual(temiz, {"basariEsigi": 55.5})
        self.assertEqual(len(hata), 2)


if __name__ == "__main__":
    unittest.main()
