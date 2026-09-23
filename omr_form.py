"""
Optik Okuma (Kamera OMR) - basili cevap formu ureteci.

Bu modul, "edupusula-optik-okuma-prompt.md" spesifikasyonundaki 4-sik
grid'i tanimlar ve reportlab ile A4'e yerlesen, kesim cizgili, ogrenci
basina QR kodlu bir PDF uretir.

KRITIK: Buradaki tum geometri sabitleri, mini-formun kendi (sablona gore
degisen) alani icinde SOL-UST kose orijinli, milimetre cinsinden ve
MUTLAK degil ORANSAL (0..1) olarak tanimlanir. Boylece Faz 3'teki
omr_pipeline.py, kamera goruntusunu bu ORANLARIN ayni sekilde
uygulanabilecegi normalize bir dikdortgene (perspektif duzeltmesi
sonrasi) donusturup AYNI koordinat fonksiyonlarini dogrudan piksel
uzayinda kullanabilir - grid koordinatlari iki yerde ayri ayri
tanimlanip birbirinden sapmaz.

Kullanici isteğiyle 2026-09-17: tek sabit form yerine BIRDEN FAZLA
SABLON (FormTemplate) var artik - "compact" (mevcut, 70x148.5mm, maks.
25 soru, 6 kagit/A4), "quarter50" ve "quarter100" (ceyrek A4,
105x148.5mm, sirasiyla maks. 50/100 soru, 4 kagit/A4). Soru sayisi
arttikca ayni fiziksel alanda daha COK SUTUN kullanilir (satir
yuksekligi/sabit ust-alt bosluklar AYNI kalir) - bu yuzden 50/100'de
balon capi kacinilmaz sekilde kuculur (sirasiyla 3.6mm / 2.8mm,
'compact'in 4.4mm'inden kucuk). Hangi ornegin hangi sablonla
BASILDIGI (form_template) sunucuda kalici olarak saklanir (bkz.
server.py omr_exam_definitions.form_template) - select_template()
sadece OLUSTURMA anında bir kere cagrilir, okuma sirasinda ASLA
yeniden turetilmez (sinirlar ileride degisirse eski taramalar bozulmasin
diye).

2026-09-23: kullanici karari uzerine iki degisiklik yapildi: (1) QR
okunamadiginda yedek kimlik yontemi olan "Okul No" balon blogu tamamen
KALDIRILDI (gercek kullanimda hic doldurulmuyordu, QR tek basina yeterli) -
bu blogun kapladigi dikey alan artik bos; (2) yeni varsayilan kucuk-kagit
standardi 25 yerine 20 soru oldu ("compact20", answer_grid_top_mm=32.0 -
Okul No blogunun bosalttigi alani da kullanarak 10mm'lik cok daha ferah
satir araligi saglar). ESKI 'compact' (25 soru, 6mm satir araligi, Okul No
blogu HALA cizilmiyor ama alani bos kalir) DEGISTIRILMEDI ve TEMPLATES'te
kaldi - bugune kadar bu sablonla basilmis kagitlar (staging test kagitlari
dahil) okunabilir kalsin diye. select_template() artik YENI sinavlar icin
25'lik 'compact'i hic secmiyor, sadece gecmis kayitlari okumak icin
sozlukte duruyor."""

import io
import os
from dataclasses import dataclass

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


QUESTION_COUNT_MIN = 1
QUESTION_COUNT_MAX = 100  # TUM sablonlar arasindaki en buyuk fiziksel kapasite
CHOICES = ("A", "B", "C", "D")


