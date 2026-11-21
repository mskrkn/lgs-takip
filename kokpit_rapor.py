"""Okul Kokpiti - donem raporu (PDF, A4 dikey) ve Excel (her bolum ayri sayfa).

Girdi kokpit.acilis_verisi() ciktisi (+ ogrenci net listesi); Flask'tan
bagimsizdir. Excel stdlib zipfile ile minimal OOXML yazar (projede openpyxl
yok - omr_reports.to_xlsx ile ayni yaklasim, ama cok sayfali).
"""
import io
import os
import re
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape as _xml_escape

import kokpit_hesap as K

_XML_BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


# ---------------------------------------------------------------- ortak tablolar
def bolumler(v, ogrenciler):
    """Rapor bolumleri: [(sayfa_adi, baslik, kolonlar, satirlar)] - sayilar ham."""
    k = v["kartlar"]
    p, n, kat, kal = k["puan"], k["toplamNet"], k["katilim"], k["kaldirac"]
    kartlar = [
        ("Ortalama LGS puanı (yaklaşık)", p["deger"], f"{p['onceEtiket']} {K.fmt(p['once'])} → {p['sonraEtiket']} {K.fmt(p['sonra'])} ({K.fmt_isaret(p['fark'])})" if p["fark"] is not None else "Önceki dönem yok"),
        ("Toplam net", n["deger"], f"{K.fmt(n['soru'], 0)} sorudan, hedef {K.fmt(n['hedef'], 0)}"),
        ("Son deneme katılımı (%)", (kat["deger"] or 0) * 100 if kat["deger"] is not None else None,
         f"{kat['katilan']} / {kat['kayitli']} öğrenci, {kat['girmeyen']} girmedi" if kat["katilan"] is not None else ""),
        ("En büyük kaldıraç", kal["ad"] if kal else "-",
         f"%{K.fmt((kal['oran'] or 0) * 100, 0)} başarı, ×{kal['katsayi']}, açık {K.fmt(kal['acik'])}" if kal else ""),
    ]
    out = [("Göstergeler", "Gösterge kartları", ["Gösterge", "Değer", "Açıklama"], kartlar)]
    out.append(("Uyarılar", "Dikkat gerektirenler", ["Kod", "Başlık", "Detay"],
                [(u["kod"], u["baslik"], u["detay"]) for u in v["uyarilar"]]
                + ([("VERI_EKSIK", v["veriDurumu"]["uyari"]["baslik"], "")] if v["veriDurumu"].get("uyari") else [])))
    out.append(("Dersler", v["dersler"]["baslik"], ["Ders", "Katsayı", "Ortalama net", "Soru", "Başarı (%)"],
                [(d["ad"], d["katsayi"], d["net"], d["soru"], (d["oran"] or 0) * 100) for d in v["dersler"]["liste"]]))
    g = v["degisim"]
    out.append(("Dönem değişimi", g.get("baslik") or g.get("mesaj"),
                ["Ders", g.get("once") or "Önceki", g.get("sonra") or "Bu dönem", "Fark", "Belirgin"],
                [(x["ad"], x["once"], x["sonra"], x["fark"], "evet" if x["belirgin"] else "hayır") for x in g.get("dersler", [])]))
    sd = [k_ for k_ in K.DERS_SIRASI if any(k_ in s["dersler"] for s in v["subeler"]["satirlar"])]
    out.append(("Şubeler", v["subeler"]["baslik"],
                ["Şube", "Öğrenci", "Toplam net", "LGS puanı", "Ort. yanlış"] + [K.DERS_KISA[x] for x in sd]
                + ["Önceki puan", "Bu dönem puan"],
                [(s["sube"], s["ogrenci"], s["toplamNet"], s["puan"], s["yanlis"]) + tuple(s["dersler"].get(x) for x in sd)
                 + (s["puanOnce"], s["puanSonra"]) for s in v["subeler"]["satirlar"]]))
    out.append(("Katılım", v["katilim"]["baslik"], ["Deneme", "Tarih", "Katılan", "Kayıtlı", "Oran (%)", "Durum"],
                [(c["ad"], c["tarih"], c["katilan"], c["kayitli"], (c["oran"] or 0) * 100 if c["oran"] is not None else None,
                  "yüklendi" if c["yuklendi"] else "yüklenmedi") for c in v["katilim"]["cubuklar"]]))
    if ogrenciler is not None:
        dersler = [x for x in K.DERS_SIRASI if any(x in o["dersler"] for o in ogrenciler)]
        out.append(("Öğrenci netleri", "Öğrenci bazında net listesi",
                    ["No", "Öğrenci", "Şube", "Deneme", "Tarih"] + [K.DERS_KISA[x] for x in dersler]
                    + ["Toplam net", "Doğru", "Yanlış", "LGS puanı"],
                    [(o["numara"], o["ad"], o["sube"], o["deneme"], o["tarih"]) + tuple(o["dersler"].get(x) for x in dersler)
                     + (o["toplamNet"], o["d"], o["y"], o["puan"]) for o in ogrenciler]))
    return out


