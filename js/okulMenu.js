// ============================================================
// Okul yöneticisi menüsü - TEK tanım. Hem Okul Geneli (okul-kokpiti.html,
// js/kokpit/kokpit.js) hem yönetim paneli (index.html, js/app.js -> Okul
// Admini kabuğu) menüyü buradan üretir; başlıklar ve sıra iki yerde hep aynı
// kalsın diye. Bir başlık eklenecek/değişecekse yalnızca burası değişir.
//
// Her öğe: { anahtar, ad, spa: panel sayfası (index.html data-page) | null,
//            kokpit: okul-kokpiti.html hash'i | null, href: diğer adres | null }
// ya da { baslik: 'Yönetim' } bölüm başlığı.
// ============================================================
(function () {
  'use strict';
  var OGELER = [
    { anahtar: 'genel', ad: 'Okul Geneli', kokpit: '' },
    { anahtar: 'kademe', ad: 'Kademe ayrıntısı', kokpit: 'kademe' },
    { anahtar: 'denemeler', ad: 'Denemeler', spa: 'exams' },
    { anahtar: 'subeler', ad: 'Şubeler', kokpit: 'subeler' },
    { anahtar: 'ogrenciler', ad: 'Öğrenciler', spa: 'students' },
    { anahtar: 'odevler', ad: 'Ödevler', href: '/ogretmen.html?page=assignments', dis: true },
    { anahtar: 'raporlar', ad: 'Raporlar', spa: 'reports' },
    { anahtar: 'veri', ad: 'Veri Durumu', kokpit: 'veri' },
    { anahtar: 'kokpit-ayarlar', ad: 'Kokpit ayarları', kokpit: 'ayarlar' },
    { baslik: 'Yönetim' },
    { anahtar: 'kullanicilar', ad: 'Kullanıcılar', spa: 'users' },
    { anahtar: 'veri-girisi', ad: 'Veri Girişi', spa: 'import' },
    { anahtar: 'soru-girisi', ad: 'Soru Girişi', spa: 'question-bank' },
    { anahtar: 'kazanim', ad: 'Kazanım Testleri', href: '/ogretmen.html?page=omr', dis: true },
    { anahtar: 'panel-ayarlar', ad: 'Panel ayarları', spa: 'settings' },
  ];

  // ctx: { okulId, kokpitQs: okul-kokpiti için sorgu ('?okul=2&seviye=8'),
  //        seviye: kademe öğesinin adı için (ör. '8') }
  function ogeler(ctx) {
    ctx = ctx || {};
    var qs = ctx.kokpitQs || (ctx.okulId ? '?okul=' + encodeURIComponent(ctx.okulId) : '');
    return OGELER.map(function (o) {
      if (o.baslik) return o;
      var x = {};
      for (var k in o) x[k] = o[k];
      if (o.anahtar === 'kademe' && ctx.seviye) x.ad = ctx.seviye + '. sınıflar';
      if (o.kokpit != null) {
        // "Okul Geneli" kademe/dönem filtresi taşımaz
        var q = o.anahtar === 'genel' ? (ctx.okulId ? '?okul=' + encodeURIComponent(ctx.okulId) : '') : qs;
        x.url = '/okul-kokpiti.html' + q + '#' + o.kokpit;
      } else if (o.spa) {
        x.url = '/index.html?page=' + o.spa;
      } else {
        x.url = o.href;
      }
      return x;
    });
  }

  window.OkulMenu = { ogeler: ogeler };
})();
