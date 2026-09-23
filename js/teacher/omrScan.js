// ============================================================
// Optik Okuma (Kamera OMR) - kamera yakalama + offline kuyruk.
// ============================================================
// 2026-09-23: edupusula-omr-motoru-prompt.md mimarisi uygulandı - marker
// tespiti, perspektif düzeltme, QR okuma ve balon okumanın TAMAMI artık
// tarayıcıda (OpenCV.js/WASM, bir Web Worker içinde - bkz. omrWorker.js/
// omrWorkerCore.js) çalışıyor. Ana thread (bu dosya) yalnızca: kamera akışı,
// UI durumu (🔴🟡🟢), Worker'a küçük/tam çözünürlüklü kareler gönderme ve
// Worker'ın ÇÖZÜLMÜŞ (küçük JSON) sonucunu sunucuya iletmekle görevli. Ham
// fotoğraf ARTIK sunucuya GİTMİYOR - yalnızca düşük güvenli/şüpheli
// sonuçlarda Worker küçük bir önizleme PNG'i ekliyor (bkz. omrWorkerCore.js
// needsPreview). Dosya/PDF yükleme (kamerasız masaüstü yolu) DEĞİŞMEDİ -
// orada gerçek bir video akışı olmadığından sunucudaki Python pipeline'ı
// (omr_pipeline.py) kullanılmaya devam ediyor.
//
// ÖNEMLİ: ogretmen.html hiç js/db.js / js/sync.js YÜKLEMİYOR (bunlar SADECE
// index.html'deki okul-admin'in kendi tarayıcısındaki senkron veritabanı -
// öğretmen paneli oturum tabanlı, doğrudan sunucu API'siyle konuşan ince bir
// istemci). Bu yüzden offline kuyruk burada Dexie'ye değil, bu dosyaya özel,
// bağımsız (vanilla) bir IndexedDB deposuna yazılır.

const OMR_QUEUE_DB_NAME = 'EduPusulaOmrQueue';
const OMR_QUEUE_STORE = 'pendingScans';

