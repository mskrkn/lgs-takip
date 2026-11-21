"""Okul Kokpiti - hesaplama modulu (sartnamede `kokpitHesap`).

Flask'a, oturuma ya da veritabanina BAGIMLI DEGIL: girdisi sade sozluk/liste,
ciktisi sade sozluk. Boylece birim testleri (tests/test_kokpit_hesap.py) gercek
sunucuyu ayaga kaldirmadan calisir ve kokpit.py (rotalar + ozet tablo) yalnizca
bu fonksiyonlari cagirir.

Katmanlar:
1. Temel kurallar: net(), lgs_puani(), sonuc_ozeti()  (sartname 5.1, 5.3)
2. Donem: donem_coz()                                    (4.1, 5.6)
3. Toplama: istatistik()  - ozet tablo satirlarindan donem ortalamalari (5.2)
4. Analiz: acilis_analizi(), uyarilar()                  (4.2-4.8, 5.4, 5.5, 6)

Yuvarlama YAPILMAZ; sayilar ham float doner, yalnizca metinler (basliklar,
uyari cumleleri) tr-TR bicimiyle (virgul) yazilir.
"""
import math
from datetime import date, timedelta

# ---------------------------------------------------------------- sabitler
# Ozet tablodaki satirlari etkileyen bir hesap kurali (net, puan, eksik
# karne) degisince artirilir: kokpit.init_schema tum denemeleri yeniden kurar.
HESAP_SURUMU = "2"
DERS_SIRASI = ["turkce", "inkilap", "din", "ingilizce", "matematik", "fen"]
DERS_AD = {
    "turkce": "Türkçe", "inkilap": "İnkılap Tarihi", "din": "Din Kültürü",
    "ingilizce": "İngilizce", "matematik": "Matematik", "fen": "Fen Bilimleri",
}
DERS_KISA = {
    "turkce": "Türkçe", "inkilap": "İnkılap", "din": "Din", "ingilizce": "İngilizce",
    "matematik": "Matematik", "fen": "Fen",
}
KATSAYI = {"turkce": 4, "matematik": 4, "fen": 4, "inkilap": 1, "din": 1, "ingilizce": 1}
VARSAYILAN_SORU = {"turkce": 20, "matematik": 20, "fen": 20, "inkilap": 10, "din": 10, "ingilizce": 10}
AY_AD = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
         "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

# Uyari kodlari onem sirasina gore (sartname 6). VERI_EKSIK listede degil,
# Veri durumu kartinda gosterilir ama siralamada en ustte.
UYARI_ONEM = ["VERI_EKSIK", "SUBE_PUAN_DUSUS", "DERS_NET_DUSUS", "YANLIS_YUKSEK",
              "SUBE_ACIK", "KATILIM_DUSUK"]
UYARI_AKSIYON = {
    "SUBE_PUAN_DUSUS": ("ogretmen_bildirim", "Öğretmenlere bildir"),
    "DERS_NET_DUSUS": ("ogretmen_bildirim", "Öğretmenlere bildir"),
    "YANLIS_YUKSEK": ("odev_oneri", "Ödev öner"),
    "SUBE_ACIK": ("odev_oneri", "Ödev öner"),
    "KATILIM_DUSUK": ("veli_bildirim", "Velilere bildir"),
    "VERI_EKSIK": ("veri_girisi", "Veri girişine git"),
}

# Ayarlar: (varsayilan, en kucuk, en buyuk). Okul bazinda kokpit_ayarlar
# tablosunda yalnizca degistirilen anahtarlar saklanir.
AYAR_TANIM = {
    "basariEsigi": (60.0, 1.0, 100.0),      # ders basari orani esigi (%)
    "degisimEsigi": (0.5, 0.0, 10.0),       # donem degisiminde "belirgin" sayilan net farki
    "toplamNetHedef": (60.0, 0.0, 90.0),    # toplam net hedefi
    "katilimHedef": (90.0, 1.0, 100.0),     # katilim hedefi (%)
    "subePuanDusus": (10.0, 0.1, 500.0),    # SUBE_PUAN_DUSUS (puan)
    "dersNetDusus": (1.0, 0.1, 20.0),       # DERS_NET_DUSUS (net)
    "yanlisFazlaYuzde": (25.0, 1.0, 500.0), # YANLIS_YUKSEK (% fazla)
    "subeAcikNet": (10.0, 0.1, 90.0),       # SUBE_ACIK (net)
    "riskNetDusus": (5.0, 0.1, 90.0),       # sube detayi risk listesi: net dususu
    "riskAltYuzde": (20.0, 1.0, 100.0),     # sube detayi risk listesi: alt dilim (%)
}
VARSAYILAN_AYARLAR = {k: v[0] for k, v in AYAR_TANIM.items()}


def ayarlari_birlestir(kayitli=None):
    """Okulun kayitli ayarlarini varsayilanlarla birlestirir; gecersiz/sinir
    disi degerleri sessizce varsayilana dusurur (bozuk kayit kokpiti dusurmesin)."""
    out = dict(VARSAYILAN_AYARLAR)
    for k, v in (kayitli or {}).items():
        if k not in AYAR_TANIM:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        lo, hi = AYAR_TANIM[k][1], AYAR_TANIM[k][2]
        if lo <= f <= hi and not math.isnan(f):
            out[k] = f
    return out


