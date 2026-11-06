// ============================================================
// Tema (aydinlik / karanlik) - 2026-11-06
// ============================================================
// <head> icinde, CSS'ten HEMEN SONRA ve SENKRON yuklenir (defer YOK) - tema
// sayfa cizilmeden <html data-theme="..."> olarak uygulanir, acilista
// karanlik->aydinlik "yanip sonme" olmaz.
//
// Varsayilan AYDINLIK (kullanici karari 2026-11-06). Secim cihazda
// localStorage 'edu_theme' ('light'|'dark') olarak hatirlanir.
// Aydinlik renkler: css/theme-light.css (html[data-theme="light"] altinda).
//
// Grafikler (Chart.js): js/analysis.js vb. koyu tema icin SABIT renkler
// (#94a3b8 eksen yazisi, rgba(255,255,255,.05) izgara...) veriyor - her
// grafigi tek tek degistirmek yerine burada global bir eklenti bu bilinen
// renkleri aydinlik temada karsiliklarina cevirir; tema degisince acik
// grafikler de yeniden boyanir.
(function () {
  'use strict';
  var KEY = 'edu_theme';

  function stored() {
    try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; }
  }
  function current() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

  function applyMeta(theme) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', theme === 'dark' ? '#070913' : '#f4f6fb');
  }

  document.documentElement.setAttribute('data-theme', stored() || 'light');

  // ---- Grafik renk eslemesi (koyu tema sabiti -> aydinlik karsiligi) ----
  var COLOR_MAP = {
    '#cbd5e1': '#334155', '#94a3b8': '#475569', '#64748b': '#475569', '#f1f5f9': '#0f172a',
    '#f8fafc': '#0f172a', '#e2e8f0': '#1e293b', '#fff': '#0f172a', '#ffffff': '#0f172a',
    '#070913': '#ffffff', '#0d1224': '#ffffff', '#1e293b': '#ffffff', '#0f172a': '#ffffff',
  };
  function mapColor(v) {
    if (typeof v !== 'string') return v;
    var k = v.trim().toLowerCase();
    if (COLOR_MAP[k]) return COLOR_MAP[k];
    var m = k.match(/^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/);
    if (m) return 'rgba(15,23,42,' + Math.min(0.5, parseFloat(m[1]) * 1.6).toFixed(3) + ')';
    var d = k.match(/^rgba\(\s*(13|15|17|7)\s*,\s*(18|23|24|9)\s*,\s*(38|42|48|19)\s*,\s*([\d.]+)\s*\)$/);
    if (d) return 'rgba(255,255,255,' + d[4] + ')';
    return v;
  }
  var COLOR_KEYS = { color: 1, backgroundColor: 0, borderColor: 0, backdropColor: 1, titleColor: 1, bodyColor: 1 };
  // Sadece YAZI/IZGARA renklerini cevirir (veri serilerinin renkleri - ders
  // renkleri vb. - degismez): tooltip arka plani ve izgara/eksen dallari.
  function walk(obj, light, path, orig, depth) {
    if (!obj || typeof obj !== 'object' || depth > 7) return;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (k === 'data' || k === 'datasets' || k === '_proxy' || k.charAt(0) === '$' || k.charAt(0) === '_') continue;
      var v = obj[k], p = path + '.' + k;
      if (typeof v === 'string' && (k in COLOR_KEYS) && (COLOR_KEYS[k] || /tooltip|grid|ticks|title|legend|pointLabels|angleLines/.test(path))) {
        if (!(p in orig)) orig[p] = v;
        obj[k] = light ? mapColor(orig[p]) : orig[p];
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, light, p, orig, depth + 1);
      }
    }
  }
  function themeChart(chart) {
    var cfg = chart.config && (chart.config._config || chart.config);
    if (!cfg || !cfg.options) return;
    chart.$eduOrig = chart.$eduOrig || {};
    walk(cfg.options, current() === 'light', 'o', chart.$eduOrig, 0);
  }
  function registerChartPlugin() {
    if (!window.Chart || window.Chart.$eduThemed) return !!window.Chart;
    window.Chart.$eduThemed = true;
    window.Chart.register({ id: 'eduTheme', beforeInit: themeChart });
    try {
      window.Chart.defaults.color = current() === 'light' ? '#475569' : '#94a3b8';
      window.Chart.defaults.borderColor = current() === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)';
    } catch (e) { /* eski surum */ }
    return true;
  }

  function set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* ozel mod */ }
    applyMeta(theme);
    renderButtons();
    if (window.Chart) {
      registerChartPlugin();
      try {
        window.Chart.defaults.color = theme === 'light' ? '#475569' : '#94a3b8';
        window.Chart.defaults.borderColor = theme === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)';
        var inst = window.Chart.instances || {};
        Object.keys(inst).forEach(function (id) { var c = inst[id]; themeChart(c); c.update('none'); });
      } catch (e) { /* grafik yoksa onemsiz */ }
    }
    try { window.dispatchEvent(new CustomEvent('edu-theme-change', { detail: { theme: theme } })); } catch (e) { /* eski tarayici */ }
  }

  function toggle() { set(current() === 'dark' ? 'light' : 'dark'); }

  function renderButtons() {
    var dark = current() === 'dark';
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = dark ? '☀️' : '🌙';
      btns[i].title = dark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç';
      btns[i].setAttribute('aria-label', btns[i].title);
    }
  }

  // Dugme: sayfada [data-theme-toggle] yer tutucusu varsa onu kullanir, yoksa
  // ust bardaki bilinen kapsayicilara (.header-right / .top-bar-actions) ya
  // da en son care sag-alt kosede yuzen kucuk bir dugme olarak eklenir.
  function mountButton() {
    if (document.querySelector('[data-theme-toggle]')) { renderButtons(); return; }
    var host = document.querySelector('.header-right, .top-bar-actions, .topbar-actions, .header-actions');
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-theme-toggle', '');
    b.className = 'edu-theme-toggle' + (host ? '' : ' edu-theme-toggle--float');
    b.addEventListener('click', toggle);
    if (host) host.insertBefore(b, host.firstChild); else document.body.appendChild(b);
    renderButtons();
  }

  window.EduTheme = { get: current, set: set, toggle: toggle };
  applyMeta(current());
  if (!registerChartPlugin()) {
    // Chart.js bu dosyadan SONRA yukleniyorsa: DOM hazir olunca kaydet
    document.addEventListener('DOMContentLoaded', registerChartPlugin);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (t && !t.classList.contains('edu-theme-toggle')) toggle();
  });
})();