@dataclass(frozen=True)
class FormTemplate:
    """Bir optik kagit sablonunun TUM geometrisi. Butun degerler mm
    cinsinden, mini-formun kendi sol-ust orijinli koordinat sisteminde
    (bkz. modul docstring'i)."""
    id: str
    form_w_mm: float
    form_h_mm: float
    question_count_max: int
    page_cols: int   # A4 sayfada yan yana kac kagit
    page_rows: int   # A4 sayfada alt alta kac kagit

    fiducial_size_mm: float
    fiducial_margin_mm: float
    qr_box_mm: tuple  # (x0, y0, x1, y1)

    answer_grid_top_mm: float
    answer_grid_bottom_mm: float
    answer_rows_per_col: int  # 1. sutunun satir sayisi (son sutun daha kisa olabilir)
    answer_col_x_mm: dict     # {1: x, 2: x, ...} - sutun basi x konumu
    answer_choice_offsets_mm: tuple  # A,B,C,D - sutun basindan
    answer_bubble_d_mm: float
    answer_num_offset_mm: float  # soru numarasi, sutun basindan bu kadar SOLDA

    title_font_size: int
    name_font_size: int
    class_font_size: int
    num_font_size: int
    num_baseline_dy: float
    choice_font_size: int
    choice_baseline_dy: float

    @property
    def answer_row_h_mm(self):
        return (self.answer_grid_bottom_mm - self.answer_grid_top_mm) / self.answer_rows_per_col

    def fiducial_centers_mm(self):
        """4 kose fiducial'inin (sol-ust orijinli) merkez koordinatlari."""
        half = self.fiducial_size_mm / 2 + self.fiducial_margin_mm
        return {
            "TL": (half, half),
            "TR": (self.form_w_mm - half, half),
            "BL": (half, self.form_h_mm - half),
            "BR": (self.form_w_mm - half, self.form_h_mm - half),
        }

    def question_bubble_center_mm(self, question_number, choice_index):
        """question_number: 1..question_count_max, choice_index: 0-3 (A-D)."""
        col = (question_number - 1) // self.answer_rows_per_col + 1
        row = (question_number - 1) % self.answer_rows_per_col
        x_col = self.answer_col_x_mm[col]
        x = x_col + self.answer_choice_offsets_mm[choice_index]
        y = self.answer_grid_top_mm + row * self.answer_row_h_mm + self.answer_row_h_mm / 2
        return (x, y)

    def question_number_pos_mm(self, question_number):
        col = (question_number - 1) // self.answer_rows_per_col + 1
        row = (question_number - 1) % self.answer_rows_per_col
        x = self.answer_col_x_mm[col] - self.answer_num_offset_mm
        y = self.answer_grid_top_mm + row * self.answer_row_h_mm + self.answer_row_h_mm / 2
        return (x, y)


# ============================================================
# Sablonlar (bkz. modul docstring'i - "compact" 2026-09-16'da
# canliya alinan, degismeyen geometri; quarter50/quarter100
# 2026-09-17'de eklendi)
# ============================================================

TEMPLATE_COMPACT = FormTemplate(
    id="compact",
    form_w_mm=70.0, form_h_mm=148.5,
    question_count_max=25,
    page_cols=3, page_rows=2,
    fiducial_size_mm=5.0, fiducial_margin_mm=5.0,
    qr_box_mm=(11.0, 10.5, 27.0, 26.5),
    answer_grid_top_mm=57.0, answer_grid_bottom_mm=135.0, answer_rows_per_col=13,
    answer_col_x_mm={1: 9.0, 2: 41.0},
    answer_choice_offsets_mm=(4.5, 10.5, 16.5, 22.5),
    answer_bubble_d_mm=4.4, answer_num_offset_mm=3.0,
    title_font_size=8, name_font_size=7, class_font_size=6,
    num_font_size=8, num_baseline_dy=2.5,
    choice_font_size=6, choice_baseline_dy=2.0,
)

TEMPLATE_COMPACT20 = FormTemplate(
    id="compact20",
    form_w_mm=70.0, form_h_mm=148.5,
    question_count_max=20,
    page_cols=3, page_rows=2,
    fiducial_size_mm=5.0, fiducial_margin_mm=5.0,
    qr_box_mm=(11.0, 10.5, 27.0, 26.5),
    answer_grid_top_mm=32.0, answer_grid_bottom_mm=135.0, answer_rows_per_col=10,
    answer_col_x_mm={1: 9.0, 2: 41.0},
    answer_choice_offsets_mm=(4.5, 10.5, 16.5, 22.5),
    answer_bubble_d_mm=4.4, answer_num_offset_mm=3.0,
    title_font_size=8, name_font_size=7, class_font_size=6,
    num_font_size=8, num_baseline_dy=2.5,
    choice_font_size=6, choice_baseline_dy=2.0,
)

