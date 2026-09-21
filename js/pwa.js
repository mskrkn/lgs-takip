// Platformlar arası ortak davranışlar: PWA (service worker), çevrimdışı şeridi,
// ağ/oturum hatalarında anlaşılır uyarı, global hata yakalama, iOS klavye ve
// kurulum yönlendirmesi. Tarayıcı algılama yerine özellik algılama kullanılır.
(function () {
  'use strict';

  // ---- Service worker (uygulama kabuğu önbelleği) ----
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* kayıt opsiyonel */ });
    });
  }

  // ---- Küçük toast (UI.toast'tan bağımsız; her sayfada çalışır) ----
  let toastEl = null;
  function toast(message, actionLabel, action, ms) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement('div');
    toastEl.className = 'edu-toast';
    toastEl.setAttribute('role', 'alert');
    const span = document.createElement('span');
    span.textContent = message;
    toastEl.appendChild(span);
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.onclick = () => { if (toastEl) toastEl.remove(); toastEl = null; action && action(); };
      toastEl.appendChild(b);
    }
    document.body.appendChild(toastEl);
    const t = toastEl;
    setTimeout(() => { if (t.parentNode) t.remove(); if (toastEl === t) toastEl = null; }, ms || 7000);
  }
  window.EduToast = toast;

  // ---- Çevrimdışı durum şeridi ----
  function ensureBar() {
    let bar = document.getElementById('edu-offline-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'edu-offline-bar';
      bar.setAttribute('role', 'status');
      bar.textContent = '📡 İnternet bağlantısı yok — kaydetme/yükleme işlemleri çalışmaz. Bağlantı gelince otomatik devam eder.';
      document.body.appendChild(bar);
    }
    return bar;
  }
  function syncOnline() {
    if (!document.body) return;
    ensureBar().classList.toggle('on', navigator.onLine === false);
  }
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  document.addEventListener('DOMContentLoaded', syncOnline);

  // ---- Global hata yakalama: tek bir bölüm çökünce tüm uygulama sessiz kalmasın ----
  let lastErrAt = 0;
  function reportSectionError() {
    const now = Date.now();
    if (now - lastErrAt < 15000) return; // art arda uyarı yağmasın
    lastErrAt = now;
    toast('Bu bölüm yüklenirken bir sorun oluştu.', 'Yeniden Dene', () => location.reload());
  }
  window.addEventListener('error', (e) => {
    // Kaynak yükleme hataları (resim vb.) ve cross-origin "Script error" gürültüsünü yoksay
    if (e && e.target && e.target !== window) return;
    if (e && e.message === 'Script error.') return;
    reportSectionError();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    if (r && (r.name === 'AbortError')) return;
    reportSectionError();
  });

  // ---- Ağ / oturum hataları: /api istekleri için anlaşılır bilgi ----
  const origFetch = window.fetch;
  let redirecting = false;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const isApi = url.startsWith('/api/') || url.includes(location.origin + '/api/');
    let res;
    try {
      res = await origFetch.apply(this, arguments);
    } catch (err) {
      if (isApi && method !== 'GET' && err && err.name !== 'AbortError') {
        toast(navigator.onLine === false
          ? '📡 İnternet yok — bu işlem KAYDEDİLMEDİ. Bağlantı gelince tekrar deneyin.'
          : '⚠️ Sunucuya ulaşılamadı — bu işlem kaydedilmemiş olabilir. Lütfen tekrar deneyin.');
      }
      throw err;
    }
    if (isApi && res.status === 401 && !redirecting && !/\/api\/(login|me)(\?|$)/.test(url)) {
      redirecting = true;
      toast('Oturumunuz sona erdi. Giriş sayfasına yönlendiriliyorsunuz…', null, null, 4000);
      setTimeout(() => location.replace('/login.html'), 1500);
    } else if (isApi && res.status >= 500 && method !== 'GET') {
      toast('⚠️ Sunucuda bir sorun oluştu — işlem tamamlanamadı. Lütfen tekrar deneyin.');
    }
    return res;
  };

  // ---- iOS/Android klavye: odaklanan alan görünür kalsın ----
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { el.scrollIntoView(); } }, 350);
  });

  // ---- Kurulum yönlendirmesi (zorunlu değil; site normal web olarak da tam çalışır) ----
  window.EduInstallHelp = function () {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone) { toast('Uygulama zaten kurulu.', null, null, 3000); return; }
    const ua = navigator.userAgent || '';
    let msg;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
      msg = 'iPhone/iPad: Safari\'de alttaki Paylaş (↑) düğmesine dokunun → "Ana Ekrana Ekle".';
    } else if (/Android/.test(ua)) {
      msg = 'Android: Chrome menüsü (⋮) → "Ana ekrana ekle" ya da "Uygulamayı yükle".';
    } else if (/Macintosh/.test(ua)) {
      msg = 'Mac: Safari\'de Paylaş → "Dock\'a Ekle"; Chrome/Edge\'de adres çubuğundaki yükle simgesi.';
    } else {
      msg = 'Windows: Chrome/Edge adres çubuğundaki "Uygulamayı yükle" simgesine tıklayın.';
    }
    toast(msg, null, null, 12000);
  };
})();