def ayarlari_dogrula(gelen):
    """PUT /ayarlar girdisi: ({anahtar: float}, [hata, ...])."""
    temiz, hatalar = {}, []
    for k, v in (gelen or {}).items():
        if k not in AYAR_TANIM:
            hatalar.append(f"Bilinmeyen ayar: {k}")
            continue
        try:
            f = float(str(v).replace(",", "."))
        except (TypeError, ValueError):
            hatalar.append(f"{k}: sayı olmalı")
            continue
        lo, hi = AYAR_TANIM[k][1], AYAR_TANIM[k][2]
        if not (lo <= f <= hi):
            hatalar.append(f"{k}: {fmt(lo, 1)} ile {fmt(hi, 1)} arasında olmalı")
            continue
        temiz[k] = f
    return temiz, hatalar


# ---------------------------------------------------------------- bicim
def fmt(x, ondalik=2):
    """tr-TR sayi: 16.1 -> '16,10'. None -> '-'."""
    if x is None:
        return "-"
    s = f"{x:,.{ondalik}f}"
    return s.replace(",", " ").replace(".", ",").replace(" ", ".")


def fmt_isaret(x, ondalik=2):
    """'+1,14' / '−0,54' (gercek eksi isareti)."""
    if x is None:
        return "-"
    r = round(x, ondalik)
    if r > 0:
        return "+" + fmt(r, ondalik)
    if r < 0:
        return "−" + fmt(-r, ondalik)
    return fmt(0, ondalik)


def yuzde(x):
    """0.712 -> '%71'."""
    return "%" + str(int(round(x * 100))) if x is not None else "-"


# Turkce ek uyumu (8-B'nin, 104'ten, 89'a, 8-F'de). Kelimenin SON SESLISI ve
# sesli/sert unsuzle bitip bitmedigi okunusa gore belirlenir.
_HARF_OKUNUS = {
    "A": "a", "B": "be", "C": "ce", "Ç": "çe", "D": "de", "E": "e", "F": "fe", "G": "ge",
    "Ğ": "ge", "H": "he", "I": "ı", "İ": "i", "J": "je", "K": "ke", "L": "le", "M": "me",
    "N": "ne", "O": "o", "Ö": "ö", "P": "pe", "R": "re", "S": "se", "Ş": "şe", "T": "te",
    "U": "u", "Ü": "ü", "V": "ve", "Y": "ye", "Z": "ze",
}
_RAKAM = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
_ONLAR = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]
_SESLI = "aeıioöuü"
_SERT = "fstkçşhp"


