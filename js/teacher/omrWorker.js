// ============================================================
// Optik Okuma (Kamera OMR) - Web Worker.
// ============================================================
// edupusula-omr-motoru-prompt.md'nin istediği mimari: marker tespiti,
// perspektif düzeltme, QR okuma ve balon okumanın TAMAMI burada (tarayıcı
// içinde, WASM ile) çalışır - ana thread'i (kamera akışı/UI) bloklamaz,
// ham fotoğraf sunucuya GİTMEZ (yalnızca sonuç JSON'u gider; düşük
// güvenli/incelemelik sonuçlar için küçük bir önizleme kırpması - bkz.
// omrScan.js - opsiyonel olarak eklenir).
//
// Mesaj protokolü (ana thread <-> worker):
//   -> {type:'init'}
//   <- {type:'ready'} | {type:'initError', message}
//   -> {type:'align', width, height, buffer (Transferable), templateId}
//   <- {type:'alignResult', ready, hint, qrFound}
//   -> {type:'decode', reqId, width, height, buffer (Transferable), questionCount, templateId}
//   <- {type:'decodeResult', reqId, ...OmrWorkerCore.decodeFrame sonucu}
//   <- {type:'decodeError', reqId, message}

importScripts('/js/teacher/omrGeometry.js', '/js/teacher/omrWorkerCore.js', '/js/vendor/jsQR.js');
importScripts('https://cdn.jsdelivr.net/npm/opencv.js@1.2.1/opencv.js');

let cvReady = null; // initialize olmus OpenCV.js modulu

self.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    if (typeof cv === 'undefined' || typeof cv.then !== 'function') {
      self.postMessage({ type: 'initError', message: 'OpenCV.js yüklenemedi.' });
      return;
    }
    // İKİ argümanlı .then(onFulfilled, onRejected) KASITLI: zincirlenmiş
    // .then().catch() ile Node test ortamında opencv.js'in (spec'e tam
    // uymayan özel "thenable" döndüren) MODULARIZE yükleme nesnesinde
    // asla çözülmeyen bir kilitlenme yaşandı (bkz. omr_node_test bulgusu,
    // 2026-09-23) - bu iki-argümanlı biçim hem Node'da hem tarayıcıda
    // güvenli çalıştığı doğrulanan biçim.
    cv.then(
      (ready) => { cvReady = ready; self.postMessage({ type: 'ready' }); },
      (err) => { self.postMessage({ type: 'initError', message: String((err && err.message) || err) }); },
    );
    return;
  }

  if (!cvReady) {
    if (msg.reqId) self.postMessage({ type: 'decodeError', reqId: msg.reqId, message: 'Motor henüz hazır değil.' });
    return;
  }

  if (msg.type === 'align') {
    try {
      const imageData = { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height };
      const qr = OmrWorkerCore.detectQr(jsQR, imageData, cvReady);
      self.postMessage({
        type: 'alignResult',
        qrFound: !!qr,
        ready: !!qr,
        hint: qr ? 'Hazır' : 'Kağıdın QR kodunu/köşelerini çerçeveye alın',
      });
    } catch (err) {
      self.postMessage({ type: 'alignResult', qrFound: false, ready: false, hint: 'Analiz hatası' });
    }
    return;
  }

  if (msg.type === 'decode') {
    try {
      const imageData = { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height };
      const result = await OmrWorkerCore.decodeFrame(cvReady, jsQR, imageData, msg.questionCount, msg.templateId);
      self.postMessage({ type: 'decodeResult', reqId: msg.reqId, result });
    } catch (err) {
      self.postMessage({ type: 'decodeError', reqId: msg.reqId, message: String((err && err.message) || err) });
    }
  }
});
