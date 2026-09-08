"""EduPusula Soru Havuzu - PDF'den otomatik soru tespiti/kırpma.

Test PDF'inin metin katmanını (PyMuPDF) okuyarak her sorunun başlangıç
numarasını ve sayfa üzerindeki konumunu bulur, iki sütunlu (LGS/TYT tipi)
kitapçık düzenini x-koordinatına göre ayırt eder, her sorunun kapladığı
alanı görüntü olarak kırpar ve varsa cevap anahtarı sayfasını ayrıştırır.

Bu modül SADECE otomatik ilk-tahmini üretir - sonuç kesin/nihai değildir,
server.py bunu question_bank tablosuna 'pending_review' durumuyla yazar;
öğretmen kırpma sınırlarını ve konu/kazanım/zorluk bilgisini onaylamadan
hiçbir soru havuza (approved) düşmez.

Taranmış/fotokopi PDF'ler (gerçek metin katmanı olmayan, sayfası tek bir
resimden ibaret dosyalar) için sayfa bazında Tesseract OCR'a düşer - bkz.
_ocr_page_lines. Bu sadece metin katmanı BOŞ çıkan sayfalarda çalışır,
normal dijital PDF'lerde hiçbir OCR maliyeti oluşmaz.

Bir sütunda kendinden sonra soru gelmeyen son sorunun alt sınırı, metin/OCR
tespitinden bilinemez (bir sonraki soru numarası yok) - bunu iyileştirmek
için OpenCV ile görsel blok tespiti (gri tonlama + Otsu eşikleme +
morfolojik genişletme + kontur tespiti, bkz. _detect_ink_blocks) opsiyonel
bir katman olarak kullanılır; hangi bloğun kaçıncı soru olduğuna asla karar
vermez, sadece zaten "sayfa sonuna kadar" olan gevşek sınırı sıkılaştırır.
"""

import io
import os
import re

import fitz  # PyMuPDF
import pytesseract
from PIL import Image

# OpenCV, sütundaki SON sorunun alt sınırını (bkz. _detect_ink_blocks)
# görsel olarak iyileştirmek için opsiyonel bir katman - kurulu değilse
# sessizce eski davranışa (sayfa sonuna kadar kırpma) döner, PDF işleme
# hattının geri kalanını hiçbir şekilde etkilemez.
try:
    import cv2
    import numpy as np
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False

# Windows'ta Tesseract kurulumu PATH'e girmeyebilir (özellikle sunucu bir
# arka plan servisi olarak PATH güncellenmeden önce başladıysa) - bilinen
# kurulum yollarını doğrudan dener, bulamazsa pytesseract'ın kendi PATH
# aramasına güvenir.
for _candidate in (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
):
    if os.path.isfile(_candidate):
        pytesseract.pytesseract.tesseract_cmd = _candidate
        break

# Türkçe dil verisi (tur.traineddata) proje içinde tessdata/ altında
# taşınır - Program Files'a admin hakkı olmadan yazılamadığı ve diğer
# bilgisayarda da git ile aynı yerde bulunması gerektiği için. Ortam
# değişkeni ile veriliyor (pytesseract'ın config string'i shlex ile
# ayrıştırıyor - Windows'taki ters eğik çizgili yollarda tırnak/escape
# sorunlarına yol açıyor, TESSDATA_PREFIX bunu tamamen atlıyor).
_TESSDATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tessdata")
if os.path.isdir(_TESSDATA_DIR):
    os.environ["TESSDATA_PREFIX"] = _TESSDATA_DIR
_OCR_LANG = "tur+eng"
_OCR_DPI = 300

# Soru başlangıcı: "12." veya "1." - noktadan sonra boşluk ya da satır sonu.
# Not: cevap anahtarındaki "12.D" gibi kalıplarla KARIŞMAMASI için nokta
# sonrası doğrudan bir harf gelmesi durumunu kasıtlı olarak dışarıda bırakır.
_QUESTION_START_RE = re.compile(r"^\s*(\d{1,3})\.(\s|$)")