def _okunus(metin):
    t = str(metin).strip()
    if not t:
        return "a"
    son = t[-1]
    if son.isdigit():
        parca = t.replace(".", "").split(",")[-1]  # "20,0" -> "0" (yirmi virgul SIFIR)
        rakam = "".join(ch for ch in parca if ch.isdigit())
        n = int(rakam[-3:]) if rakam else 0
        if n % 10:
            return _RAKAM[n % 10]
        if n % 100:
            return _ONLAR[(n % 100) // 10]
        if n == 0:
            return "bin" if len(rakam.lstrip("0")) > 3 else "sıfır"
        return "yüz"
    kuyruk = ""
    for ch in reversed(t):
        if ch.isalpha():
            kuyruk = ch + kuyruk
        else:
            break
    if len(kuyruk) == 1:  # sube harfi: 8-B -> "be"
        return _HARF_OKUNUS.get(kuyruk.replace("i", "İ").replace("ı", "I").upper(), kuyruk.lower())
    return (kuyruk or t).replace("I", "ı").replace("İ", "i").lower()


def ek(metin, tur):
    """metin + kesme + ek. tur: 'in' (ilgi), 'de' (bulunma), 'den' (ayrilma), 'e' (yonelme)."""
    o = _okunus(metin)
    sesli = next((c for c in reversed(o) if c in _SESLI), "a")
    kalin = sesli in "aıou"
    sesliyle_biter = o[-1] in _SESLI
    sert = o[-1] in _SERT
    if tur == "in":
        v = {"a": "ı", "ı": "ı", "o": "u", "u": "u", "e": "i", "i": "i", "ö": "ü", "ü": "ü"}[sesli]
        e = ("n" if sesliyle_biter else "") + v + "n"
    elif tur == "de":
        e = ("t" if sert else "d") + ("a" if kalin else "e")
    elif tur == "den":
        e = ("t" if sert else "d") + ("a" if kalin else "e") + "n"
    elif tur == "e":
        e = ("y" if sesliyle_biter else "") + ("a" if kalin else "e")
    else:
        raise ValueError(tur)
    return f"{metin}'{e}"


# ---------------------------------------------------------------- temel kurallar
def net(dogru, yanlis):
    """LGS kurali: net = dogru - yanlis/3. Yuvarlama yok."""
    return (dogru or 0) - (yanlis or 0) / 3.0


def soru_sayilari(question_counts=None):
    """Denemenin ders soru sayilari (questionCounts) - yoksa LGS varsayilani."""
    out = dict(VARSAYILAN_SORU)
    for k, v in (question_counts or {}).items():
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out[k] = n
    return out


def lgs_puani(ders_netleri, sorular=None):
    """LGS puani arayuzu (sartname 5.3). Kokpit puan icin YALNIZCA bunu cagirir.

    Ilk surum katsayili YAKLASIK hesap: Turkce/Matematik/Fen x4, digerleri x1;
    agirlikli net, tam agirlikli nete (soru x katsayi toplami, LGS'de 270)
    oranlanip yaygin LGS hesaplayicilarinin dogrusal yaklasimina olceklenir:
    0 net ~ 194,75, tam net = 500 (Haruniye 56,69 net -> ~385; edesis 378,80).
    Gercek LGS puani standart puana dayanir; o yontem eklenince yalnizca bu
    fonksiyon degisir.
    Donus: {"puan": float, "yaklasik": True, "yontem": str}."""
    sorular = sorular or VARSAYILAN_SORU
    agirlikli = tam = 0.0
    for k, q in sorular.items():
        kat = KATSAYI.get(k, 1)
        tam += q * kat
        n = (ders_netleri or {}).get(k)
        if n is not None:
            agirlikli += max(0.0, min(float(n), float(q))) * kat
    if tam <= 0:
        return {"puan": None, "yaklasik": True, "yontem": "katsayili-yaklasik"}
    return {"puan": PUAN_TABAN + (500.0 - PUAN_TABAN) * agirlikli / tam, "yaklasik": True,
            "yontem": "katsayili-yaklasik"}


PUAN_TABAN = 194.752082  # yaklasik hesapta 0 netin puani

_HAZIR_PUAN_ALANLARI = ("lgsPuan", "lgsPuani", "puan", "score")


def sonuc_ozeti(veri, sorular=None):
    """results.data_json -> kokpit satiri. Ders neti d - y/3 ile YENIDEN
    hesaplanir (dogru/yanlis yoksa kayitli net kullanilir). Sonuc dosyasi
    yayinevinin hesapladigi bir puan tasiyorsa (ör. lgsPuan) o kullanilir,
    yoksa lgs_puani() yaklasik degeri.

    eksik: denemenin derslerinden biri sonucta yok ya da dogru/yanlis/net
    bilgisi bos -> Veri Durumu'nda "karnesi eksik" sayilir."""
    sorular = sorular or VARSAYILAN_SORU
    subjects = (veri or {}).get("subjects") or {}
    dersler, eksik = {}, False
    td = ty = tb = 0.0
    for k in sorular:
        s = subjects.get(k)
        if not isinstance(s, dict):
            eksik = True
            continue
        d, y, b = s.get("correct"), s.get("wrong"), s.get("blank")
        if d is None and y is None:
            if s.get("net") is None:
                eksik = True
                continue
            n = float(s.get("net"))
            d = y = None
        else:
            n = net(float(d or 0), float(y or 0))
        dd, yy, bb = float(d or 0), float(y or 0), float(b or 0)
        dersler[k] = {"d": dd, "y": yy, "b": bb, "net": n}
        td, ty, tb = td + dd, ty + yy, tb + bb
    puan, yaklasik = None, True
    for alan in _HAZIR_PUAN_ALANLARI:
        v = (veri or {}).get(alan)
        if isinstance(v, (int, float)) and 100 <= v <= 500:
            puan, yaklasik = float(v), False
            break
    if puan is None and dersler:
        puan = lgs_puani({k: v["net"] for k, v in dersler.items()}, sorular)["puan"]
    return {
        "dersler": dersler, "toplamNet": sum(v["net"] for v in dersler.values()),
        "d": td, "y": ty, "b": tb, "puan": puan, "puanYaklasik": yaklasik,
        "eksik": eksik or not dersler,
    }


# ---------------------------------------------------------------- donem
def _tarih(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def egitim_yili(d):
    """Eylul-Agustos: 2026-11-18 -> (2026, 2027)."""
    bas = d.year if d.month >= 9 else d.year - 1
    return bas, bas + 1


def _ay_araligi(yil, ay):
    bas = date(yil, ay, 1)
    son = date(yil + (ay == 12), ay % 12 + 1, 1) - timedelta(days=1)
    return bas, son


def _onceki_ay(yil, ay):
    return (yil - 1, 12) if ay == 1 else (yil, ay - 1)


def _aralik(bas, bit, tur, etiket, kisa=None):
    return {"tur": tur, "bas": bas.isoformat(), "bit": bit.isoformat(), "etiket": etiket,
            "kisa": kisa or etiket}


def donem_coz(donem, tarihler, bas=None, bit=None, bugun=None):
    """Donem secimi -> {"secili": aralik, "once": aralik|None, "sonra": aralik|None,
    "egitimYili": "2026–2027", "kod": URL degeri}.

    - "tum" (varsayilan): son denemenin egitim yili; karsilastirma son ay ile
      ondan onceki ay (sartname 5.6).
    - "YYYY-MM": o ay; karsilastirma bir onceki ay.
    - "ozel" + bas/bit (YYYY-MM-DD): o aralik; karsilastirma hemen onceki ayni
      uzunluktaki aralik.
    tarihler: secili seviyedeki denemelerin tarihleri (str/ date)."""
    gunler = sorted(t for t in (_tarih(x) for x in tarihler) if t)
    referans = gunler[-1] if gunler else (bugun or date.today())
    ey = egitim_yili(referans)
    donem = (donem or "tum").strip()

    if donem == "ozel":
        b, e = _tarih(bas), _tarih(bit)
        if b and e and b <= e:
            uzun = (e - b).days + 1
            ob, oe = b - timedelta(days=uzun), b - timedelta(days=1)
            fmt_g = lambda d: d.strftime("%d.%m.%Y")
            return {
                "kod": "ozel", "egitimYili": f"{ey[0]}–{ey[1]}",
                "secili": _aralik(b, e, "ozel", f"{fmt_g(b)}–{fmt_g(e)}", "Bu aralık"),
                "once": _aralik(ob, oe, "ozel", f"{fmt_g(ob)}–{fmt_g(oe)}", "Önceki aralık"),
                "sonra": _aralik(b, e, "ozel", f"{fmt_g(b)}–{fmt_g(e)}", "Bu aralık"),
            }
        donem = "tum"

    if len(donem) == 7 and donem[4] == "-":
        try:
            y, m = int(donem[:4]), int(donem[5:])
            if 1 <= m <= 12:
                sb, se = _ay_araligi(y, m)
                py, pm = _onceki_ay(y, m)
                ob, oe = _ay_araligi(py, pm)
                ey2 = egitim_yili(sb)
                return {
                    "kod": donem, "egitimYili": f"{ey2[0]}–{ey2[1]}",
                    "secili": _aralik(sb, se, "ay", AY_AD[m]),
                    "once": _aralik(ob, oe, "ay", AY_AD[pm]),
                    "sonra": _aralik(sb, se, "ay", AY_AD[m]),
                }
        except ValueError:
            pass

    # tum donem
    yb, ye = date(ey[0], 9, 1), date(ey[1], 8, 31)
    yil_gunleri = [g for g in gunler if yb <= g <= ye]
    once = sonra = None
    if yil_gunleri:
        son = yil_gunleri[-1]
        sb, se = _ay_araligi(son.year, son.month)
        py, pm = _onceki_ay(son.year, son.month)
        ob, oe = _ay_araligi(py, pm)
        sonra = _aralik(sb, se, "ay", AY_AD[son.month])
        once = _aralik(ob, oe, "ay", AY_AD[pm])
    return {"kod": "tum", "egitimYili": f"{ey[0]}–{ey[1]}",
            "secili": _aralik(yb, ye, "tum", "Tüm dönem"), "once": once, "sonra": sonra}


def aralikta(tarih, aralik):
    if not aralik:
        return False
    t = _tarih(tarih)
    return bool(t) and aralik["bas"] <= t.isoformat() <= aralik["bit"]


# ---------------------------------------------------------------- toplama
def istatistik(ozet, katilim=None, deneme_idleri=None):
    """Ozet tablo satirlarindan donem istatistigi (sartname 5.2).

    ozet: [{"exam_id", "class_name", "subject", "n", "sum_d", "sum_y", "sum_b",
            "sum_net", "sum_q", "sum_puan", "n_puan"}] - subject "*" = ogrencinin
            toplam satiri (sum_d/sum_y toplam dogru/yanlis, sum_puan puan).
    katilim: [(exam_id, student_id, class_name)] - sube ogrenci sayisi
            (donemde EN AZ BIR denemeye girmis) icin.
    deneme_idleri: yalniz bu denemeler (None = hepsi).

    Donem ortalamasi = donemdeki tum ogrenci-deneme sonuclarinin ortalamasi
    (toplam / sonuc sayisi), deneme ortalamalarinin ortalamasi DEGIL."""
    idler = set(deneme_idleri) if deneme_idleri is not None else None
    okul, subeler, denemeler = {}, {}, set()
    for r in ozet:
        if idler is not None and r["exam_id"] not in idler:
            continue
        denemeler.add(r["exam_id"])
        for hedef in (okul, subeler.setdefault(r["class_name"], {})):
            a = hedef.setdefault(r["subject"], [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0])
            a[0] += r["n"]
            a[1] += r["sum_d"]
            a[2] += r["sum_y"]
            a[3] += r.get("sum_b") or 0.0
            a[4] += r["sum_net"]
            a[5] += r.get("sum_q") or 0.0
            a[6] += r.get("sum_puan") or 0.0
            a[7] += r.get("n_puan") or 0

    def coz(acc):
        dersler = {}
        for k in DERS_SIRASI + sorted(set(acc) - set(DERS_SIRASI) - {"*"}):
            a = acc.get(k)
            if not a or not a[0]:
                continue
            soru = a[5] / a[0] if a[5] else float(VARSAYILAN_SORU.get(k, 0))
            ort = a[4] / a[0]
            dersler[k] = {"net": ort, "dogru": a[1] / a[0], "yanlis": a[2] / a[0],
                          "bos": a[3] / a[0], "soru": soru, "oran": ort / soru if soru else None,
                          "n": a[0]}
        t = acc.get("*")
        n = t[0] if t else 0
        return {
            "n": n, "dersler": dersler,
            "toplamNet": sum(d["net"] for d in dersler.values()),
            "toplamSoru": sum(d["soru"] for d in dersler.values()),
            "puan": (t[6] / t[7]) if t and t[7] else None,
            "dogru": t[1] / n if n else None, "yanlis": t[2] / n if n else None,
            "bos": t[3] / n if n else None,
        }

    out = coz(okul)
    out["denemeSayisi"] = len(denemeler)
    ogr = {}
    for exam_id, sid, cls in (katilim or []):
        if idler is not None and exam_id not in idler:
            continue
        ogr.setdefault(cls, set()).add(sid)
    out["subeler"] = {}
    for cls, acc in subeler.items():
        s = coz(acc)
        s["ogrenci"] = len(ogr.get(cls, ())) if katilim is not None else None
        out["subeler"][cls] = s
    out["ogrenci"] = len(set().union(*ogr.values())) if ogr else 0
    return out


# ---------------------------------------------------------------- analiz
def _sube_sirala(adlar):
    def anahtar(a):
        bas = ""
        for ch in a:
            if ch.isdigit():
                bas += ch
            else:
                break
        return (int(bas) if bas else 99, a)
    return sorted(adlar, key=anahtar)


def _r2(x):
    return None if x is None else round(x, 2)


def _ders_listesi(ist, ayar):
    out = []
    for k, d in ist["dersler"].items():
        out.append({
            "ders": k, "ad": DERS_AD.get(k, k), "kisa": DERS_KISA.get(k, k),
            "katsayi": KATSAYI.get(k, 1), "net": d["net"], "soru": d["soru"], "oran": d["oran"],
            "esikAlti": d["oran"] is not None and d["oran"] * 100 < ayar["basariEsigi"],
        })
    out.sort(key=lambda d: -(d["oran"] or 0))
    return out


def kaldirac(ist):
    """En buyuk kaldirac (5.4): acik = (soru - ortalama net) x katsayi en buyuk ders."""
    en = None
    for k, d in ist["dersler"].items():
        acik = (d["soru"] - d["net"]) * KATSAYI.get(k, 1)
        if en is None or acik > en["acik"]:
            en = {"ders": k, "ad": DERS_AD.get(k, k), "acik": acik, "oran": d["oran"],
                  "katsayi": KATSAYI.get(k, 1), "net": d["net"], "soru": d["soru"]}
    return en


def _ders_basligi(dersler, ayar):
    alt = [d for d in dersler if d["esikAlti"]]
    if not dersler:
        return "Bu dönemde ders verisi yok"
    if not alt:
        return f"Tüm dersler %{fmt(ayar['basariEsigi'], 0)} eşiğinin üstünde"
    alt.sort(key=lambda d: -d["oran"])  # ekrandaki sirayla (basari buyukten kucuge)
    sinir = int(math.ceil(max(d["oran"] for d in alt) * 100 / 5.0) * 5)
    sinir = min(sinir, int(ayar["basariEsigi"]))
    adlar = [d["kisa"] for d in alt]
    liste = adlar[0] if len(adlar) == 1 else ", ".join(adlar[:-1]) + " ve " + adlar[-1]
    return f"{liste} %{sinir}{_yuzde_eki(sinir)} altında"


def _yuzde_eki(n):
    # "%55'in", "%60'ın", "%40'ın" -> ilgi eki sayinin okunusuna gore
    return ek(str(n), "in")[len(str(n)):]


def _degisim(once, sonra, ayar, etiket_once, etiket_sonra):
    if not once or not sonra or not once["n"] or not sonra["n"]:
        return {"var": False, "mesaj": "Karşılaştırma için önceki dönemde deneme yok", "dersler": []}
    satirlar = []
    for k in DERS_SIRASI + sorted(set(sonra["dersler"]) - set(DERS_SIRASI)):
        a, b = once["dersler"].get(k), sonra["dersler"].get(k)
        if not a or not b:
            continue
        fark = b["net"] - a["net"]
        satirlar.append({"ders": k, "ad": DERS_AD.get(k, k), "kisa": DERS_KISA.get(k, k),
                         "once": a["net"], "sonra": b["net"], "fark": fark,
                         "belirgin": abs(round(fark, 2)) >= ayar["degisimEsigi"]})
    satirlar.sort(key=lambda s: -s["fark"])
    dusen = sorted([s for s in satirlar if s["belirgin"] and s["fark"] < 0], key=lambda s: s["fark"])
    artan = [s for s in satirlar if s["belirgin"] and s["fark"] > 0]
    ay = etiket_sonra.lower()
    zaman = ek(ay, "de")[len(ay) + 1:]
    zaman = f"{ay}{zaman}" if ay else "bu dönem"
    if dusen:
        adlar = [s["kisa"].lower() if s["kisa"] not in ("Türkçe", "İngilizce", "İnkılap") else s["kisa"] for s in dusen]
        liste = adlar[0] if len(adlar) == 1 else ", ".join(adlar[:-1]) + " ve " + adlar[-1]
        baslik = f"{zaman.capitalize()} {liste} geriledi"
    elif artan:
        baslik = f"{zaman.capitalize()} belirgin düşüş yok; {artan[0]['kisa']} {fmt_isaret(artan[0]['fark'])} net"
    else:
        baslik = f"{zaman.capitalize()} belirgin bir değişim yok"
    return {"var": True, "baslik": baslik, "dersler": satirlar, "once": etiket_once, "sonra": etiket_sonra,
            "onceDeneme": once["denemeSayisi"], "sonraDeneme": sonra["denemeSayisi"]}


def _sube_tablosu(cur, once, sonra, ayar, dersler):
    en_dusuk = [d["ders"] for d in sorted(dersler, key=lambda d: d["oran"] or 0)[:2]]
    satirlar = []
    for cls in _sube_sirala(cur["subeler"]):
        s = cur["subeler"][cls]
        po = once["subeler"].get(cls, {}).get("puan") if once else None
        ps = sonra["subeler"].get(cls, {}).get("puan") if sonra else None
        fark = ps - po if po is not None and ps is not None else None
        trend = None
        if fark is not None:
            trend = "dusus" if round(fark, 2) <= -ayar["subePuanDusus"] else ("artis" if round(fark, 2) > 0 else "sabit")
        satirlar.append({
            "sube": cls, "ogrenci": s.get("ogrenci"), "n": s["n"], "toplamNet": s["toplamNet"],
            "puan": s["puan"], "yanlis": s["yanlis"], "dogru": s["dogru"],
            "dersler": {k: v["net"] for k, v in s["dersler"].items()},
            "puanOnce": po, "puanSonra": ps, "puanFark": fark, "trend": trend,
        })
    baslik = "Bu dönemde şube verisi yok"
    dolu = [s for s in satirlar if s["n"]]
    if len(dolu) >= 2:
        en_iyi = max(dolu, key=lambda s: s["toplamNet"])
        en_kotu = min(dolu, key=lambda s: s["toplamNet"])
        baslik = f"{en_kotu['sube']}, {ek(en_iyi['sube'], 'in')} {fmt(en_iyi['toplamNet'] - en_kotu['toplamNet'], 1)} net gerisinde"
    elif dolu:
        baslik = f"{dolu[0]['sube']}: {fmt(dolu[0]['toplamNet'], 2)} toplam net"
    return {"baslik": baslik, "satirlar": satirlar, "varsayilanDersler": en_dusuk}


def _katilim_grafigi(katilim, ayar, etiket_sonra, sonra_araligi):
    """katilim: [{"id","ad","tarih","katilan","kayitli"}] kronolojik."""
    hedef = ayar["katilimHedef"] / 100.0
    cubuklar = []
    for k in katilim:
        yuklendi = k["katilan"] > 0
        oran = k["katilan"] / k["kayitli"] if k["kayitli"] else None
        cubuklar.append(dict(k, yuklendi=yuklendi, oran=oran,
                             hedefAlti=yuklendi and oran is not None and oran < hedef))
    yuklu = [c for c in cubuklar if c["yuklendi"]]
    baslik = "Bu dönemde yüklenmiş deneme yok"
    son_ay = [c for c in yuklu if aralikta(c["tarih"], sonra_araligi)] or yuklu
    if len(son_ay) >= 2:
        a, b = son_ay[0]["katilan"], son_ay[-1]["katilan"]
        ay = (etiket_sonra or "").lower()
        zaman = (ay + ek(ay, "de")[len(ay) + 1:]) if ay else "bu dönem"
        fiil = "indi" if b < a else ("çıktı" if b > a else "değişmedi")
        if a == b:
            baslik = f"Katılım {zaman} {a} öğrencide sabit"
        else:
            baslik = f"Katılım {zaman} {ek(str(a), 'den')} {ek(str(b), 'e')} {fiil}"
    elif yuklu:
        baslik = f"Son denemeye {yuklu[-1]['katilan']} öğrenci katıldı"
    return {"baslik": baslik, "cubuklar": cubuklar, "hedef": ayar["katilimHedef"]}


def uyarilar(cur, once, sonra, katilim, ayar, etiket_sonra="", donem_kodu="", sonra_araligi=None):
    """Sartname 6'daki kurallar. VERI_EKSIK burada uretilmez (veri_durumu()).
    Ayni subede SUBE_PUAN_DUSUS varsa o subenin DERS_NET_DUSUS'lari ayri satir
    olmak yerine puan dususu uyarisinin detayina katilir (taslaktaki gibi)."""
    out = []
    ay = (etiket_sonra or "").lower()
    zaman = (ay + ek(ay, "de")[len(ay) + 1:]) if ay else "bu dönem"
    karsilastirma = bool(once and sonra and once["n"] and sonra["n"])

    def ekle(kod, anahtar, etki, baslik, detay, hedef, veri):
        tur, etiket = UYARI_AKSIYON[kod]
        out.append({
            "kod": kod, "anahtar": f"{kod}:{anahtar}:{donem_kodu}", "etki": etki,
            "baslik": baslik, "detay": detay, "hedef": hedef, "veri": veri,
            "aksiyon": {"tur": tur, "etiket": etiket},
            "detayLink": {"tip": "sube", "id": hedef.get("sube")} if hedef.get("sube") else {"tip": "katilim"},
        })

    # DERS_NET_DUSUS (once hesaplanir, SUBE_PUAN_DUSUS detayinda kullanilir)
    ders_dusus = {}
    if karsilastirma:
        for cls, sb in sonra["subeler"].items():
            sa = once["subeler"].get(cls)
            if not sa or not sa["n"] or not sb["n"]:
                continue
            for k, d in sb["dersler"].items():
                a = sa["dersler"].get(k)
                if not a:
                    continue
                fark = d["net"] - a["net"]
                if round(fark, 2) <= -ayar["dersNetDusus"]:
                    ders_dusus.setdefault(cls, []).append(
                        {"ders": k, "ad": DERS_KISA.get(k, k), "once": a["net"], "sonra": d["net"], "fark": fark})
        for lst in ders_dusus.values():
            lst.sort(key=lambda x: x["fark"])

    puan_dusen = set()
    if karsilastirma:
        for cls, sb in sonra["subeler"].items():
            sa = once["subeler"].get(cls)
            if not sa or sa.get("puan") is None or sb.get("puan") is None:
                continue
            fark = sb["puan"] - sa["puan"]
            if round(fark, 2) <= -ayar["subePuanDusus"]:
                puan_dusen.add(cls)
                parcalar = [f"{x['ad']} {fmt_isaret(x['fark'])} net" for x in ders_dusus.get(cls, [])[:2]]
                if not parcalar:
                    tum = []
                    for k, d in sb["dersler"].items():
                        a = sa["dersler"].get(k)
                        if a:
                            tum.append((d["net"] - a["net"], k))
                    tum.sort()
                    parcalar = [f"{DERS_KISA.get(k, k)} {fmt_isaret(f)} net" for f, k in tum[:2] if f < 0]
                detay = ", ".join(parcalar) + "." if parcalar else ""
                if sa.get("yanlis") is not None and sb.get("yanlis") is not None:
                    ya, yb = fmt(sa["yanlis"], 1), fmt(sb["yanlis"], 1)
                    fiil = "çıktı" if sb["yanlis"] > sa["yanlis"] else "indi"
                    detay += f" Yanlış sayısı {ek(ya, 'den')} {ek(yb, 'e')} {fiil}."
                ekle("SUBE_PUAN_DUSUS", cls, -fark,
                     f"{cls} {zaman} {fmt(-fark, 1)} puan düştü", detay.strip(),
                     {"sube": cls}, {"once": sa["puan"], "sonra": sb["puan"], "fark": fark,
                                     "dersler": ders_dusus.get(cls, [])})

    for cls, lst in ders_dusus.items():
        if cls in puan_dusen:
            continue
        for x in lst:
            ekle("DERS_NET_DUSUS", f"{cls}:{x['ders']}", -x["fark"],
                 f"{cls} {x['ad']} neti {fmt(-x['fark'], 2)} düştü",
                 f"{x['ad']} ortalaması {fmt(x['once'], 2)} netten {fmt(x['sonra'], 2)} nete indi.",
                 {"sube": cls, "ders": x["ders"]}, x)

    # YANLIS_YUKSEK: subenin ortalama yanlisi okul ortalamasinin esik % ustunde
    okul_y = cur.get("yanlis")
    if okul_y:
        for cls, s in cur["subeler"].items():
            if s.get("yanlis") is None or not s["n"]:
                continue
            fazla = (s["yanlis"] / okul_y - 1) * 100
            if round(fazla, 2) >= ayar["yanlisFazlaYuzde"]:
                kayip = s["yanlis"] / 3.0
                ekle("YANLIS_YUKSEK", cls, fazla,
                     f"{ek(cls, 'de')} yanlış sayısı çok yüksek",
                     f"Deneme başına {fmt(s['yanlis'], 2)} yanlış; bu, yaklaşık {fmt(kayip, 2)} net kayıp demek. "
                     f"Okul ortalaması {fmt(okul_y, 2)} (%{fmt(fazla, 0)} fazla).",
                     {"sube": cls}, {"yanlis": s["yanlis"], "okulYanlis": okul_y, "fazlaYuzde": fazla,
                                     "kayipNet": kayip})

    # SUBE_ACIK: en iyi subenin toplam netinin esik kadar gerisinde
    dolu = {c: s for c, s in cur["subeler"].items() if s["n"]}
    if len(dolu) >= 2:
        en_iyi = max(dolu, key=lambda c: dolu[c]["toplamNet"])
        for cls, s in dolu.items():
            if cls == en_iyi:
                continue
            acik = dolu[en_iyi]["toplamNet"] - s["toplamNet"]
            if round(acik, 2) >= ayar["subeAcikNet"]:
                ekle("SUBE_ACIK", cls, acik,
                     f"{cls}, {ek(en_iyi, 'in')} {fmt(acik, 2)} net gerisinde",
                     f"Toplam net {fmt(s['toplamNet'], 2)}, {en_iyi} {fmt(dolu[en_iyi]['toplamNet'], 2)}.",
                     {"sube": cls}, {"acik": acik, "enIyi": en_iyi, "toplamNet": s["toplamNet"]})

    # KATILIM_DUSUK: son deneme hedefin altinda ya da son 3 denemede surekli dusus
    yuklu = [k for k in katilim if k["katilan"] > 0]
    if yuklu:
        son = yuklu[-1]
        oran = son["katilan"] / son["kayitli"] if son["kayitli"] else None
        son3 = [k["katilan"] for k in yuklu[-3:]]
        surekli = len(son3) == 3 and son3[0] > son3[1] > son3[2]
        if (oran is not None and oran * 100 < ayar["katilimHedef"]) or surekli:
            girmeyen = son["kayitli"] - son["katilan"]
            seri = [k for k in yuklu if aralikta(k["tarih"], sonra_araligi)] if sonra_araligi else []
            if len(seri) < 2:
                seri = yuklu[-3:]
            detay = (f"Son {len(seri)} denemede {seri[0]['katilan']} → {seri[-1]['katilan']} öğrenci. "
                     if len(seri) >= 2 else "")
            detay += f"Son denemeye {girmeyen} öğrenci girmedi."
            baslik = (f"Son deneme katılımı {yuzde(oran)}" if oran is not None and oran * 100 < ayar["katilimHedef"]
                      else "Katılım son 3 denemede sürekli düşüyor")
            ekle("KATILIM_DUSUK", str(son["id"]), (ayar["katilimHedef"] - (oran or 0) * 100),
                 baslik, detay, {"denemeId": son["id"]},
                 {"oran": oran, "katilan": son["katilan"], "kayitli": son["kayitli"],
                  "girmeyen": girmeyen, "surekliDusus": surekli})

    sira = {k: i for i, k in enumerate(UYARI_ONEM)}
    out.sort(key=lambda u: (sira[u["kod"]], -u["etki"]))
    return out


def veri_durumu(denemeler, son_deneme_karne=None):
    """denemeler: [{"id","ad","tarih","katilan","kayitli","eksikKarne","sorunlar":[...]}]
    secili donemde. son_deneme_karne: {"toplam","eksik"} (son yuklu deneme)."""
    yuklenmemis = [d for d in denemeler if d["katilan"] == 0]
    sorunlu_ids = {d["id"] for d in yuklenmemis} | {d["id"] for d in denemeler if d.get("eksikKarne")}
    sorunsuz = [d for d in denemeler if d["id"] not in sorunlu_ids]
    karne = None
    yuklu = [d for d in denemeler if d["katilan"] > 0]
    if yuklu:
        son = yuklu[-1]
        karne = {"denemeId": son["id"], "ad": son["ad"], "toplam": son["katilan"],
                 "eksik": son.get("eksikKarne", 0), "hazir": son["katilan"] - son.get("eksikKarne", 0)}
    uyari = None
    eksik_toplam = sum(d.get("eksikKarne", 0) for d in denemeler)
    if yuklenmemis or eksik_toplam:
        parca = []
        if yuklenmemis:
            parca.append(", ".join(f"{d['ad']} ({_kisa_tarih(d['tarih'])})" for d in yuklenmemis[:3])
                         + (" denemesi" if len(yuklenmemis) == 1 else " denemeleri") + " yüklenmemiş")
        if eksik_toplam:
            parca.append(f"{eksik_toplam} sonuçta eksik ders bilgisi var")
        metin = "; ".join(parca)
        uyari = {"kod": "VERI_EKSIK", "baslik": metin[:1].upper() + metin[1:],
                 "aksiyon": {"tur": "veri_girisi", "etiket": UYARI_AKSIYON["VERI_EKSIK"][1]},
                 "yuklenmemis": [d["id"] for d in yuklenmemis], "eksikKarne": eksik_toplam}
    return {"yuklenmemis": yuklenmemis, "karne": karne, "sorunsuzSayisi": len(sorunsuz),
            "toplam": len(denemeler), "uyari": uyari}


def _kisa_tarih(t):
    d = _tarih(t)
    return d.strftime("%d.%m") if d else "-"


def acilis_analizi(cur, once, sonra, katilim, ayar, donem):
    """Acilis ekraninin hesaplanan bolumleri.
    cur: secili donem istatistigi; once/sonra: karsilastirma donemleri
    (tum donemde son ay ve onceki ay); katilim: secili donemdeki denemeler
    (kronolojik, yuklenmemisler dahil); donem: donem_coz() ciktisi."""
    et_once = (donem.get("once") or {}).get("etiket", "")
    et_sonra = (donem.get("sonra") or {}).get("etiket", "")
    sonra_araligi = donem.get("sonra")
    dersler = _ders_listesi(cur, ayar)
    kal = kaldirac(cur)
    karsilastirma = bool(once and sonra and once["n"] and sonra["n"])
    if kal and karsilastirma and kal["ders"] in once["dersler"] and kal["ders"] in sonra["dersler"]:
        kal["degisim"] = sonra["dersler"][kal["ders"]]["net"] - once["dersler"][kal["ders"]]["net"]
    elif kal:
        kal["degisim"] = None

    yuklu = [k for k in katilim if k["katilan"] > 0]
    son = yuklu[-1] if yuklu else None
    kartlar = {
        "puan": {
            "deger": cur["puan"], "yaklasik": True,
            "once": once["puan"] if karsilastirma else None,
            "sonra": sonra["puan"] if karsilastirma else None,
            "fark": (sonra["puan"] - once["puan"]) if karsilastirma and once["puan"] is not None and sonra["puan"] is not None else None,
            "onceEtiket": et_once, "sonraEtiket": et_sonra,
        },
        "toplamNet": {
            "deger": cur["toplamNet"] if cur["n"] else None, "soru": cur["toplamSoru"],
            "oran": cur["toplamNet"] / cur["toplamSoru"] if cur["toplamSoru"] else None,
            "hedef": ayar["toplamNetHedef"],
        },
        "katilim": {
            "deger": (son["katilan"] / son["kayitli"]) if son and son["kayitli"] else None,
            "katilan": son["katilan"] if son else None, "kayitli": son["kayitli"] if son else None,
            "girmeyen": (son["kayitli"] - son["katilan"]) if son else None,
            "denemeId": son["id"] if son else None, "denemeAd": son["ad"] if son else None,
        },
        "kaldirac": kal,
    }
    return {
        "kartlar": kartlar,
        "dersler": {"baslik": _ders_basligi(dersler, ayar), "liste": dersler,
                    "esik": ayar["basariEsigi"], "denemeSayisi": cur["denemeSayisi"]},
        "degisim": dict(_degisim(once, sonra, ayar, et_once, et_sonra), esik=ayar["degisimEsigi"]),
        "subeler": _sube_tablosu(cur, once, sonra, ayar, dersler),
        "katilim": _katilim_grafigi(katilim, ayar, et_sonra, sonra_araligi),
        "uyarilar": uyarilar(cur, once, sonra, katilim, ayar, et_sonra, donem.get("kod", ""), sonra_araligi),
    }


def risk_listesi(ogrenciler, ayar):
    """Sube detayi risk listesi (8.1): onceki doneme gore en az riskNetDusus
    net dusen ya da subenin alt riskAltYuzde dilimindeki ogrenciler.
    ogrenciler: [{"id","ad","net","oncekiNet"}] (net = donem ortalama toplam net)."""
    dolu = sorted([o for o in ogrenciler if o.get("net") is not None], key=lambda o: o["net"])
    if not dolu:
        return []
    alt_n = max(1, int(math.ceil(len(dolu) * ayar["riskAltYuzde"] / 100.0))) if len(dolu) >= 5 else 0
    alt = {o["id"] for o in dolu[:alt_n]}
    out = []
    for o in dolu:
        nedenler = []
        if o.get("oncekiNet") is not None and round(o["net"] - o["oncekiNet"], 2) <= -ayar["riskNetDusus"]:
            nedenler.append(f"{fmt(o['oncekiNet'] - o['net'], 2)} net düştü")
        if o["id"] in alt:
            nedenler.append(f"şubenin alt %{fmt(ayar['riskAltYuzde'], 0)} diliminde")
        if nedenler:
            out.append(dict(o, nedenler=nedenler))
    return out
