"""
Optik Okuma (Kamera OMR) - basili cevap formu ureteci.

Bu modul, "edupusula-optik-okuma-prompt.md" spesifikasyonundaki sabit
20-soru x 4-sik grid'i tanimlar ve reportlab ile A4'e 2x2 yerlesen,
kesim cizgili, ogrenci basina QR kodlu bir PDF uretir.

KRITIK: Buradaki tum geometri sabitleri, mini-formun kendi 105x148mm
alani icinde SOL-UST kose orijinli, milimetre cinsinden ve MUTLAK
degil ORANSAL (0..1) olarak tanimlanir. Boylece Faz 3'teki
omr_pipeline.py, kamera goruntusunu bu ORANLARIN ayni sekilde
uygulanabilecegi normalize bir dikdortgene (perspektif duzeltmesi
sonrasi) donusturup AYNI koordinat fonksiyonlarini dogrudan
piksel uzayinda kullanabilir - grid koordinatlari iki yerde ayri
ayri tanimlanip birbirinden sapmaz.
"""

import io
import os

import reportlab
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

import qrcode

# Turkce karakterler (İ, ı, Ş, ş, Ğ, ğ) reportlab'in yerlesik Helvetica'sinda
# (WinAnsi/cp1252 kodlamasi) YOK - ogrenci adlari bu yuzden bos kare olarak
# basilirdi (gercek bir dev veritabani ornegiyle dogrulandi: "HALİL" ->
# "HAL[]L"). reportlab'in kendi paketiyle gelen Vera (Bitstream Vera Sans)
# TTF'i butun Turkce karakterleri icerir ve platform bagimsizdir (VM'de de
# ayni yerde bulunur) - ekstra bir font dosyasi depoya eklemeye gerek yok.
_FONTS_DIR = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
pdfmetrics.registerFont(TTFont("EduPusulaSans", os.path.join(_FONTS_DIR, "Vera.ttf")))
pdfmetrics.registerFont(TTFont("EduPusulaSans-Bold", os.path.join(_FONTS_DIR, "VeraBd.ttf")))


# ============================================================
# Sabit grid geometrisi (bkz. modul docstring'i - oransal, mm degil)
# ============================================================

FORM_W_MM = 105.0
FORM_H_MM = 148.0

QUESTION_COUNT_MAX = 20
CHOICES = ("A", "B", "C", "D")

FIDUCIAL_SIZE_MM = 5.0
FIDUCIAL_MARGIN_MM = 5.0

QR_BOX_MM = (8.0, 12.0, 28.0, 32.0)  # (x0, y0, x1, y1) sol-ust orijinli

# Okul No bloğu: kullanıcı isteğiyle (2026-09-15) SATIR=hane, SÜTUN=rakam
# (0-9 üstte tek bir başlık satırı, altında 5 hane satırı) düzenine
# çevrildi - eskiden 4 hane x dikey 0-9 idi. Daha büyük dairelerle daha
# rahat okunuyor, yatayda kullanılmayan alanı da değerlendiriyor.
ID_DIGIT_COUNT = 5   # hane sayisi (satir)
ID_DIGIT_ROWS = 10   # rakam degeri 0-9 (sutun) - isim ozgun pipeline uyumu icin korunuyor
ID_BLOCK_ORIGIN_MM = (20.0, 40.0)  # ilk (deger=0) sutunun x'i, baslik satirinin y'si
ID_DIGIT_COL_SPACING_MM = 6.5
ID_DIGIT_ROW_SPACING_MM = 6.5
ID_BUBBLE_D_MM = 4.5

# Cevap balonlari kullanici isteğiyle buyutuldu (3.5mm -> 4.2mm); alt
# fiducial'lerle carpismamak icin ANSWER_GRID_BOTTOM_MM daraltildi, ID
# bloğunun artik daha az dikey yer kaplamasindan kazanilan alan
# ANSWER_GRID_TOP_MM'i yukari cekerek geri kazanildi (okuma alanini
# olabildiğince etkin kullanma isteğiyle uyumlu).
ANSWER_GRID_TOP_MM = 78.0
ANSWER_GRID_BOTTOM_MM = 136.0
ANSWER_ROWS_PER_COL = 10
ANSWER_ROW_H_MM = (ANSWER_GRID_BOTTOM_MM - ANSWER_GRID_TOP_MM) / ANSWER_ROWS_PER_COL
ANSWER_COL_X_MM = {1: 6.0, 2: 55.0}  # sutun 1: soru 1-10, sutun 2: soru 11-20
ANSWER_CHOICE_OFFSETS_MM = (9.0, 15.5, 22.0, 28.5)  # A,B,C,D - sutun basindan
ANSWER_BUBBLE_D_MM = 4.2


