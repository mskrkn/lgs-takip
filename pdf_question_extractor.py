"""EduPusula Soru Havuzu - PDF'den otomatik soru tespiti/kırpma.

Test PDF'inin metin katmanını (PyMuPDF) okuyarak her sorunun başlangıç
numarasını ve sayfa üzerindeki konumunu bulur, iki sütunlu (LGS/TYT tipi)
kitapçık düzenini x-koordinatına göre ayırt eder, her sorunun kapladığı
alanı görüntü olarak kırpar ve varsa cevap anahtarı sayfasını ayrıştırır.

Bu modül SADECE otomatik ilk-tahmini üretir - sonuç kesin/nihai değildir,
server.py bunu question_bank tablosuna 'pending_review' durumuyla yazar;
öğretmen kırpma sınırlarını ve konu/kazanım/zorluk bilgisini onaylamadan
hiçbir soru havuza (approved) düşmez.

NOT: PDF'in gerçek metin katmanı olmadığı (taranmış/fotokopi) durumlar
için bu modül şu an bir şey yapamaz - bkz. proje notları. O senaryo
ayrı bir OCR adımı gerektirir ve kasıtlı olarak bu ilk sürümün dışında
bırakılmıştır.
"""

import re

import fitz  # PyMuPDF

# Soru başlangıcı: "12." veya "1." - noktadan sonra boşluk ya da satır sonu.
# Not: cevap anahtarındaki "12.D" gibi kalıplarla KARIŞMAMASI için nokta
# sonrası doğrudan bir harf gelmesi durumunu kasıtlı olarak dışarıda bırakır.
_QUESTION_START_RE = re.compile(r"^\s*(\d{1,3})\.(\s|$)")

# Cevap anahtarı satırı: "12.D", boşluksuz, tek harf.
_ANSWER_LINE_RE = re.compile(r"^\s*(\d{1,3})\.\s*([A-EÇĞİÖŞÜ])\s*$")

# Sayfa başlığı/altbilgisi gibi neredeyse tam sayfa genişliğindeki bloklar
# sütun sınırını bozmasın diye sütunlama hesabından hariç tutulur.
_FULL_WIDTH_BLOCK_RATIO = 0.6

# Kırpma çözünürlüğü (dpi) - ekran önizlemesi için yeterli, dosya boyutu makul.
_CROP_DPI = 200


def _page_lines(page):
    """Bir sayfadaki her metin satırını (text, bbox) olarak döndürür."""
    d = page.get_text("dict")
    lines = []
    for block in d.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            lines.append((text, line["bbox"], block))
    return lines


def _detect_answer_key_pages(doc):
    """Bir sayfadaki satırların yarısından fazlası 'N.X' kalıbına uyuyorsa
    (ve en az 5 tane varsa) o sayfa cevap anahtarı sayfası kabul edilir."""
    answer_key = {}
    answer_key_pages = set()
    for pno in range(doc.page_count):
        lines = _page_lines(doc[pno])
        stripped = [t.strip() for t, _, _ in lines if t.strip()]
        if not stripped:
            continue
        matches = [_ANSWER_LINE_RE.match(t) for t in stripped]
        matches = [m for m in matches if m]
        if len(matches) >= 5 and len(matches) >= 0.5 * len(stripped):
            answer_key_pages.add(pno)
            for m in matches:
                answer_key[int(m.group(1))] = m.group(2)
    return answer_key_pages, answer_key


