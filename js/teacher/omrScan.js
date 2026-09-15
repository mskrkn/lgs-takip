// ============================================================
// Optik Okuma (Kamera OMR) - Faz 2: kamera yakalama + offline kuyruk.
// ============================================================
// ÖNEMLİ: ogretmen.html hiç js/db.js / js/sync.js YÜKLEMİYOR (bunlar SADECE
// index.html'deki okul-admin'in kendi tarayıcısındaki senkron veritabanı -
// öğretmen paneli oturum tabanlı, doğrudan sunucu API'siyle konuşan ince bir
// istemci). Bu yüzden offline kuyruk burada Dexie'ye değil, bu dosyaya özel,
// bağımsız (vanilla) bir IndexedDB deposuna yazılır - tek bir 'pendingScans'
// object store'u yeterli, ayrı bir kütüphane eklemeye gerek yok.
//
// Cihaz tarafı kontrol KASITLI OLARAK hafif: gerçek bir CV kütüphanesi değil,
// küçük bir canvas üzerinde ortalama parlaklık + basit yatay gradyan toplamı
// (bulanıklık tahmini) + 4 köşe bölgesinde koyuluk taraması. Ağır iş (gerçek
// perspektif düzeltme, bubble analizi) hep sunucuda olacak (Faz 3).

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

async function _omrUploadScan(examDefId, blob) {
  const fd = new FormData();
  fd.append('examDefinitionId', examDefId);
  fd.append('image', blob, 'scan.jpg');
  const res = await fetch('/api/teacher/omr/scans', { method: 'POST', body: fd });
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
        await _omrUploadScan(rec.examDefId, rec.blob);
        await _omrQueueDelete(rec.id);
        if (onProgress) onProgress(await _omrQueueCount());
      } catch (err) {
        // Ilk basarisizlikta dur - muhtemelen hala offline'iz, geri kalanini
        // tek tek denemek pil/veri israfi olur. Bir sonraki 'online' olayinda
        // ya da tarama ekrani tekrar acildiginda yeniden denenecek.
        break;
      }
    }
  } finally {
    _omrFlushInFlight = false;
  }
}

window.addEventListener('online', () => _omrFlushPendingScans());

// ============================================================
// Kamera ekranı
// ============================================================

let _omrScanState = null; // { stream, examDefId, examTitle, uploaded, queued, ready, readySince }

