"""Okul Kokpiti aksiyon akisi - CANLI test sunucusuna karsi uctan uca (unittest degil).

Kullanim: test DB ile sunucuyu 127.0.0.1:8099de baslatip
    python tests/test_kokpit_aksiyon_canli.py <test_db_yolu>
Gercek (uretim) veritabaninda CALISTIRMAYIN: bildirim ve taslak yazar."""
import json
import sqlite3
import sys
import urllib.request
import http.cookiejar

B = "http://127.0.0.1:8099"
DB = sys.argv[1]


class Oturum:
    def __init__(self, kullanici):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.istek("/api/login", {"username": kullanici, "password": "Test1234!"})

    def istek(self, yol, govde=None, method=None):
        data = json.dumps(govde).encode() if govde is not None else None
        req = urllib.request.Request(B + yol, data=data, method=method or ("POST" if data else "GET"),
                                     headers={"Content-Type": "application/json"})
        try:
            with self.op.open(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")


def kontrol(ad, kosul, ek=""):
    print(("OK  " if kosul else "HATA") + f" {ad} {ek}")
    if not kosul:
        kontrol.hata += 1


kontrol.hata = 0
admin = Oturum("okul_admin")
_, d = admin.istek("/api/okullar/2/kokpit")
uyari = {u["kod"]: u for u in d["uyarilar"]}
F = {"seviye": "8"}

# 1) ogretmen bildirimi
u = uyari["SUBE_PUAN_DUSUS"]
db = sqlite3.connect(DB)
once_n = db.execute("SELECT COUNT(*) FROM notifications").fetchone()[0]
s, on = admin.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                    {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F})
kontrol("ogretmen onizleme", s == 200 and on["aliciSayisi"] > 0, [a["ad"] + " " + a["aciklama"] for a in on.get("alicilar", [])])
kontrol("onizleme bildirim yazmaz", db.execute("SELECT COUNT(*) FROM notifications").fetchone()[0] == once_n)
s, r = admin.istek("/api/okullar/2/kokpit/aksiyonlar", {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"],
                                                        "filtreler": F, "onay": True})
kontrol("onay kodu olmadan gonderim reddedilir", s == 409, (s, r))
s, r = admin.istek("/api/okullar/2/kokpit/aksiyonlar", {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"],
                                                        "filtreler": F, "onayKodu": on["onayKodu"]})
kontrol("acik onay olmadan gonderim reddedilir", s == 400, (s, r))
s, r = admin.istek("/api/okullar/2/kokpit/aksiyonlar", {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"],
                                                        "filtreler": F, "onay": True, "onayKodu": on["onayKodu"] + "x"})
kontrol("bozuk onay kodu reddedilir", s == 409)
s, r = admin.istek("/api/okullar/2/kokpit/aksiyonlar", {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"],
                                                        "filtreler": F, "onay": True, "onayKodu": on["onayKodu"],
                                                        "metin": "Düzenlenmiş metin: 8-E için toplantı."})
kontrol("ogretmen bildirimi gonderildi", s == 200 and r["aliciSayisi"] == on["aliciSayisi"], r)
row = db.execute("SELECT user_id, tur, uyari_anahtari, alici_sayisi, metin FROM kokpit_aksiyonlar ORDER BY id DESC LIMIT 1").fetchone()
kontrol("aksiyon kaydi (kim/ne zaman/kime/hangi uyari)", row and row[2] == u["anahtar"] and row[4].startswith("Düzenlenmiş"), row)
_, d2 = admin.istek("/api/okullar/2/kokpit")
kontrol("tekrar aksiyon uyarisi gecmiste", u["anahtar"] in d2["aksiyonGecmisi"])
s, on2 = admin.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                     {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F})
kontrol("onizleme onceki aksiyonu gosterir", on2.get("oncekiAksiyon") is not None)

