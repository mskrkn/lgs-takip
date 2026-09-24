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

  function invertMat(cv, H) {
    const inv = new cv.Mat();
    cv.invert(H, inv);
    return inv;
  }

  function transformPoint(cv, Hinv, x, y) {
    const src = cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
    const dst = new cv.Mat();
    cv.perspectiveTransform(src, dst, Hinv);
    const result = [dst.data32F[0], dst.data32F[1]];
    src.delete();
    dst.delete();
    return result;
  }

  // omr_pipeline.py _refine_square_in_window'un birebir aynısı.
  function refineSquareInWindow(cv, grayMat, cx, cy, winR, expectedAreaPx) {
    const W = grayMat.cols, H = grayMat.rows;
    const x0 = Math.max(0, Math.floor(cx - winR));
    const x1 = Math.min(W, Math.floor(cx + winR));
    const y0 = Math.max(0, Math.floor(cy - winR));
    const y1 = Math.min(H, Math.floor(cy + winR));
    if (x1 <= x0 || y1 <= y0) return null;
    const crop = grayMat.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
    const th = new cv.Mat();
    cv.threshold(crop, th, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(th, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = null, bestScore = -1;
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
            const dx = rr.center.x - crop.cols / 2, dy = rr.center.y - crop.rows / 2;
            const distToCenter = Math.hypot(dx, dy);
            const score = solidity - distToCenter / winR;
            if (score > bestScore) { bestScore = score; best = [x0 + rr.center.x, y0 + rr.center.y]; }
          }
        }
      }
      c.delete();
    }
    crop.delete(); th.delete(); contours.delete(); hierarchy.delete();
    return best;
  }

  // omr_pipeline.py _rectify'nin (2026-09-23 düzeltmesi dahil) birebir
  // aynısı: HER köşenin ilk tahmini DAİMA sadece QR'ın kendi 4 köşesinden
  // türetilen sabit H0'dan hesaplanır - kümülatif değil.
  function rectify(cv, rgbaMat, qrPoints, template) {
    const G = root.OmrGeometry;
    const gray = new cv.Mat();
    cv.cvtColor(rgbaMat, gray, cv.COLOR_RGBA2GRAY);
    const qrSizePx = dist(qrPoints[1], qrPoints[0]);
    const winR = qrSizePx * 1.4;
    const expectedFidAreaPx = Math.pow(qrSizePx * (template.fiducialSizeMm / 20.0), 2);

    const fidMm = G.fiducialCentersMm(template);
    const qrDst = G.qrMmCorners(template).map(([x, y]) => [x * G.PX_PER_MM, y * G.PX_PER_MM]);

    const H0 = getPerspectiveTransformMat(cv, qrPoints, qrDst);
    const H0inv = invertMat(cv, H0);
    H0.delete();

    const refined = {};
    for (const key of FIDUCIAL_ORDER) {
      const [xMm, yMm] = fidMm[key];
      const approx = transformPoint(cv, H0inv, xMm * G.PX_PER_MM, yMm * G.PX_PER_MM);
      const found = refineSquareInWindow(cv, gray, approx[0], approx[1], winR, expectedFidAreaPx);
      refined[key] = found || approx;
    }
    H0inv.delete();

    const src = FIDUCIAL_ORDER.map((k) => refined[k]);
    const dst = FIDUCIAL_ORDER.map((k) => { const [x, y] = fidMm[k]; return [x * G.PX_PER_MM, y * G.PX_PER_MM]; });
    const Hfinal = getPerspectiveTransformMat(cv, src, dst);

    const canonW = Math.round(template.formWMm * G.PX_PER_MM);
    const canonH = Math.round(template.formHMm * G.PX_PER_MM);
    const warped = new cv.Mat();
    cv.warpPerspective(rgbaMat, warped, Hfinal, new cv.Size(canonW, canonH));
    Hfinal.delete();
    gray.delete();
    return { warped, refined };
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

  // jsQR ile QR tespiti - once ham karede, bulunamazsa QR'in beklenen
  // bolgesini (varsa onceki bir tahminden) 4x buyutup tekrar dener
  // (bkz. omr_pipeline.py _detect_qr/_decode_qr_cropped_upscale ile ayni
  // gerekce: kucuk/uzak QR bazen dogrudan cozulmuyor).
  function _tryDecodeQr(jsQRFn, imageData) {
    const result = jsQRFn(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
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

  // cv verilirse ve ham karede QR bulunamazsa 1.6x büyütüp tekrar dener -
  // omr_pipeline.py'nin (Python) AYNI bulgusuna dayanır (bkz. o dosyanın
  // docstring'i: "QR kucuk kalinca cogu zaman HIC bulamiyordu"). Gerçek bir
  // kullanıcı raporuyla doğrulandı: 720px önizleme QR'ı buluyor (yeşil
  // çerçeve) ama el titremesi/az ışıkta tam çözünürlüklü çekimde jsQR'ın TEK
  // denemesi çoğu zaman başarısız oluyordu. Sadece ilk deneme başarısız
  // olunca çalıştığından çoğu (başarılı) durumda ek maliyeti yok.
  function detectQr(jsQRFn, imageData, cv) {
    const direct = _tryDecodeQr(jsQRFn, imageData);
    if (direct) return direct;
    if (!cv) return null;
    let src = null, up = null;
    try {
      const scale = 1.6;
      src = cv.matFromImageData(imageData);
      up = new cv.Mat();
      cv.resize(src, up, new cv.Size(Math.round(imageData.width * scale), Math.round(imageData.height * scale)), 0, 0, cv.INTER_CUBIC);
      const upImageData = { data: new Uint8ClampedArray(up.data), width: up.cols, height: up.rows };
      const found = _tryDecodeQr(jsQRFn, upImageData);
      if (found) {
        // Buyutulmus koordinatlari orijinal (rectify()'in bekledigi) olcege
        // geri getir - noktalar HER ZAMAN orijinal imageData uzayinda olmali.
        found.points = found.points.map(([x, y]) => [x / scale, y / scale]);
        return found;
      }
    } catch (err) {
      // sessizce basarisiz - null donulur, cagiran "okunamadi" olarak ele alir.
    } finally {
      if (src) src.delete();
      if (up) up.delete();
    }
    return null;
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
      return { readable: false, matchStatus: 'unmatched', paperToken: null,
        warnings: ["Kağıdın QR kodu bulunamadı - kağıt kadraja tam girmiyor olabilir."] };
    }

    const rgbaMat = cv.matFromImageData(imageData);
    let warped, refined;
    try {
      ({ warped, refined } = rectify(cv, rgbaMat, qr.points, template));
    } finally {
      rgbaMat.delete();
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
      return { readable: false, matchStatus: 'unmatched', paperToken: null,
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
      return { readable: false, matchStatus: 'unmatched', paperToken: null,
        warnings: ['Okuma güvenilir değil (bulanık/örtülü olabilir) - tekrar deneniyor.'] };
    }

    const resultBase = {
      readable: true, matchStatus: 'matched_qr', paperToken: qr.data,
      questions, confidenceAvg, warnings, refinedFiducials: refined,
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
    decodeFrame, detectQr, rectify, readQuestions, classifyGroup, diskMean, glareFraction,
    BLANK_VS_MARKED_GAP, MULTI_MARK_CLOSE_GAP, MULTI_MARK_MIN_PROMINENCE, BUBBLE_SAMPLE_R_MM,
    OMR_MIN_CONFIDENCE_AVG, OMR_GLARE_SATURATION_LEVEL, OMR_GLARE_BG_PERCENTILE,
    OMR_GLARE_MARGIN, OMR_GLARE_AREA_FRACTION,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = OmrWorkerCore;
  root.OmrWorkerCore = OmrWorkerCore;
})(typeof self !== 'undefined' ? self : this);