function _omrOpenScanView(examDefId, examTitle) {
  if (document.getElementById('omr-scan-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'omr-scan-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:100000;display:flex;flex-direction:column;color:#fff';
  overlay.innerHTML = `
    <div style="position:relative;flex:1;overflow:hidden">
      <video id="omr-scan-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
      <div id="omr-scan-frame" style="position:absolute;top:10%;left:20%;width:60%;height:75%;border:3px dashed rgba(255,255,255,0.7);border-radius:8px;pointer-events:none;transition:border-color .15s"></div>
      <div style="position:absolute;top:10px;left:0;right:0;text-align:center;font-size:13px;text-shadow:0 1px 3px #000">
        <span id="omr-scan-hint">Kağıdı çerçeveye hizalayın</span>
      </div>
      <button id="omr-scan-close" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px">✕</button>
    </div>
    <div style="padding:14px;background:#111;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span id="omr-scan-counter" style="font-size:13px;color:#ccc">0 tarandı</span>
      <button id="omr-scan-capture" style="width:64px;height:64px;border-radius:50%;background:#fff;border:4px solid #888"></button>
      <span style="width:60px"></span>
    </div>
    <canvas id="omr-scan-canvas" style="display:none"></canvas>
    <canvas id="omr-scan-analysis-canvas" width="80" height="112" style="display:none"></canvas>
  `;
  document.body.appendChild(overlay);

  _omrScanState = { examDefId, examTitle, uploaded: 0, queued: 0, ready: false, readySince: 0 };

  // Tarayicilar getUserMedia'yi SADECE "guvenli baglam"da (HTTPS ya da
  // localhost/127.0.0.1) sunar - ozellikle telefon tarayicilarinda LAN IP'si
  // uzerinden (http://192.168.x.x gibi) hicbir izin penceresi bile CIKMADAN
  // navigator.mediaDevices tamamen tanimsiz kalir. Bu durumda dogrudan
  // .getUserMedia cagirmak senkron bir TypeError firlatip ekranin sessizce
  // siyah kalmasina yol acardi - bunun yerine acik bir Turkce aciklama
  // gosteriyoruz (gercek bir olayla dogrulandi: Android Chrome + LAN IP).
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('omr-scan-hint').textContent =
      '⚠️ Kamera bu bağlantıda kullanılamıyor. Tarayıcılar kamerayı sadece ' +
      'HTTPS üzerinden (ya da bilgisayarda "localhost" ile) açmaya izin verir. ' +
      'Telefondan LAN IP (http://192.168...) ile test ediyorsanız, staging ' +
      'ortamının HTTPS adresini kullanın.';
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then(stream => {
      _omrScanState.stream = stream;
      document.getElementById('omr-scan-video').srcObject = stream;
      _omrScanAnalysisLoop();
    })
    .catch(err => {
      document.getElementById('omr-scan-hint').textContent = 'Kamera açılamadı: ' + err.message;
    });

  document.getElementById('omr-scan-close').addEventListener('click', _omrCloseScanView);
  document.getElementById('omr-scan-capture').addEventListener('click', _omrCaptureFrame);

  _omrFlushPendingScans(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
  _omrQueueCount().then(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
}

function _omrCloseScanView() {
  if (_omrScanState && _omrScanState.stream) {
    _omrScanState.stream.getTracks().forEach(t => t.stop());
  }
  const overlay = document.getElementById('omr-scan-overlay');
  if (overlay) overlay.remove();
  _omrScanState = null;
}

function _omrUpdateCounter() {
  const el = document.getElementById('omr-scan-counter');
  if (!el || !_omrScanState) return;
  const { uploaded, queued } = _omrScanState;
  el.textContent = queued > 0 ? `${uploaded} tarandı · ${queued} kuyrukta` : `${uploaded} tarandı`;
}

// Hafif, cihaz-bağımsız ön kontrol: gerçek CV değil, downsample edilmiş bir
// canvas üzerinde ortalama parlaklık + basit gradyan toplamı (bulanıklık
// tahmini) + kılavuz çerçevenin 4 köşesine denk gelen bölgelerde koyuluk
// taraması (fiducial'lerin kabaca orada olup olmadığını tahmin eder).
function _omrScanAnalysisLoop() {
  if (!_omrScanState) return;
  const video = document.getElementById('omr-scan-video');
  const canvas = document.getElementById('omr-scan-analysis-canvas');
  if (video && video.videoWidth && canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const { ready, hint } = _omrAnalyzeFrame(ctx, canvas.width, canvas.height);
      _omrApplyReadyState(ready, hint);
    } catch (err) {
      // Canvas okunamadıysa (ör. bazı tarayıcı güvenlik kısıtları) sessizce
      // sadece manuel çekime düş - otomatik tetikleme olmaz ama uygulama
      // çalışmaya devam eder.
    }
  }
  setTimeout(_omrScanAnalysisLoop, 300);
}

function _omrAnalyzeFrame(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }

  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = sum / gray.length;

  let gradSum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      gradSum += Math.abs(gray[y * w + x] - gray[y * w + x - 1]);
    }
  }
  const sharpness = gradSum / (w * h);

  // Kılavuz çerçeve ekranda üstten %10, soldan %20, genişlik %60, yükseklik
  // %75 (bkz. #omr-scan-frame CSS'i) - köşe kontrolü tüm karenin değil, BU
  // dikdörtgenin köşelerine bakmalı, aksi halde kağıdın kendisi değil kamera
  // görüntüsünün dış kenarları kontrol edilmiş olurdu.
  const frameLeft = w * 0.20, frameTop = h * 0.10, frameW = w * 0.60, frameH = h * 0.75;
  const cornerSize = Math.round(Math.min(frameW, frameH) * 0.18);
  const corners = [
    [frameLeft, frameTop],
    [frameLeft + frameW - cornerSize, frameTop],
    [frameLeft, frameTop + frameH - cornerSize],
    [frameLeft + frameW - cornerSize, frameTop + frameH - cornerSize],
  ].map(([x, y]) => [Math.round(x), Math.round(y)]);
  let darkCorners = 0;
  for (const [cx, cy] of corners) {
    let darkPixels = 0, total = 0;
    for (let y = cy; y < cy + cornerSize && y < h; y++) {
      for (let x = cx; x < cx + cornerSize && x < w; x++) {
        total++;
        if (gray[y * w + x] < 90) darkPixels++;
      }
    }
    if (total > 0 && darkPixels / total > 0.15) darkCorners++;
  }

  if (brightness < 60) return { ready: false, hint: 'Işığı artırın' };
  if (brightness > 235) return { ready: false, hint: 'Işığı azaltın / parlamayı önleyin' };
  if (sharpness < 8) return { ready: false, hint: 'Telefonu sabit tutun' };
  if (darkCorners < 3) return { ready: false, hint: 'Kağıdın 4 köşesini çerçeveye alın' };
  return { ready: true, hint: 'Hazır - otomatik çekiliyor...' };
}

const OMR_AUTO_CAPTURE_HOLD_MS = 600;

function _omrApplyReadyState(ready, hint) {
  const frame = document.getElementById('omr-scan-frame');
  const hintEl = document.getElementById('omr-scan-hint');
  if (hintEl) hintEl.textContent = hint;
  if (!frame || !_omrScanState) return;
  frame.style.borderColor = ready ? '#22c55e' : 'rgba(255,255,255,0.7)';

  const now = Date.now();
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
  if (!_omrScanState) return;
  const video = document.getElementById('omr-scan-video');
  const canvas = document.getElementById('omr-scan-canvas');
  if (!video || !video.videoWidth) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(async (blob) => {
    if (!blob || !_omrScanState) return;
    const examDefId = _omrScanState.examDefId;
    const hintEl = document.getElementById('omr-scan-hint');
    try {
      await _omrUploadScan(examDefId, blob);
      if (_omrScanState) {
        _omrScanState.uploaded++;
        _omrUpdateCounter();
      }
      _omrFlushPendingScans(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
      if (hintEl) hintEl.textContent = '✅ Yüklendi - sıradaki öğrenci';
    } catch (err) {
      await _omrQueueAdd({ examDefId, blob, capturedAt: new Date().toISOString() });
      if (_omrScanState) {
        _omrScanState.queued++;
        _omrUpdateCounter();
      }
      if (hintEl) hintEl.textContent = '📥 Çevrimdışı - kuyruğa eklendi';
    }
  }, 'image/jpeg', 0.85);
}