# Cevap anahtarı satırı: "12.D", boşluksuz, tek harf.
_ANSWER_LINE_RE = re.compile(r"^\s*(\d{1,3})\.\s*([A-EÇĞİÖŞÜ])\s*$")

# Sayfa başlığı/altbilgisi gibi neredeyse tam sayfa genişliğindeki bloklar
# sütun sınırını bozmasın diye sütunlama hesabından hariç tutulur. 0.6 gibi
# düşük bir eşik, tek sütunlu (LGS/TYT değil, düz metin) soru sayfalarında
# gövde metnini de (gerçek genişliği genelde sayfanın %80-90'ı) yanlışlıkla
# eler - bu yüzden yalnızca kenardan kenara uzanan gerçekten tam genişlikteki
# öğeleri (dekoratif başlık/altbilgi şeridi) hedefleyecek kadar yüksek.
_FULL_WIDTH_BLOCK_RATIO = 0.92

# Kırpma çözünürlüğü (dpi) - ekran önizlemesi için yeterli, dosya boyutu makul.
_CROP_DPI = 200

# pytesseract kelime güven skoru (0-100, boş/gürültü kutuları için -1 döner).
# Bu eşiğin altındaki kelimeler satır/blok bbox hesabına hiç katılmaz - aksi
# halde tek bir yanlış-okunan gürültü kelimesi satırın sınırını genişletip
# soru başlangıcı regex'inin yanlış yerden eşleşmesine yol açabiliyordu.
_OCR_MIN_CONF = 40

# OCR'da rakamlarla sık karışan karakterler - YALNIZCA _QUESTION_START_RE
# (strict) eşleşmediğinde, satırın en baştaki "sayı." bölümünü normalize
# etmek için denenir. Dijital PDF'lerde (OCR'a hiç düşmeyen) bu path asla
# tetiklenmez çünkü strict regex zaten eşleşiyor.
_OCR_DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "S": "5", "B": "8"})
_QUESTION_START_OCR_FALLBACK_RE = re.compile(r"^\s*([0-9OoIlSB]{1,3})\.(\s|$)")


def _match_question_start(text, allow_ocr_fallback=False):
    """Soru başlangıcı için önce strict (_QUESTION_START_RE) dener. Sadece
    OCR'lı (taranmış) sayfalarda ve strict eşleşmediğinde rakam-karışıklığı
    normalize edilmiş fallback'e düşer - dijital PDF'lerde metin zaten
    güvenilir olduğundan fallback hiç denenmez (aksi halde "I. Giriş" gibi
    Romen rakamlı başlıklar yanlışlıkla soru başlangıcı sanılabilirdi)."""
    m = _QUESTION_START_RE.match(text)
    if m:
        return int(m.group(1))
    if not allow_ocr_fallback:
        return None
    m = _QUESTION_START_OCR_FALLBACK_RE.match(text)
    if m:
        try:
            return int(m.group(1).translate(_OCR_DIGIT_FIX))
        except ValueError:
            return None
    return None


# ---- Görsel blok tespiti (OpenCV) ----
# _detect_questions, bir sütundaki SON sorunun alt sınırını bilmiyor (bir
# sonraki soru numarası yoksa "sayfa sonuna kadar" varsayıyordu). Bu genelde
# gereğinden fazla boş alanı (altbilgi, sayfa kenar boşluğu) da kırpmaya
# dahil ediyordu. OpenCV burada SADECE bu tek sınırı sıkılaştırmak için
# kullanılır - hangi bloğun "soru 7" olduğuna asla karar vermez, o iş metin/
# OCR tabanlı tespitte kalır. cv2 kurulu değilse devre dışı kalır.
_INK_BLOCK_DPI = 150
_INK_BLOCK_MIN_HEIGHT_PX = 20