def fiducial_centers_mm():
    """4 kose fiducial'inin (sol-ust orijinli) merkez koordinatlari."""
    half = FIDUCIAL_SIZE_MM / 2 + FIDUCIAL_MARGIN_MM
    return {
        "TL": (half, half),
        "TR": (FORM_W_MM - half, half),
        "BL": (half, FORM_H_MM - half),
        "BR": (FORM_W_MM - half, FORM_H_MM - half),
    }


def id_bubble_center_mm(digit_col, digit_row):
    """digit_col: 0-4 (soldan saga hane sirasi/SATIR), digit_row: 0-9
    (o hanenin rakam degeri/SUTUN) - isimler eski (dikey) tasarimdan
    kalma ama omr_pipeline.py bu fonksiyonu semantik olarak degil sadece
    (index, deger) ciftinden piksel uretmek icin cagirdigindan degismesine
    gerek yok."""
    x0, y0 = ID_BLOCK_ORIGIN_MM
    x = x0 + digit_row * ID_DIGIT_COL_SPACING_MM
    y = y0 + (digit_col + 1) * ID_DIGIT_ROW_SPACING_MM  # +1: baslik satirini atla
    return (x, y)


def question_bubble_center_mm(question_number, choice_index):
    """question_number: 1-20, choice_index: 0-3 (A-D)."""
    col = 1 if question_number <= 10 else 2
    row = (question_number - 1) % 10
    x_col = ANSWER_COL_X_MM[col]
    x = x_col + ANSWER_CHOICE_OFFSETS_MM[choice_index]
    y = ANSWER_GRID_TOP_MM + row * ANSWER_ROW_H_MM + ANSWER_ROW_H_MM / 2
    return (x, y)


# ============================================================
# PDF uretimi
# ============================================================

def _mm_to_pt_topdown(x_mm, y_mm, origin_x_pt, origin_y_top_pt):
    """Form-lokal (sol-ust orijinli, mm) koordinati, sayfa uzerindeki
    (reportlab'in sol-alt orijinli, punto) mutlak koordinatina cevirir."""
    px = origin_x_pt + x_mm * mm
    py = origin_y_top_pt - y_mm * mm
    return px, py