function _omrOpenQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OMR_QUEUE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OMR_QUEUE_STORE)) {
        db.createObjectStore(OMR_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _omrQueueAdd(record) {
  const db = await _omrOpenQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OMR_QUEUE_STORE, 'readwrite');
    tx.objectStore(OMR_QUEUE_STORE).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function _omrQueueGetAll() {
  const db = await _omrOpenQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OMR_QUEUE_STORE, 'readonly');
    const req = tx.objectStore(OMR_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function _omrQueueDelete(id) {
  const db = await _omrOpenQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OMR_QUEUE_STORE, 'readwrite');
    tx.objectStore(OMR_QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function _omrQueueCount() {
  return (await _omrQueueGetAll()).length;
}

// Dosya/PDF yükleme (masaüstü/kamerasız yol) - DEĞİŞMEDİ, sunucudaki Python
// pipeline'ını kullanmaya devam eder (bkz. server.py api_teacher_omr_upload_scan).
async function _omrUploadScan(examDefId, blob, extra) {
  const fd = new FormData();
  fd.append('examDefinitionId', examDefId);
  fd.append('image', blob, (extra && extra.filename) || 'scan.jpg');
  if (extra && extra.page) fd.append('page', extra.page);
  const opts = { method: 'POST', body: fd };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(extra && extra.page ? 60000 : 30000);
  const res = await fetch('/api/teacher/omr/scans', opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sunucu hatası (${res.status})`);
  }
  return res.json();
}

// Canlı kamera yolu (istemci-tarafı WASM motoru zaten çözdü) - sunucuya
// yalnızca küçük JSON gider (bkz. server.py api_teacher_omr_client_decoded_scan).
async function _omrSubmitDecoded(examDefId, decoded) {
  const payload = {
    examDefinitionId: examDefId,
    matchStatus: decoded.matchStatus,
    paperToken: decoded.paperToken || null,
    idDigits: decoded.idDigits || null,
    questions: decoded.questions.map((q) => ({ question: q.question, answer: q.answer, status: q.status })),
    warnings: decoded.warnings || [],
  };
  if (decoded.previewPngBase64) payload.previewImage = decoded.previewPngBase64;
  const opts = {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(15000);
  const res = await fetch('/api/teacher/omr/scans/client-decoded', opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sunucu hatası (${res.status})`);
  }
  return res.json();
}

let _omrFlushInFlight = false;
async function _omrFlushPendingScans(onProgress) {
  if (_omrFlushInFlight || !navigator.onLine) return;
  _omrFlushInFlight = true;
  try {
    const pending = await _omrQueueGetAll();
    for (const rec of pending) {
      try {
        // Gecis donemi uyumlulugu: eski kayitlar {examDefId,blob} (ham goruntu,
        // multipart), yeniler {examDefId,decoded} (kucuk JSON) - ikisi de
        // desteklenir ki deploy anindaki kuyrukta bekleyen taramalar kaybolmasin.
        if (rec.blob) await _omrUploadScan(rec.examDefId, rec.blob);
        else await _omrSubmitDecoded(rec.examDefId, rec.decoded);
        await _omrQueueDelete(rec.id);
        if (onProgress) onProgress(await _omrQueueCount());
      } catch (err) {
        break; // muhtemelen hala offline'iz - bir sonraki 'online' olayinda tekrar denenir
      }
    }
  } finally {
    _omrFlushInFlight = false;
  }
}

window.addEventListener('online', () => _omrFlushPendingScans());

// ============================================================
// İstemci-tarafı OMR motoru (Web Worker) - bkz. omrWorker.js/omrWorkerCore.js
// ============================================================

let _omrWorker = null;
let _omrWorkerState = 'idle'; // idle|loading|ready|error
let _omrWorkerErrorMsg = '';
let _omrWorkerReadyWaiters = [];
let _omrDecodeSeq = 0;
const _omrDecodeWaiters = new Map();
let _omrAlignInFlight = false;

function _omrHandleWorkerMessage(ev) {
  const msg = ev.data || {};
  if (msg.type === 'ready') {
    _omrWorkerState = 'ready';
    _omrWorkerReadyWaiters.splice(0).forEach((w) => w.resolve());
  } else if (msg.type === 'initError') {
    _omrWorkerState = 'error';
    _omrWorkerErrorMsg = msg.message || 'Optik motor başlatılamadı.';
    _omrWorkerReadyWaiters.splice(0).forEach((w) => w.reject(new Error(_omrWorkerErrorMsg)));
  } else if (msg.type === 'alignResult') {
    _omrAlignInFlight = false;
    _omrApplyReadyState(msg.ready, msg.hint);
  } else if (msg.type === 'decodeResult') {
    const w = _omrDecodeWaiters.get(msg.reqId);
    if (w) { _omrDecodeWaiters.delete(msg.reqId); w.resolve(msg.result); }
  } else if (msg.type === 'decodeError') {
    const w = _omrDecodeWaiters.get(msg.reqId);
    if (w) { _omrDecodeWaiters.delete(msg.reqId); w.reject(new Error(msg.message || 'Okuma hatası.')); }
  }
}

// Worker'ı (henüz yoksa) oluşturup hazır olmasını bekler - tek instance,
// kamera ekranı kapanana kadar (kapatılınca terminate edilir) yaşar.
function _omrEnsureWorker() {
  if (_omrWorkerState === 'ready') return Promise.resolve();
  if (_omrWorkerState === 'error') return Promise.reject(new Error(_omrWorkerErrorMsg));
  if (!_omrWorker) {
    try {
      _omrWorker = new Worker('/js/teacher/omrWorker.js');
    } catch (err) {
      _omrWorkerState = 'error';
      _omrWorkerErrorMsg = 'Optik motor bu tarayıcıda başlatılamadı.';
      return Promise.reject(new Error(_omrWorkerErrorMsg));
    }
    _omrWorker.onmessage = _omrHandleWorkerMessage;
    _omrWorker.onerror = () => {
      _omrWorkerState = 'error';
      _omrWorkerErrorMsg = 'Optik motor yüklenirken bir hata oluştu (ağ bağlantınızı kontrol edin).';
      _omrWorkerReadyWaiters.splice(0).forEach((w) => w.reject(new Error(_omrWorkerErrorMsg)));
    };
  }
  return new Promise((resolve, reject) => {
    _omrWorkerReadyWaiters.push({ resolve, reject });
    if (_omrWorkerState === 'idle') {
      _omrWorkerState = 'loading';
      _omrWorker.postMessage({ type: 'init' });
    }
  });
}

function _omrTerminateWorker() {
  if (_omrWorker) { _omrWorker.terminate(); _omrWorker = null; }
  _omrWorkerState = 'idle';
  _omrWorkerErrorMsg = '';
  _omrWorkerReadyWaiters = [];
  _omrDecodeWaiters.clear();
  _omrAlignInFlight = false;
}

// imageData.data.buffer TRANSFER edilir (kopyasız, hızlı) - bu yüzden
// çağıran taraf aynı ImageData'yı bir daha KULLANMAMALI (bkz. çağrı yerleri,
// her zaman taze bir getImageData() sonucu geçirilir).
function _omrWorkerAlign(imageData, templateId) {
  if (!_omrWorker) return;
  _omrWorker.postMessage(
    { type: 'align', width: imageData.width, height: imageData.height, buffer: imageData.data.buffer, templateId },
    [imageData.data.buffer],
  );
}

function _omrWorkerDecode(imageData, questionCount, templateId) {
  const reqId = ++_omrDecodeSeq;
  return new Promise((resolve, reject) => {
    _omrDecodeWaiters.set(reqId, { resolve, reject });
    _omrWorker.postMessage(
      { type: 'decode', reqId, width: imageData.width, height: imageData.height, buffer: imageData.data.buffer, questionCount, templateId },
      [imageData.data.buffer],
    );
  });
}

// ============================================================
// Kamera ekranı
// ============================================================

let _omrScanState = null; // { stream, examDefId, examTitle, questionCount, templateId, uploaded, queued, ready, readySince }

async function _omrOpenScanView(examDefId, examTitle) {
  if (document.getElementById('omr-scan-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'omr-scan-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:100000;display:flex;flex-direction:column;color:#fff';
  overlay.innerHTML = `
    <div style="position:relative;flex:1;overflow:hidden">
      <video id="omr-scan-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
      <div id="omr-scan-frame" style="position:absolute;top:10%;left:20%;width:60%;height:75%;border:3px dashed rgba(255,255,255,0.7);border-radius:8px;pointer-events:none;transition:border-color .15s"></div>
      <div style="position:absolute;top:10px;left:0;right:0;text-align:center;font-size:13px;text-shadow:0 1px 3px #000">
        <span id="omr-scan-hint">⏳ Optik motor yükleniyor...</span>
      </div>
      <button id="omr-scan-close" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px">✕</button>
      <div id="omr-scan-card" style="display:none;position:absolute;left:10px;right:10px;bottom:10px;background:rgba(17,24,39,0.96);border:1px solid #374151;border-radius:12px;padding:12px;box-shadow:0 4px 18px rgba(0,0,0,0.6)"></div>
      <div id="omr-scan-sheet" style="display:none;position:absolute;inset:0;background:#0b1220;overflow-y:auto;padding:12px;z-index:5"></div>
    </div>
    <div style="padding:14px;background:#111;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span id="omr-scan-counter" style="font-size:13px;color:#ccc">0 tarandı</span>
      <button id="omr-scan-capture" style="width:64px;height:64px;border-radius:50%;background:#fff;border:4px solid #888"></button>
      <button id="omr-scan-file-btn" type="button" title="Fotoğraf / PDF dosyası yükle" style="width:60px;background:transparent;border:1px solid #555;border-radius:10px;color:#ddd;font-size:22px">📁</button>
    </div>
    <div id="omr-cam-fallback" style="display:none;position:absolute;inset:0;background:#0b1220;z-index:6;padding:20px;overflow-y:auto;text-align:center;flex-direction:column;align-items:center;justify-content:center;gap:12px"></div>
    <input type="file" id="omr-file-camera" accept="image/*" capture="environment" style="display:none">
    <input type="file" id="omr-file-pick" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png" multiple style="display:none">
    <canvas id="omr-scan-canvas" style="display:none"></canvas>
    <canvas id="omr-scan-analysis-canvas" style="display:none"></canvas>
  `;
  document.body.appendChild(overlay);

  _omrScanState = {
    examDefId, examTitle, questionCount: null, templateId: 'compact',
    uploaded: 0, queued: 0, ready: false, readySince: 0,
    // Cift okuma engeli: cekimden sonra kagit kadrajdan CIKANA kadar otomatik
    // cekim kilitli (awaitingRemoval); yukleme surerken (busy) de yeni cekim yok.
    awaitingRemoval: false, notReadySince: 0, busy: false,
    approved: 0, pendingIds: new Set(), card: null,
  };

  document.getElementById('omr-file-camera').addEventListener('change', (e) => { _omrHandleFiles(e.target.files); e.target.value = ''; });
  document.getElementById('omr-file-pick').addEventListener('change', (e) => { _omrHandleFiles(e.target.files); e.target.value = ''; });
  document.getElementById('omr-scan-file-btn').addEventListener('click', () => document.getElementById('omr-file-pick').click());
  document.getElementById('omr-scan-close').addEventListener('click', _omrCloseScanView);
  document.getElementById('omr-scan-capture').addEventListener('click', _omrCaptureFrame);

  _omrFlushPendingScans(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
  _omrQueueCount().then(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });

  // Test tanımının soru sayısı + kağıt şablonu (form_template) - istemci
  // motorunun HANGİ geometriyi (bkz. omrGeometry.js) kullanacağını belirler.
  let examMeta = null;
  try {
    examMeta = await fetch(`/api/teacher/omr/exams/${examDefId}`).then((r) => (r.ok ? r.json() : null));
  } catch (err) { /* asagida hata olarak ele alinir */ }
  if (!_omrScanState) return; // ekran bu sirada kapatilmis olabilir
  if (!examMeta || !examMeta.question_count) {
    document.getElementById('omr-scan-hint').textContent = '❌ Test tanımı yüklenemedi.';
    return;
  }
  _omrScanState.questionCount = examMeta.question_count;
  _omrScanState.templateId = examMeta.form_template || 'compact';

  // Kamera + istemci motoru paralel başlatılır (ikisi de birkaç saniye
  // sürebilir) - hangisi önce biterse öbürünü beklemeden devam eder.
  _omrStartCamera();
  _omrEnsureWorker().then(() => {
    if (_omrScanState) { document.getElementById('omr-scan-hint').textContent = 'Kağıdı çerçeveye hizalayın'; _omrScanAnalysisLoop(); }
  }).catch((err) => {
    if (_omrScanState) _omrShowEngineError(err.message);
  });
}

// İstemci motoru (WASM) hiç başlamazsa (eski tarayıcı, ağ engeli vb.) canlı
// kamera OKUMASI çalışmaz - ama sistem KULLANILAMAZ hale gelmez: dosya/PDF
// yükleme yolu (sunucu tarafı pipeline) bağımsız çalışmaya devam eder.
function _omrShowEngineError(reason) {
  const hint = document.getElementById('omr-scan-hint');
  if (hint) hint.textContent = '⚠️ Otomatik okuma motoru başlatılamadı - fotoğraf/dosya yükleyerek devam edebilirsiniz.';
  _omrShowCameraFallback((reason || 'Optik motor başlatılamadı.') + ' Kağıdı fotoğraflayıp yükleyerek devam edebilirsiniz.', true);
}

// Kamera açılamazsa (desteklenmiyor / izin reddedildi / kullanımda / HTTPS yok)
// sistem kullanılamaz hale gelmez: fotoğraf çek/yükle, dosya seç, tekrar dene.
function _omrStartCamera() {
  const fb = document.getElementById('omr-cam-fallback');
  if (fb) fb.style.display = 'none';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _omrShowCameraFallback(window.isSecureContext
      ? 'Bu tarayıcı kamera erişimini desteklemiyor.'
      : 'Kamera yalnızca güvenli (HTTPS) bağlantıda açılır.');
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then(stream => {
      if (!_omrScanState) { stream.getTracks().forEach(t => t.stop()); return; }
      _omrScanState.stream = stream;
      const v = document.getElementById('omr-scan-video');
      v.srcObject = stream;
      const p = v.play && v.play();
      if (p && p.catch) p.catch(() => {});
    })
    .catch(err => {
      const name = err && err.name;
      const why = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Kamera izni verilmedi. Tarayıcı ayarlarından bu site için kamerayı etkinleştirin.'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'Bu cihazda kamera bulunamadı.'
          : name === 'NotReadableError'
            ? 'Kamera başka bir uygulama tarafından kullanılıyor.'
            : 'Kamera açılamadı' + (err && err.message ? ': ' + err.message : '.');
      _omrShowCameraFallback(why);
    });
}

function _omrShowCameraFallback(reason, hideRetry) {
  const fb = document.getElementById('omr-cam-fallback');
  if (!fb) return;
  const btn = 'width:100%;max-width:320px;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;background:#4f46e5';
  fb.innerHTML = `
    <div style="font-size:40px">📷</div>
    <div style="font-size:18px;font-weight:700">Kamera kullanılamıyor</div>
    <div style="font-size:14px;color:#9ca3af;max-width:340px">${_omrEsc(reason || '')}</div>
    <div style="font-size:13px;color:#9ca3af;max-width:340px">Kağıdı fotoğraflayıp ya da tarayıcıdan aldığınız JPEG/PNG/PDF dosyasını yükleyerek devam edebilirsiniz.</div>
    <button type="button" id="omr-fb-photo" style="${btn}">📸 Fotoğraf Yükle</button>
    <button type="button" id="omr-fb-file" style="${btn};background:#0f766e">📁 Dosya Seç (JPEG / PNG / PDF)</button>
    ${hideRetry ? '' : `<button type="button" id="omr-fb-retry" style="${btn};background:#374151">🔄 Tekrar Dene</button>`}
    <button type="button" id="omr-fb-close" style="${btn};background:transparent;border:1px solid #555">✕ Kapat</button>`;
  fb.style.display = 'flex';
  fb.querySelector('#omr-fb-photo').onclick = () => document.getElementById('omr-file-camera').click();
  fb.querySelector('#omr-fb-file').onclick = () => document.getElementById('omr-file-pick').click();
  const retryBtn = fb.querySelector('#omr-fb-retry');
  if (retryBtn) retryBtn.onclick = () => _omrStartCamera();
  fb.querySelector('#omr-fb-close').onclick = _omrCloseScanView;
}

// Dosyadan yükleme (fotoğraf / JPEG / PNG / PDF - PDF'de her sayfa ayrı kağıt).
// DEĞİŞMEDİ - istemci motorundan bağımsız, sunucu pipeline'ını kullanır.
async function _omrHandleFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length || !_omrScanState) return;
  const st = _omrScanState;
  const hint = document.getElementById('omr-scan-hint');
  const say = (t) => { if (hint) hint.textContent = t; };
  if (st.busy) { say('⏳ Önceki yükleme sürüyor, lütfen bekleyin.'); return; }
  st.busy = true;
  let okCount = 0;
  const failed = [];
  const MAX_MB = 20;
  try {
    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isImg = /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
      if (!isPdf && !isImg) { failed.push(`${file.name}: desteklenmeyen tür (JPEG, PNG veya PDF olmalı)`); continue; }
      if (file.size > MAX_MB * 1024 * 1024) { failed.push(`${file.name}: dosya ${MAX_MB} MB'tan büyük`); continue; }
      try {
        let pages = isPdf ? 1 : 0; // 0: tek görsel
        for (let page = 1; !pages || page <= pages; page++) {
          say(isPdf ? `⏳ ${file.name} — sayfa ${page}${pages > 1 ? '/' + pages : ''} okunuyor…` : `⏳ ${file.name} okunuyor…`);
          const data = await _omrUploadScan(st.examDefId, file, isPdf ? { page, filename: file.name } : { filename: file.name });
          if (isPdf && page === 1) pages = data.pageCount || 1;
          if (_omrScanState) _omrHandleScanResponse(data);
          okCount++;
          if (!isPdf) break;
        }
      } catch (err) {
        const net = err instanceof TypeError || err.name === 'TimeoutError' || err.name === 'AbortError';
        failed.push(`${file.name}: ${net ? 'bağlantı hatası — internet bağlantınızı kontrol edip tekrar deneyin' : (err.message || 'yüklenemedi')}`);
      }
    }
  } finally {
    if (_omrScanState) _omrScanState.busy = false;
  }
  say(failed.length
    ? `⚠️ ${okCount} kağıt okundu, ${failed.length} dosya başarısız: ${failed.join(' | ')}`
    : `✅ ${okCount} kağıt okundu — aşağıdaki karttan onaylayın.`);
  const fb = document.getElementById('omr-cam-fallback');
  if (fb && okCount) fb.style.display = 'none';
}

function _omrCloseScanView() {
  if (_omrScanState && _omrScanState.stream) {
    _omrScanState.stream.getTracks().forEach(t => t.stop());
  }
  _omrTerminateWorker();
  const overlay = document.getElementById('omr-scan-overlay');
  if (overlay) overlay.remove();
  _omrScanState = null;
}

function _omrUpdateCounter() {
  const el = document.getElementById('omr-scan-counter');
  if (!el || !_omrScanState) return;
  const { uploaded, queued, approved, pendingIds } = _omrScanState;
  const parts = [`${uploaded} okundu`, `${approved} onaylı`];
  if (pendingIds.size > 0) parts.push(`${pendingIds.size} onay bekliyor`);
  if (queued > 0) parts.push(`${queued} kuyrukta`);
  el.textContent = parts.join(' · ');
}

// Hafif önizleme döngüsü: küçük (480px) bir kareyi periyodik olarak Worker'a
// gönderip GERÇEK QR tespitiyle 🔴🟡🟢 durumunu günceller (bkz.
// omrWorker.js 'align' mesajı) - ağır balon okuma/perspektif düzeltme burada
// YAPILMAZ, sadece "kağıt kadrajda mı" sorusuna hızlı cevap.
function _omrScanAnalysisLoop() {
  if (!_omrScanState) return;
  if (_omrWorkerState === 'ready' && !_omrAlignInFlight) {
    const video = document.getElementById('omr-scan-video');
    const canvas = document.getElementById('omr-scan-analysis-canvas');
    if (video && video.videoWidth && canvas) {
      try {
        const vw = video.videoWidth, vh = video.videoHeight;
        const targetW = 480, targetH = Math.max(1, Math.round(vh * (targetW / vw)));
        if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, targetW, targetH);
        const imageData = ctx.getImageData(0, 0, targetW, targetH);
        _omrAlignInFlight = true;
        _omrWorkerAlign(imageData, _omrScanState.templateId);
      } catch (err) {
        // Canvas okunamadıysa (ör. bazı tarayıcı güvenlik kısıtları) sessizce
        // sadece manuel çekime düş - otomatik tetikleme olmaz ama uygulama
        // çalışmaya devam eder.
      }
    }
  }
  setTimeout(_omrScanAnalysisLoop, 180);
}

const OMR_AUTO_CAPTURE_HOLD_MS = 300;
// Kagit bu kadar sure kadrajdan CIKMIS (hazir degil) gorunmeden ayni kagit
// yeniden otomatik okunmaz.
const OMR_REARM_ABSENT_MS = 300;
// Kagit hizla degistirilirken "hazir degil" araligi hic olusmayabilir - bu
// sureden sonra kilit yine de acilir (QR'li ayni kagit sunucuda zaten
// "zaten okundu" olarak tekillestirilir, yeni kayit acilmaz).
const OMR_LOCK_MAX_MS = 6000;

function _omrApplyReadyState(ready, hint) {
  const frame = document.getElementById('omr-scan-frame');
  const hintEl = document.getElementById('omr-scan-hint');
  if (!_omrScanState) return;
  const now = Date.now();

  if (_omrScanState.busy) {
    if (hintEl) hintEl.textContent = '⏳ Okunuyor...';
    _omrScanState.ready = false;
    return;
  }
  if (_omrScanState.awaitingRemoval) {
    // Okunan kagit hala kadrajdaysa (hazir) yeniden tetikleme; kagit
    // cekilip yeterince sure "hazir degil" kalinca kilit acilir.
    if (hintEl) hintEl.textContent = ready ? 'Sıradaki kağıdı gösterin' : hint;
    if (frame) frame.style.borderColor = 'rgba(255,255,255,0.7)';
    _omrScanState.ready = false;
    if (ready) {
      _omrScanState.notReadySince = 0;
    } else if (!_omrScanState.notReadySince) {
      _omrScanState.notReadySince = now;
    } else if (now - _omrScanState.notReadySince > OMR_REARM_ABSENT_MS) {
      _omrScanState.awaitingRemoval = false;
      _omrScanState.notReadySince = 0;
    }
    if (_omrScanState.awaitingRemoval && now - _omrScanState.lockedAt > OMR_LOCK_MAX_MS) {
      _omrScanState.awaitingRemoval = false;
      _omrScanState.notReadySince = 0;
    }
    return;
  }

  if (hintEl) hintEl.textContent = ready ? 'Hazır - otomatik çekiliyor...' : hint;
  if (!frame) return;
  frame.style.borderColor = ready ? '#22c55e' : 'rgba(255,255,255,0.7)';

  if (ready) {
    if (!_omrScanState.ready) {
      _omrScanState.ready = true;
      _omrScanState.readySince = now;
    } else if (now - _omrScanState.readySince > OMR_AUTO_CAPTURE_HOLD_MS) {
      _omrScanState.ready = false; // tekrar tetiklenmeden once yeniden "hazir" olmali
      _omrCaptureFrame();
    }
  } else {
    _omrScanState.ready = false;
  }
}

function _omrCaptureFrame() {
  if (!_omrScanState || _omrScanState.busy || _omrWorkerState !== 'ready') return;
  const video = document.getElementById('omr-scan-video');
  const canvas = document.getElementById('omr-scan-canvas');
  if (!video || !video.videoWidth) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // Ayni kagidi tekrar tekrar cekmemek icin: yukleme bitene kadar (busy) ve
  // kagit kadrajdan cikana kadar (awaitingRemoval) otomatik cekim kilitli.
  _omrScanState.busy = true;
  _omrScanState.awaitingRemoval = true;
  _omrScanState.notReadySince = 0;
  _omrScanState.lockedAt = Date.now();
  const tCapture = performance.now();
  const cardEl = document.getElementById('omr-scan-card');
  if (cardEl) {
    _omrScanState.card = null;
    cardEl.innerHTML = '<div style="font-size:15px;text-align:center;padding:8px 0">⏳ Okunuyor...</div>';
    cardEl.style.display = 'block';
  }

  (async () => {
    const hintEl = document.getElementById('omr-scan-hint');
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      _omrCardClose();
      if (_omrScanState) _omrScanState.busy = false;
      return;
    }
    let decoded = null;
    try {
      decoded = await _omrWorkerDecode(imageData, _omrScanState.questionCount, _omrScanState.templateId);
    } catch (err) {
      _omrCardClose();
      if (hintEl) hintEl.textContent = '❌ Okuma hatası: ' + (err.message || 'bilinmeyen hata');
      if (_omrScanState) _omrScanState.busy = false;
      return;
    }
    if (!_omrScanState) return;
    if (!decoded.readable) {
      // Okunamayan bir kağıt için sunucuya HİÇBİR ŞEY göndermiyoruz (ham
      // görüntü zaten yok, kaydedilecek anlamlı bir okuma da yok) - kart
      // sadece Türkçe uyarıyı gösterip kapatılır, öğretmen yeniden dener.
      _omrScanState.busy = false;
      const why = (decoded.warnings && decoded.warnings[0]) || '';
      if (hintEl) hintEl.textContent = '❌ Okunamadı - kağıdı düzleştirip tekrar deneyin. ' + why;
      _omrCardClose();
      return;
    }
    try {
      const data = await _omrSubmitDecoded(_omrScanState.examDefId, decoded);
      data.timing = { totalMs: Math.round(performance.now() - tCapture) };
      if (_omrScanState) _omrHandleScanResponse(data);
      _omrFlushPendingScans(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
    } catch (err) {
      _omrCardClose();
      // SADECE gercek ag hatasi (fetch TypeError) "cevrimdisi" sayilir ve
      // kuyruga alinir - OKUMA zaten TAMAMLANDI (istemci tarafinda), sadece
      // sunucuya bildirim bekliyor; sunucunun verdigi bir hata (oturum
      // dustu, test bulunamadi vb.) ayri gosterilir, sonsuza kadar
      // tekrarlanmaz.
      if (err instanceof TypeError || err.name === 'TimeoutError' || err.name === 'AbortError') {
        await _omrQueueAdd({ examDefId: _omrScanState.examDefId, decoded, capturedAt: new Date().toISOString() });
        if (_omrScanState) { _omrScanState.queued++; _omrUpdateCounter(); }
        if (hintEl) hintEl.textContent = '📥 Çevrimdışı - okuma tamamlandı, gönderim kuyruğa eklendi';
      } else if (hintEl) {
        hintEl.textContent = '❌ ' + (err.message || 'Gönderim başarısız');
      }
    } finally {
      if (_omrScanState) _omrScanState.busy = false;
    }
  })();
}

// ============================================================
// Anlik sonuc karti (videodaki gibi: kagit okununca ogrenci/puan karti,
// uzerinde Onayla/Duzenle/Sil) - kart ENGELLEYICI DEGIL, yeni bir kagit
// okununca yenisiyle degisir; onaylanmadan gecilenler needs_review kalir.
// ============================================================

function _omrHandleScanResponse(data) {
  const st = _omrScanState;
  if (!st) return;
  if (!data.duplicate) st.uploaded++;
  if (data.status === 'needs_review') st.pendingIds.add(data.scanId);
  _omrUpdateCounter();
  _omrShowCard(data);
}

const _OMR_CARD_BTN = 'border:none;border-radius:8px;padding:9px 12px;font-size:14px;font-weight:600;color:#fff;cursor:pointer';

function _omrShowCard(data) {
  const el = document.getElementById('omr-scan-card');
  if (!el || !_omrScanState) return;
  _omrScanState.card = data;
  _omrScanState.cardToken = (_omrScanState.cardToken || 0) + 1;
  const esc = _omrEsc;
  const s = data.summary;

  let header;
  if (data.studentName) {
    header = `<div style="font-size:16px;font-weight:700">${esc(data.studentName)}</div>
      <div style="font-size:12px;color:#9ca3af">No ${esc(data.schoolNumber || '-')} · ${esc(data.className || '-')}</div>`;
  } else {
    header = `<div style="font-size:16px;font-weight:700;color:#f59e0b">Öğrenci eşleşmedi</div>`;
  }

  let body = '';
  if (data.duplicate) {
    body += `<div style="font-size:12px;color:#60a5fa;margin-top:4px">ℹ️ Bu kağıt zaten okundu${data.status === 'approved' ? ' (onaylı)' : ''}.</div>`;
  }
  if (!data.readable) {
    const why = (data.warnings && data.warnings[0]) ? ' ' + esc(data.warnings[0]) : '';
    body += `<div style="font-size:14px;color:#f87171;margin-top:6px">❌ Okunamadı - kağıdı düzleştirip ışığı kontrol ederek tekrar deneyin.${why}</div>`;
  } else {
    body += `<div style="font-size:15px;margin-top:6px">
      <span style="color:#4ade80">✔ ${s.correct}</span> ·
      <span style="color:#fb7185">✘ ${s.wrong}</span> ·
      <span style="color:#9ca3af">○ ${s.blank}</span> ·
      <strong>Net ${data.net}</strong></div>`;
    if (s.flagged > 0) {
      body += `<div style="font-size:12px;color:#fbbf24;margin-top:2px">⚠️ ${s.flagged} şüpheli soru (çift işaret/belirsiz)</div>`;
    }
  }

  let picker = '';
  if (data.status === 'needs_review' && data.readable && !data.studentId) {
    const students = (_omrOverview && _omrOverview.students) || [];
    const classNames = [...new Set(students.map(st => st.class_name).filter(Boolean))].sort();
    const sel = 'background:#111;color:#fff;border:1px solid #444;border-radius:6px;padding:7px;width:100%;margin-top:6px';
    picker = `
      <select id="omr-card-class" style="${sel}" onchange="_omrCardFilterStudents()">
        <option value="">Tüm Şubeler</option>
        ${classNames.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <select id="omr-card-student" style="${sel}">${_omrBuildStudentOptions(students, '', null)}</select>`;
  }

  let buttons = '';
  if (data.status === 'needs_review') {
    const del = `<button style="${_OMR_CARD_BTN};background:#dc2626" onclick="_omrCardReject()">🗑 Sil</button>`;
    if (!data.readable) {
      buttons = del;
    } else {
      buttons = `
        <button style="${_OMR_CARD_BTN};background:#16a34a" onclick="_omrCardApprove()">✅ ${data.studentId ? 'Onayla' : 'Ata ve Onayla'}</button>
        <button style="${_OMR_CARD_BTN};background:#4b5563" onclick="_omrCardEdit()">✏️ Düzenle</button>
        ${del}`;
    }
  } else {
    buttons = `<button style="${_OMR_CARD_BTN};background:#4b5563" onclick="_omrCardClose()">Kapat</button>`;
  }

  el.innerHTML = `${header}${body}${picker}
    <div id="omr-card-msg" style="font-size:12px;color:#f87171;min-height:14px;margin-top:4px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${buttons}</div>
    ${data.timing ? `<div style="font-size:10px;color:#6b7280;margin-top:6px">⏱ toplam ${data.timing.totalMs} ms (tarayıcıda okundu) · sunucu ${data.processingMs ?? '-'} ms</div>` : ''}`;
  el.style.display = 'block';
}

function _omrCardMsg(text) {
  const m = document.getElementById('omr-card-msg');
  if (m) m.textContent = text;
}

function _omrCardClose() {
  const el = document.getElementById('omr-scan-card');
  if (el) el.style.display = 'none';
  if (_omrScanState) _omrScanState.card = null;
}

// Onay/silme sonrasi kart kisa bir sonuc metni gosterip kapanir.
function _omrFlashCard(text) {
  const el = document.getElementById('omr-scan-card');
  if (!el || !_omrScanState) return;
  const token = ++_omrScanState.cardToken;
  el.innerHTML = `<div style="font-size:16px;font-weight:700;text-align:center;padding:6px 0">${_omrEsc(text)}</div>`;
  el.style.display = 'block';
  setTimeout(() => {
    if (_omrScanState && _omrScanState.cardToken === token) _omrCardClose();
  }, 1400);
}

function _omrCardFilterStudents() {
  const cls = document.getElementById('omr-card-class');
  const stu = document.getElementById('omr-card-student');
  if (!cls || !stu) return;
  const students = (_omrOverview && _omrOverview.students) || [];
  stu.innerHTML = _omrBuildStudentOptions(students, cls.value, null);
}

async function _omrCardApprove() {
  const st = _omrScanState;
  const card = st && st.card;
  if (!card) return;
  if (card.summary && card.summary.flagged > 0 &&
      !confirm(`${card.summary.flagged} şüpheli soru boş sayılacak. Yine de onaylansın mı?\n(Düzeltmek için "Düzenle"ye basın.)`)) return;
  _omrCardMsg('');
  try {
    if (!card.studentId) {
      const sid = document.getElementById('omr-card-student')?.value;
      if (!sid) { _omrCardMsg('❌ Önce bir öğrenci seçin.'); return; }
      const ar = await fetch(`/api/teacher/omr/scans/${card.scanId}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: parseInt(sid, 10) }),
      });
      const ad = await ar.json();
      if (!ar.ok) { _omrCardMsg('❌ ' + (ad.error || 'Öğrenci atanamadı.')); return; }
    }
    const res = await fetch(`/api/teacher/omr/scans/${card.scanId}/approve`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { _omrCardMsg('❌ ' + (data.error || 'Onaylanamadı.')); return; }
    window._omrOnScanChanged(card.scanId, 'approved', data.net);
  } catch (err) {
    _omrCardMsg('❌ Bağlantı hatası, tekrar deneyin.');
  }
}

async function _omrCardReject() {
  const card = _omrScanState && _omrScanState.card;
  if (!card) return;
  _omrCardMsg('');
  try {
    const res = await fetch(`/api/teacher/omr/scans/${card.scanId}/reject`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { _omrCardMsg('❌ ' + (data.error || 'Silinemedi.')); return; }
    window._omrOnScanChanged(card.scanId, 'rejected');
  } catch (err) {
    _omrCardMsg('❌ Bağlantı hatası, tekrar deneyin.');
  }
}

// Onay/red nerede yapildiysa (kart ya da Duzenle sayfasi) sayaci ve karti
// gunceller - omrDefine.js _omrApproveScan/_omrRejectScan da bunu cagirir.
window._omrOnScanChanged = function (scanId, status, net) {
  const st = _omrScanState;
  if (!st) return;
  if (st.pendingIds.has(scanId)) {
    st.pendingIds.delete(scanId);
    if (status === 'approved') st.approved++;
  }
  _omrUpdateCounter();
  _omrCloseSheet(false);
  if (st.card && st.card.scanId === scanId) {
    const shownNet = net !== undefined ? net : st.card.net;
    _omrFlashCard(status === 'approved' ? `✅ Onaylandı${shownNet != null ? ' (net ' + shownNet + ')' : ''}` : '🗑 Silindi');
  }
};

// Duzenle: kamerayi kapatmadan overlay icinde mevcut Incele detay gorunumunu
// (foto, soru-soru okuma, A/B/C/D duzeltme, ogrenci atama) acar.
function _omrCardEdit() {
  const st = _omrScanState;
  const card = st && st.card;
  if (!card) return;
  const sheet = document.getElementById('omr-scan-sheet');
  if (!sheet) return;
  sheet.style.display = 'block';
  sheet.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button style="${_OMR_CARD_BTN};background:#4b5563" onclick="_omrCloseSheet(true)">✕ Kapat</button>
    </div>
    <div id="omr-sheet-host"></div>`;
  _omrOpenScanDetail(card.scanId, st.examDefId, st.examTitle, document.getElementById('omr-sheet-host'));
}

async function _omrCloseSheet(refreshCard) {
  const sheet = document.getElementById('omr-scan-sheet');
  if (!sheet || sheet.style.display === 'none') return;
  sheet.style.display = 'none';
  sheet.innerHTML = '';
  const card = _omrScanState && _omrScanState.card;
  if (!refreshCard || !card) return;
  try {
    const scan = await fetch(`/api/teacher/omr/scans/${card.scanId}`).then(r => r.json());
    if (scan && scan.card && _omrScanState && _omrScanState.card && _omrScanState.card.scanId === card.scanId) {
      _omrShowCard(scan.card);
    }
  } catch (err) { /* kart eski haliyle kalir */ }
}