def kapak(v):
    return {
        "okul": v["okul"]["ad"], "yil": v["donem"]["egitimYili"],
        "seviye": f"{v['seviye']}. sınıflar ({v['kayitli']} öğrenci)" if v["seviye"] else "-",
        "donem": v["donem"]["secili"]["etiket"],
        "aralik": f"{v['donem']['secili']['bas']} – {v['donem']['secili']['bit']}",
        "sonDeneme": f"{v['sonDeneme']['ad']} ({v['sonDeneme']['tarih']})" if v.get("sonDeneme") else "-",
        "degerlendirilen": v.get("degerlendirilen", 0),
        "olusturma": datetime.now().strftime("%d.%m.%Y %H:%M"),
    }


# ---------------------------------------------------------------- Excel
def _col(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(ref, v, style=0):
    if v is None or v == "":
        return ""
    if isinstance(v, bool):
        v = "evet" if v else "hayır"
    if isinstance(v, (int, float)):
        return f'<c r="{ref}" s="{3 if isinstance(v, float) else style}"><v>{round(v, 4) if isinstance(v, float) else v}</v></c>'
    t = _xml_escape(_XML_BAD.sub("", str(v)))
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{t}</t></is></c>'


def _sayfa_adi(ad, kullanilan):
    ad = re.sub(r"[\[\]\*\?/\\:]", " ", ad)[:31] or "Sayfa"
    a, i = ad, 2
    while a in kullanilan:
        a = f"{ad[:28]} {i}"
        i += 1
    kullanilan.add(a)
    return a


def excel(v, ogrenciler):
    """Her bolum ayri sayfada ham tablo (sartname 7)."""
    k = kapak(v)
    sayfalar = [("Kapak", [["Okul Kokpiti - dönem raporu"], ["Okul", k["okul"]], ["Eğitim yılı", k["yil"]],
                           ["Seviye", k["seviye"]], ["Dönem", k["donem"]], ["Aralık", k["aralik"]],
                           ["Son deneme", k["sonDeneme"]], ["Değerlendirilen deneme", k["degerlendirilen"]],
                           ["Oluşturulma", k["olusturma"]],
                           ["Not", "LGS puanı katsayılı yaklaşık hesaptır (Türkçe, Matematik, Fen ×4; diğerleri ×1)."]])]
    for ad, baslik, kolonlar, satirlar in bolumler(v, ogrenciler):
        sayfalar.append((ad, [[baslik], [], list(kolonlar)] + [list(s) for s in satirlar]))
    kullanilan, xml_sayfalar = set(), []
    for ad, satirlar in sayfalar:
        rows = []
        genis = {}
        for ri, satir in enumerate(satirlar, start=1):
            stil = 1 if (ri == 1 or (ad != "Kapak" and ri == 3)) else 0
            rows.append(f'<row r="{ri}">' + "".join(_cell(f"{_col(ci)}{ri}", x, stil) for ci, x in enumerate(satir)) + "</row>")
            for ci, x in enumerate(satir):
                genis[ci] = max(genis.get(ci, 0), len(str(x if x is not None else "")))
        cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{min(max(w + 2, 8), 60)}" customWidth="1"/>'
                       for i, w in sorted(genis.items()))
        xml_sayfalar.append((_sayfa_adi(ad, kullanilan),
                             '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                             + (f"<cols>{cols}</cols>" if cols else "") + f'<sheetData>{"".join(rows)}</sheetData></worksheet>'))
    ns_r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{ns_r}"><sheets>'
          + "".join(f'<sheet name="{_xml_escape(a)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, (a, _) in enumerate(xml_sayfalar))
          + "</sheets></workbook>")
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i + 1}" Type="{ns_r}/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                      for i in range(len(xml_sayfalar)))
            + f'<Relationship Id="rId{len(xml_sayfalar) + 1}" Type="{ns_r}/styles" Target="styles.xml"/></Relationships>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>'
              '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
              '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
              '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
              '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>')
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                    for i in range(len(xml_sayfalar))) + "</Types>")
    root = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{ns_r}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", root)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/styles.xml", styles)
        for i, (_, x) in enumerate(xml_sayfalar):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", x)
    return buf.getvalue()


