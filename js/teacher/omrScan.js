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

async function _omrUploadScan(examDefId, blob, extra) {
  const fd = new FormData();
  fd.append('examDefinitionId', examDefId);
  fd.append('image', blob, (extra && extra.filename) || 'scan.jpg');
  if (extra && extra.page) fd.append('page', extra.page);
  // Takili bir istek "busy" kilidini sonsuza kadar acik tutmasin diye zaman asimi.
  const opts = { method: 'POST', body: fd };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(extra && extra.page ? 60000 : 30000);
  const res = await fetch('/api/teacher/omr/scans', opts);
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
    <canvas id="omr-scan-analysis-canvas" width="80" height="112" style="display:none"></canvas>
  `;
  document.body.appendChild(overlay);

  _omrScanState = {
    examDefId, examTitle, uploaded: 0, queued: 0, ready: false, readySince: 0,
    // Cift okuma engeli: cekimden sonra kagit kadrajdan CIKANA kadar otomatik
    // cekim kilitli (awaitingRemoval); yukleme surerken (busy) de yeni cekim yok.
    awaitingRemoval: false, notReadySince: 0, busy: false,
    approved: 0, pendingIds: new Set(), card: null,
  };

  // Tarayicilar getUserMedia'yi SADECE "guvenli baglam"da (HTTPS ya da
  // localhost/127.0.0.1) sunar - ozellikle telefon tarayicilarinda LAN IP'si
  // uzerinden (http://192.168.x.x gibi) hicbir izin penceresi bile CIKMADAN
  // navigator.mediaDevices tamamen tanimsiz kalir. Bu durumda dogrudan
  // .getUserMedia cagirmak senkron bir TypeError firlatip ekranin sessizce
  // siyah kalmasina yol acardi - bunun yerine acik bir Turkce aciklama
  // gosteriyoruz (gercek bir olayla dogrulandi: Android Chrome + LAN IP).
  _omrStartCamera();

  document.getElementById('omr-file-camera').addEventListener('change', (e) => { _omrHandleFiles(e.target.files); e.target.value = ''; });
  document.getElementById('omr-file-pick').addEventListener('change', (e) => { _omrHandleFiles(e.target.files); e.target.value = ''; });
  document.getElementById('omr-scan-file-btn').addEventListener('click', () => document.getElementById('omr-file-pick').click());
  document.getElementById('omr-scan-close').addEventListener('click', _omrCloseScanView);
  document.getElementById('omr-scan-capture').addEventListener('click', _omrCaptureFrame);

  _omrFlushPendingScans(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
  _omrQueueCount().then(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
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
      _omrScanAnalysisLoop();
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

function _omrShowCameraFallback(reason) {
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
    <button type="button" id="omr-fb-retry" style="${btn};background:#374151">🔄 Tekrar Dene</button>
    <button type="button" id="omr-fb-close" style="${btn};background:transparent;border:1px solid #555">✕ Kapat</button>`;
  fb.style.display = 'flex';
  fb.querySelector('#omr-fb-photo').onclick = () => document.getElementById('omr-file-camera').click();
  fb.querySelector('#omr-fb-file').onclick = () => document.getElementById('omr-file-pick').click();
  fb.querySelector('#omr-fb-retry').onclick = () => _omrStartCamera();
  fb.querySelector('#omr-fb-close').onclick = _omrCloseScanView;
}

