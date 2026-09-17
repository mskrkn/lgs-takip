"""
Optik Okuma (Kamera OMR) - sunucu taraflı görüntü işleme pipeline'ı.

Telefon kamerasıyla çekilen ham form fotoğrafını işler: perspektif düzeltme,
QR/4-haneli-no ile kimlik çözümü, bubble doluluk analizi. Geometri sabitleri
`omr_form.py`'den alınır - form NASIL BASILDIYSA burada AYNI koordinatlarla
okunur, iki yerde ayrı ayrı tanımlanıp birbirinden sapmaz (bkz. omr_form.py
docstring'i).

Gerçek basılı+telefonla-fotoğraflanmış örneklerle (2026-09-15) kalibre edildi
- bkz. proje notu `edupusula-kamera-omr-projesi`. Önemli bulgular:
  - Perspektif düzeltmeyi SADECE QR'ın 4 köşesinden hesaplamak YETERSİZ:
    telefon kamerasının hafif lens distorsiyonu QR'dan (sayfanın bir
    köşesinde) uzaklaştıkça birikip sayfanın öbür ucundaki bubble'ları
    yanlış konumda okutuyor. Bunun yerine QR'dan kaba bir başlangıç tahmini
    alınır, sonra 4 köşe fiducial'i (aşamalı olarak, her bulunan nokta bir
    SONRAKİ tahmini iyileştirerek) kendi konumlarında ARANIP homografi bu
    gerçek 4 noktadan hesaplanır.
  - Fiducial arama penceresinde "dolu kare" ile "dolu (işaretli) daire"yi
    ayırt etmek için EKSEN-HİZALI solidity güvenilmez (döndürülmüş bir kare
    kutusunun sadece yarısını doldurur) - `cv2.minAreaRect` (döndürülmüş
    kutu) kullanılır, bu da kareyi rotasyondan bağımsız ayırt eder.
  - Bubble okuma MUTLAK piksel eşiği yerine SORU-İÇİ GÖRECELİ karşılaştırma
    kullanır (aynı sorunun 4 şıkkı birbirine 5mm mesafede, yerel ışık/gölge
    koşulu neredeyse aynı) - bu, sabit bir global eşikten çok daha dayanıklı
    çıktı (gölgeli fotoğraflarda bile doğru okundu).
  - QR decode bazen ham/rektifiye görüntüde başarısız olsa da, QR bölgesini
    kırpıp 4x büyütünce çözülebiliyor - bu yüzden üç kademeli denenir.
"""

import cv2
import numpy as np

import omr_form as F

PX_PER_MM = 8
CANON_W = int(F.FORM_W_MM * PX_PER_MM)
CANON_H = int(F.FORM_H_MM * PX_PER_MM)

_QR_MM_CORNERS = [
    (F.QR_BOX_MM[0], F.QR_BOX_MM[1]), (F.QR_BOX_MM[2], F.QR_BOX_MM[1]),
    (F.QR_BOX_MM[2], F.QR_BOX_MM[3]), (F.QR_BOX_MM[0], F.QR_BOX_MM[3]),
]
_FIDUCIAL_ORDER = ["TL", "TR", "BR", "BL"]

BLANK_VS_MARKED_GAP = 15  # bkz. modul docstring'i - gercek fotograflarla olculdu
MULTI_MARK_CLOSE_GAP = 15
MULTI_MARK_MIN_PROMINENCE = 20
BUBBLE_SAMPLE_R_MM = 1.1


class OmrReadError(Exception):
    pass


def _mm_to_px(x_mm, y_mm):
    return (x_mm * PX_PER_MM, y_mm * PX_PER_MM)