TEMPLATE_QUARTER50 = FormTemplate(
    id="quarter50",
    form_w_mm=105.0, form_h_mm=148.5,
    question_count_max=50,
    page_cols=2, page_rows=2,
    fiducial_size_mm=5.0, fiducial_margin_mm=5.0,
    qr_box_mm=(11.0, 10.5, 27.0, 26.5),
    answer_grid_top_mm=57.0, answer_grid_bottom_mm=135.0, answer_rows_per_col=13,
    answer_col_x_mm={1: 9.0, 2: 34.0, 3: 59.0, 4: 84.0},
    answer_choice_offsets_mm=(2.8, 7.1, 11.4, 15.7),
    answer_bubble_d_mm=3.6, answer_num_offset_mm=3.0,
    title_font_size=9, name_font_size=8, class_font_size=7,
    num_font_size=7, num_baseline_dy=2.2,
    choice_font_size=6, choice_baseline_dy=1.8,
)

TEMPLATE_QUARTER100 = FormTemplate(
    id="quarter100",
    form_w_mm=105.0, form_h_mm=148.5,
    question_count_max=100,
    page_cols=2, page_rows=2,
    fiducial_size_mm=5.0, fiducial_margin_mm=5.0,
    qr_box_mm=(11.0, 10.5, 27.0, 26.5),
    answer_grid_top_mm=57.0, answer_grid_bottom_mm=135.0, answer_rows_per_col=20,
    answer_col_x_mm={1: 7.0, 2: 26.0, 3: 45.0, 4: 64.0, 5: 83.0},
    answer_choice_offsets_mm=(2.2, 5.6, 9.0, 12.4),
    answer_bubble_d_mm=2.8, answer_num_offset_mm=2.5,
    title_font_size=9, name_font_size=8, class_font_size=7,
    num_font_size=6, num_baseline_dy=1.8,
    choice_font_size=5, choice_baseline_dy=1.4,
)

TEMPLATES = {t.id: t for t in (TEMPLATE_COMPACT, TEMPLATE_COMPACT20, TEMPLATE_QUARTER50, TEMPLATE_QUARTER100)}


def select_template(question_count):
    """SADECE test tanimi OLUSTURULURKEN bir kere cagrilir, sonucu
    (template.id) kalici olarak saklanir - bkz. modul docstring'i.
    En kucuk yeterli sabloni secer: 1-20 -> compact20, 21-50 -> quarter50,
    51-100 -> quarter100. Eski 'compact' (25 soru) artik YENI test icin
    SECILMIYOR - sadece daha once bu sablonla basilmis eski sinavlari
    okuyabilmek icin TEMPLATES sozlugunde tutuluyor (2026-09-23)."""
    if question_count <= TEMPLATE_COMPACT20.question_count_max:
        return TEMPLATE_COMPACT20
    if question_count <= TEMPLATE_QUARTER50.question_count_max:
        return TEMPLATE_QUARTER50
    return TEMPLATE_QUARTER100


# ============================================================
# PDF uretimi
# ============================================================

def _mm_to_pt_topdown(x_mm, y_mm, origin_x_pt, origin_y_top_pt):
    """Form-lokal (sol-ust orijinli, mm) koordinati, sayfa uzerindeki
    (reportlab'in sol-alt orijinli, punto) mutlak koordinatina cevirir."""
    px = origin_x_pt + x_mm * mm
    py = origin_y_top_pt - y_mm * mm
    return px, py