# yanlis tur / sahte anahtar / baska okul / ogretmen
s, _ = admin.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                   {"tur": "veli_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F})
kontrol("uyariya uymayan aksiyon turu reddedilir", s == 400)
s, _ = admin.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                   {"tur": "ogretmen_bildirim", "uyariAnahtari": "SUBE_PUAN_DUSUS:8-Z:2026-11", "filtreler": F})
kontrol("sahte uyari anahtari reddedilir", s == 400)
diger = Oturum("diger_admin")
s, _ = diger.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                   {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F})
kontrol("baska okulun admini 403", s == 403)
veri = Oturum("veri_admin")
s, _ = veri.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                  {"tur": "ogretmen_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F})
kontrol("veri giris admini aksiyon alamaz 403", s == 403)

# 2) odev onerisi -> taslak
u = uyari["YANLIS_YUKSEK"]
odev_once = db.execute("SELECT COUNT(*) FROM assignments").fetchone()[0]
s, on = admin.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                    {"tur": "odev_oneri", "uyariAnahtari": u["anahtar"], "filtreler": F, "soruSayisi": 8})
kontrol("odev onizleme", s == 200 and on["ek"]["soruSayisi"] == 8, (on.get("ek", {}).get("dersAd"), len(on.get("ek", {}).get("sorular", [])), on.get("alicilar")))
s, r = admin.istek("/api/okullar/2/kokpit/aksiyonlar", {"tur": "odev_oneri", "uyariAnahtari": u["anahtar"], "filtreler": F,
                                                        "soruSayisi": 8, "onay": True, "onayKodu": on["onayKodu"]})
kontrol("odev onerisi gonderildi", s == 200 and r["sonuc"]["taslaklar"], r)
kontrol("ogrenciye dogrudan odev gitmedi (assignments degismedi)",
        db.execute("SELECT COUNT(*) FROM assignments").fetchone()[0] == odev_once)
tid = r["sonuc"]["taslaklar"][0]
t_user = db.execute("SELECT u.username FROM kokpit_odev_taslaklari t JOIN users u ON u.id=t.teacher_id WHERE t.id=?", (tid,)).fetchone()[0]
ogr = Oturum(t_user)
s, b = ogr.istek("/api/bildirimler")
kontrol("ogretmen bildirimi goruyor", s == 200 and any("taslak=" + str(tid) in (x["link"] or "") for x in b["bildirimler"]), t_user)
s, t = ogr.istek(f"/api/kokpit/taslaklar/{tid}")
kontrol("ogretmen taslagi aciyor", s == 200 and t["durum"] == "taslak", (t.get("dersAd"), len(t.get("sorular", []))))
baska = Oturum("t_mat7")
s, _ = baska.istek(f"/api/kokpit/taslaklar/{tid}")
kontrol("baska ogretmen taslagi goremez", s == 404)
govde = {"mode": "manual", "className": t["sube"], "title": t["baslik"], "questionIds": [q["id"] for q in t["sorular"]]} \
    if t["sorular"] else {"mode": "auto", "className": t["sube"], "title": t["baslik"], "subjectId": t["subjectId"], "questionCount": 8}
s, a = ogr.istek("/api/teacher/assignments", govde)
kontrol("ogretmen mevcut odev uciyla yayinladi", s == 200, a)
s, _ = ogr.istek(f"/api/kokpit/taslaklar/{tid}/durum", {"durum": "yayinlandi", "odevId": a.get("id")})
kontrol("taslak yayinlandi olarak islendi", s == 200)
kontrol("odev ogretmenin adina", db.execute("SELECT u.username FROM assignments a JOIN users u ON u.id=a.teacher_id WHERE a.id=?", (a.get("id"),)).fetchone()[0] == t_user)

# 3) veli bildirimi
u = uyari["KATILIM_DUSUK"]
s, on = admin.istek("/api/okullar/2/kokpit/aksiyonlar?onizleme=1",
                    {"tur": "veli_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F})
kontrol("veli onizleme (veli sayisi)", s == 200 and on["aliciSayisi"] == 20, (on.get("aliciSayisi"), on.get("ek")))
s, r = admin.istek("/api/okullar/2/kokpit/aksiyonlar", {"tur": "veli_bildirim", "uyariAnahtari": u["anahtar"], "filtreler": F,
                                                        "onay": True, "onayKodu": on["onayKodu"]})
kontrol("veli bildirimi gonderildi", s == 200 and r["aliciSayisi"] == 20)
veli = Oturum("veli1")
s, b = veli.istek("/api/bildirimler")
kontrol("veli bildirimi goruyor", s == 200 and b["okunmamis"] >= 1, b["bildirimler"][0]["metin"][-60:] if b.get("bildirimler") else b)
giren = Oturum("veli_giren")
s, b = giren.istek("/api/bildirimler")
kontrol("denemeye giren ogrencinin velisine gitmedi", s == 200 and not b["bildirimler"])
print("HATA SAYISI:", kontrol.hata)
