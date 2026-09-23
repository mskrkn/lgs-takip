"""
Optik Okuma (Kamera OMR) - sunucu taraflı görüntü işleme pipeline'ı.

Telefon kamerasıyla çekilen ham form fotoğrafını işler: perspektif düzeltme,
QR/4-haneli-no ile kimlik çözümü, bubble doluluk analizi. Geometri sabitleri
`omr_form.py`'den alınır - form NASIL BASILDIYSA burada AYNI koordinatlarla
okunur, iki yerde ayrı ayrı tanımlanıp birbirinden sapmaz (bkz. omr_form.py
docstring'i).

Kullanici isteğiyle 2026-09-17: artik TEK sabit form yerine birden fazla
sablon (bkz. omr_form.FormTemplate) var - bu yuzden bu dosyadaki her
fonksiyon ilgili taramanin HANGI sablonla basildigini (template objesi,
sunucuda omr_exam_definitions.form_template'ten okunur) parametre olarak
alir; hicbir geometri artik modul yuklenirken SABIT hesaplanmiyor.

Gerçek basılı+telefonla-fotoğraflanmış örneklerle (2026-09-15, "compact"
sablonuyla) kalibre edildi - bkz. proje notu `edupusula-kamera-omr-projesi`.
Önemli bulgular:
  - Perspektif düzeltmeyi SADECE QR'ın 4 köşesinden hesaplamak YETERSİZ:
    telefon kamerasının hafif lens distorsiyonu QR'dan (sayfanın bir
    köşesinde) uzaklaştıkça birikip sayfanın öbür ucundaki bubble'ları
    yanlış konumda okutuyor. Bunun yerine QR'dan kaba bir başlangıç tahmini
    alınır, sonra 4 köşe fiducial'i kendi konumlarında ARANIP homografi bu
    gerçek 4 noktadan hesaplanır. KRİTİK DÜZELTME (2026-09-23, gerçek bir
    sınıf taramasının TÜM bubble'ları yanlış okuduğu, sadece QR/kimlik
    eşleşmesinin doğru kaldığı bir olay sonrası): köşe tahminleri ÖNCEDEN
    her biri bir öncekinin bulduğu noktayı homografiye EKLEYEREK (aşamalı/
    kümülatif) hesaplanıyordu - TL ve TR ikisi de sayfanın ÜST bölgesinde
    olduğundan, bu iki nokta + QR'ın 4 köşesi (hepsi yine üst bölgede) BR/BL
    için sayısal olarak neredeyse dejenere (tüm kalibrasyon noktaları tek
    bir bölgede kümelenmiş) bir nokta kümesi oluşturuyordu; bu kümeden
    `cv2.findHomography` ile sayfanın UZAK (alt) ucuna EKSTRAPOLASYON,
    sentetik (distorsiyonsuz) bir sayfada bile onlarca piksel sapma
    üretebiliyordu - ve homografi TEK BİR global dönüşüm olduğundan, BR/BL
    yanlış bulununca nihai warpPerspective TÜM sayfayı (sadece alt köşeleri
    değil) bozuyordu. Artık HER köşenin ilk tahmini DAİMA SADECE QR'ın kendi
    4 köşesinden türetilen SABİT bir homografiyle hesaplanıyor (bir önceki
    köşenin sonucu bir SONRAKİ köşenin tahminine karıştırılmıyor); nihai
    warp hâlâ 4 köşenin GERÇEKTEN BULUNDUĞU (arama penceresinde iyileştirilmiş)
    konumlarından hesaplanır - kümülatif nokta ekleme kaldırıldığı için bu
    son adım artık sayısal olarak kararlı.
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

DIKKAT: "quarter50"/"quarter100" sablonlari (kucuk balon, 2.8-3.6mm) HENUZ
gercek fotograflarla kalibre edilmedi - BUBBLE_SAMPLE_R_MM/esikler sadece
"compact"in 4.4mm balonuyla dogrulandi. Kucuk balonlarda okuma
guvenilirligi dusebilir, gercek kullanimdan once fiziksel testle
dogrulanmali.
"""

import cv2
import numpy as np

import omr_form as F

PX_PER_MM = 8

_FIDUCIAL_ORDER = ["TL", "TR", "BR", "BL"]

BLANK_VS_MARKED_GAP = 15  # bkz. modul docstring'i - gercek fotograflarla olculdu
MULTI_MARK_CLOSE_GAP = 15
MULTI_MARK_MIN_PROMINENCE = 20
BUBBLE_SAMPLE_R_MM = 1.1


class OmrReadError(Exception):
    pass


def _resolve_template(template_id):
    return F.TEMPLATES.get(template_id, F.TEMPLATE_COMPACT)


def _canon_size_px(template):
    return int(template.form_w_mm * PX_PER_MM), int(template.form_h_mm * PX_PER_MM)


