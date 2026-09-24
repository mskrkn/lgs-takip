// ============================================================
// Optik Okuma (Kamera OMR) - form geometrisi, JS aynası.
// ============================================================
// KRİTİK: Bu dosyadaki TÜM sabitler omr_form.py'deki FormTemplate
// tanımlarının (TEMPLATE_COMPACT/QUARTER50/QUARTER100) BİREBİR aynısı
// olmak ZORUNDADIR - biri değişirse diğeri de AYNI ANDA güncellenmeli.
// omr_form.py PDF'i bu koordinatlarla basıyor, bu dosya (ve onu kullanan
// omrWorker.js) aynı koordinatlarla kamera görüntüsünü okuyor; ikisi
// sapınca balon okuma tamamen bozulur (bkz. 2026-09-23 rektifikasyon
// olayı - server.py/omr_pipeline.py tarafındaki aynı düzeltme notu).
//
// Hem ana thread'de (gerekirse) hem de Worker içinde (importScripts ile)
// kullanılabilmesi için düz bir global obje olarak tanımlanır - ES module
// değil, Worker'lar importScripts ile modül olmayan klasik script bekler.

(function (root) {
  'use strict';

  const CHOICES = ['A', 'B', 'C', 'D'];
  const PX_PER_MM = 8; // omr_pipeline.py PX_PER_MM ile aynı - rektifiye kanonik uzayın çözünürlüğü

  function fiducialCentersMm(t) {
    const half = t.fiducialSizeMm / 2 + t.fiducialMarginMm;
    return {
      TL: [half, half],
      TR: [t.formWMm - half, half],
      BL: [half, t.formHMm - half],
      BR: [t.formWMm - half, t.formHMm - half],
    };
  }

  function qrMmCorners(t) {
    const [x0, y0, x1, y1] = t.qrBoxMm;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  function answerRowHMm(t) {
    return (t.answerGridBottomMm - t.answerGridTopMm) / t.answerRowsPerCol;
  }

  function questionBubbleCenterMm(t, questionNumber, choiceIndex) {
    const col = Math.floor((questionNumber - 1) / t.answerRowsPerCol) + 1;
    const row = (questionNumber - 1) % t.answerRowsPerCol;
    const xCol = t.answerColXMm[col];
    const x = xCol + t.answerChoiceOffsetsMm[choiceIndex];
    const y = t.answerGridTopMm + row * answerRowHMm(t) + answerRowHMm(t) / 2;
    return [x, y];
  }

  // ---- Şablonlar - omr_form.py TEMPLATE_COMPACT/COMPACT20/QUARTER50/QUARTER100
  // ile BİREBİR aynı sayısal değerler ----
  // 2026-09-23: "Okul No" yedek kimlik bloğu (idDigit*) kaldırıldı - hiç
  // kullanılmıyordu, QR tek başına yeterliydi (bkz. omr_form.py docstring'i).
  const TEMPLATE_COMPACT = {
    id: 'compact', formWMm: 70.0, formHMm: 148.5, questionCountMax: 25,
    fiducialSizeMm: 5.0, fiducialMarginMm: 5.0, qrBoxMm: [11.0, 10.5, 27.0, 26.5],
    answerGridTopMm: 57.0, answerGridBottomMm: 135.0, answerRowsPerCol: 13,
    answerColXMm: { 1: 9.0, 2: 41.0 },
    answerChoiceOffsetsMm: [4.5, 10.5, 16.5, 22.5],
    answerBubbleDMm: 4.4,
  };

  const TEMPLATE_COMPACT20 = {
    id: 'compact20', formWMm: 70.0, formHMm: 148.5, questionCountMax: 20,
    fiducialSizeMm: 5.0, fiducialMarginMm: 5.0, qrBoxMm: [11.0, 10.5, 27.0, 26.5],
    answerGridTopMm: 32.0, answerGridBottomMm: 135.0, answerRowsPerCol: 10,
    answerColXMm: { 1: 9.0, 2: 41.0 },
    answerChoiceOffsetsMm: [4.5, 10.5, 16.5, 22.5],
    answerBubbleDMm: 4.4,
  };

  const TEMPLATE_QUARTER50 = {
    id: 'quarter50', formWMm: 105.0, formHMm: 148.5, questionCountMax: 50,
    fiducialSizeMm: 5.0, fiducialMarginMm: 5.0, qrBoxMm: [11.0, 10.5, 27.0, 26.5],
    answerGridTopMm: 57.0, answerGridBottomMm: 135.0, answerRowsPerCol: 13,
    answerColXMm: { 1: 9.0, 2: 34.0, 3: 59.0, 4: 84.0 },
    answerChoiceOffsetsMm: [2.8, 7.1, 11.4, 15.7],
    answerBubbleDMm: 3.6,
  };

  const TEMPLATE_QUARTER100 = {
    id: 'quarter100', formWMm: 105.0, formHMm: 148.5, questionCountMax: 100,
    fiducialSizeMm: 5.0, fiducialMarginMm: 5.0, qrBoxMm: [11.0, 10.5, 27.0, 26.5],
    answerGridTopMm: 57.0, answerGridBottomMm: 135.0, answerRowsPerCol: 20,
    answerColXMm: { 1: 7.0, 2: 26.0, 3: 45.0, 4: 64.0, 5: 83.0 },
    answerChoiceOffsetsMm: [2.2, 5.6, 9.0, 12.4],
    answerBubbleDMm: 2.8,
  };

  const TEMPLATES = {
    compact: TEMPLATE_COMPACT,
    compact20: TEMPLATE_COMPACT20,
    quarter50: TEMPLATE_QUARTER50,
    quarter100: TEMPLATE_QUARTER100,
  };

  const OmrGeometry = {
    CHOICES, PX_PER_MM, TEMPLATES,
    fiducialCentersMm, qrMmCorners, questionBubbleCenterMm, answerRowHMm,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = OmrGeometry; // Node testleri icin
  root.OmrGeometry = OmrGeometry;
})(typeof self !== 'undefined' ? self : this);