def _draw_mini_form(c, origin_x_pt, origin_y_top_pt, paper, exam_title):
    """Tek bir ogrencinin formunu, sayfa uzerinde (origin_x_pt, origin_y_top_pt)
    sol-ust kosesinden baslayarak cizer."""

    def pt(x_mm, y_mm):
        return _mm_to_pt_topdown(x_mm, y_mm, origin_x_pt, origin_y_top_pt)

    # Kesim/cerceve siniri (ince gri cizgi - fiziksel kesim rehberi)
    c.setStrokeColorRGB(0.75, 0.75, 0.75)
    c.setLineWidth(0.4)
    x0, y0 = pt(0, 0)
    x1, y1 = pt(FORM_W_MM, FORM_H_MM)
    c.rect(x0, y1, x1 - x0, y0 - y1, stroke=1, fill=0)

    # 4 kose fiducial (dolu siyah kare)
    c.setFillColorRGB(0, 0, 0)
    for cx_mm, cy_mm in fiducial_centers_mm().values():
        cx, cy = pt(cx_mm, cy_mm)
        half = FIDUCIAL_SIZE_MM / 2 * mm
        c.rect(cx - half, cy - half, FIDUCIAL_SIZE_MM * mm, FIDUCIAL_SIZE_MM * mm, stroke=0, fill=1)

    # QR kod (paper_token)
    qr_x0, qr_y0, qr_x1, qr_y1 = QR_BOX_MM
    qx, qy = pt(qr_x0, qr_y1)  # sol-ust
    qr_img = qrcode.make(paper["paper_token"], border=1)
    qr_size_pt = (qr_x1 - qr_x0) * mm
    c.drawInlineImage(qr_img, qx, qy, width=qr_size_pt, height=qr_size_pt)

    # Kimlik metni (sadece gorsel dogrulama - eslestirme mantigina dahil degil)
    text_x, text_y = pt(qr_x1 + 4, 16)
    c.setFont("EduPusulaSans-Bold", 10)
    c.drawString(text_x, text_y, (exam_title or "")[:38])
    c.setFont("EduPusulaSans-Bold", 9)
    c.drawString(text_x, text_y - 11, (paper.get("student_name") or "")[:38])
    c.setFont("EduPusulaSans", 8)
    c.drawString(text_x, text_y - 21, f"Sınıf: {paper.get('class_name') or '-'}")

    # Okul No bloğu: BAŞLIK satırı "0 1 2 ... 9" + altında 5 hane satırı
    # (kullanıcı isteğiyle satır=hane/sütun=rakam düzenine çevrildi, bkz.
    # id_bubble_center_mm docstring'i).
    label_x, label_y = pt(ID_BLOCK_ORIGIN_MM[0] - 12, ID_BLOCK_ORIGIN_MM[1])
    c.setFont("EduPusulaSans-Bold", 8)
    c.drawString(label_x, label_y - 2, "No")
    c.setFont("EduPusulaSans-Bold", 7)
    for value in range(ID_DIGIT_ROWS):
        hx, hy = pt(ID_BLOCK_ORIGIN_MM[0] + value * ID_DIGIT_COL_SPACING_MM, ID_BLOCK_ORIGIN_MM[1])
        c.drawCentredString(hx, hy - 2, str(value))
    for digit_col in range(ID_DIGIT_COUNT):
        for digit_row in range(ID_DIGIT_ROWS):
            cx_mm, cy_mm = id_bubble_center_mm(digit_col, digit_row)
            cx, cy = pt(cx_mm, cy_mm)
            r = ID_BUBBLE_D_MM / 2 * mm
            c.setLineWidth(1.0)
            c.circle(cx, cy, r, stroke=1, fill=0)

    # Cevap grid'i (20 soru x 4 sik) - buyuk, kalin hatli daireler
    for q in range(1, QUESTION_COUNT_MAX + 1):
        col = 1 if q <= 10 else 2
        row = (q - 1) % 10
        num_x_mm = ANSWER_COL_X_MM[col] - 4.5
        num_y_mm = ANSWER_GRID_TOP_MM + row * ANSWER_ROW_H_MM + ANSWER_ROW_H_MM / 2
        nx, ny = pt(num_x_mm, num_y_mm)
        c.setFont("EduPusulaSans-Bold", 9)
        c.drawCentredString(nx, ny - 3, str(q))
        for choice_idx, choice_label in enumerate(CHOICES):
            cx_mm, cy_mm = question_bubble_center_mm(q, choice_idx)
            cx, cy = pt(cx_mm, cy_mm)
            r = ANSWER_BUBBLE_D_MM / 2 * mm
            c.setLineWidth(1.1)
            c.circle(cx, cy, r, stroke=1, fill=0)
            c.setFont("EduPusulaSans-Bold", 7)
            c.drawCentredString(cx, cy - 2.4, choice_label)


def generate_omr_pdf(papers, exam_title):
    """papers: [{paper_token, student_name, class_name}, ...] - her biri icin
    bir mini-form cizilir, A4 sayfalara 2x2 yerlestirilir. PDF byte'larini
    dondurur."""
    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    # 2x2 yerlesim: her sayfada 4 mini-form, aralarinda kesim payi yok
    # (kesim cizgisi kenarliktan geliyor), sayfayi ortalamak icin kucuk bir
    # dis bosluk birakiliyor.
    grid_w = FORM_W_MM * 2 * mm
    grid_h = FORM_H_MM * 2 * mm
    offset_x = (page_w - grid_w) / 2
    offset_y = (page_h - grid_h) / 2

    slots = [
        (offset_x, page_h - offset_y),                      # sol-ust
        (offset_x + FORM_W_MM * mm, page_h - offset_y),      # sag-ust
        (offset_x, page_h - offset_y - FORM_H_MM * mm),      # sol-alt
        (offset_x + FORM_W_MM * mm, page_h - offset_y - FORM_H_MM * mm),  # sag-alt
    ]

    for i, paper in enumerate(papers):
        slot = i % 4
        if slot == 0 and i > 0:
            c.showPage()
        ox, oy_top = slots[slot]
        _draw_mini_form(c, ox, oy_top, paper, exam_title)

    c.save()
    return buf.getvalue()