def _qr_mm_corners(template):
    x0, y0, x1, y1 = template.qr_box_mm
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _mm_to_px(x_mm, y_mm):
    return (x_mm * PX_PER_MM, y_mm * PX_PER_MM)


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


def _rectify(img, qr_points, template):
    """QR koseleri + kose fiducial'lerinden nihai rektifiye (duzlestirilmis,
    sabit CANON_W x CANON_H boyutunda) goruntuyu hesaplar.

    Her kosenin ARAMA PENCERESI icin ilk tahmini, DAIMA SADECE QR'in kendi 4
    kosesinden turetilen SABIT bir homografiyle (H0) hesaplanir - bir onceki
    kosenin bulundugu nokta bir SONRAKI kosenin tahminine KARISTIRILMAZ (bkz.
    modul docstring'indeki 2026-09-23 duzeltme notu). Nihai warp, 4 kosenin
    GERCEKTEN BULUNDUGU konumlardan (tumu ayni H0 baz alinarak bagimsiz
    arandigi icin sayisal olarak kararli) hesaplanir."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    qr_size_px = float(np.linalg.norm(qr_points[1] - qr_points[0]))
    win_r = qr_size_px * 1.4
    expected_fid_area_px = (qr_size_px * (template.fiducial_size_mm / 20.0)) ** 2

    fid_mm = template.fiducial_centers_mm()
    H0 = cv2.getPerspectiveTransform(
        np.array([tuple(p) for p in qr_points], dtype=np.float32),
        np.array([_mm_to_px(x, y) for x, y in _qr_mm_corners(template)], dtype=np.float32),
    )
    H0_inv = np.linalg.inv(H0)

    refined = {}
    for key in _FIDUCIAL_ORDER:
        x_mm, y_mm = fid_mm[key]
        pt = np.array([[[x_mm * PX_PER_MM, y_mm * PX_PER_MM]]], dtype=np.float32)
        approx = cv2.perspectiveTransform(pt, H0_inv)[0][0]
        found = _refine_square_in_window(gray, approx[0], approx[1], win_r, expected_fid_area_px)
        refined[key] = found if found else tuple(approx)

    src = np.array([refined[k] for k in _FIDUCIAL_ORDER], dtype=np.float32)
    dst = np.array([_mm_to_px(*fid_mm[k]) for k in _FIDUCIAL_ORDER], dtype=np.float32)
    H_final = cv2.getPerspectiveTransform(src, dst)
    canon_w, canon_h = _canon_size_px(template)
    warped = cv2.warpPerspective(img, H_final, (canon_w, canon_h))
    return warped, refined


def _decode_qr(detector, image):
    data, points, _ = detector.detectAndDecode(image)
    return (data or None), points


_ARUCO_QR_AVAILABLE = hasattr(cv2, "QRCodeDetectorAruco")


def _detect_qr(img):
    """Ham fotografta QR'i bulur. Klasik cv2.QRCodeDetector QR kucuk kalinca
    (kamera kagittan uzaksa) cogu zaman HIC bulamiyordu - 14 gercek staging
    fotografinin sadece 4'unde buldu, Aruco tabanli detektor (QRCodeDetector
    Aruco) 11'inde, ikisi + 2x buyutme 13'unde. Bu yuzden sirayla: klasik ->
    Aruco -> 2x buyutulmus goruntude ikisi. Doner: (data|None, points(4,2)|None);
    points ham (buyutulmemis) piksel koordinatlaridir."""
    detectors = [cv2.QRCodeDetector()]
    if _ARUCO_QR_AVAILABLE:
        detectors.append(cv2.QRCodeDetectorAruco())
    for scale in (1.0, 2.0):
        im = img if scale == 1.0 else cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        for det in detectors:
            try:
                data, pts, _ = det.detectAndDecode(im)
            except cv2.error:
                continue
            if pts is None or len(pts) == 0:
                continue
            # Noktalar bulunur bulunmaz DUR - kimlik zaten rektifiye edilmis
            # goruntude (asagida) cozuluyor, ham goruntude decode'a ugrasip
            # 2x buyutulmus tekrar denemeler yapmak sureyi ~1.5 sn'ye cikariyordu.
            return (data or None), np.asarray(pts[0], dtype=np.float32) / scale
    return None, None


def _decode_qr_any(image):
    """Rektifiye (duzlestirilmis) goruntude QR'i klasik ve Aruco detektorle dener."""
    dets = [cv2.QRCodeDetector()]
    if _ARUCO_QR_AVAILABLE:
        dets.append(cv2.QRCodeDetectorAruco())
    for det in dets:
        try:
            data, _pts, _ = det.detectAndDecode(image)
        except cv2.error:
            continue
        if data:
            return data
    return None