def _find_ink_blocks_in_image(gray_arr, scale):
    """gray_arr: piksel uzayında uint8 gri tonlama dizisi. scale: piksel ->
    PDF nokta çevrim çarpanı (72/dpi). Morfolojik genişletme ile satır içi
    kelimeleri ve soru metni ile şıklar arasındaki dikey boşlukları
    birleştirip kontur tespiti yapar, PDF nokta uzayında [(x0,y0,x1,y1), ...]
    döner. Saf bir görüntü-işleme fonksiyonu - PyMuPDF/fitz bağımlılığı
    yok, bu yüzden sentetik bir numpy dizisiyle de test edilebilir."""
    _, thresh = cv2.threshold(gray_arr, 200, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # 25: satır içi kelimeleri birleştirir, 15: soru metni ile A/B/C/D
    # şıkları arasındaki dikey boşluğu köprüler - böylece bir soru tek bir
    # bitişik kütle halinde tespit edilir.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 15))
    dilated = cv2.dilate(thresh, kernel, iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    blocks = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if h < _INK_BLOCK_MIN_HEIGHT_PX:
            continue
        blocks.append((x * scale, y * scale, (x + w) * scale, (y + h) * scale))
    return blocks


def _detect_ink_blocks(page, dpi=_INK_BLOCK_DPI):
    """Bir PDF sayfasını düşük çözünürlükte (hız için) gri tonlamaya
    render edip _find_ink_blocks_in_image'e devreder. cv2 kurulu değilse
    veya sayfa render edilemezse boş liste döner - çağıran taraf bu durumda
    eski davranışa (sayfa sonuna kadar kırpma) döner."""
    if not _HAS_CV2:
        return []
    try:
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
        return _find_ink_blocks_in_image(gray, scale=72.0 / dpi)
    except Exception:
        return []


def _last_question_bottom(ink_blocks, col_x0, col_x1, y0, page_bottom):
    """Bir sütunda kendinden sonra soru gelmeyen (o yüzden 'sayfa sonuna
    kadar' varsayılan sınırı kullanılan) sorunun gerçek alt sınırını,
    o sütunla örtüşen ve y0'ın altında kalan en alttaki görsel bloğun alt
    kenarına göre tahmin eder. Bulunamazsa page_bottom'a (eski davranış)
    döner - bu fonksiyon sınırı SADECE sıkılaştırabilir, asla page_bottom'ı
    aşamaz ya da y0'ın altına inemez."""
    if not ink_blocks:
        return page_bottom
    col_mid = (col_x0 + col_x1) / 2
    tolerance = (col_x1 - col_x0) / 2 + 15
    candidates = [
        b for b in ink_blocks
        if b[3] > y0 + 5 and abs(((b[0] + b[2]) / 2) - col_mid) <= tolerance
    ]
    if not candidates:
        return page_bottom
    bottom = max(b[3] for b in candidates) + 10  # küçük pay
    return max(y0 + 15, min(bottom, page_bottom))


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


def _ocr_page_lines(page, dpi=_OCR_DPI):
    """Metin katmanı olmayan (taranmış) bir sayfada OCR ile satırları
    tespit eder - _page_lines ile birebir aynı format (text, line_bbox,
    block) döner ki _detect_questions/_detect_answer_key_pages hiçbir
    değişiklik yapmadan kullanabilsin. Koordinatlar OCR piksel uzayından
    PDF nokta uzayına (dpi/72 ölçeğiyle) çevrilir."""
    pix = page.get_pixmap(dpi=dpi)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    data = pytesseract.image_to_data(img, lang=_OCR_LANG, output_type=pytesseract.Output.DICT)
    scale = dpi / 72.0

    line_entries = {}   # (block, par, line) -> {"words": [...], "bbox": [x0,y0,x1,y1]}
    block_bbox = {}      # block_num -> [x0,y0,x1,y1]
    for i, word in enumerate(data["text"]):
        word = word.strip()
        if not word:
            continue
        try:
            if int(data["conf"][i]) < _OCR_MIN_CONF:
                continue
        except (ValueError, TypeError):
            pass
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        x0, y0, x1, y1 = x / scale, y / scale, (x + w) / scale, (y + h) / scale

        bkey = data["block_num"][i]
        bb = block_bbox.setdefault(bkey, [x0, y0, x1, y1])
        bb[0] = min(bb[0], x0); bb[1] = min(bb[1], y0)
        bb[2] = max(bb[2], x1); bb[3] = max(bb[3], y1)

        lkey = (bkey, data["par_num"][i], data["line_num"][i])
        entry = line_entries.setdefault(lkey, {"words": [], "bbox": [x0, y0, x1, y1], "block": bkey})
        entry["words"].append(word)
        lb = entry["bbox"]
        lb[0] = min(lb[0], x0); lb[1] = min(lb[1], y0)
        lb[2] = max(lb[2], x1); lb[3] = max(lb[3], y1)

    lines = []
    for entry in line_entries.values():
        text = " ".join(entry["words"])
        lines.append((text, tuple(entry["bbox"]), {"bbox": tuple(block_bbox[entry["block"]])}))
    return lines


def _get_page_lines(page):
    """Önce gerçek metin katmanını dener; sayfa boş çıkarsa (taranmış/
    fotokopi PDF) OCR'a düşer. Normal dijital PDF'lerde OCR hiç çalışmaz.
    (lines, is_ocr) döner - is_ocr, çağıranın OCR'a özgü rakam-karışıklığı
    fallback'ini yalnızca gerçekten OCR'lı sayfalarda uygulayabilmesi için."""
    lines = _page_lines(page)
    if lines:
        return lines, False
    return _ocr_page_lines(page), True


def _build_page_lines_cache(doc):
    """Her sayfanın (lines, is_ocr) sonucunu BİR KEZ hesaplayıp önbelleğe
    alır. _detect_boilerplate_lines/_detect_answer_key_pages/
    _detect_questions üçü de sayfa satırlarına ihtiyaç duyar - önbellek
    olmasaydı taranmış (OCR'lı) bir PDF'te her sayfa için Tesseract İKİ-ÜÇ
    KEZ çalışırdı (işlem süresini gereksiz yere katlar - OCR zaten bu
    hattın en pahalı adımı)."""
    return [_get_page_lines(doc[pno]) for pno in range(doc.page_count)]


# Sayfa başlığı/altbilgisi gibi TÜM dokümanda BİREBİR tekrarlayan satırlar
# (örn. "8. SINIF İNTRO 1. SAYI") - eğer böyle bir satır tesadüfen
# "N. " kalıbına uyuyorsa (_QUESTION_START_RE), her sayfada yeniden
# eşleşip gerçek "Soru N"in konumunu ezerdi (bkz. _detect_questions'taki
# "dokümanda sonraki görülen kazanır" davranışı). En az 3 sayfa VE
# sayfaların yarısından fazlasında BİREBİR aynı görülen bir satır metni
# "boilerplate" sayılıp soru/cevap-anahtarı eşleşmesinden hariç tutulur.
_BOILERPLATE_MIN_PAGE_COUNT = 3
_BOILERPLATE_MIN_PAGE_RATIO = 0.5


def _detect_boilerplate_lines(doc, page_lines_cache):
    if doc.page_count < _BOILERPLATE_MIN_PAGE_COUNT:
        return frozenset()
    text_pages = {}
    for pno in range(doc.page_count):
        lines, _is_ocr = page_lines_cache[pno]
        seen_this_page = set()
        for text, _bbox, _block in lines:
            t = text.strip()
            if not t or t in seen_this_page:
                continue
            seen_this_page.add(t)
            text_pages.setdefault(t, set()).add(pno)
    threshold = max(_BOILERPLATE_MIN_PAGE_COUNT, doc.page_count * _BOILERPLATE_MIN_PAGE_RATIO)
    return frozenset(t for t, pages in text_pages.items() if len(pages) >= threshold)


def _detect_answer_key_pages(doc, page_lines_cache, boilerplate=frozenset()):
    """Bir sayfadaki satırların yarısından fazlası 'N.X' kalıbına uyuyorsa
    (ve en az 5 tane varsa) o sayfa cevap anahtarı sayfası kabul edilir."""
    answer_key = {}
    answer_key_pages = set()
    for pno in range(doc.page_count):
        lines, _is_ocr = page_lines_cache[pno]
        stripped = [t.strip() for t, _, _ in lines if t.strip() and t.strip() not in boilerplate]
        if not stripped:
            continue
        matches = [_ANSWER_LINE_RE.match(t) for t in stripped]
        matches = [m for m in matches if m]
        if len(matches) >= 5 and len(matches) >= 0.5 * len(stripped):
            answer_key_pages.add(pno)
            for m in matches:
                answer_key[int(m.group(1))] = m.group(2)
    return answer_key_pages, answer_key


# ---- FAZ 1.2: Matris/tablo tipi cevap anahtarı (Hız Yayınları formatı) ----
# _ANSWER_LINE_RE satır-tabanlı yöntemi ("12.D") bu formatta 0 eşleşme
# buluyor - cevap harfleri satır metni değil, çizgilerle ayrılmış bir
# tablonun hücreleri. Üstelik bu tablo TEK bir dersin değil, BİRDEN FAZLA
# dersin VE birden fazla kitapçığın (A/B) cevaplarını aynı sayfada
# birleştiriyor (sütun grubu = ders, alt sütun = kitapçık). Doğru hücreyi
# okuyabilmek için extract_questions'a çağıran taraftan (server.py, upload
# formundaki subject_code/booklet_code) ders adı ve kitapçık bilgisi
# GEÇİRİLMELİDİR - bu yüzden extract_questions'a iki OPSİYONEL parametre
# eklendi (mevcut çağrılar etkilenmez, varsayılan None = grid yöntemi hiç
# denenmez).
_GRID_ROW_LINE_RATIO = 0.30
_GRID_COL_LINE_RATIO = 0.15
_GRID_CELL_INSET = 14
_GRID_DARK_RATIO_MIN = 0.02
_GRID_ANSWER_LETTERS = "ABCDE"
_TR_UPPER_MAP = str.maketrans({"i": "İ", "ı": "I"})


def _tr_normalize(s):
    """Türkçe büyük/küçük harf ve OCR gürültüsüne toleranslı karşılaştırma
    için: büyüt, Türkçe aksanlı harfleri ASCII karşılığına indirger, harf
    olmayan her şeyi atar."""
    s = s.translate(_TR_UPPER_MAP).upper()
    repl = {"İ": "I", "Ş": "S", "Ğ": "G", "Ü": "U", "Ö": "O", "Ç": "C"}
    for a, b in repl.items():
        s = s.replace(a, b)
    return re.sub(r"[^A-Z]", "", s)


def _find_grid_answer_key_page(page_lines_cache):
    """'CEVAP ANAHTAR' başlıklı bir sayfa arar - bulunamazsa None (bu
    kitapçık varyantı hiç cevap anahtarı içermiyor olabilir, bkz. FAZ 1.2
    test setindeki bazı örnekler)."""
    for pno, (lines, _is_ocr) in enumerate(page_lines_cache):
        texts = _tr_normalize(" ".join(t for t, _, _ in lines))
        if "CEVAPANAHTAR" in texts:
            return pno
    return None


def _detect_grid_geometry(page, dpi=_OCR_DPI):
    """Sayfanın gri-tonlama render'inde piksel-yoğunluk profiliyle tablo
    çizgilerinin (yatay/dikey) piksel konumlarını bulur. cv2 yoksa ya da
    render başarısızsa (None, None, None) döner - çağıran taraf bu durumda
    grid yöntemini sessizce atlar."""
    if not _HAS_CV2:
        return None, None, None
    try:
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    except Exception:
        return None, None, None

    _, thresh = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)
    h, w = thresh.shape

    def _line_positions(sums, ratio):
        threshold = sums.max() * ratio
        positions, in_line = [], False
        for i, s in enumerate(sums):
            if s > threshold and not in_line:
                positions.append(i)
                in_line = True
            elif s <= threshold:
                in_line = False
        return positions

    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(w // 15, 1), 1))
    horiz = cv2.dilate(cv2.erode(thresh, horiz_kernel), horiz_kernel)
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(h // 40, 1)))
    vert = cv2.dilate(cv2.erode(thresh, vert_kernel), vert_kernel)

    row_ys = _line_positions(horiz.sum(axis=1), _GRID_ROW_LINE_RATIO)
    col_xs = _line_positions(vert.sum(axis=0), _GRID_COL_LINE_RATIO)
    return row_ys, col_xs, gray


def _ocr_grid_cell(gray, x0, y0, x1, y1, inset=_GRID_CELL_INSET):
    """Tek bir hücreyi kırpıp OKU. Önce koyu piksel oranına bakar - neredeyse
    tamamen boşsa (öğrencinin/basımın cevap yazmadığı satır) OCR'a hiç
    girmez (hem yanlış-pozitif riskini keser hem de OCR maliyetinden
    kaçınır). Tek bir PSM modu her harfte güvenilir değil (denendi: psm 8
    'D'de, psm 10 bazı hücrelerde başarısız oluyordu) - bu yüzden birkaç
    modu sırayla dener, TEK karakterlik ilk sonucu kabul eder."""
    x0i, y0i, x1i, y1i = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    if x1i <= x0i or y1i <= y0i:
        return ""
    crop_arr = gray[y0i:y1i, x0i:x1i]
    if crop_arr.size == 0:
        return ""
    dark_ratio = float((crop_arr < 150).sum()) / crop_arr.size
    if dark_ratio < _GRID_DARK_RATIO_MIN:
        return ""
    crop_img = Image.fromarray(crop_arr)
    for psm in (6, 8, 10, 7):
        text = pytesseract.image_to_string(
            crop_img, lang="eng",
            config=f"--psm {psm} -c tessedit_char_whitelist={_GRID_ANSWER_LETTERS}",
        ).strip()
        if len(text) == 1:
            return text
    return ""


def _extract_grid_answer_key(doc, page_lines_cache, subject_name, booklet_code):
    """Matris tipi cevap anahtarını okur - subject_name ("Matematik" gibi
    okunabilir ders adı) ve booklet_code ("A"/"B") ile hangi sütun grubunun
    okunacağını belirler. Uygun sayfa/sütun bulunamazsa boş dict döner
    (çağıran taraf bunu 'grid yöntemi de bulamadı' olarak yorumlar, hata
    fırlatmaz - opsiyonel bir ikinci deneme)."""
    if not subject_name or not booklet_code:
        return {}
    grid_page = _find_grid_answer_key_page(page_lines_cache)
    if grid_page is None:
        return {}
    row_ys, col_xs, gray = _detect_grid_geometry(doc[grid_page])
    if not row_ys or not col_xs or gray is None:
        return {}

    target = _tr_normalize(subject_name)
    if not target:
        return {}

    # Ders başlığı satırı OCR'da TEK bir satıra birleşiyor ("TÜRKÇE SOSYAL
    # BİLGİ | DİN KÜLTÜRÜ ...") - bu yüzden satır-metniyle eşleştirmek
    # ders adının GERÇEK x-konumunu vermiyor (tüm tabloyu kapsayan geniş
    # bir aralık dönerdi). Bunun yerine her ders İKİ bitişik alt-sütun
    # (A/B) kaplıyor varsayımıyla col_xs bandları ikişerli gruplanır, her
    # grubun başlık satırındaki karşılığı AYRI AYRI kırpılıp OCR edilir -
    # hangi grup subject_name ile eşleşiyorsa o kullanılır.
    if len(row_ys) < 5:
        return {}
    col_bands = list(zip(col_xs, col_xs[1:]))
    # row_ys[0:2]: başlık/altbilgi şeridi (tablo dışı), row_ys[2:4]: ders adı
    # satırı, row_ys[4] itibariyle soru 1 başlar (bkz. FAZ 1.2 doğrulaması).
    header_y0, header_y1 = row_ys[2], row_ys[3]
    subject_groups = [col_bands[i:i + 2] for i in range(0, len(col_bands) - 1, 2)]

    cell_x0 = cell_x1 = None
    for group in subject_groups:
        if len(group) < 2:
            continue
        gx0, gx1 = group[0][0], group[-1][1]
        crop = Image.fromarray(gray[header_y0:header_y1, gx0:gx1])
        header_text = pytesseract.image_to_string(crop, lang=_OCR_LANG, config="--psm 7").strip()
        norm = _tr_normalize(header_text)
        if norm and (target in norm or norm in target):
            booklet_index = 0 if booklet_code.strip().upper().startswith("A") else 1
            cell_x0, cell_x1 = group[min(booklet_index, len(group) - 1)]
            break
    if cell_x0 is None:
        return {}

    # row_ys[0:2]: başlık/altbilgi şeridi, row_ys[2:4]: ders adı + A/B
    # alt-başlığı, row_ys[4]'ten itibaren soru 1, 2, 3...
    data_row_bands = list(zip(row_ys[4:], row_ys[5:]))
    answer_key = {}
    for i, (ry0, ry1) in enumerate(data_row_bands):
        letter = _ocr_grid_cell(gray, cell_x0, ry0, cell_x1, ry1)
        if letter:
            answer_key[i + 1] = letter
    return answer_key


def _detect_questions(doc, skip_pages, page_lines_cache, boilerplate=frozenset()):
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
        # Sadece gerçekten gerekirse (bir sütunun son sorusu için) hesaplanır -
        # her sayfa için gereksiz cv2 render/işlem maliyetini önler.
        ink_blocks = None

        cols = {"L": [], "R": []}
        page_lines, is_ocr = page_lines_cache[pno]
        for text, bbox, block in page_lines:
            if text.strip() in boilerplate:
                continue
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
                num = _match_question_start(text, allow_ocr_fallback=is_ocr)
                if num is not None:
                    starts.append((num, line_bbox[1]))
            starts.sort(key=lambda t: t[1])

            for i, (num, y0) in enumerate(starts):
                if i + 1 < len(starts):
                    y_end = starts[i + 1][1]
                else:
                    if ink_blocks is None:
                        ink_blocks = _detect_ink_blocks(page)
                    y_end = _last_question_bottom(ink_blocks, col_x0, col_x1, y0, ph - 20)
                rect = fitz.Rect(
                    max(col_x0 - 8, 0), max(y0 - 6, 0),
                    min(col_x1 + 8, pw), min(y_end - 4, ph),
                )
                questions[num] = {"page": pno, "rect": rect}
    return questions


def extract_questions(pdf_path, subject_name=None, booklet_code=None):
    """PDF'i açar, cevap anahtarını ve soruları tespit eder.

    subject_name/booklet_code OPSİYONELDİR (varsayılan None - eski çağrılar
    hiçbir davranış değişikliği görmez). Verilirse, satır-tabanlı yöntem
    ("12.D") hiç eşleşme bulamadığında İKİNCİ bir deneme olarak matris/tablo
    tipi cevap anahtarı (bkz. _extract_grid_answer_key, FAZ 1.2 - Hız
    Yayınları formatı: tek sayfada birden fazla ders + kitapçık) denenir.
    server.py bu bilgiyi upload formundaki subject_code/booklet_code'dan
    geçirir.

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
        page_lines_cache = _build_page_lines_cache(doc)
        boilerplate = _detect_boilerplate_lines(doc, page_lines_cache)
        answer_key_pages, answer_key = _detect_answer_key_pages(doc, page_lines_cache, boilerplate)
        if not answer_key:
            answer_key = _extract_grid_answer_key(doc, page_lines_cache, subject_name, booklet_code)
        questions = _detect_questions(
            doc, skip_pages=answer_key_pages,
            page_lines_cache=page_lines_cache, boilerplate=boilerplate,
        )
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
