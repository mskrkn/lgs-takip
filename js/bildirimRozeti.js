// Ust cubuktaki 🔔 Bildirimler baglantisina okunmamis bildirim sayisini yazar
// (Okul Kokpiti'nden gelen ogretmen/veli bildirimleri, bkz. bildirimler.html).
// Hata olursa sessizce gecer - panelin geri kalanini etkilemez.
(function () {
  'use strict';
  function guncelle() {
    var link = document.getElementById('bildirim-link');
    var rozet = document.getElementById('bildirim-rozet');
    if (!link || !rozet || !window.fetch) return;
    fetch('/api/bildirimler', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var n = d && d.okunmamis ? d.okunmamis : 0;
        rozet.textContent = n > 9 ? '9+' : String(n);
        rozet.style.display = n ? 'inline-flex' : 'none';
        link.setAttribute('aria-label', n ? 'Bildirimler, ' + n + ' okunmamış' : 'Bildirimler');
      })
      .catch(function () { /* yoksay */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guncelle);
  else guncelle();
  // Sekmeye geri donunce (ör. bildirimler sayfasindan) sayiyi tazele
  document.addEventListener('visibilitychange', function () { if (!document.hidden) guncelle(); });
})();