def _decode_qr_cropped_upscale(detector, warped, template):
    """QR bazen ham/rektifiye tam goruntude cozulmez ama kendi bolgesi
    kirpilip 4x buyutulunce cozulebiliyor (gercek fotograflarla dogrulandi -
    bkz. modul docstring'i)."""
    qr_x0, qr_y0, qr_x1, qr_y1 = template.qr_box_mm
    x0, y0 = _mm_to_px(qr_x0 - 3, qr_y0 - 3)
    x1, y1 = _mm_to_px(qr_x1 + 3, qr_y1 + 3)
    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(warped.shape[1], int(x1)), min(warped.shape[0], int(y1))
    crop = warped[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    crop_big = cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    data, _points, _ = detector.detectAndDecode(crop_big)
    return data or _decode_qr_any(crop_big)


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


def _read_questions(gray, question_count, template):
    results = []
    for q in range(1, question_count + 1):
        means = []
        for choice_idx in range(4):
            x_mm, y_mm = template.question_bubble_center_mm(q, choice_idx)
            cx, cy = _mm_to_px(x_mm, y_mm)
            means.append(_disk_mean(gray, cx, cy, BUBBLE_SAMPLE_R_MM * PX_PER_MM))
        cls = _classify_group(means, F.CHOICES)
        results.append({"question": q, "answer": cls["value"], "status": cls["status"],
                         "means": [round(m, 1) for m in means]})
    return results


def _read_id_digits(gray, template):
    """4 haneli okul-no bubble blogu - QR okunamadiginda yedek kimlik
    dogrulama. NOT: gercek ornek fotograflarda ogrenci bu alani hic
    doldurmadi (QR zaten kimligi tasiyordu) - bu fonksiyon ayni GORECELI
    karsilastirma yontemiyle yazildi ama gercek ISARETLENMIS bir haneyle
    henuz DOGRULANMADI, ileride gercek veriyle kontrol edilmeli."""
    digits = []
    statuses = []
    for col in range(template.id_digit_count):
        means = [_disk_mean(gray, *_mm_to_px(*template.id_bubble_center_mm(col, row)),
                             template.id_bubble_d_mm / 2 * PX_PER_MM)
                 for row in range(template.id_digit_rows)]
        cls = _classify_group(means, [str(d) for d in range(template.id_digit_rows)])
        digits.append(cls["value"])
        statuses.append(cls["status"])
    if any(s != "single" for s in statuses):
        return None
    return "".join(digits)


def process_scan_image(image_bytes, question_count, template_id="compact"):
    """Ana giris noktasi. image_bytes: yuklenen fotografin ham byte'lari.
    question_count: bu sinavin soru sayisi (ogretmen serbestce girer,
    template.question_count_max ile sinirlanir - fazla satirlar ANALIZ
    EDILMEZ). template_id: bu sinavin BASILDIGI sablonun kimligi
    (omr_exam_definitions.form_template'ten okunur, bkz. omr_form.py
    modul docstring'i - ASLA question_count'tan yeniden turetilmez).

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
    template = _resolve_template(template_id)
    warnings = []
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise OmrReadError("Görüntü dosyası okunamadı (bozuk veya desteklenmeyen format).")

    detector = cv2.QRCodeDetector()
    _data, qr_points = _detect_qr(img)
    if qr_points is None:
        raise OmrReadError("Kağıdın QR kodu/kimlik alanı bulunamadı - kağıt kadraja tam girmiyor olabilir.")

    warped, _refined_fid = _rectify(img, qr_points, template)
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    paper_token, _points_r = _decode_qr(detector, warped)
    if not paper_token:
        paper_token = _decode_qr_cropped_upscale(detector, warped, template)
    if not paper_token:
        paper_token = _decode_qr_any(warped)
    if not paper_token and _data:
        paper_token = _data  # duzeltme once basarisiz olup ham goruntude basarili oldugu nadir durum

    match_status = "unmatched"
    id_digits = None
    if paper_token:
        match_status = "matched_qr"
    else:
        warnings.append("QR kodu okunamadı, 4 haneli numara alanına düşülüyor.")
        id_digits = _read_id_digits(gray, template)
        if id_digits:
            match_status = "matched_id_digits"
        else:
            warnings.append("4 haneli numara alanı da okunamadı/boş - manuel atama gerekiyor.")

    if not isinstance(question_count, int) or question_count < F.QUESTION_COUNT_MIN:
        question_count = 20
    question_count = min(question_count, template.question_count_max)
    questions = _read_questions(gray, question_count, template)
    if any(q["status"] == "ambiguous" for q in questions):
        warnings.append("Bazı sorularda belirsiz işaretleme tespit edildi.")

    return {
        "paper_token": paper_token,
        "id_digits": id_digits,
        "match_status": match_status,
        "questions": questions,
        "warnings": warnings,
    }
