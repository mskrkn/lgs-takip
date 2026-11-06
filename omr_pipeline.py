"""
Optik Okuma (Kamera OMR) - sunucu taraflı görüntü işleme pipeline'ı.

Telefon kamerasıyla çekilen ham form fotoğrafını işler: perspektif düzeltme,
QR ile kimlik çözümü, bubble doluluk analizi (2026-09-23: yedek "4 haneli
okul no" kimlik yöntemi kaldırıldı, gerçek kullanımda hiç kullanılmıyordu -
bkz. omr_form.py docstring'i). Geometri sabitleri
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


def _square_candidates(gray, cx, cy, win_r, expected_area_px, limit=3):
    """Penceredeki kare-benzeri dolu lekeler, skora gore azalan (en fazla
    `limit`). Eleme kurallari _refine_square_in_window ile ayni."""
    x0, x1 = max(0, int(cx - win_r)), min(gray.shape[1], int(cx + win_r))
    y0, y1 = max(0, int(cy - win_r)), min(gray.shape[0], int(cy + win_r))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return []
    crop = gray[y0:y1, x0:x1]
    _, th = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
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
        ax, ay = x0 + rcx, y0 + rcy
        score = solidity - (((ax - cx) ** 2 + (ay - cy) ** 2) ** 0.5) / win_r
        out.append((score, (float(ax), float(ay))))
    out.sort(key=lambda t: -t[0])
    return [p for _s, p in out[:limit]]


def _refine_square_in_window(gray, cx, cy, win_r, expected_area_px):
    """Penceredeki en iyi kare adayi (x, y) ya da None."""
    c = _square_candidates(gray, cx, cy, win_r, expected_area_px, limit=1)
    return c[0] if c else None


# --- Kose dogrulama (2026-11-06) -------------------------------------------
# Uretimdeki 254 istemci onizlemesinin olcumu: alt koseler (BL/BR) %72'sinde
# BULUNAMAMIS ve eski kod sessizce QR tahminine dusup okumaya DEVAM etmisti
# -> sayfa egik duzlestirilip balonlar yanlis yerden okunuyordu (ogretmenin
# 🗑 Sil dedigi 202 taramanin 185'i bu). Neden: 16 mm'lik QR'dan 120 mm
# asagiya yapilan tahmin ~20+ mm sapiyor, arama penceresi ise 22 mm - zemine/
# aciya gore bazen tutuyor bazen tutmuyordu ("bazen beyaz bazen siyah zemin
# daha iyi" sikayeti). Simdi: (1) alt koseler ayrica bulunan TL-TR (55 mm
# taban) uzerinden de tahmin edilir, gerekirse genis pencerede aranir;
# (2) aday 4'lulerin geometrisi dogrulanir; (3) dogrulanamazsa ok=False -
# kamera bu kareyi OKUMAZ, yeniden dener.
FID_PRIMARY_WIN_QR = 1.4      # arama yaricapi, QR kenari cinsinden (eskisiyle ayni)
FID_WIDE_WIN_QR = 2.6         # ikinci sans (sadece alt koseler)
FID_SIDE_ASYM_MAX = 0.12      # |TL-BL| ile |TR-BR| arasindaki fark / ortalama
FID_ASPECT_TOL = 0.22         # (sol/sag kenar)/(ust kenar) sablon oranindan bu kadar sapabilir
FID_QR_REPROJ_MAX_MM = 4.0    # bulunan koselerle QR koseleri sablondaki yerine bu kadar yakin dusmeli


def _homography(src_pts, dst_pts):
    return cv2.getPerspectiveTransform(np.array(src_pts, dtype=np.float32), np.array(dst_pts, dtype=np.float32))


def _apply_h(H, x, y):
    v = H @ np.array([x, y, 1.0])
    return v[0] / v[2], v[1] / v[2]


def _dedupe(points, min_d):
    out = []
    for p in points:
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= min_d * min_d for q in out):
            out.append(p)
    return out


FID_PATCH_MIN_CONTRAST = 35   # halka medyani - kare ici medyani (gri seviye)
FID_PATCH_INNER_DARK_MIN = 0.85
FID_PATCH_RING_BRIGHT_MIN = 0.7


def _fid_patch_ok(gray, H_inv, center_mm, size_mm):
    """Aday donusumle sablondaki kose karesinin yeri kaynak goruntude
    gercekten 'koyu kare + etrafinda beyaz kagit' mi? Tam warp yapmadan,
    H_inv ile ~70 nokta orneklenir (ucuz). Yanlis bir aday (zemindeki kare
    benzeri leke, yanlis kose) bu testi neredeyse hic gecemez."""
    cx, cy = center_mm
    half = size_mm / 2
    inner = [(cx + dx * half * 0.7, cy + dy * half * 0.7)
             for dx in (-1, -0.66, -0.33, 0, 0.33, 0.66, 1) for dy in (-1, -0.66, -0.33, 0, 0.33, 0.66, 1)]
    rr = half + 1.0
    ring = [(cx + rr * np.cos(a), cy + rr * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 20, endpoint=False)]
    h, w = gray.shape[:2]

    def sample(pts):
        vals = []
        for x_mm, y_mm in pts:
            x, y = _apply_h(H_inv, x_mm * PX_PER_MM, y_mm * PX_PER_MM)
            xi, yi = int(round(x)), int(round(y))
            if not (0 <= xi < w and 0 <= yi < h):
                return None
            vals.append(float(gray[yi, xi]))
        return np.array(vals)

    iv, rv = sample(inner), sample(ring)
    if iv is None or rv is None:
        return False
    i_med, r_med = float(np.median(iv)), float(np.median(rv))
    if r_med - i_med < FID_PATCH_MIN_CONTRAST:
        return False
    mid = (i_med + r_med) / 2
    return (np.mean(iv < mid) >= FID_PATCH_INNER_DARK_MIN) and (np.mean(rv > mid) >= FID_PATCH_RING_BRIGHT_MIN)


def _locate_fiducials(gray, qr_points, template):
    """Doner (refined: {TL,TR,BR,BL: (x,y)}, info: {ok, reason, qrErrMm, wide}).
    ok=False iken refined eski davranisla (bulunamayanlar QR tahmini) doludur
    - sunucu yolu bunu UYARI ile kullanir, kamera yolu kareyi reddeder."""
    qr_points = np.asarray(qr_points, dtype=np.float64)
    qr_size_px = float(np.linalg.norm(qr_points[1] - qr_points[0]))
    r1 = qr_size_px * FID_PRIMARY_WIN_QR
    exp_area = (qr_size_px * (template.fiducial_size_mm / 20.0)) ** 2
    fid_mm = template.fiducial_centers_mm()
    qr_dst = [_mm_to_px(x, y) for x, y in _qr_mm_corners(template)]
    H0 = _homography(qr_points, qr_dst)
    H0_inv = np.linalg.inv(H0)
    pred = {k: _apply_h(H0_inv, fid_mm[k][0] * PX_PER_MM, fid_mm[k][1] * PX_PER_MM) for k in _FIDUCIAL_ORDER}
    fallback = {}
    info = {"ok": False, "reason": "", "qrErrMm": None, "wide": False}
    min_sep = qr_size_px * (template.fiducial_size_mm / 16.0) * 0.5

    cands = {}
    for k in ("TL", "TR"):
        cands[k] = _square_candidates(gray, pred[k][0], pred[k][1], r1, exp_area, limit=2)
        fallback[k] = cands[k][0] if cands[k] else pred[k]
    if not cands["TL"] or not cands["TR"]:
        for k in ("BL", "BR"):
            c = _square_candidates(gray, pred[k][0], pred[k][1], r1, exp_area, limit=1)
            fallback[k] = c[0] if c else pred[k]
        info["reason"] = "top"
        return fallback, info

    w_mm = fid_mm["TR"][0] - fid_mm["TL"][0]
    h_mm = fid_mm["BL"][1] - fid_mm["TL"][1]
    tl0, tr0 = np.array(cands["TL"][0]), np.array(cands["TR"][0])
    u = (tr0 - tl0) / w_mm                      # px / mm, formun x ekseni
    v = np.array([-u[1], u[0]])                 # dik eksen
    if np.dot(v, np.array(pred["BL"]) - np.array(pred["TL"])) < 0:
        v = -v
    pa = {"BL": tuple(tl0 + v * h_mm), "BR": tuple(tr0 + v * h_mm)}
    for k in ("BL", "BR"):
        c = (_square_candidates(gray, pa[k][0], pa[k][1], r1, exp_area)
             + _square_candidates(gray, pred[k][0], pred[k][1], r1, exp_area))
        if not c:
            mid = ((pa[k][0] + pred[k][0]) / 2, (pa[k][1] + pred[k][1]) / 2)
            half_gap = (((pa[k][0] - pred[k][0]) ** 2 + (pa[k][1] - pred[k][1]) ** 2) ** 0.5) / 2
            c = _square_candidates(gray, mid[0], mid[1], max(qr_size_px * FID_WIDE_WIN_QR, half_gap + r1), exp_area, limit=4)
            if c:
                info["wide"] = True
        cands[k] = _dedupe(c, min_sep)[:4]
        fallback[k] = cands[k][0] if cands[k] else pred[k]
    if not cands["BL"] or not cands["BR"]:
        info["reason"] = "bottom"
        return fallback, info

    dst = [_mm_to_px(*fid_mm[k]) for k in _FIDUCIAL_ORDER]
    expected_ratio = h_mm / w_mm
    best = None
    for tl in cands["TL"]:
        for tr in cands["TR"]:
            for br in cands["BR"]:
                for bl in cands["BL"]:
                    top = np.hypot(tr[0] - tl[0], tr[1] - tl[1])
                    left = np.hypot(bl[0] - tl[0], bl[1] - tl[1])
                    right = np.hypot(br[0] - tr[0], br[1] - tr[1])
                    if top < 1 or abs(left - right) / ((left + right) / 2) > FID_SIDE_ASYM_MAX:
                        continue
                    if abs(((left + right) / 2) / top / expected_ratio - 1) > FID_ASPECT_TOL:
                        continue
                    quad = np.array([tl, tr, br, bl], dtype=np.float32)
                    if not cv2.isContourConvex(quad):
                        continue
                    H = _homography(quad, dst)
                    err = max(np.hypot(*(np.array(_apply_h(H, *qr_points[i])) - np.array(qr_dst[i])))
                              for i in range(4)) / PX_PER_MM
                    if err > FID_QR_REPROJ_MAX_MM:
                        continue
                    H_inv = np.linalg.inv(H)
                    if not all(_fid_patch_ok(gray, H_inv, fid_mm[k], template.fiducial_size_mm) for k in _FIDUCIAL_ORDER):
                        continue
                    cost = err + (np.hypot(bl[0] - pa["BL"][0], bl[1] - pa["BL"][1])
                                  + np.hypot(br[0] - pa["BR"][0], br[1] - pa["BR"][1])) / (np.linalg.norm(u) * 10.0)
                    if best is None or cost < best[0]:
                        best = (cost, err, {"TL": tl, "TR": tr, "BR": br, "BL": bl})
    if best is None:
        info["reason"] = "geometry"
        return fallback, info
    info.update(ok=True, qrErrMm=round(float(best[1]), 2))
    return best[2], info


def _rectify(img, qr_points, template):
    """QR koseleri + kose fiducial'lerinden nihai rektifiye (duzlestirilmis,
    sabit CANON_W x CANON_H boyutunda) goruntuyu hesaplar. Doner
    (warped, refined, info) - info icin bkz. _locate_fiducials.

    Kose tahminleri kumulatif homografi ile YAPILMAZ (bkz. modul
    docstring'indeki 2026-09-23 notu): ust koseler QR'dan, alt koseler QR'dan
    VE bulunan ust iki kosenin tabanindan bagimsiz tahmin edilir; nihai warp
    yalnizca geometrisi dogrulanmis 4 GERCEK kose noktasindan hesaplanir."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    fid_mm = template.fiducial_centers_mm()
    refined, info = _locate_fiducials(gray, qr_points, template)
    src = np.array([refined[k] for k in _FIDUCIAL_ORDER], dtype=np.float32)
    dst = np.array([_mm_to_px(*fid_mm[k]) for k in _FIDUCIAL_ORDER], dtype=np.float32)
    H_final = cv2.getPerspectiveTransform(src, dst)
    canon_w, canon_h = _canon_size_px(template)
    warped = cv2.warpPerspective(img, H_final, (canon_w, canon_h))
    return warped, refined, info


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


def process_scan_image(image_bytes, question_count, template_id="compact"):
    """Ana giris noktasi. image_bytes: yuklenen fotografin ham byte'lari.
    question_count: bu sinavin soru sayisi (ogretmen serbestce girer,
    template.question_count_max ile sinirlanir - fazla satirlar ANALIZ
    EDILMEZ). template_id: bu sinavin BASILDIGI sablonun kimligi
    (omr_exam_definitions.form_template'ten okunur, bkz. omr_form.py
    modul docstring'i - ASLA question_count'tan yeniden turetilmez).

    Doner: {
      'paper_token': str|None,
      'match_status': 'matched_qr'|'unmatched',
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

    warped, _refined_fid, fid_info = _rectify(img, qr_points, template)
    if not fid_info["ok"]:
        warnings.append("Kağıdın köşelerindeki siyah kareler bulunamadı - okuma hatalı olabilir, "
                        "lütfen kontrol edin (kağıdın tamamı ve 4 köşe görünecek şekilde yeniden çekin).")
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    paper_token, _points_r = _decode_qr(detector, warped)
    if not paper_token:
        paper_token = _decode_qr_cropped_upscale(detector, warped, template)
    if not paper_token:
        paper_token = _decode_qr_any(warped)
    if not paper_token and _data:
        paper_token = _data  # duzeltme once basarisiz olup ham goruntude basarili oldugu nadir durum

    match_status = "unmatched"
    if paper_token:
        match_status = "matched_qr"
    else:
        warnings.append("QR kodu okunamadı - manuel atama gerekiyor.")

    if not isinstance(question_count, int) or question_count < F.QUESTION_COUNT_MIN:
        question_count = 20
    question_count = min(question_count, template.question_count_max)
    questions = _read_questions(gray, question_count, template)
    if any(q["status"] == "ambiguous" for q in questions):
        warnings.append("Bazı sorularda belirsiz işaretleme tespit edildi.")

    return {
        "paper_token": paper_token,
        "match_status": match_status,
        "questions": questions,
        "warnings": warnings,
        "fiducials_ok": bool(fid_info["ok"]),
    }