def _rough_homography_from_qr(qr_points):
    src = np.array(qr_points, dtype=np.float32)
    dst = np.array([_mm_to_px(x, y) for x, y in _QR_MM_CORNERS], dtype=np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def _refine_square_in_window(gray, cx, cy, win_r, expected_area_px):
    x0, x1 = max(0, int(cx - win_r)), min(gray.shape[1], int(cx + win_r))
    y0, y1 = max(0, int(cy - win_r)), min(gray.shape[0], int(cy + win_r))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = gray[y0:y1, x0:x1]
    _, th = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best, best_score = None, -1
    for c in contours:
        area = cv2.contourArea(c)
        if area < expected_area_px * 0.25 or area > expected_area_px * 4.0:
            continue
        (rcx, rcy), (rw, rh), _angle = cv2.minAreaRect(c)
        if rw < 1 or rh < 1:
            continue
        aspect = rw / rh if rw < rh else rh / rw
        if aspect < 0.6:
            continue
        solidity = area / (rw * rh)
        if solidity < 0.85:
            continue
        dist_to_center = ((rcx - crop.shape[1] / 2) ** 2 + (rcy - crop.shape[0] / 2) ** 2) ** 0.5
        score = solidity - dist_to_center / win_r
        if score > best_score:
            best_score = score
            best = (x0 + rcx, y0 + rcy)
    return best


def _rectify(img, qr_points):
    """QR koseleri + kose fiducial'lerinden nihai rektifiye (duzlestirilmis,
    sabit CANON_W x CANON_H boyutunda) goruntuyu hesaplar."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    qr_size_px = float(np.linalg.norm(qr_points[1] - qr_points[0]))
    win_r = qr_size_px * 1.4
    expected_fid_area_px = (qr_size_px * (F.FIDUCIAL_SIZE_MM / 20.0)) ** 2

    fid_mm = F.fiducial_centers_mm()
    known_src = [tuple(p) for p in qr_points]
    known_dst = [_mm_to_px(x, y) for x, y in _QR_MM_CORNERS]

    refined = {}
    for key in _FIDUCIAL_ORDER:
        if len(known_src) == 4:
            H_cur = cv2.getPerspectiveTransform(
                np.array(known_src, dtype=np.float32), np.array(known_dst, dtype=np.float32))
        else:
            H_cur, _ = cv2.findHomography(
                np.array(known_src, dtype=np.float32), np.array(known_dst, dtype=np.float32))
        x_mm, y_mm = fid_mm[key]
        pt = np.array([[[x_mm * PX_PER_MM, y_mm * PX_PER_MM]]], dtype=np.float32)
        approx = cv2.perspectiveTransform(pt, np.linalg.inv(H_cur))[0][0]
        found = _refine_square_in_window(gray, approx[0], approx[1], win_r, expected_fid_area_px)
        pos = found if found else tuple(approx)
        refined[key] = pos
        known_src.append(pos)
        known_dst.append(_mm_to_px(x_mm, y_mm))

    src = np.array([refined[k] for k in _FIDUCIAL_ORDER], dtype=np.float32)
    dst = np.array([_mm_to_px(*fid_mm[k]) for k in _FIDUCIAL_ORDER], dtype=np.float32)
    H_final = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(img, H_final, (CANON_W, CANON_H))
    return warped, refined


def _decode_qr(detector, image):
    data, points, _ = detector.detectAndDecode(image)
    return (data or None), points


def _decode_qr_cropped_upscale(detector, warped):
    """QR bazen ham/rektifiye tam goruntude cozulmez ama kendi bolgesi
    kirpilip 4x buyutulunce cozulebiliyor (gercek fotograflarla dogrulandi -
    bkz. modul docstring'i)."""
    x0, y0 = _mm_to_px(F.QR_BOX_MM[0] - 3, F.QR_BOX_MM[1] - 3)
    x1, y1 = _mm_to_px(F.QR_BOX_MM[2] + 3, F.QR_BOX_MM[3] + 3)
    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(warped.shape[1], int(x1)), min(warped.shape[0], int(y1))
    crop = warped[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    crop_big = cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    data, _points, _ = detector.detectAndDecode(crop_big)
    return data or None


def _disk_mean(gray, cx, cy, r):
    x0, x1 = max(0, int(cx - r)), min(gray.shape[1], int(cx + r) + 1)
    y0, y1 = max(0, int(cy - r)), min(gray.shape[0], int(cy + r) + 1)
    patch = gray[y0:y1, x0:x1]
    if patch.size == 0:
        return 255.0
    yy, xx = np.ogrid[y0:y1, x0:x1]
    mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    vals = patch[mask]
    return float(vals.mean()) if vals.size else 255.0


def _classify_group(means, labels):
    """Bir grup (bir sorunun 4 sikki, ya da bir hane sutununun 10 rakami)
    icin GORECELI karsilastirma: ayni grubun ogeleri birbirine yakin
    oldugundan (5mm/2.4mm ara), yerel golge/isik farkini otomatik iptal
    eder - sabit global esikten cok daha dayanikli (bkz. modul docstring'i).
    """
    means = np.array(means)
    order = np.argsort(means)  # en koyudan en acige
    darkest, second = means[order[0]], means[order[1]]
    brightest = means.max()
    gap = brightest - darkest
    if gap < BLANK_VS_MARKED_GAP:
        return {"status": "blank", "value": None}
    if (second - darkest) < MULTI_MARK_CLOSE_GAP and (brightest - second) > MULTI_MARK_MIN_PROMINENCE:
        return {"status": "multi", "value": None}
    return {"status": "single", "value": labels[order[0]]}


def _read_questions(gray, question_count):
    results = []
    for q in range(1, question_count + 1):
        means = []
        for choice_idx in range(4):
            x_mm, y_mm = F.question_bubble_center_mm(q, choice_idx)
            cx, cy = _mm_to_px(x_mm, y_mm)
            means.append(_disk_mean(gray, cx, cy, BUBBLE_SAMPLE_R_MM * PX_PER_MM))
        cls = _classify_group(means, F.CHOICES)
        results.append({"question": q, "answer": cls["value"], "status": cls["status"],
                         "means": [round(m, 1) for m in means]})
    return results


def _read_id_digits(gray):
    """4 haneli okul-no bubble blogu - QR okunamadiginda yedek kimlik
    dogrulama. NOT: gercek ornek fotograflarda ogrenci bu alani hic
    doldurmadi (QR zaten kimligi tasiyordu) - bu fonksiyon ayni GORECELI
    karsilastirma yontemiyle yazildi ama gercek ISARETLENMIS bir haneyle
    henuz DOGRULANMADI, ileride gercek veriyle kontrol edilmeli."""
    digits = []
    statuses = []
    for col in range(F.ID_DIGIT_COUNT):
        means = [_disk_mean(gray, *_mm_to_px(*F.id_bubble_center_mm(col, row)),
                             F.ID_BUBBLE_D_MM / 2 * PX_PER_MM)
                 for row in range(F.ID_DIGIT_ROWS)]
        cls = _classify_group(means, [str(d) for d in range(F.ID_DIGIT_ROWS)])
        digits.append(cls["value"])
        statuses.append(cls["status"])
    if any(s != "single" for s in statuses):
        return None
    return "".join(digits)


def process_scan_image(image_bytes, question_count):
    """Ana giris noktasi. image_bytes: yuklenen fotografin ham byte'lari.
    question_count: bu sinavin soru sayisi (F.ALLOWED_QUESTION_COUNTS: 10/15/
    20/25 - fazla satirlar ANALIZ EDILMEZ, bkz. spesifikasyon bolum 1
    'soru sayisi esnekligi').

    Doner: {
      'paper_token': str|None,
      'id_digits': str|None (4 haneli, QR yoksa/basarisizsa yedek),
      'match_status': 'matched_qr'|'matched_id_digits'|'unmatched',
      'questions': [{'question','answer','status','means'}, ...],
      'warnings': [str, ...],
    }
    OmrReadError: goruntu hic okunamadiginda (bozuk dosya, form/QR hic
    bulunamadi) firlatilir - cagiran taraf bunu 'needs_review' + tam manuel
    atamaya dusurmeli.
    """
    warnings = []
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise OmrReadError("Görüntü dosyası okunamadı (bozuk veya desteklenmeyen format).")

    detector = cv2.QRCodeDetector()
    _data, points = _decode_qr(detector, img)
    if points is None:
        raise OmrReadError("Kağıdın QR kodu/kimlik alanı bulunamadı - kağıt kadraja tam girmiyor olabilir.")

    qr_points = points[0]
    warped, _refined_fid = _rectify(img, qr_points)
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    paper_token, _points_r = _decode_qr(detector, warped)
    if not paper_token:
        paper_token = _decode_qr_cropped_upscale(detector, warped)
    if not paper_token and _data:
        paper_token = _data  # duzeltme once basarisiz olup ham goruntude basarili oldugu nadir durum

    match_status = "unmatched"
    id_digits = None
    if paper_token:
        match_status = "matched_qr"
    else:
        warnings.append("QR kodu okunamadı, 4 haneli numara alanına düşülüyor.")
        id_digits = _read_id_digits(gray)
        if id_digits:
            match_status = "matched_id_digits"
        else:
            warnings.append("4 haneli numara alanı da okunamadı/boş - manuel atama gerekiyor.")

    question_count = question_count if question_count in F.ALLOWED_QUESTION_COUNTS else 20
    questions = _read_questions(gray, question_count)
    if any(q["status"] == "ambiguous" for q in questions):
        warnings.append("Bazı sorularda belirsiz işaretleme tespit edildi.")

    return {
        "paper_token": paper_token,
        "id_digits": id_digits,
        "match_status": match_status,
        "questions": questions,
        "warnings": warnings,
    }
