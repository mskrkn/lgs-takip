// ============================================================
// Okul Kokpiti - detay ekranları: Ayarlar (#ayarlar), Şube detayı
// (#sube/<şube>), Ders detayı (#ders/<ders>), Veri Durumu (#veri).
// Ortak yardımcılar js/kokpit/kokpit.js'teki window.Kokpit'ten gelir.
// ============================================================
(function () {
  'use strict';
  const K = window.Kokpit;
  if (!K) return;
  const { esc, fmt, isaretli, yuzde, trTarih, kisaTarih, api, okulYolu, filtreQS, ST } = K;
  const $ = (s, r) => (r || document).querySelector(s);
  const geri = (ad) => `<p class="kp-crumb"><a href="${filtreQS({ okul: ST.okulId })}#">Okul Kokpiti</a> / ${esc(ad)}</p>`;

  // ---------------------------------------------------------- Ayarlar
  const AYAR_ETIKET = [
    ['basariEsigi', 'Ders başarı eşiği (%)', 'Bu oranın altındaki dersler turuncu gösterilir.'],
    ['toplamNetHedef', 'Toplam net hedefi', 'Toplam net kartındaki dönem hedefi.'],
    ['katilimHedef', 'Katılım hedefi (%)', 'Katılım grafiğindeki kesikli çizgi ve KATILIM_DUSUK eşiği.'],
    ['degisimEsigi', 'Belirgin değişim (net)', 'Dönem değişiminde bunun altındaki farklar soluk gösterilir.'],
    ['subePuanDusus', 'Şube puan düşüşü (puan)', 'SUBE_PUAN_DUSUS: şube puanı bu kadar düşerse uyarı.'],
    ['dersNetDusus', 'Ders net düşüşü (net)', 'DERS_NET_DUSUS: şubede bir dersin neti bu kadar düşerse uyarı.'],
    ['yanlisFazlaYuzde', 'Yanlış fazlası (%)', 'YANLIS_YUKSEK: şube yanlışı okul ortalamasını bu oranda aşarsa.'],
    ['subeAcikNet', 'Şube açığı (net)', 'SUBE_ACIK: şube en iyi şubenin bu kadar net gerisindeyse.'],
    ['riskNetDusus', 'Risk: net düşüşü', 'Şube detayı risk listesi: önceki döneme göre en az bu kadar düşen öğrenci.'],
    ['riskAltYuzde', 'Risk: alt dilim (%)', 'Şube detayı risk listesi: şubenin alt yüzdelik dilimi.'],
  ];

  K.EKRANLAR.ayarlar = async function () {
    K.iskelet();
    try {
      const r = await api(okulYolu('/ayarlar'));
      const duzenle = ST.kapsam === 'platform' || ST.kapsam === 'okul';
      const alan = ([k, ad, acik]) => `<label class="kp-field">${esc(ad)}
          <input type="number" step="any" name="${k}" value="${r.ayarlar[k]}" min="${r.tanim[k].min}" max="${r.tanim[k].max}"${duzenle ? '' : ' disabled'}>
          <small>${esc(acik)} Varsayılan: ${fmt(r.varsayilan[k], k.endsWith('Dusus') || k === 'degisimEsigi' ? 1 : 0)}${r.degistirilen.includes(k) ? ' · <b>değiştirildi</b>' : ''}</small></label>`;
      $('#kp-view').innerHTML = `<div class="kp-container">
        <header class="kp-head"><div>${geri('Ayarlar')}<h1>Kokpit ayarları</h1>
          <p class="kp-sub">Eşikler ve hedefler yalnızca bu okul için geçerlidir. Değişiklik kaydedilince tüm kartlar ve uyarılar yeniden hesaplanır.</p></div></header>
        <form class="kp-card" id="kp-ayar-form" novalidate>
          <div class="kp-settings">${AYAR_ETIKET.map(alan).join('')}</div>
          <div id="kp-ayar-mesaj" role="status"></div>
          ${duzenle ? `<div class="kp-modal-actions"><button type="button" class="kp-btn" id="kp-ayar-varsayilan">Varsayılanlara dön</button>
          <button type="submit" class="kp-btn kp-btn-primary">Kaydet</button></div>` : ''}
        </form></div>`;
      const form = $('#kp-ayar-form');
      const kaydet = async (degerler) => {
        try {
          await api(okulYolu('/ayarlar'), { method: 'PUT', body: JSON.stringify({ ayarlar: degerler }) });
          K.toast('Ayarlar kaydedildi. Kokpit yeni eşiklerle hesaplanıyor.');
          K.EKRANLAR.ayarlar();
        } catch (e) {
          $('#kp-ayar-mesaj').innerHTML = `<p class="kp-info">${esc(e.message)}</p>`;
        }
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const d = {};
        form.querySelectorAll('input[name]').forEach((i) => { d[i.name] = i.value; });
        kaydet(d);
      });
      const v = $('#kp-ayar-varsayilan');
      if (v) v.addEventListener('click', () => kaydet(Object.assign({}, r.varsayilan)));
    } catch (e) { K.hataCiz(e); }
  };
})();