def _detect_questions(doc, skip_pages):
    """Her soru numarası için {page, rect} döndürür. Aynı numara birden
    fazla sayfada/kez tespit edilirse (örn. kapak sayfasındaki dekoratif
    bir sayı listesiyle çakışma) DOKÜMAN SIRASINDA SONRAKİ görülen kazanır
    - içerik sayfaları kapak/dekoratif öğelerden sonra geldiği için bu,
    ekstra bir "kapak sayfası mı" tespiti yapmadan yanlış eşleşmeleri
    kendiliğinden eler."""
    questions = {}
    for pno in range(doc.page_count):
        if pno in skip_pages:
            continue
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height
        mid = pw / 2

        cols = {"L": [], "R": []}
        for text, bbox, block in _page_lines(page):
            bx0, by0, bx1, by1 = block["bbox"]
            if (bx1 - bx0) > _FULL_WIDTH_BLOCK_RATIO * pw:
                continue
            col = "L" if (bx0 + bx1) / 2 < mid else "R"
            cols[col].append((text, bbox, block["bbox"]))

        for col_name, entries in cols.items():
            if not entries:
                continue
            col_x0 = min(bb[0] for _, _, bb in entries)
            col_x1 = max(bb[2] for _, _, bb in entries)

            starts = []
            for text, line_bbox, _ in entries:
                m = _QUESTION_START_RE.match(text)
                if m:
                    starts.append((int(m.group(1)), line_bbox[1]))
            starts.sort(key=lambda t: t[1])

            for i, (num, y0) in enumerate(starts):
                y_end = starts[i + 1][1] if i + 1 < len(starts) else ph - 20
                rect = fitz.Rect(
                    max(col_x0 - 8, 0), max(y0 - 6, 0),
                    min(col_x1 + 8, pw), min(y_end - 4, ph),
                )
                questions[num] = {"page": pno, "rect": rect}
    return questions


def extract_questions(pdf_path):
    """PDF'i açar, cevap anahtarını ve soruları tespit eder.

    Döner: {
      "page_count": int,
      "answer_key": {soru_no: "A"/"B"/...},
      "questions": [
        {"number": int, "page": int (0-index), "rect": fitz.Rect}, ...
      ]  # soru numarasına göre sıralı
    }

    Görüntüyü kaydetmek çağıranın işi (render_question_crop) - bu fonksiyon
    sadece tespiti yapar, disk I/O'ya karışmaz.
    """
    doc = fitz.open(pdf_path)
    try:
        answer_key_pages, answer_key = _detect_answer_key_pages(doc)
        questions = _detect_questions(doc, skip_pages=answer_key_pages)
        ordered = [
            {"number": num, "page": info["page"], "rect": info["rect"]}
            for num, info in sorted(questions.items())
        ]
        return {
            "page_count": doc.page_count,
            "answer_key": answer_key,
            "questions": ordered,
        }
    finally:
        doc.close()


def render_question_crop(pdf_path, page_index, rect, out_path):
    """Tek bir sorunun kırpılmış görüntüsünü PNG olarak diske kaydeder."""
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_index]
        pix = page.get_pixmap(clip=rect, dpi=_CROP_DPI)
        pix.save(out_path)
    finally:
        doc.close()


# Elle kırpma düzeltme ekranının arka plan görüntüsü için çözünürlük.
# _CROP_DPI ile aynı olması, ekranda sürüklenen dikdörtgenin nokta<->piksel
# ölçeğinin kaydedilen son kırpmayla birebir eşleşmesini sağlar.
CONTEXT_DPI = _CROP_DPI


def render_page_image_bytes(pdf_path, page_index, dpi=CONTEXT_DPI):
    """Tüm sayfayı PNG bayt dizisi olarak döndürür (elle kırpma düzeltme
    ekranının arka plan referans görüntüsü) - sayfanın puan cinsinden
    genişlik/yüksekliğiyle birlikte, çağıran taraf ölçek hesabı yapabilsin."""
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_index]
        pix = page.get_pixmap(dpi=dpi)
        return pix.tobytes("png"), page.rect.width, page.rect.height
    finally:
        doc.close()


def render_question_crop_from_bounds(pdf_path, page_index, x0, y0, x1, y1, out_path, dpi=_CROP_DPI):
    """Kullanıcının elle düzelttiği sınırlarla yeniden kırpar. Sayfa dışına
    taşan sınırları sayfa kenarına kadar kırpar (fitz.Rect'in kendisi bunu
    sessizce yapmaz, geçersiz bir pixmap üretebilir). Kaydedilmek üzere
    gerçekte kullanılan (kırpılmış) sınırı döndürür."""
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_index]
        pw, ph = page.rect.width, page.rect.height
        rect = fitz.Rect(
            max(0, min(x0, x1)), max(0, min(y0, y1)),
            min(pw, max(x0, x1)), min(ph, max(y0, y1)),
        )
        if rect.width < 4 or rect.height < 4:
            raise ValueError("Kırpma alanı çok küçük.")
        pix = page.get_pixmap(clip=rect, dpi=dpi)
        pix.save(out_path)
        return rect
    finally:
        doc.close()
