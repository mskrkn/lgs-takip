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
  // Okul Geneli / N. sınıflar / <ekran>
  const geri = (ad) => K.kademeCrumb({ seviye: K.params().get('seviye') || (ST.veri && ST.veri.seviye) }, ad);

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

  // ---------------------------------------------------------- ortak
  function siraliTablo(el, kolonlar, satirlar, satirHtml, varsayilan) {
    const st = { sira: varsayilan[0], yon: varsayilan[1] };
    const ciz = () => {
      const L = satirlar.slice().sort((a, b) => {
        const x = a[st.sira], y = b[st.sira];
        if (typeof x === 'string' || typeof y === 'string') return st.yon * String(x || '').localeCompare(String(y || ''), 'tr');
        return st.yon * ((x == null ? -1e9 : x) - (y == null ? -1e9 : y));
      });
      el.innerHTML = `<div class="kp-table-wrap"><table class="kp-table"><thead><tr>${kolonlar.map(([k, ad]) => {
        const aktif = st.sira === k;
        return `<th scope="col" aria-sort="${aktif ? (st.yon > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-k="${k}">${esc(ad)}${aktif ? (st.yon > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
      }).join('')}</tr></thead><tbody>${L.map(satirHtml).join('') || `<tr class="kp-plain"><td colspan="${kolonlar.length}">Kayıt yok.</td></tr>`}</tbody></table></div>`;
      el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
        if (st.sira === b.dataset.k) st.yon *= -1; else { st.sira = b.dataset.k; st.yon = -1; }
        ciz(); const n = el.querySelector(`[data-k="${b.dataset.k}"]`); if (n) n.focus();
      }));
    };
    ciz();
  }

  function cizgiGrafik(trend, alanS, alanO, etiket) {
    const pts = trend.filter((t) => t[alanS] != null || t[alanO] != null);
    if (pts.length < 2) return '<p class="kp-empty">Çizgi için en az iki deneme gerekir.</p>';
    const W = 640, H = 200, P = 36;
    const vals = pts.flatMap((t) => [t[alanS], t[alanO]]).filter((x) => x != null);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const x = (i) => P + i * (W - 2 * P) / (pts.length - 1);
    const y = (v) => H - P + 8 - (v - lo) / (hi - lo) * (H - 2 * P);
    const yol = (alan) => pts.map((t, i) => t[alan] == null ? null : `${x(i).toFixed(1)},${y(t[alan]).toFixed(1)}`).filter(Boolean).join(' ');
    const noktalar = (alan, renk) => pts.map((t, i) => t[alan] == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(t[alan]).toFixed(1)}" r="4" fill="${renk}"><title>${esc(t.ad)}: ${fmt(t[alan])}</title></circle>`).join('');
    return `<div class="kp-line-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(etiket)} - deneme deneme şube ve okul ortalaması">
      <line x1="${P}" x2="${W - P}" y1="${H - P + 8}" y2="${H - P + 8}" stroke="#CBD5E1"/>
      <polyline points="${yol(alanO)}" fill="none" stroke="#94A3B8" stroke-width="2" stroke-dasharray="6 5"/>
      <polyline points="${yol(alanS)}" fill="none" stroke="#2563EB" stroke-width="3"/>
      ${noktalar(alanO, '#94A3B8')}${noktalar(alanS, '#2563EB')}
      ${pts.map((t, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="11" text-anchor="middle" fill="#475569">${kisaTarih(t.tarih)}</text>`).join('')}
      <text x="${P - 6}" y="${y(hi - pad) + 4}" font-size="11" text-anchor="end" fill="#475569">${fmt(hi - pad, 0)}</text>
      <text x="${P - 6}" y="${y(lo + pad) + 4}" font-size="11" text-anchor="end" fill="#475569">${fmt(lo + pad, 0)}</text>
    </svg></div>
    <div class="kp-legend"><span><i style="background:#2563EB"></i>Şube</span><span><i style="background:#94A3B8"></i>Okul ortalaması (kesikli)</span></div>
    <div class="kp-sr"><table><caption>${esc(etiket)}</caption><thead><tr><th>Deneme</th><th>Tarih</th><th>Şube</th><th>Okul</th></tr></thead>
    <tbody>${pts.map((t) => `<tr><td>${esc(t.ad)}</td><td>${trTarih(t.tarih)}</td><td>${fmt(t[alanS])}</td><td>${fmt(t[alanO])}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const fark = (a, b) => (a == null || b == null) ? '' : ` <span class="${a - b < 0 ? 'kp-down' : 'kp-up'}">(${isaretli(a - b)} okula göre)</span>`;

  // ---------------------------------------------------------- Şube detayı
  K.EKRANLAR.sube = async function (sube) {
    K.iskelet();
    try {
      const d = await api(okulYolu(`/subeler/${encodeURIComponent(sube)}${filtreQS()}`));
      const k = d.kartlar;
      const uyarilar = ((ST.veri && ST.veri.uyarilar) || []).filter((u) => u.hedef && u.hedef.sube === sube);
      $('#kp-view').innerHTML = `<div class="kp-container">
        ${K.baslikCiz(d, `${sube} şubesi`, `${d.denemeSayisi} deneme · ${k.ogrenci.sube} / ${k.ogrenci.kayitli} öğrenci en az bir denemeye girdi`, { crumb: geri(`Şube ${sube}`) })}
        <section class="kp-stats" aria-label="Şube göstergeleri">
          <div class="kp-stat"><small>Toplam net</small><b>${fmt(k.toplamNet.sube)}</b><small>Okul ${fmt(k.toplamNet.okul)}${fark(k.toplamNet.sube, k.toplamNet.okul)}</small></div>
          <div class="kp-stat"><small>LGS puanı (yaklaşık)</small><b>${fmt(k.puan.sube)}</b><small>Okul ${fmt(k.puan.okul)}${fark(k.puan.sube, k.puan.okul)}</small></div>
          <div class="kp-stat"><small>Ortalama yanlış</small><b>${fmt(k.yanlis.sube, 1)}</b><small>Okul ${fmt(k.yanlis.okul, 1)} · yaklaşık ${fmt((k.yanlis.sube || 0) / 3)} net kayıp</small></div>
          <div class="kp-stat"><small>Dönem puan değişimi</small><b class="${(k.puanDegisim || 0) < 0 ? 'kp-down' : 'kp-up'}">${isaretli(k.puanDegisim)}</b><small>${esc((d.donem.once || {}).etiket || '')} → ${esc((d.donem.sonra || {}).etiket || '')}</small></div>
        </section>
        ${uyarilar.length ? `<article class="kp-card"><h2>Bu şube için uyarılar</h2><ul class="kp-alerts" style="margin-top:12px">${uyarilar.map((u) => `<li class="kp-alert" data-kod="${esc(u.kod)}"><span class="kp-alert-dot" aria-hidden="true"></span><div><h3>${esc(u.baslik)}</h3><p>${esc(u.detay)}</p></div><div class="kp-alert-actions">${ST.veri.yetki.aksiyon && u.aksiyon.tur !== 'veri_girisi' ? `<button type="button" class="kp-btn kp-btn-sm kp-btn-accent" data-aksiyon="${esc(u.anahtar)}">${esc(u.aksiyon.etiket)}</button>` : ''}</div></li>`).join('')}</ul></article>` : ''}
        <div class="kp-grid-eq">
          <article class="kp-card"><h2>Deneme deneme toplam net</h2><p class="kp-card-sub">Şube ile okul ortalaması</p>${cizgiGrafik(d.trend, 'subeNet', 'okulNet', 'Toplam net')}</article>
          <article class="kp-card"><h2>Deneme deneme LGS puanı</h2><p class="kp-card-sub">Yaklaşık puan, şube ile okul ortalaması</p>${cizgiGrafik(d.trend, 'subePuan', 'okulPuan', 'LGS puanı')}</article>
        </div>
        <article class="kp-card"><h2>Ders başarısı ve dönem değişimi</h2><p class="kp-card-sub">Başarı = ortalama net / soru · okul oranı karşılaştırma için</p><div id="kp-sube-ders"></div></article>
        <article class="kp-card"><h2>Risk listesi${d.risk.length ? ` <span class="kp-tag">${d.risk.length}</span>` : ''}</h2>
          <p class="kp-card-sub">Önceki döneme göre en az ${fmt(d.ayarlar.riskNetDusus, 1)} net düşen ya da şubenin alt %${fmt(d.ayarlar.riskAltYuzde, 0)} diliminde kalan öğrenciler</p>
          ${d.risk.length ? `<ul class="kp-data-list">${d.risk.map((o) => `<li class="kp-warn"><div><strong><a href="/ogretmen.html?page=students">${esc(o.ad)}</a></strong><span>${fmt(o.net)} net · ${esc(o.nedenler.join(', '))}</span></div></li>`).join('')}</ul>` : '<p class="kp-empty">Risk ölçütlerine giren öğrenci yok.</p>'}</article>
        <article class="kp-card"><h2>Öğrenciler</h2><p class="kp-card-sub">Dönem ortalamaları · öğrenci adı, öğretmen panelindeki öğrenci listesine götürür; gelişim ekranı (Başarı Pusulası) oradan açılır</p><div id="kp-sube-ogr"></div></article>
      </div>`;
      K.filtreBagla();
      siraliTablo($('#kp-sube-ders'), [['ad', 'Ders'], ['oran', 'Başarı'], ['net', 'Net'], ['okulOran', 'Okul başarı'], ['degisim', 'Dönem değişimi']], d.dersler,
        (x) => `<tr class="kp-plain"><td><a href="${filtreQS({ okul: ST.okulId, sube })}#ders/${x.ders}">${esc(x.ad)}</a></td><td>${yuzde(x.oran)}</td><td>${fmt(x.net)}/${fmt(x.soru, 0)}</td><td>${yuzde(x.okulOran)}</td><td class="${(x.degisim || 0) < 0 ? 'kp-down' : 'kp-up'}">${isaretli(x.degisim)}</td></tr>`, ['oran', 1]);
      siraliTablo($('#kp-sube-ogr'), [['ad', 'Öğrenci'], ['net', 'Net'], ['puan', 'Puan'], ['yanlis', 'Yanlış'], ['deneme', 'Deneme'], ['degisim', 'Değişim']], d.ogrenciler,
        (o) => `<tr class="kp-plain"><td><a href="/ogretmen.html?page=students">${esc(o.ad)}</a></td><td>${fmt(o.net)}</td><td>${fmt(o.puan)}</td><td>${fmt(o.yanlis, 1)}</td><td>${o.deneme}</td><td class="${(o.degisim || 0) < 0 ? 'kp-down' : 'kp-up'}">${isaretli(o.degisim)}</td></tr>`, ['net', -1]);
      $('#kp-view').querySelectorAll('[data-aksiyon]').forEach((b) => b.addEventListener('click', () => {
        const u = ST.veri.uyarilar.find((x) => x.anahtar === b.dataset.aksiyon);
        if (u && typeof window.KokpitAksiyon === 'function') window.KokpitAksiyon(u);
      }));
    } catch (e) { K.hataCiz(e); }
  };

  // ---------------------------------------------------------- Ders detayı
  K.EKRANLAR.ders = async function (ders) {
    K.iskelet();
    try {
      const sube = K.params().get('sube');
      const d = await api(okulYolu(`/dersler/${encodeURIComponent(ders)}${filtreQS(sube ? { sube } : {})}`));
      const o = d.ozet;
      const zayif = d.kazanimlar.filter((x) => x.zayif);
      const subeSec = `<label class="kp-field">Kazanım kırılımı<select id="kp-ders-sube"><option value="">Tüm şubeler</option>${d.subeler.map((s) => `<option${s.sube === d.sube ? ' selected' : ''}>${esc(s.sube)}</option>`).join('')}</select></label>`;
      const maks = 100;
      $('#kp-view').innerHTML = `<div class="kp-container">
        ${K.baslikCiz(d, d.ad, `${d.denemeSayisi} deneme · LGS katsayısı ×${d.katsayi}`, { crumb: geri(d.ad) })}
        <section class="kp-stats">
          <div class="kp-stat"><small>Ortalama net</small><b>${fmt(o.net)} / ${fmt(o.soru, 0)}</b></div>
          <div class="kp-stat"><small>Başarı oranı</small><b>${yuzde(o.oran)}</b></div>
          <div class="kp-stat"><small>Ortalama yanlış</small><b>${fmt(o.yanlis, 1)}</b></div>
          <div class="kp-stat"><small>Dönem değişimi</small><b class="${(o.degisim || 0) < 0 ? 'kp-down' : 'kp-up'}">${isaretli(o.degisim)}</b></div>
        </section>
        <article class="kp-card"><h2>Şubelere göre ${esc(d.ad)} neti</h2><p class="kp-card-sub">Ortalama net ve önceki döneme göre değişim</p>
          <div class="kp-hbars">${d.subeler.map((s) => `<a class="kp-hbar" style="text-decoration:none;color:inherit" href="${filtreQS({ okul: ST.okulId })}#sube/${encodeURIComponent(s.sube)}">
            <span class="kp-hbar-name"><span>${esc(s.sube)}</span></span>
            <span class="kp-hbar-track"><span class="kp-hbar-fill${s.oran * 100 < (ST.veri && ST.veri.ayarlar ? ST.veri.ayarlar.basariEsigi : 60) ? ' kp-low' : ''}" style="width:${Math.min(maks, s.oran * 100)}%"></span></span>
            <span class="kp-hbar-val">${fmt(s.net)} · <span class="${(s.degisim || 0) < 0 ? 'kp-down' : 'kp-up'}">${isaretli(s.degisim)}</span></span></a>`).join('')}</div></article>
        <article class="kp-card"><h2>${zayif.length ? `En zayıf kazanım: ${esc(zayif[0].kazanim)} (%${fmt(zayif[0].dogruYuzde, 0)} doğru)` : 'Konu ve kazanım kırılımı'}</h2>
          <p class="kp-card-sub">Her kazanım için doğru yüzdesi · en zayıf 5 kazanım vurgulu · etiketi olmayan sorular "Etiketsiz" grubunda</p>
          <div class="kp-filters" style="margin-bottom:12px">${subeSec}</div>
          ${d.kazanimlar.length ? `<div class="kp-table-wrap"><table class="kp-table"><thead><tr><th>Kazanım</th><th>Soru</th><th>Doğru</th><th>Yanlış</th><th>Boş</th>${d.yetki.aksiyon ? '<th><span class="kp-sr">Aksiyon</span></th>' : ''}</tr></thead>
          <tbody>${d.kazanimlar.map((x) => `<tr class="kp-plain${x.zayif ? ' kp-weak' : ''}"><td style="white-space:normal;min-width:220px">${x.zayif ? '<span class="kp-tag" style="background:#FEF3C7;color:#78350F">zayıf</span> ' : ''}${esc(x.kazanim)}</td>
            <td>${x.soruSayisi}</td><td><b class="${x.dogruYuzde < 50 ? 'kp-down' : ''}">%${fmt(x.dogruYuzde, 0)}</b></td><td>%${fmt(x.yanlisYuzde, 0)}</td><td>%${fmt(x.bosYuzde, 0)}</td>
            ${d.yetki.aksiyon ? `<td>${x.zayif ? `<button type="button" class="kp-btn kp-btn-sm kp-btn-accent" data-odev-kazanim="${esc(x.kazanim)}">Ödev öner</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
            : '<p class="kp-empty">Bu dönemde soru bazlı cevap verisi (kazanım eşleşmesi) olan deneme yok.</p>'}
        </article></div>`;
      K.filtreBagla();
      $('#kp-ders-sube').addEventListener('change', (e) => { K.setParams({ sube: e.target.value || null }); K.ciz(); });
      $('#kp-view').querySelectorAll('[data-odev-kazanim]').forEach((b) => b.addEventListener('click', () => {
        if (typeof window.KokpitAksiyon === 'function') {
          window.KokpitAksiyon({
            kod: 'KAZANIM_ZAYIF', anahtar: `KAZANIM_ZAYIF:${d.sube || '*'}:${ders}:${b.dataset.odevKazanim}`,
            baslik: `${d.ad}: ${b.dataset.odevKazanim}`, detay: 'Zayıf kazanım için ödev önerisi',
            hedef: { sube: d.sube, ders, kazanimlar: zayif.map((z) => z.kazanim), kazanim: b.dataset.odevKazanim },
            aksiyon: { tur: 'odev_oneri', etiket: 'Ödev öner' },
          });
        }
      }));
    } catch (e) { K.hataCiz(e); }
  };

  // ---------------------------------------------------------- Veri Durumu
  K.EKRANLAR.veri = async function () {
    K.iskelet();
    try {
      const d = await api(okulYolu(`/veri-durumu${filtreQS()}`));
      if (!ST.veri) ST.veri = { yetki: d.yetki, uyarilar: [] };
      const kaz = { tam: '<span class="kp-badge-ok">Tam</span>', eksik: '<span class="kp-badge-bad">Eksik</span>', yok: '<span class="kp-badge-bad">Yok</span>' };
      const sorunlu = d.denemeler.filter((x) => !x.sorunsuz).length;
      $('#kp-view').innerHTML = `<div class="kp-container">
        ${K.baslikCiz(d, 'Veri Durumu', `${d.denemeler.length} deneme · ${sorunlu ? `${sorunlu} denemede eksik var` : 'tüm denemeler eksiksiz'}`, { crumb: geri('Veri Durumu') })}
        <article class="kp-card"><h2>${sorunlu ? `${sorunlu} denemede tamamlanması gereken veri var` : 'Tüm denemelerin verisi tam'}</h2>
          <p class="kp-card-sub">Yükleme, katılım, eksik sonuç, cevap anahtarı ve kazanım eşleşmesi · seçili dönem</p>
          <div class="kp-table-wrap"><table class="kp-table"><thead><tr><th>Deneme</th><th>Tarih</th><th>Durum</th><th>Katılan / kayıtlı</th><th>Eksik sonuç</th><th>Cevap anahtarı</th><th>Kazanım eşleşmesi</th></tr></thead>
          <tbody>${d.denemeler.map((x) => `<tr class="kp-plain"><td style="white-space:normal;min-width:180px"><b>${esc(x.ad)}</b></td><td>${trTarih(x.tarih)}</td>
            <td>${x.durum === 'yüklenmedi' ? '<span class="kp-badge-bad">Yüklenmedi</span>' : '<span class="kp-badge-ok">Değerlendirildi</span>'}</td>
            <td>${x.katilan} / ${x.kayitli}${x.katilmayan ? ` <span class="kp-tag">${x.katilmayan} girmedi</span>` : ''}</td>
            <td>${x.eksikKarne ? `<details><summary class="kp-badge-bad">${x.eksikKarne} öğrenci</summary><small>${x.eksikOgrenciler.map(esc).join(', ')}</small></details>` : '<span class="kp-badge-ok">Yok</span>'}</td>
            <td>${x.cevapAnahtari ? '<span class="kp-badge-ok">Var</span>' : '<span class="kp-badge-bad">Yok</span>'}</td>
            <td>${kaz[x.kazanim] || esc(x.kazanim)}</td></tr>`).join('') || '<tr class="kp-plain"><td colspan="7">Bu dönemde deneme yok.</td></tr>'}</tbody></table></div>
          <p style="margin:14px 0 0"><a class="kp-btn kp-btn-primary" href="/index.html?page=import">Veri girişine git</a></p></article></div>`;
      K.filtreBagla();
    } catch (e) { K.hataCiz(e); }
  };
})();