# ---------------------------------------------------------------- PDF
def pdf(v):
    """A4 dikey donem raporu: kapak bilgisi, gostergeler, uyarilar, ders
    basarisi (cubuk), donem degisimi (cubuk), sube tablosu, katilim."""
    import reportlab
    from reportlab.graphics.shapes import Drawing, Line, Rect, String
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    fd = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    if "EduPusulaSans" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("EduPusulaSans", os.path.join(fd, "Vera.ttf")))
        pdfmetrics.registerFont(TTFont("EduPusulaSans-Bold", os.path.join(fd, "VeraBd.ttf")))
    NAVY, ORANGE, BLUE, TEAL = colors.HexColor("#0B1530"), colors.HexColor("#F7A21B"), colors.HexColor("#2563EB"), colors.HexColor("#0F9F8F")
    MUTED, LINE, ORTX = colors.HexColor("#475569"), colors.HexColor("#E2E8F0"), colors.HexColor("#B45309")
    st = {
        "h1": ParagraphStyle("h1", fontName="EduPusulaSans-Bold", fontSize=18, leading=22, textColor=NAVY),
        "h2": ParagraphStyle("h2", fontName="EduPusulaSans-Bold", fontSize=12, leading=15, textColor=NAVY, spaceBefore=10, spaceAfter=4),
        "p": ParagraphStyle("p", fontName="EduPusulaSans", fontSize=9, leading=12, textColor=colors.HexColor("#1E293B")),
        "s": ParagraphStyle("s", fontName="EduPusulaSans", fontSize=8, leading=10, textColor=MUTED),
        "c": ParagraphStyle("c", fontName="EduPusulaSans", fontSize=8, leading=10),
        "cb": ParagraphStyle("cb", fontName="EduPusulaSans-Bold", fontSize=8, leading=10),
    }
    W = A4[0] - 32 * mm
    # Vera yazi tipinde ok isareti yok -> "->"
    E = lambda t: _xml_escape(str(t if t is not None else "-").replace("→", "->"))  # noqa: E731
    KOD_AD = {"SUBE_PUAN_DUSUS": "Şube puanı düştü", "DERS_NET_DUSUS": "Ders neti düştü",
              "YANLIS_YUKSEK": "Yanlış yüksek", "SUBE_ACIK": "Şube açığı", "KATILIM_DUSUK": "Katılım düşük",
              "VERI_EKSIK": "Veri eksik"}

    def tablo(kolonlar, satirlar, genislik=None):
        data = [[Paragraph(E(c), st["cb"]) for c in kolonlar]]
        for s in satirlar:
            data.append([Paragraph(E(K.fmt(x) if isinstance(x, float) else x), st["c"]) for x in s])
        t = Table(data, colWidths=genislik, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        return t

    def cubuklar(satirlar, maks, esik=None, iki_yonlu=False):
        h = 16 * len(satirlar) + 8
        d = Drawing(W, h)
        etiket_w, deger_w = 90, 70
        bar_w = W - etiket_w - deger_w
        for i, (ad, deger, renk, yazi) in enumerate(satirlar):
            y = h - 16 * (i + 1)
            d.add(String(0, y + 3, ad, fontName="EduPusulaSans", fontSize=8, fillColor=NAVY))
            if iki_yonlu:
                orta = etiket_w + bar_w / 2
                w = abs(deger) / maks * (bar_w / 2) if maks else 0
                x = orta - w if deger < 0 else orta
                d.add(Rect(x, y, w, 10, fillColor=renk, strokeColor=None))
            else:
                d.add(Rect(etiket_w, y, bar_w, 10, fillColor=colors.HexColor("#F1F5F9"), strokeColor=None))
                d.add(Rect(etiket_w, y, max(0, min(1, deger / maks)) * bar_w, 10, fillColor=renk, strokeColor=None))
            d.add(String(W - deger_w + 6, y + 2, yazi, fontName="EduPusulaSans", fontSize=8, fillColor=MUTED))
        if iki_yonlu:
            d.add(Line(etiket_w + bar_w / 2, 0, etiket_w + bar_w / 2, h, strokeColor=NAVY, strokeWidth=0.8))
        if esik is not None:
            x = etiket_w + esik / maks * bar_w
            d.add(Line(x, 0, x, h, strokeColor=NAVY, strokeWidth=0.6, strokeDashArray=[2, 2]))
        return d

    k = kapak(v)
    akis = [Paragraph("Okul Kokpiti · Dönem raporu", st["h1"]), Spacer(1, 3),
            Paragraph(E(f"{k['okul']} · {k['yil']} · {k['seviye']}"), st["p"]),
            Paragraph(E(f"Dönem: {k['donem']} ({k['aralik']}) · {k['degerlendirilen']} deneme · son deneme {k['sonDeneme']}"), st["p"]),
            Paragraph(E(f"Oluşturulma: {k['olusturma']} · LGS puanı katsayılı yaklaşık hesaptır."), st["s"]), Spacer(1, 6)]
    bl = {b[0]: b for b in bolumler(v, None)}
    _, _, kol, sat = bl["Göstergeler"]
    akis += [Paragraph("Gösterge kartları", st["h2"]),
             tablo(kol, [(a, K.fmt(b) if isinstance(b, float) else b, c) for a, b, c in sat], [W * .32, W * .2, W * .48])]
    _, _, kol, sat = bl["Uyarılar"]
    sat = [(KOD_AD.get(a, a), b, c) for a, b, c in sat]
    akis += [Paragraph("Dikkat gerektirenler", st["h2"]),
             tablo(["Tür", "Başlık", "Detay"], sat, [W * .18, W * .32, W * .5]) if sat else Paragraph("Bu dönem dikkat gerektiren bir durum yok.", st["p"])]
    esik = v["dersler"]["esik"]
    ders_sat = [(d["kisa"] + f" ×{d['katsayi']}", (d["oran"] or 0) * 100, ORANGE if d["esikAlti"] else BLUE,
                 f"%{K.fmt((d['oran'] or 0) * 100, 0)} · {K.fmt(d['net'])}/{K.fmt(d['soru'], 0)}") for d in v["dersler"]["liste"]]
    akis += [KeepTogether([Paragraph(E(v["dersler"]["baslik"]), st["h2"]),
                           Paragraph(E(f"Başarı = ortalama net / soru · turuncu: %{K.fmt(esik, 0)} eşiğinin altında"), st["s"]),
                           cubuklar(ders_sat, 100, esik) if ders_sat else Spacer(1, 1)])]
    g = v["degisim"]
    if g.get("var"):
        maks = max([0.5] + [abs(x["fark"]) for x in g["dersler"]])
        akis += [KeepTogether([Paragraph(E(g["baslik"]), st["h2"]),
                               Paragraph(E(f"{g['once']} → {g['sonra']} ortalama net farkı · ±{K.fmt(g['esik'])} altı belirgin sayılmaz"), st["s"]),
                               cubuklar([(x["kisa"], x["fark"], ORANGE if x["fark"] < 0 else TEAL, K.fmt_isaret(x["fark"]))
                                         for x in g["dersler"]], maks, iki_yonlu=True)])]
    else:
        akis += [Paragraph("Dönem değişimi", st["h2"]), Paragraph(E(g.get("mesaj")), st["p"])]
    sb = v["subeler"]
    sd = sb["varsayilanDersler"]
    once_et = (v["donem"].get("once") or {}).get("etiket", "Önceki")
    sonra_et = (v["donem"].get("sonra") or {}).get("etiket", "bu dönem")
    akis += [Paragraph(E(sb["baslik"]), st["h2"]),
             tablo(["Şube", "Öğrenci", "Toplam net", "LGS puanı", "Ort. yanlış"] + [K.DERS_KISA[x] for x in sd]
                   + [f"{once_et} -> {sonra_et} puan"],
                   [(x["sube"], x["ogrenci"], x["toplamNet"], x["puan"], x["yanlis"]) + tuple(x["dersler"].get(d) for d in sd)
                    + (f"{K.fmt(x['puanOnce'])} -> {K.fmt(x['puanSonra'])}" if x["puanOnce"] is not None and x["puanSonra"] is not None else "-",)
                    for x in sb["satirlar"]],
                   [W * .1, W * .1, W * .12, W * .12, W * .11] + [W * .11] * len(sd) + [W * (.45 - .11 * len(sd))])]
    _, bas, kol, sat = bl["Katılım"]
    akis += [Paragraph(E(bas), st["h2"]), tablo(kol, sat, [W * .3, W * .14, W * .12, W * .12, W * .14, W * .18])]
    buf = io.BytesIO()

    def alt(canvas, doc):
        canvas.saveState()
        canvas.setFont("EduPusulaSans", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(16 * mm, 10 * mm, f"EduPusula · {k['okul']} · Okul Kokpiti dönem raporu")
        canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, f"Sayfa {doc.page}")
        canvas.restoreState()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=16 * mm,
                      title="Okul Kokpiti dönem raporu", author="EduPusula").build(akis, onFirstPage=alt, onLaterPages=alt)
    return buf.getvalue()
