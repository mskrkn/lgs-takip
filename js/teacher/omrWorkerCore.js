// ============================================================
// Optik Okuma (Kamera OMR) - istemci tarafı (WASM) okuma çekirdeği.
// ============================================================
// omr_pipeline.py'nin (2026-09-23 rektifikasyon düzeltmesi dahil) JS
// aynası - AYNI algoritma, AYNI eşikler. cv (OpenCV.js, hazır/init
// tamamlanmış) ve jsQR fonksiyonunu enjekte olarak alır - böylece hem
// Worker içinde (gerçek kamera) hem de Node'da (otomatik test, bkz.
// omrWorkerCore.test.js) AYNI kod çalıştırılıp doğrulanabilir.
//
// KRİTİK bakım kuralı: buradaki _rectify/_refineSquareInWindow/
// _diskMean/_classifyGroup/_readQuestions mantığı server.py tarafındaki
// omr_pipeline.py ile SAPMAMALI - biri değişirse diğeri de güncellenmeli
// (aynı kural omrGeometry.js için de geçerli, bkz. o dosyanın başlığı).
// Dosya/PDF yükleme (kamerasız) yolu HÂLÂ sunucudaki Python pipeline'ını
// kullanıyor (bkz. server.py api_teacher_omr_upload_scan) - bu dosya
// SADECE canlı kamera akışı için.

