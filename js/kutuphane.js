// ============================================================
// Büyük kütüphaneleri İHTİYAÇ ANINDA yükler (panel hızlandırma).
// Excel (xlsx ~200 KB), PDF okuma (pdf.js ~75 KB + worker) ve PDF oluşturma
// (jsPDF ~95 KB) yalnızca Veri Girişi / Raporlar / dışa aktarmada gerekiyor;
// eskiden her panel açılışında <head>'de beklemeli yükleniyordu.
// Kullanım: await Kutuphane.yukle('xlsx');  // XLSX hazır
// Aynı kütüphane ikinci kez istenirse aynı Promise döner (tek indirme).
// ============================================================
(function () {
  'use strict';
  var KAYNAK = {
    xlsx: { url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', hazir: function () { return typeof window.XLSX !== 'undefined'; } },
    pdf: {
      url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      hazir: function () { return typeof window.pdfjsLib !== 'undefined'; },
      sonra: function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      },
    },
    jspdf: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', hazir: function () { return !!(window.jspdf && window.jspdf.jsPDF); } },
    // Eski bulut senkronu (Ayarlar > Firebase) - normal akista hic kullanilmiyor;
    // yalnizca o form kullanilirsa sirayla yuklenir.
    firebase: {
      urls: ['https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
        'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js'],
      hazir: function () { return !!(window.firebase && window.firebase.firestore && window.firebase.auth); },
    },
  };

  function betik(url) {
    return new Promise(function (coz, reddet) {
      var s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = function () { coz(); };
      s.onerror = function () { reddet(new Error('Kütüphane yüklenemedi (internet bağlantısını kontrol edin).')); };
      document.head.appendChild(s);
    });
  }
  var bekleyen = {};

  function yukle(ad) {
    var k = KAYNAK[ad];
    if (!k) return Promise.reject(new Error('Bilinmeyen kütüphane: ' + ad));
    if (k.hazir()) return Promise.resolve();
    if (bekleyen[ad]) return bekleyen[ad];
    var urls = k.urls || [k.url];
    bekleyen[ad] = urls.reduce(function (p, u) { return p.then(function () { return betik(u); }); }, Promise.resolve())
      .then(function () {
        try { if (k.sonra) k.sonra(); } catch (e) { /* worker ayarı olmadan da çalışır */ }
      }, function (e) {
        delete bekleyen[ad];  // sonra tekrar denenebilsin
        throw e;
      });
    return bekleyen[ad];
  }

  // Hata mesajı gösterip devam etmek isteyen çağıranlar için: başarısızsa false
  function dene(ad) {
    return yukle(ad).then(function () { return true; }, function (e) {
      if (window.UI && UI.toast) UI.toast(e.message, 'danger');
      return false;
    });
  }

  window.Kutuphane = { yukle: yukle, dene: dene };
})();
