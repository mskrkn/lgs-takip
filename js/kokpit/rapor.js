// ============================================================
// Okul Kokpiti - PDF / Excel raporu (şartname 7). Sunucu raporu kısa sürede
// bitirirse doğrudan imzalı (10 dk) indirme bağlantısı döner; uzun sürerse
// arka plan işi olur, burada yoklanır ve hazır olunca kullanıcıya bildirilir.
// ============================================================
(function () {
  'use strict';
  const K = window.Kokpit;
  if (!K) return;
  const { api, okulYolu, esc } = K;

  function indir(url) {
    const a = document.createElement('a');
    a.href = url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function bekle(isId, ad) {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await api(okulYolu(`/rapor/${isId}`));
      if (r.durum === 'hazir') return r;
      if (r.durum === 'hata') throw new Error(r.hata || `${ad} oluşturulamadı.`);
    }
    throw new Error(`${ad} beklenenden uzun sürdü; birazdan yeniden deneyin.`);
  }

  window.KokpitRapor = async function (format, btn) {
    const ad = format === 'pdf' ? 'Dönem raporu (PDF)' : 'Excel raporu';
    const metin = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanıyor…'; }
    try {
      const p = K.params();
      const filtreler = {};
      ['seviye', 'donem', 'bas', 'bit'].forEach((k) => { if (p.get(k)) filtreler[k] = p.get(k); });
      if (!filtreler.seviye && K.ST.veri) filtreler.seviye = K.ST.veri.seviye;
      let r = await api(okulYolu('/rapor'), { method: 'POST', body: JSON.stringify({ format, filtreler }) });
      if (r.durum === 'calisiyor') {
        K.toast(`${ad} arka planda hazırlanıyor; hazır olunca haber vereceğim.`);
        r = await bekle(r.isId, ad);
        K.modalAc(`${ad} hazır`, `<p>Rapor hazır. Bağlantı ${Math.round(r.gecerlilikSn / 60)} dakika geçerlidir ve yalnızca sizin oturumunuzla açılır.</p>
          <div class="kp-modal-actions"><a class="kp-btn kp-btn-primary" href="${esc(r.indir)}">İndir</a></div>`);
        return;
      }
      if (r.durum === 'hata') throw new Error(r.hata || `${ad} oluşturulamadı.`);
      indir(r.indir);
      K.toast(`${ad} indiriliyor.`);
    } catch (e) {
      K.toast(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = metin; }
    }
  };
})();