def _draw_mini_form(c, origin_x_pt, origin_y_top_pt, template, paper, exam_title):
    """Tek bir ogrencinin formunu, sayfa uzerinde (origin_x_pt, origin_y_top_pt)
    sol-ust kosesinden baslayarak, verilen sablonun geometrisiyle cizer."""
    t = template

    def pt(x_mm, y_mm):
        return _mm_to_pt_topdown(x_mm, y_mm, origin_x_pt, origin_y_top_pt)

    # Kesim/cerceve siniri (ince gri cizgi - fiziksel kesim rehberi)
    c.setStrokeColorRGB(0.75, 0.75, 0.75)
    c.setLineWidth(0.4)
    x0, y0 = pt(0, 0)
    x1, y1 = pt(t.form_w_mm, t.form_h_mm)
    c.rect(x0, y1, x1 - x0, y0 - y1, stroke=1, fill=0)

    # 4 kose fiducial (dolu siyah kare)
    c.setFillColorRGB(0, 0, 0)
    for cx_mm, cy_mm in t.fiducial_centers_mm().values():
        cx, cy = pt(cx_mm, cy_mm)
        half = t.fiducial_size_mm / 2 * mm
        c.rect(cx - half, cy - half, t.fiducial_size_mm * mm, t.fiducial_size_mm * mm, stroke=0, fill=1)

    # QR kod (paper_token)
    qr_x0, qr_y0, qr_x1, qr_y1 = t.qr_box_mm
    qx, qy = pt(qr_x0, qr_y1)  # sol-ust
    qr_img = qrcode.make(paper["paper_token"], border=1)
    qr_size_pt = (qr_x1 - qr_x0) * mm
    c.drawInlineImage(qr_img, qx, qy, width=qr_size_pt, height=qr_size_pt)

    # Kimlik metni (sadece gorsel dogrulama - eslestirme mantigina dahil degil)
    text_x, text_y = pt(qr_x1 + 3, 15)
    c.setFont("EduPusulaSans-Bold", t.title_font_size)
    c.drawString(text_x, text_y, (exam_title or "")[:26])
    c.setFont("EduPusulaSans-Bold", t.name_font_size)
    c.drawString(text_x, text_y - 10, (paper.get("student_name") or "")[:26])
    c.setFont("EduPusulaSans", t.class_font_size)
    c.drawString(text_x, text_y - 19, f"Sınıf: {paper.get('class_name') or '-'}")

    # Cevap grid'i - buyuk, kalin hatli daireler
    for q in range(1, t.question_count_max + 1):
        num_x_mm, num_y_mm = t.question_number_pos_mm(q)
        nx, ny = pt(num_x_mm, num_y_mm)
        c.setFont("EduPusulaSans-Bold", t.num_font_size)
        c.drawCentredString(nx, ny - t.num_baseline_dy, str(q))
        for choice_idx, choice_label in enumerate(CHOICES):
            cx_mm, cy_mm = t.question_bubble_center_mm(q, choice_idx)
            cx, cy = pt(cx_mm, cy_mm)
            r = t.answer_bubble_d_mm / 2 * mm
            c.setLineWidth(1.1)
            c.circle(cx, cy, r, stroke=1, fill=0)
            c.setFont("EduPusulaSans-Bold", t.choice_font_size)
            c.drawCentredString(cx, cy - t.choice_baseline_dy, choice_label)


def generate_omr_pdf(papers, exam_title, template):
    """papers: [{paper_token, student_name, class_name}, ...] - her biri icin
    bir mini-form cizilir, A4 sayfalara template.page_cols x template.page_rows
    yerlestirilir. PDF byte'larini dondurur."""
    t = template
    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    per_page = t.page_cols * t.page_rows
    grid_w = t.form_w_mm * t.page_cols * mm
    grid_h = t.form_h_mm * t.page_rows * mm
    offset_x = (page_w - grid_w) / 2
    offset_y = (page_h - grid_h) / 2

    slots = [
        (offset_x + col * t.form_w_mm * mm, page_h - offset_y - row * t.form_h_mm * mm)
        for row in range(t.page_rows) for col in range(t.page_cols)
    ]

    for i, paper in enumerate(papers):
        slot = i % per_page
        if slot == 0 and i > 0:
            c.showPage()
        ox, oy_top = slots[slot]
        _draw_mini_form(c, ox, oy_top, t, paper, exam_title)

    c.save()
    return buf.getvalue()