(function (root) {
  'use strict';

  const BLANK_VS_MARKED_GAP = 15;
  const MULTI_MARK_CLOSE_GAP = 15;
  const MULTI_MARK_MIN_PROMINENCE = 20;
  const BUBBLE_SAMPLE_R_MM = 1.1;
  // Bkz. decodeFrame - ortalama guven bunun ALTINDAYSA (cogu soru sinirda/
  // belirsiz) okuma tumden GUVENILMEZ sayilir, sunucuya cop veri gitmez.
  const OMR_MIN_CONFIDENCE_AVG = 0.35;
  // Flas/parlama tespiti (bkz. decodeFrame): kagit kameraya cok yakinken
  // flas kullanilinca yansimadan (specular glare) genis, pikselin fiziksel
  // MAX degerine yapistigi ("tamamen yanmis") bir bolge olusabiliyor - bu,
  // balonun altindaki koyu isareti MASKELEYIP okumayi YANLIS yaparken
  // classifyGroup'un GORECELI kiyaslamasini da bozmadigindan (4 sik da
  // esit derecede "parlak" gorunebiliyor) YUKSEK guvenle donebiliyor,
  // yani OMR_MIN_CONFIDENCE_AVG bunu YAKALAYAMAZ (bkz. 2026-09-24 kullanici
  // raporu: "flas acinca daha hizli ama yanlis okuyor").
  //
  // ESIK SABIT DEGIL, HER KAREYE GORE UYARLANIR: sabit "253+ piksel" denemesi
  // sentetik test goruntulerinde (dogrudan dijital render - GERCEK bir
  // fotografin sensor gurultusu/isik dususu OLMADIGINDAN arka plan pikselin
  // matematiksel MAX'ina, 255'e, sabit oturuyor - olcum: %97+) YANLIS POZITIF
  // verdi; aym mantik teorik olarak COK PARLAK (ama gercek/mesru) bir taramayi
  // da riske atar. Bunun yerine: once bu KARENIN KENDI tipik arka plan
  // seviyesi (histogramda 60. persentil - balonlar/QR/fiducial'lerin koyu
  // pikselleri azinlikta oldugundan bu deger guvenle "beyaz kagit" bolgesine
  // denk gelir) hesaplanir, parlama esigi bunun OMR_GLARE_MARGIN kadar
  // USTUNDE (ama asla OMR_GLARE_SATURATION_LEVEL'in ALTINDA degil) belirlenir.
  // Boylece: sentetik/mukemmel-beyaz bir karede (arka plan zaten 255) esik
  // 255'i asar ve kontrol dogal olarak HIC TETIKLENMEZ (yanlis pozitif yok,
  // fixture'lara dokunmaya gerek kalmadan); gercek bir fotografta (arka plan
  // tipik 200-245, bkz. bugunku gercek cihaz ornekleri) esik sabit tabanda
  // (253) kalir ve gercek bir flas lekesini yakalar. TEK BASINA birkac parlak
  // piksel (kucuk, zararsiz bir yansima noktasi/toz) degil, sayfanin BUYUK
  // bir kismini (>= %20) kaplamasi aranir - kucuk lekeler reddetmez.
  const OMR_GLARE_SATURATION_LEVEL = 253;
  const OMR_GLARE_BG_PERCENTILE = 0.6;
  const OMR_GLARE_MARGIN = 15;
  const OMR_GLARE_AREA_FRACTION = 0.20;
  const FIDUCIAL_ORDER = ['TL', 'TR', 'BR', 'BL'];

  // Histogram tabanli (O(n) + O(256), tam siralamadan COK daha ucuz) parlama
  // orani hesaplayicisi - bkz. yukaridaki uzun aciklama.
  function glareFraction(grayData) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < grayData.length; i++) hist[grayData[i]]++;
    const total = grayData.length;
    const target = total * OMR_GLARE_BG_PERCENTILE;
    let cum = 0, bgLevel = 255;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= target) { bgLevel = v; break; }
    }
    const level = Math.max(OMR_GLARE_SATURATION_LEVEL, bgLevel + OMR_GLARE_MARGIN);
    if (level > 255) return 0; // 8-bit'te hicbir piksel bunu asamaz
    let above = 0;
    for (let v = level; v <= 255; v++) above += hist[v];
    return above / total;
  }

  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  // ---- OpenCV.js Mat yardımcıları (her biri kendi Mat'ini SİLER - WASM
  // heap sızıntısı olmasın diye; bkz. OpenCV.js bilinen gotcha'sı) ----
  function ptsToMat32FC2(cv, points) {
    const arr = [];
    for (const [x, y] of points) arr.push(x, y);
    return cv.matFromArray(points.length, 1, cv.CV_32FC2, arr);
  }

  function getPerspectiveTransformMat(cv, srcPts, dstPts) {
    const srcMat = ptsToMat32FC2(cv, srcPts);
    const dstMat = ptsToMat32FC2(cv, dstPts);
    const H = cv.getPerspectiveTransform(srcMat, dstMat);
    srcMat.delete();
    dstMat.delete();
    return H; // çağıran silmeli
  }

  // omr_pipeline.py _square_candidates'in birebir aynısı: penceredeki
  // kare-benzeri dolu lekeler, skora gore azalan (en fazla `limit`).
  function squareCandidates(cv, grayMat, cx, cy, winR, expectedAreaPx, limit) {
    const lim = limit || 3;
    const W = grayMat.cols, H = grayMat.rows;
    const x0 = Math.max(0, Math.floor(cx - winR));
    const x1 = Math.min(W, Math.floor(cx + winR));
    const y0 = Math.max(0, Math.floor(cy - winR));
    const y1 = Math.min(H, Math.floor(cy + winR));
    if (x1 - x0 < 4 || y1 - y0 < 4) return [];
    const crop = grayMat.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
    const th = new cv.Mat();
    cv.threshold(crop, th, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(th, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const out = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area >= expectedAreaPx * 0.25 && area <= expectedAreaPx * 4.0) {
        const rr = cv.minAreaRect(c);
        const rw = rr.size.width, rh = rr.size.height;
        if (rw >= 1 && rh >= 1) {
          const aspect = rw < rh ? rw / rh : rh / rw;
          const solidity = area / (rw * rh);
          if (aspect >= 0.6 && solidity >= 0.85) {
            const ax = x0 + rr.center.x, ay = y0 + rr.center.y;
            out.push({ score: solidity - Math.hypot(ax - cx, ay - cy) / winR, p: [ax, ay] });
          }
        }
      }
      c.delete();
    }
    crop.delete(); th.delete(); contours.delete(); hierarchy.delete();
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, lim).map((o) => o.p);
  }

  function refineSquareInWindow(cv, grayMat, cx, cy, winR, expectedAreaPx) {
    const c = squareCandidates(cv, grayMat, cx, cy, winR, expectedAreaPx, 1);
    return c.length ? c[0] : null;
  }

  // ---- Saf JS 4 nokta homografisi (aday 4'lu degerlendirmesi icin; her
  // aday icin WASM Mat acmamak - hem hiz hem sizinti riski) ----
  function homography4(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let col = 0; col < 8; col++) {
      let piv = col;
      for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-12) return null;
      [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
      for (let r = 0; r < 8; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        if (!f) continue;
        for (let k = col; k < 8; k++) A[r][k] -= f * A[col][k];
        b[r] -= f * b[col];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }

  function applyH(m, x, y) {
    const w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  }

  function isConvexQuad(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-9) return false;
      const s = cr > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  }

  // Kose dogrulama (2026-11-06) - aciklama ve olcumler icin bkz.
  // omr_pipeline.py "Kose dogrulama" blogu. Sabitler oradakiyle AYNI.
  const FID_PRIMARY_WIN_QR = 1.4;
  const FID_WIDE_WIN_QR = 2.6;
  const FID_SIDE_ASYM_MAX = 0.12;
  const FID_ASPECT_TOL = 0.22;
  const FID_QR_REPROJ_MAX_MM = 4.0;
  const FID_PATCH_MIN_CONTRAST = 35;
  const FID_PATCH_INNER_DARK_MIN = 0.85;
  const FID_PATCH_RING_BRIGHT_MIN = 0.7;

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // omr_pipeline.py _fid_patch_ok'un aynisi.
  function fidPatchOk(grayMat, Hinv, center, sizeMm, pxPerMm) {
    const [cx, cy] = center;
    const half = sizeMm / 2;
    const steps = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
    const inner = [];
    for (const dx of steps) for (const dy of steps) inner.push([cx + dx * half * 0.7, cy + dy * half * 0.7]);
    const rr = half + 1.0;
    const ring = [];
    for (let i = 0; i < 20; i++) { const a = (2 * Math.PI * i) / 20; ring.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    const W = grayMat.cols, H = grayMat.rows, data = grayMat.data;
    const sample = (pts) => {
      const vals = [];
      for (const [xm, ym] of pts) {
        const [x, y] = applyH(Hinv, xm * pxPerMm, ym * pxPerMm);
        const xi = Math.round(x), yi = Math.round(y);
        if (!(xi >= 0 && xi < W && yi >= 0 && yi < H)) return null;
        vals.push(data[yi * W + xi]);
      }
      return vals;
    };
    const iv = sample(inner), rv = sample(ring);
    if (!iv || !rv) return false;
    const iMed = median(iv), rMed = median(rv);
    if (rMed - iMed < FID_PATCH_MIN_CONTRAST) return false;
    const mid = (iMed + rMed) / 2;
    const innerDark = iv.filter((v) => v < mid).length / iv.length;
    const ringBright = rv.filter((v) => v > mid).length / rv.length;
    return innerDark >= FID_PATCH_INNER_DARK_MIN && ringBright >= FID_PATCH_RING_BRIGHT_MIN;
  }

  function dedupe(points, minD) {
    const out = [];
    for (const p of points) if (out.every((q) => dist(p, q) >= minD)) out.push(p);
    return out;
  }

  // omr_pipeline.py _locate_fiducials'in birebir aynasi. Doner
  // {refined: {TL,TR,BR,BL: [x,y]}, info: {ok, reason, qrErrMm, wide}}.
  function locateFiducials(cv, gray, qrPoints, template) {
    const G = root.OmrGeometry;
    const P = G.PX_PER_MM;
    const qrSizePx = dist(qrPoints[1], qrPoints[0]);
    const r1 = qrSizePx * FID_PRIMARY_WIN_QR;
    const expArea = Math.pow(qrSizePx * (template.fiducialSizeMm / 20.0), 2);
    const fidMm = G.fiducialCentersMm(template);
    const qrDst = G.qrMmCorners(template).map(([x, y]) => [x * P, y * P]);
    const H0 = homography4(qrPoints, qrDst);
    const H0inv = H0 && invert3(H0);
    const info = { ok: false, reason: '', qrErrMm: null, wide: false };
    if (!H0inv) { info.reason = 'qr'; return { refined: null, info }; }
    const pred = {};
    for (const k of FIDUCIAL_ORDER) pred[k] = applyH(H0inv, fidMm[k][0] * P, fidMm[k][1] * P);
    const fallback = {};
    const minSep = qrSizePx * (template.fiducialSizeMm / 16.0) * 0.5;
    const cands = {};
    for (const k of ['TL', 'TR']) {
      cands[k] = squareCandidates(cv, gray, pred[k][0], pred[k][1], r1, expArea, 2);
      fallback[k] = cands[k][0] || pred[k];
    }
    if (!cands.TL.length || !cands.TR.length) {
      for (const k of ['BL', 'BR']) fallback[k] = refineSquareInWindow(cv, gray, pred[k][0], pred[k][1], r1, expArea) || pred[k];
      info.reason = 'top';
      return { refined: fallback, info };
    }
    const wMm = fidMm.TR[0] - fidMm.TL[0];
    const hMm = fidMm.BL[1] - fidMm.TL[1];
    const tl0 = cands.TL[0], tr0 = cands.TR[0];
    const u = [(tr0[0] - tl0[0]) / wMm, (tr0[1] - tl0[1]) / wMm];
    let v = [-u[1], u[0]];
    if (v[0] * (pred.BL[0] - pred.TL[0]) + v[1] * (pred.BL[1] - pred.TL[1]) < 0) v = [-v[0], -v[1]];
    const pa = { BL: [tl0[0] + v[0] * hMm, tl0[1] + v[1] * hMm], BR: [tr0[0] + v[0] * hMm, tr0[1] + v[1] * hMm] };
    for (const k of ['BL', 'BR']) {
      let c = squareCandidates(cv, gray, pa[k][0], pa[k][1], r1, expArea)
        .concat(squareCandidates(cv, gray, pred[k][0], pred[k][1], r1, expArea));
      if (!c.length) {
        const mid = [(pa[k][0] + pred[k][0]) / 2, (pa[k][1] + pred[k][1]) / 2];
        const halfGap = dist(pa[k], pred[k]) / 2;
        c = squareCandidates(cv, gray, mid[0], mid[1], Math.max(qrSizePx * FID_WIDE_WIN_QR, halfGap + r1), expArea, 4);
        if (c.length) info.wide = true;
      }
      cands[k] = dedupe(c, minSep).slice(0, 4);
      fallback[k] = cands[k][0] || pred[k];
    }
    if (!cands.BL.length || !cands.BR.length) { info.reason = 'bottom'; return { refined: fallback, info }; }

    const dst = FIDUCIAL_ORDER.map((k) => [fidMm[k][0] * P, fidMm[k][1] * P]);
    const expectedRatio = hMm / wMm;
    const uLen = Math.hypot(u[0], u[1]);
    let best = null;
    for (const tl of cands.TL) for (const tr of cands.TR) for (const br of cands.BR) for (const bl of cands.BL) {
      const top = dist(tr, tl), left = dist(bl, tl), right = dist(br, tr);
      if (top < 1 || Math.abs(left - right) / ((left + right) / 2) > FID_SIDE_ASYM_MAX) continue;
      if (Math.abs(((left + right) / 2) / top / expectedRatio - 1) > FID_ASPECT_TOL) continue;
      const quad = [tl, tr, br, bl];
      if (!isConvexQuad(quad)) continue;
      const Hc = homography4(quad, dst);
      if (!Hc) continue;
      let err = 0;
      for (let i = 0; i < 4; i++) err = Math.max(err, dist(applyH(Hc, qrPoints[i][0], qrPoints[i][1]), qrDst[i]));
      err /= P;
      if (err > FID_QR_REPROJ_MAX_MM) continue;
      const Hcinv = invert3(Hc);
      if (!Hcinv || !FIDUCIAL_ORDER.every((k) => fidPatchOk(gray, Hcinv, fidMm[k], template.fiducialSizeMm, P))) continue;
      const cost = err + (dist(bl, pa.BL) + dist(br, pa.BR)) / (uLen * 10.0);
      if (!best || cost < best.cost) best = { cost, err, refined: { TL: tl, TR: tr, BR: br, BL: bl } };
    }
    if (!best) { info.reason = 'geometry'; return { refined: fallback, info }; }
    info.ok = true;
    info.qrErrMm = Math.round(best.err * 100) / 100;
    return { refined: best.refined, info };
  }

  // omr_pipeline.py _rectify'nin birebir aynasi (2026-11-06 kose dogrulamasi
  // dahil). Doner {warped, refined, info}; info.ok=false ise warped yine
  // uretilir (eski davranis) ama decodeFrame bu kareyi OKUMAZ.
  function rectify(cv, rgbaMat, qrPoints, template) {
    const G = root.OmrGeometry;
    const gray = new cv.Mat();
    cv.cvtColor(rgbaMat, gray, cv.COLOR_RGBA2GRAY);
    let located;
    try {
      located = locateFiducials(cv, gray, qrPoints, template);
    } finally {
      gray.delete();
    }
    const { refined, info } = located;
    if (!refined) return { warped: null, refined: null, info };
    const fidMm = G.fiducialCentersMm(template);
    const src = FIDUCIAL_ORDER.map((k) => refined[k]);
    const dst = FIDUCIAL_ORDER.map((k) => { const [x, y] = fidMm[k]; return [x * G.PX_PER_MM, y * G.PX_PER_MM]; });
    const Hfinal = getPerspectiveTransformMat(cv, src, dst);
    const canonW = Math.round(template.formWMm * G.PX_PER_MM);
    const canonH = Math.round(template.formHMm * G.PX_PER_MM);
    const warped = new cv.Mat();
    cv.warpPerspective(rgbaMat, warped, Hfinal, new cv.Size(canonW, canonH));
    Hfinal.delete();
    return { warped, refined, info };
  }

  // omr_pipeline.py _disk_mean'in birebir aynısı - ham Uint8Array üzerinde
  // (OpenCV Mat'e ihtiyaç yok, dairesel piksel ortalaması saf JS'te hızlı).
  function diskMean(grayData, width, height, cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(width, Math.ceil(cx + r) + 1);
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height, Math.ceil(cy + r) + 1);
    if (x1 <= x0 || y1 <= y0) return 255;
    let sum = 0, n = 0;
    const r2 = r * r;
    for (let y = y0; y < y1; y++) {
      const rowOff = y * width;
      for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) { sum += grayData[rowOff + x]; n++; }
      }
    }
    return n ? sum / n : 255;
  }

  // omr_pipeline.py _classify_group'un birebir aynısı.
  function classifyGroup(means, labels) {
    const order = means.map((_, i) => i).sort((a, b) => means[a] - means[b]);
    const darkest = means[order[0]], second = means[order[1]];
    const brightest = Math.max.apply(null, means);
    const gap = brightest - darkest;
    if (gap < BLANK_VS_MARKED_GAP) return { status: 'blank', value: null, confidence: 1.0 };
    if ((second - darkest) < MULTI_MARK_CLOSE_GAP && (brightest - second) > MULTI_MARK_MIN_PROMINENCE) {
      return { status: 'multi', value: null, confidence: 0.3 };
    }
    // Guven: darkest ile 2.'si arasindaki fark ne kadar buyukse o kadar net -
    // 0 (belirsiz sinirda) - 1 (tam net) arasi, sunucuya/UI'ya bilgi amacli.
    const confidence = Math.max(0, Math.min(1, (second - darkest) / 60));
    return { status: 'single', value: labels[order[0]], confidence };
  }

  function readQuestions(grayData, width, height, questionCount, template) {
    const G = root.OmrGeometry;
    const results = [];
    const rPx = BUBBLE_SAMPLE_R_MM * G.PX_PER_MM;
    for (let q = 1; q <= questionCount; q++) {
      const means = [];
      for (let ci = 0; ci < 4; ci++) {
        const [xMm, yMm] = G.questionBubbleCenterMm(template, q, ci);
        means.push(diskMean(grayData, width, height, xMm * G.PX_PER_MM, yMm * G.PX_PER_MM, rPx));
      }
      const cls = classifyGroup(means, G.CHOICES);
      results.push({
        question: q, answer: cls.value, status: cls.status,
        confidence: Math.round(cls.confidence * 100) / 100,
        means: means.map((m) => Math.round(m * 10) / 10),
      });
    }
    return results;
  }

  // jsQR ile tek bir karede QR tespiti (olcek secimi detectQr'da, asagida).
  function _tryDecodeQr(jsQRFn, imageData) {
    // Basili formun QR'i HER ZAMAN beyaz zemin uzerine siyah - ters renk
    // denemesi (attemptBoth) gercek kamera karelerinde HIC ek QR bulmadi ama
    // basarisiz denemenin suresini ikiye katliyordu (2026-10-21 olcumu).
    const result = jsQRFn(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    if (!result) return null;
    const L = result.location;
    return {
      data: result.data,
      points: [
        [L.topLeftCorner.x, L.topLeftCorner.y],
        [L.topRightCorner.x, L.topRightCorner.y],
        [L.bottomRightCorner.x, L.bottomRightCorner.y],
        [L.bottomLeftCorner.x, L.bottomLeftCorner.y],
      ],
    };
  }

  // jsQR, QR'i ONIZLEME boyutundaki (~720 px genislik) karelerde bulup tam
  // cozunurlukte (1080/1920 px) ya da buyutulmus karede bulamiyor: el
  // titremesi/odak bulanikligi buyuk karede daha fazla piksele yayiliyor,
  // kucultme (INTER_AREA) ise onu yumusatip QR'i netlestiriyor. 2026-10-21
  // olcumu (26 gercek telefon karesi, bkz. kullanici raporu "yesil cerceve
  // cikiyor, 'QR bulunamadi' diyor, kagit basina 1-2 dk"): tam cozunurluk
  // 1/26, eski 1.6x buyutme yedegi 0/26 (ve en pahali yol), 720 px 7/26,
  // 640>720>800 sirasi 9/26 (herhangi bir olcekte bulunabilenlerin hepsi).
  // Bu yuzden QR once bu genisliklerde aranir; bulunan kose noktalari
  // orijinal imageData uzayina geri olceklenir (rectify() tam cozunurluklu
  // karede calismaya devam eder, fiducial'lari orada kendisi inceltir).
  const QR_TRY_WIDTHS = [640, 720, 800];

  function _refineQrAtFullRes(cv, jsQRFn, imageData, srcMat, coarse) {
    const xs = coarse.points.map((p) => p[0]), ys = coarse.points.map((p) => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const pad = size * 0.6;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad)), y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
    const x1 = Math.min(imageData.width, Math.ceil(Math.max(...xs) + pad)), y1 = Math.min(imageData.height, Math.ceil(Math.max(...ys) + pad));
    if (x1 - x0 < 20 || y1 - y0 < 20) return null;
    let view = null, crop = null;
    try {
      view = srcMat.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
      crop = view.clone(); // roi bir gorunum - surekli (continuous) veri icin kopya
      const fine = _tryDecodeQr(jsQRFn, { data: new Uint8ClampedArray(crop.data), width: crop.cols, height: crop.rows });
      if (!fine || fine.data !== coarse.data) return null;
      fine.points = fine.points.map(([x, y]) => [x + x0, y + y0]);
      return fine;
    } catch (err) {
      return null;
    } finally {
      if (view) view.delete();
      if (crop) crop.delete();
    }
  }

  function detectQr(jsQRFn, imageData, cv) {
    if (!cv) return _tryDecodeQr(jsQRFn, imageData);
    let triedDirect = false;
    for (const targetW of QR_TRY_WIDTHS) {
      if (targetW > imageData.width) continue; // buyutme ISE YARAMIYOR (bkz. yukarisi)
      if (targetW === imageData.width) {
        triedDirect = true;
        const direct = _tryDecodeQr(jsQRFn, imageData);
        if (direct) return direct;
        continue;
      }
      let src = null, small = null;
      try {
        const scale = targetW / imageData.width;
        src = cv.matFromImageData(imageData);
        small = new cv.Mat();
        cv.resize(src, small, new cv.Size(targetW, Math.round(imageData.height * scale)), 0, 0, cv.INTER_AREA);
        const found = _tryDecodeQr(jsQRFn, { data: new Uint8ClampedArray(small.data), width: small.cols, height: small.rows });
        if (found) {
          found.points = found.points.map(([x, y]) => [x / scale, y / scale]);
          // Kucuk karedeki kose noktalari ~1/scale piksel kaba - rectify()
          // sayfanin en alt koselerini bu 4 noktadan disariya dogru tahmin
          // ettigi icin hata orada buyuyor. QR'in cevresi TAM cozunurlukte
          // kirpilip yeniden okunursa hassas koseler alinir (kucuk bolge,
          // hizli); okunamazsa olceklenmis noktalarla devam edilir.
          return _refineQrAtFullRes(cv, jsQRFn, imageData, src, found) || found;
        }
      } catch (err) {
        // bu olcek basarisiz - siradakini dene
      } finally {
        if (src) src.delete();
        if (small) small.delete();
      }
    }
    // Kare zaten kucukse (<640 px) hicbir olcek denenmemis olur - kendi
    // boyutunda dene. Buyuk karede tam cozunurluk denenmez: olcumde hic ek QR
    // bulmadi ama basarisiz her denemeye telefonda ~1 sn ekliyordu.
    if (triedDirect || imageData.width > QR_TRY_WIDTHS[0]) return null;
    return _tryDecodeQr(jsQRFn, imageData);
  }

  // Supheli/dusuk guvenli sonuclarda ogretmenin "Duzenle" ekraninda kagidi
  // gorebilmesi icin KUCUK bir onizleme PNG'i - "ham goruntu sunucuya
  // gitmiyor" ilkesi yalnizca GUVENLE okunan sonuclar icin gecerli (bkz.
  // edupusula-omr-motoru-prompt.md "Sonuç JSON Şeması" ve 7. adim: "Şüpheli
  // cevap inceleme ekranı (büyüt + dokunarak düzelt)" - bu ekran bir
  // goruntuye ihtiyac duyar).
  function needsPreview(decoded) {
    if (!decoded.readable) return true;
    if (decoded.confidenceAvg < 0.5) return true;
    return decoded.questions.some((q) => q.status === 'multi' || (q.status === 'single' && q.confidence < 0.35));
  }

  function buildPreviewPng(cv, warped) {
    const maxW = 420;
    const scale = Math.min(1, maxW / warped.cols);
    const w = Math.max(1, Math.round(warped.cols * scale));
    const h = Math.max(1, Math.round(warped.rows * scale));
    const resized = new cv.Mat();
    cv.resize(warped, resized, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    const imgData = new ImageData(new Uint8ClampedArray(resized.data), w, h);
    resized.delete();
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').putImageData(imgData, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Ana giris noktasi - omr_pipeline.py process_scan_image'in JS aynasi.
  // cv: initialize edilmis (thenable resolve olmus) OpenCV.js modulu.
  // jsQRFn: jsQR fonksiyonu. imageData: {data:Uint8ClampedArray, width, height}
  // (tarayicida canvas ImageData, Node testinde ayni sekle sahip bir obje).
  // ASENKRON: dusuk guvenli sonuclarda onizleme PNG'i uretmek icin
  // OffscreenCanvas.convertToBlob (Promise) bekleniyor.
  async function decodeFrame(cv, jsQRFn, imageData, questionCount, templateId) {
    const G = root.OmrGeometry;
    const template = G.TEMPLATES[templateId] || G.TEMPLATES.compact;
    const warnings = [];

    const qr = detectQr(jsQRFn, imageData, cv);
    if (!qr) {
      return { readable: false, matchStatus: 'unmatched', paperToken: null, failReason: 'qr',
        warnings: ["Kağıdın QR kodu bulunamadı - kağıt kadraja tam girmiyor olabilir."] };
    }

    const rgbaMat = cv.matFromImageData(imageData);
    let warped, refined, fidInfo;
    try {
      ({ warped, refined, info: fidInfo } = rectify(cv, rgbaMat, qr.points, template));
    } finally {
      rgbaMat.delete();
    }
    // 2026-11-06: 4 kose karesi bulunup geometrisi dogrulanamadiysa bu kare
    // OKUNMAZ - eskiden bulunamayan kose QR tahminiyle doldurulup okumaya
    // devam ediliyordu; sayfa egik duzlesip balonlar yanlis yerden okunuyordu
    // (uretimde ogretmenin sildigi taramalarin ~%90'i). Cagiran taraf bunu
    // diger "okunamadi" durumlari gibi sessizce yeniden dener.
    if (!fidInfo.ok) {
      if (warped) warped.delete();
      return { readable: false, matchStatus: 'unmatched', paperToken: null, failReason: 'corners',
        fiducialInfo: fidInfo,
        warnings: ['Kağıdın 4 köşesindeki siyah kareler görünmüyor - kağıdın tamamını çerçeveye alın.'] };
    }

    const warpedGray = new cv.Mat();
    cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);
    const grayData = warpedGray.data; // Uint8Array (tek kanal)
    const width = warpedGray.cols, height = warpedGray.rows;

    // Parlama kontrolu balon okumadan ONCE yapilir - hem gereksiz islemden
    // kacinilir hem de classifyGroup'un GORECELI kiyaslamasi bu durumu
    // (butun sikkin esit derecede "parlak" gorunmesi) yakalayamadigindan
    // ayri, mutlak bir kontrole ihtiyac var (bkz. yukarisi, sabit tanimlari).
    const glareFrac = glareFraction(grayData);
    if (glareFrac >= OMR_GLARE_AREA_FRACTION) {
      warpedGray.delete();
      warped.delete();
      return { readable: false, matchStatus: 'unmatched', paperToken: null, failReason: 'glare',
        warnings: ['Kağıtta aşırı parlama tespit edildi (flaş/ışık yansıması olabilir) - flaşı kapatıp tekrar deneyin.'] };
    }

    const questions = readQuestions(grayData, width, height, questionCount, template);
    if (questions.some((q) => q.status === 'multi')) warnings.push('Bazı sorularda belirsiz işaretleme tespit edildi.');
    warpedGray.delete();

    const confidences = questions.filter((q) => q.status !== 'blank').map((q) => q.confidence);
    const confidenceAvg = confidences.length
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : 1.0;

    // Gercek kullanici testinde bulundu: bulanik/parmakla kapatilmis bir
    // karede bile QR bulunup bazi sorular "okunabiliyor" (ama ANLAMSIZ
    // degerlerle) - eskiden bu, ogretmenin elle fark edip 🗑 Sil ile
    // temizlemesi gereken COP bir tarama olarak sunucuya gonderiliyordu.
    // Ortalama guven cok dusukse (coğu soru sinirda/belirsiz), QR bulunmus
    // olsa bile "okunamadi" sayilir - cagiran taraf (omrScan.js) bunu QR-
    // bulunamama ile AYNI sekilde ele alip sessizce yeniden dener; ogretmen
    // cogu zaman bunu hic gormez. Mukemmel bir filtre degil (bulanikligin
    // YANLIS ama "guvenli gorunen" bir sik secmesi teorik olarak hala
    // mumkun) ama gercek kullanicidan gelen COP okumalarin cogunu onler.
    if (confidenceAvg < OMR_MIN_CONFIDENCE_AVG) {
      warped.delete(); // erken donus - WASM Mat sizintisi olmasin
      return { readable: false, matchStatus: 'unmatched', paperToken: null, failReason: 'lowconf',
        warnings: ['Okuma güvenilir değil (bulanık/örtülü olabilir) - tekrar deneniyor.'] };
    }

    const resultBase = {
      readable: true, matchStatus: 'matched_qr', paperToken: qr.data,
      questions, confidenceAvg, warnings, refinedFiducials: refined, fiducialInfo: fidInfo,
    };
    if (needsPreview(resultBase) && typeof OffscreenCanvas !== 'undefined') {
      try {
        const blob = await buildPreviewPng(cv, warped);
        if (blob) resultBase.previewPngBase64 = await blobToBase64(blob);
      } catch (err) { /* önizleme olmadan devam - kritik değil */ }
    }
    warped.delete();
    return resultBase;
  }

  const OmrWorkerCore = {
    decodeFrame, detectQr, rectify, locateFiducials, readQuestions, classifyGroup, diskMean, glareFraction,
    BLANK_VS_MARKED_GAP, MULTI_MARK_CLOSE_GAP, MULTI_MARK_MIN_PROMINENCE, BUBBLE_SAMPLE_R_MM,
    OMR_MIN_CONFIDENCE_AVG, OMR_GLARE_SATURATION_LEVEL, OMR_GLARE_BG_PERCENTILE,
    OMR_GLARE_MARGIN, OMR_GLARE_AREA_FRACTION,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = OmrWorkerCore;
  root.OmrWorkerCore = OmrWorkerCore;
})(typeof self !== 'undefined' ? self : this);