// Dosyadan yükleme (fotoğraf / JPEG / PNG / PDF - PDF'de her sayfa ayrı kağıt).
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
  setTimeout(_omrScanAnalysisLoop, 150);
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

  // KRITIK: sadece "4 kosede koyu piksel var mi" kontrolu YETERSIZ - gercek
  // kullanimda kamera klavye/masa gibi genel olarak koyu/dokulu bir sahneye
  // baktiginda da yanlislikla tetikleniyordu (gercek bir olayla dogrulandi -
  // 26 yuklemenin cogu kagit degil klavye fotografiydi). Beyaz
  // kağıdın AYIRT EDICI ozelligi "koyu kose + PARLAK ORTA" kontrastidir, salt
  // koyu bir sahnede boyle bir kontrast olmaz - bu yuzden once merkezin
  // (kagidin govdesi) yeterince parlak/beyaz oldugu dogrulanir, kose
  // koyulugu da mutlak bir esik yerine bu merkeze GORECELI olcülür.
  const centerSize = Math.round(Math.min(frameW, frameH) * 0.25);
  const centerX = Math.round(frameLeft + frameW / 2 - centerSize / 2);
  const centerY = Math.round(frameTop + frameH / 2 - centerSize / 2);
  let centerSum = 0, centerTotal = 0;
  for (let y = centerY; y < centerY + centerSize && y < h; y++) {
    for (let x = centerX; x < centerX + centerSize && x < w; x++) {
      centerSum += gray[y * w + x];
      centerTotal++;
    }
  }
  const centerBrightness = centerTotal > 0 ? centerSum / centerTotal : 0;

  let darkCorners = 0;
  const darkThreshold = Math.min(110, centerBrightness - 45);
  for (const [cx, cy] of corners) {
    let darkPixels = 0, total = 0;
    for (let y = cy; y < cy + cornerSize && y < h; y++) {
      for (let x = cx; x < cx + cornerSize && x < w; x++) {
        total++;
        if (gray[y * w + x] < darkThreshold) darkPixels++;
      }
    }
    if (total > 0 && darkPixels / total > 0.15) darkCorners++;
  }

  if (brightness < 60) return { ready: false, hint: 'Işığı artırın' };
  if (brightness > 235) return { ready: false, hint: 'Işığı azaltın / parlamayı önleyin' };
  if (sharpness < 8) return { ready: false, hint: 'Telefonu sabit tutun' };
  if (centerBrightness < 140) return { ready: false, hint: 'Kağıdı çerçeveye ortalayın' };
  if (darkCorners < 4) return { ready: false, hint: 'Kağıdın 4 köşesini çerçeveye alın' };
  return { ready: true, hint: 'Hazır - otomatik çekiliyor...' };
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

  if (hintEl) hintEl.textContent = hint;
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
  if (!_omrScanState || _omrScanState.busy) return;
  const video = document.getElementById('omr-scan-video');
  const canvas = document.getElementById('omr-scan-canvas');
  if (!video || !video.videoWidth) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // Ayni kagidi tekrar tekrar cekmemek icin: yukleme bitene kadar (busy) ve
  // kagit kadrajdan cikana kadar (awaitingRemoval) otomatik cekim kilitli.
  _omrScanState.busy = true;
  _omrScanState.awaitingRemoval = true;
  _omrScanState.notReadySince = 0;
  _omrScanState.lockedAt = Date.now();
  const tCapture = performance.now();
  // Aninda gorsel geri bildirim: sonuc gelene kadar kartta "Okunuyor" gosterilir.
  const cardEl = document.getElementById('omr-scan-card');
  if (cardEl) {
    _omrScanState.card = null;
    cardEl.innerHTML = '<div style="font-size:15px;text-align:center;padding:8px 0">⏳ Okunuyor...</div>';
    cardEl.style.display = 'block';
  }
  canvas.toBlob(async (blob) => {
    if (!_omrScanState) return;
    if (!blob) { _omrScanState.busy = false; return; }
    const examDefId = _omrScanState.examDefId;
    const hintEl = document.getElementById('omr-scan-hint');
    try {
      const data = await _omrUploadScan(examDefId, blob);
      data.timing = { totalMs: Math.round(performance.now() - tCapture), sizeKb: Math.round(blob.size / 1024) };
      if (_omrScanState) _omrHandleScanResponse(data);
      _omrFlushPendingScans(count => { if (_omrScanState) { _omrScanState.queued = count; _omrUpdateCounter(); } });
    } catch (err) {
      _omrCardClose(); // "Okunuyor" karti hata durumunda takili kalmasin
      // SADECE gercek ag hatasi (fetch TypeError) "cevrimdisi" sayilir ve
      // kuyruga alinir - sunucunun verdigi bir hata (oturum dustu, test
      // bulunamadi vb.) eskiden ayni sekilde "kuyruga eklendi" gorunup sonsuza
      // kadar tekrar denenirdi, ogretmen gercek nedeni hic goremezdi.
      if (err instanceof TypeError || err.name === 'TimeoutError' || err.name === 'AbortError') {
        await _omrQueueAdd({ examDefId, blob, capturedAt: new Date().toISOString() });
        if (_omrScanState) {
          _omrScanState.queued++;
          _omrUpdateCounter();
        }
        if (hintEl) hintEl.textContent = '📥 Çevrimdışı - kuyruğa eklendi';
      } else if (hintEl) {
        hintEl.textContent = '❌ ' + (err.message || 'Yükleme başarısız');
      }
    } finally {
      if (_omrScanState) _omrScanState.busy = false;
    }
  }, 'image/jpeg', 0.75);
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
    ${data.timing ? `<div style="font-size:10px;color:#6b7280;margin-top:6px">⏱ toplam ${data.timing.totalMs} ms · sunucu ${data.processingMs ?? '-'} ms · ${data.timing.sizeKb} KB</div>` : ''}`;
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
