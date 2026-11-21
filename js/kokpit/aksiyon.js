// ============================================================
// Okul Kokpiti - aksiyonlar (şartname 9): önce önizleme, sonra onay.
// Sunucu önizlemede alıcıları hesaplar ve imzalı onayKodu verir; gönderim
// bu kod olmadan (ya da alıcılar değiştiyse) reddedilir.
// ============================================================
(function () {
  'use strict';
  const K = window.Kokpit;
  if (!K) return;
  const { esc, api, okulYolu, ST, trTarih } = K;
  ST.aksiyonAktif = true;

  // u.seviye: Okul Geneli'ndeki uyarılar kendi kademesini taşır (tüm yıl)
  function filtreler(u) {
    if (u && u.seviye) return { seviye: u.seviye };
    const p = K.params();
    const f = {};
    ['seviye', 'donem', 'bas', 'bit'].forEach((k) => { if (p.get(k)) f[k] = p.get(k); });
    if (!f.seviye && ST.veri) f.seviye = ST.veri.seviye;
    return f;
  }

  async function onizle(u, ek) {
    return api(okulYolu('/aksiyonlar?onizleme=1'), {
      method: 'POST',
      body: JSON.stringify(Object.assign({ tur: u.aksiyon.tur, uyariAnahtari: u.anahtar, hedef: u.hedef, filtreler: filtreler(u) }, ek || {})),
    });
  }

  function onizlemeHtml(o) {
    const tur = o.tur;
    const onceki = o.oncekiAksiyon
      ? `<p class="kp-info">Bu uyarı için ${trTarih(o.oncekiAksiyon.tarih)} tarihinde ${esc(K.turAd(o.oncekiAksiyon.tur))} gönderildi (${o.oncekiAksiyon.aliciSayisi} alıcı).</p>` : '';
    const alicilar = `<div class="kp-recips"><strong>${o.aliciSayisi} ${tur === 'veli_bildirim' ? 'veliye' : 'öğretmene'} gidecek</strong>
      ${tur === 'veli_bildirim' ? `<div>${o.ek.ogrenciSayisi} öğrenci ${esc(o.ek.deneme || '')} denemesine girmedi${o.ek.velisiOlmayan ? `, ${o.ek.velisiOlmayan} öğrencinin bağlı velisi yok` : ''}.</div>` : ''}
      <ul>${o.alicilar.map((a) => `<li>${esc(a.ad)}${a.aciklama ? ` <small>· ${esc(a.aciklama)}</small>` : ''}</li>`).join('')}</ul></div>`;
    const not = o.not ? `<p class="kp-info">${esc(o.not)}</p>` : '';
    let odev = '';
    if (tur === 'odev_oneri') {
      odev = `<p>Öğretmenin ekranına <strong>taslak ödev</strong> olarak düşer; öğrencilere ancak öğretmen onaylayıp yayınlayınca gider.</p>
        <label class="kp-field">Soru sayısı<input type="number" id="kp-ak-soru" min="1" max="40" value="${o.ek.soruSayisi}"></label>
        <p style="margin:10px 0 4px"><strong>${esc(o.ek.dersAd)}</strong> · önerilen ${o.ek.sorular.length} soru (mevcut soru havuzundan, otomatik mod)</p>
        ${o.ek.sorular.length ? `<ul class="kp-recips" style="list-style:none">${o.ek.sorular.map((q) => `<li>${esc(q.kod || '#' + q.id)} ${esc(q.metin || (q.gorsel ? '(görsel soru)' : ''))}</li>`).join('')}</ul>` : ''}`;
    }
    return `<p><strong>${esc(o.uyari.baslik)}</strong></p>${onceki}${alicilar}${not}${odev}
      <label class="kp-field" for="kp-ak-metin">${tur === 'odev_oneri' ? 'Öğretmene not' : 'Mesaj'} (göndermeden önce düzenleyebilirsiniz)</label>
      <textarea id="kp-ak-metin">${esc(o.metin)}</textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:14px"><input type="checkbox" id="kp-ak-onay"> Önizlemeyi kontrol ettim, göndermeyi onaylıyorum.</label>
      <div id="kp-ak-mesaj" role="status"></div>
      <div class="kp-modal-actions"><button type="button" class="kp-btn" id="kp-ak-vazgec">Vazgeç</button>
      <button type="button" class="kp-btn kp-btn-primary" id="kp-ak-gonder" disabled>${tur === 'odev_oneri' ? 'Taslağı öğretmene gönder' : 'Gönder'}</button></div>`;
  }

  async function ac(u, ek) {
    K.modalAc(u.aksiyon.etiket, '<p>Önizleme hazırlanıyor…</p>');
    let o;
    try { o = await onizle(u, ek); } catch (e) {
      K.modalAc(u.aksiyon.etiket, `<p class="kp-info">${esc(e.message)}</p><div class="kp-modal-actions"><button type="button" class="kp-btn" id="kp-ak-vazgec">Kapat</button></div>`,
        (b) => b.querySelector('#kp-ak-vazgec').addEventListener('click', K.modalKapat));
      return;
    }
    K.modalAc(`${u.aksiyon.etiket} · önizleme`, onizlemeHtml(o), (b) => {
      const onay = b.querySelector('#kp-ak-onay');
      const gonder = b.querySelector('#kp-ak-gonder');
      onay.addEventListener('change', () => { gonder.disabled = !onay.checked; });
      b.querySelector('#kp-ak-vazgec').addEventListener('click', K.modalKapat);
      const soru = b.querySelector('#kp-ak-soru');
      if (soru) soru.addEventListener('change', () => {
        const n = Math.max(1, Math.min(40, Number(soru.value) || 10));
        ac(u, { soruSayisi: n });
      });
      gonder.addEventListener('click', async () => {
        gonder.disabled = true;
        try {
          const r = await api(okulYolu('/aksiyonlar'), {
            method: 'POST',
            body: JSON.stringify(Object.assign({
              tur: o.tur, uyariAnahtari: o.uyariAnahtari, hedef: u.hedef, filtreler: filtreler(u),
              metin: b.querySelector('#kp-ak-metin').value, onay: true, onayKodu: o.onayKodu,
            }, ek || {})),
          });
          K.modalKapat();
          K.toast(o.tur === 'odev_oneri' ? `Taslak ödev ${r.aliciSayisi} öğretmenin ekranına gönderildi.` : `Bildirim ${r.aliciSayisi} alıcıya gönderildi.`);
          if (ST.veri) {
            ST.veri.aksiyonGecmisi = ST.veri.aksiyonGecmisi || {};
            ST.veri.aksiyonGecmisi[o.uyariAnahtari] = { tur: o.tur, tarih: r.tarih, aliciSayisi: r.aliciSayisi };
          }
          K.ciz();
        } catch (e) {
          b.querySelector('#kp-ak-mesaj').innerHTML = `<p class="kp-info">${esc(e.message)}</p>`;
          if (e.body && e.body.yenidenOnizle) setTimeout(() => ac(u, ek), 1500);
          else gonder.disabled = false;
        }
      });
    });
  }

  window.KokpitAksiyon = (u) => ac(u);

  // Ayarlar ekranının altına aksiyon geçmişi (kim, ne zaman, kime, hangi uyarıdan)
  const ayarEkrani = K.EKRANLAR.ayarlar;
  K.EKRANLAR.ayarlar = async function () {
    await ayarEkrani();
    if (!(ST.kapsam === 'platform' || ST.kapsam === 'okul')) return;
    try {
      const r = await api(okulYolu('/aksiyonlar'));
      const kap = document.querySelector('#kp-view .kp-container');
      if (!kap) return;
      const art = document.createElement('article');
      art.className = 'kp-card';
      art.innerHTML = `<h2>Gönderilen aksiyonlar</h2><p class="kp-card-sub">Kokpitten gönderilen tüm bildirim ve ödev önerileri kayıt altındadır.</p>
        ${r.aksiyonlar.length ? `<div class="kp-table-wrap"><table class="kp-table"><thead><tr><th>Tarih</th><th>Tür</th><th>Uyarı</th><th>Alıcı</th><th>Gönderen</th></tr></thead>
        <tbody>${r.aksiyonlar.map((a) => `<tr class="kp-plain"><td>${esc(a.tarih.replace('T', ' ').slice(0, 16))}</td><td>${esc(K.turAd(a.tur))}</td>
          <td style="white-space:normal;min-width:200px">${esc(a.uyariKodu)} ${esc([a.hedef.sube, a.hedef.ders].filter(Boolean).join(' · '))}</td><td>${a.aliciSayisi}</td><td>${esc(a.gonderen || '')}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="kp-empty">Henüz aksiyon gönderilmedi.</p>'}`;
      kap.appendChild(art);
    } catch (e) { /* geçmiş yüklenemezse ayarlar yine çalışır */ }
  };
})();
