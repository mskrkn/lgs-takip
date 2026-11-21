// ============================================================
// Okul Geneli / kademe kokpiti - okul yöneticisi ekranı (okul-kokpiti.html)
// ------------------------------------------------------------
// Tüm hesaplar sunucuda (kokpit_hesap.py); bu dosya yalnızca çizer.
// Filtreler URL'de tutulur (?okul=2&seviye=8&donem=2026-11), ekran
// hash ile seçilir (#sube/8-B, #ders/matematik, #veri, #ayarlar,
// #uyarilar) - bağlantı paylaşılınca aynı görünüm açılır.
// ============================================================
(function () {
  'use strict';

  const DERS_AD = {
    turkce: 'Türkçe', inkilap: 'İnkılap Tarihi', din: 'Din Kültürü', ingilizce: 'İngilizce',
    matematik: 'Matematik', fen: 'Fen Bilimleri',
  };
  const DERS_KISA = { turkce: 'Türkçe', inkilap: 'İnkılap', din: 'Din', ingilizce: 'İngilizce', matematik: 'Matematik', fen: 'Fen' };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (x, d = 2) => (x == null || isNaN(x)) ? '–' : Number(x).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const isaretli = (x, d = 2) => {
    if (x == null || isNaN(x)) return '–';
    const r = Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
    if (r > 0) return '+' + fmt(r, d);
    if (r < 0) return '−' + fmt(-r, d);
    return fmt(0, d);
  };
  const yuzde = (x) => (x == null || isNaN(x)) ? '–' : '%' + Math.round(x * 100);
  const trTarih = (s) => { if (!s) return '–'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
  const kisaTarih = (s) => { if (!s) return '–'; const [, m, d] = String(s).slice(0, 10).split('-'); return `${d}.${m}`; };
  // Ders adları sunucudan, okulun seçili seviyesine göre gelir (5-7. sınıfta
  // "inkilap" = Sosyal Bilgiler); sabit tablo yalnızca yedek.
  const dersBilgi = (k) => (ST.veri && ST.veri.dersAdlari && ST.veri.dersAdlari[k]) || null;
  const dersAd = (k) => (dersBilgi(k) || {}).ad || DERS_AD[k] || k;
  const kisaAd = (k) => (dersBilgi(k) || {}).kisa || DERS_KISA[k] || k;

  const ST = {
    okulId: null, kapsam: null, okullar: [], veri: null, sube: { sira: 'toplamNet', yon: -1, dersler: null },
    yukleniyor: false,
  };

  // ---------------------------------------------------------- URL durumu
  function params() { return new URLSearchParams(location.search); }
  function setParams(degis, gecmis = true) {
    const p = params();
    Object.entries(degis).forEach(([k, v]) => { if (v == null || v === '') p.delete(k); else p.set(k, v); });
    const url = `${location.pathname}?${p.toString()}${location.hash}`;
    if (gecmis) history.pushState(null, '', url); else history.replaceState(null, '', url);
  }
  function filtreQS(ek) {
    const p = params();
    const q = new URLSearchParams();
    ['seviye', 'donem', 'bas', 'bit'].forEach((k) => { if (p.get(k)) q.set(k, p.get(k)); });
    Object.entries(ek || {}).forEach(([k, v]) => { if (v != null) q.set(k, v); });
    const s = q.toString();
    return s ? `?${s}` : '';
  }
  function rota() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [ad, ...rest] = h.split('/');
    return { ad: ad || 'ana', id: rest.join('/') };
  }

  // ---------------------------------------------------------- API
  async function api(yol, secenek = {}) {
    const res = await fetch(yol, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, secenek));
    if (res.status === 401) { location.href = '/login.html'; throw new Error('Oturum kapandı.'); }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Sunucu hatası (${res.status})`);
      err.status = res.status; err.body = body;
      throw err;
    }
    return body;
  }
  const okulYolu = (alt = '') => `/api/okullar/${ST.okulId}/kokpit${alt}`;

  // ---------------------------------------------------------- toast
  let toastT = null;
  function toast(msg) {
    const t = $('#kp-toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4500);
  }

  // ---------------------------------------------------------- modal
  let modalOnce = null;
  function modalAc(baslik, html, sonra) {
    modalOnce = document.activeElement;
    $('#kp-modal-title').textContent = baslik;
    $('#kp-modal-body').innerHTML = html;
    $('#kp-modal').hidden = false;
    const ilk = $('#kp-modal-body').querySelector('textarea, input, select, button, a');
    (ilk || $('#kp-modal-close')).focus();
    if (sonra) sonra($('#kp-modal-body'));
  }
  function modalKapat() {
    $('#kp-modal').hidden = true;
    $('#kp-modal-body').innerHTML = '';
    if (modalOnce && modalOnce.focus) modalOnce.focus();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#kp-modal').hidden) modalKapat(); });

  // ---------------------------------------------------------- menü
  function menuCiz() {
    const r = rota().ad;
    const veriYalniz = ST.kapsam === 'veri';
    const qs = filtreQS({ okul: ST.okulId });
    const ic = (ad, href, aktif, dis) => `<a href="${href}" class="${dis ? 'kp-ext' : ''}"${aktif ? ' aria-current="page"' : ''}>${esc(ad)}</a>`;
    const items = veriYalniz ? [
      ic('Okul Geneli', `?okul=${ST.okulId}#`, r === 'ana'),
      ic('Veri Durumu', `${qs}#veri`, r === 'veri'),
      ic('Veri Girişi', '/index.html?page=import', false, true),
    ] : [
      ic('Okul Geneli', `?okul=${ST.okulId}#`, r === 'ana'),
      ic(params().get('seviye') ? `${params().get('seviye')}. sınıflar` : 'Kademe ayrıntısı', `${qs}#kademe`, r === 'kademe' || r === 'uyarilar'),
      ic('Denemeler', '/index.html?page=exams', false, true),
      ic('Şubeler', `${qs}#subeler`, r === 'subeler' || r === 'sube'),
      ic('Öğrenciler', '/index.html?page=students', false, true),
      ic('Ödevler', '/ogretmen.html?page=assignments', false, true),
      ic('Raporlar', '/index.html?page=reports', false, true),
      ic('Veri Durumu', `${qs}#veri`, r === 'veri'),
      ic('Kokpit ayarları', `${qs}#ayarlar`, r === 'ayarlar'),
      '<span class="kp-nav-baslik">Yönetim</span>',
      ic('Kullanıcılar', '/index.html?page=users', false, true),
      ic('Veri Girişi', '/index.html?page=import', false, true),
      ic('Soru Girişi', '/index.html?page=question-bank', false, true),
      ic('Panel ayarları', '/index.html?page=settings', false, true),
    ];
    $('#kp-nav').innerHTML = items.join('');
    const okul = ST.okullar.find((o) => o.id === ST.okulId);
    const rol = { platform: 'Platform yöneticisi', okul: 'Okul Admini', veri: 'Veri Giriş Admini' }[ST.kapsam] || '';
    let foot = `<strong>${esc(rol)}</strong>`;
    if (ST.kapsam === 'platform' && ST.okullar.length > 1) {
      foot += `<label class="kp-sr" for="kp-okul-sec">Aktif okul</label><select id="kp-okul-sec">${ST.okullar.map((o) => `<option value="${o.id}"${o.id === ST.okulId ? ' selected' : ''}>${esc(o.ad)}</option>`).join('')}</select>`;
    } else if (okul) {
      foot += `<span>${esc(okul.ad)}</span>`;
    }
    // Platform hesabının panel Anasayfa'sı Okullar listesi; Okul Admini'ninki zaten burası
    if (ST.kapsam === 'platform') foot += ` <a href="/index.html" style="color:#93C5FD;font-size:12px">Okullar</a>`;
    foot += ` <button type="button" class="kp-cikis" id="kp-cikis">Çıkış yap</button>`;
    $('#kp-side-foot').innerHTML = foot;
    $('#kp-cikis').addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* yine de çık */ }
      location.href = '/login.html';
    });
    const sec = $('#kp-okul-sec');
    if (sec) sec.addEventListener('change', () => {
      ST.okulId = Number(sec.value);
      try {
        const o = ST.okullar.find((x) => x.id === ST.okulId);
        sessionStorage.setItem('lgs_acting_school', JSON.stringify({ id: o.id, name: o.ad }));
      } catch (e) { /* yoksay */ }
      setParams({ okul: ST.okulId, seviye: null, donem: null, bas: null, bit: null });
      ciz();
    });
  }

  // ---------------------------------------------------------- iskelet / hata
  function iskelet() {
    $('#kp-view').innerHTML = `<div class="kp-container" aria-busy="true">
      <div class="kp-skel" style="height:72px"></div>
      <div class="kp-grid-kpi">${'<div class="kp-skel" style="height:128px"></div>'.repeat(4)}</div>
      <div class="kp-grid-2"><div class="kp-skel" style="height:260px"></div><div class="kp-skel" style="height:260px"></div></div>
      <div class="kp-grid-eq"><div class="kp-skel" style="height:300px"></div><div class="kp-skel" style="height:300px"></div></div>
      <span class="kp-sr">Yükleniyor…</span></div>`;
  }
  function hataCiz(err) {
    $('#kp-view').innerHTML = `<div class="kp-container"><div class="kp-card kp-state">
      <h2>Kokpit yüklenemedi</h2><p>${esc(err.message || err)}</p>
      <button type="button" class="kp-btn kp-btn-primary" id="kp-retry">Yeniden dene</button></div></div>`;
    $('#kp-retry').addEventListener('click', ciz);
  }

  // ---------------------------------------------------------- başlık + filtreler
  // Okul Geneli > N. sınıflar > (alt ekran) gezinti satırı
  function kademeCrumb(d, ad) {
    const genel = `<a href="?okul=${ST.okulId}#">Okul Geneli</a>`;
    if (!ad) return `<p class="kp-crumb">${genel}</p>`;
    if (!d.seviye) return `<p class="kp-crumb">${genel} / ${esc(ad)}</p>`;
    return `<p class="kp-crumb">${genel} / <a href="${filtreQS({ okul: ST.okulId })}#kademe">${esc(d.seviye || '')}. sınıflar</a> / ${esc(ad)}</p>`;
  }

  function baslikCiz(d, baslik, altBaslik, opts = {}) {
    const p = params();
    const seviyeSec = d.seviyeler.length > 1 ? `<label class="kp-field">Sınıf seviyesi
        <select id="kp-seviye">${d.seviyeler.map((s) => `<option value="${s}"${s === d.seviye ? ' selected' : ''}>${s}. sınıflar</option>`).join('')}</select></label>` : '';
    const donemKod = d.donem.kod;
    const donemSec = `<label class="kp-field">Dönem
        <select id="kp-donem">${d.donemSecenekleri.map((o) => `<option value="${o.kod}"${o.kod === donemKod ? ' selected' : ''}>${esc(o.etiket)}</option>`).join('')}</select></label>`;
    const ozel = donemKod === 'ozel' ? `<label class="kp-field">Başlangıç<input type="date" id="kp-bas" value="${esc(p.get('bas') || d.donem.secili.bas)}"></label>
        <label class="kp-field">Bitiş<input type="date" id="kp-bit" value="${esc(p.get('bit') || d.donem.secili.bit)}"></label>
        <button type="button" class="kp-btn" id="kp-ozel-uygula">Uygula</button>` : '';
    const raporlar = opts.rapor && d.yetki.analiz ? `<button type="button" class="kp-btn" id="kp-excel">Excel indir</button>
        <button type="button" class="kp-btn kp-btn-primary" id="kp-pdf">Dönem raporu (PDF)</button>` : '';
    const hizli = window.Kokpit && window.Kokpit.hizliIslemler ? window.Kokpit.hizliIslemler() : '';
    return `<header class="kp-head">
      <div>
        ${opts.crumb || kademeCrumb(d, opts.crumbAd)}
        <p class="kp-eyebrow">${esc(d.okul.ad)} · ${esc(d.donem.egitimYili)} · ${d.seviye ? `${esc(d.seviye)}. sınıflar (${d.kayitli} öğrenci)` : 'seviye yok'}</p>
        <h1>${esc(baslik)}</h1>
        <p class="kp-sub">${altBaslik}</p>
      </div>
      <div class="kp-filters">${seviyeSec}${donemSec}${ozel}${raporlar}${opts.rapor ? hizli : ''}</div>
    </header>`;
  }
  function filtreBagla() {
    const sev = $('#kp-seviye');
    if (sev) sev.addEventListener('change', () => { setParams({ seviye: sev.value }); ciz(); });
    const don = $('#kp-donem');
    if (don) don.addEventListener('change', () => {
      if (don.value === 'ozel') {
        const s = ST.veri && ST.veri.donem && ST.veri.donem.secili;
        setParams({ donem: 'ozel', bas: s ? s.bas : null, bit: s ? s.bit : null });
      } else setParams({ donem: don.value === 'tum' ? null : don.value, bas: null, bit: null });
      ciz();
    });
    const uyg = $('#kp-ozel-uygula');
    if (uyg) uyg.addEventListener('click', () => {
      const b = $('#kp-bas').value, e = $('#kp-bit').value;
      if (!b || !e || b > e) { toast('Geçerli bir tarih aralığı seçin.'); return; }
      setParams({ donem: 'ozel', bas: b, bit: e }); ciz();
    });
    const x = $('#kp-excel'); if (x) x.addEventListener('click', () => raporIste('xlsx', x));
    const pdf = $('#kp-pdf'); if (pdf) pdf.addEventListener('click', () => raporIste('pdf', pdf));
  }

  function sonDenemeMetni(d) {
    if (!d.sonDeneme) return 'Bu dönemde değerlendirilmiş deneme yok';
    return `Son deneme: ${esc(d.sonDeneme.ad)} · ${trTarih(d.sonDeneme.tarih)} · ${d.degerlendirilen} deneme değerlendirildi`;
  }

  // ---------------------------------------------------------- açılış ekranı
  function kpiCiz(d) {
    const k = d.kartlar;
    const p = k.puan, n = k.toplamNet, kat = k.katilim, kal = k.kaldirac;
    const puanAlt = p.once != null && p.sonra != null
      ? `${esc(p.onceEtiket)} ${fmt(p.once)} → ${esc(p.sonraEtiket)} ${fmt(p.sonra)} <span class="${p.fark < 0 ? 'kp-down' : 'kp-up'}">(${isaretli(p.fark)})</span>`
      : 'Karşılaştırma için önceki dönemde deneme yok';
    const katAlt = kat.katilan != null
      ? `${kat.katilan} / ${kat.kayitli} öğrenci · ${kat.girmeyen > 0 ? `<button type="button" class="kp-link-btn" data-katilmayan="${kat.denemeId}">${kat.girmeyen} öğrenci girmedi</button>` : 'herkes girdi'}`
      : 'Yüklenmiş deneme yok';
    const ayEk = (d.donem.sonra && d.donem.sonra.etiket) ? d.donem.sonra.etiket.toLocaleLowerCase('tr-TR') : '';
    const kalAlt = kal
      ? `${yuzde(kal.oran)} başarı · LGS katsayısı ×${kal.katsayi}${kal.degisim != null ? ` · ${esc(ayEk ? ayEk + 'da' : 'dönemde')} <span class="${kal.degisim < 0 ? 'kp-down' : 'kp-up'}">${isaretli(kal.degisim)} net</span>` : ''}`
      : '';
    return `<section class="kp-grid-kpi" aria-label="Gösterge kartları">
      <article class="kp-card"><p class="kp-kpi-label">Ortalama LGS puanı <span class="kp-tag" title="Katsayılı yaklaşık hesap; gerçek LGS puanı standart puana dayanır.">yaklaşık</span></p>
        <p class="kp-kpi-value">${fmt(p.deger)}</p><p class="kp-kpi-foot">${p.lgs === false && p.deger == null ? 'Bu dönemdeki denemeler LGS türünde değil; puan hesaplanmaz.' : puanAlt}</p></article>
      <article class="kp-card"><p class="kp-kpi-label">Toplam net</p>
        <p class="kp-kpi-value">${fmt(n.deger)} <small>/ ${fmt(n.soru, 0)}</small></p>
        <p class="kp-kpi-foot">Soruların ${yuzde(n.oran)}'ü · dönem hedefi ${fmt(n.hedef, 0)}</p></article>
      <article class="kp-card"><p class="kp-kpi-label">Son deneme katılımı</p>
        <p class="kp-kpi-value">${yuzde(kat.deger)}</p><p class="kp-kpi-foot">${katAlt}</p></article>
      <article class="kp-card"><p class="kp-kpi-label">En büyük kaldıraç</p>
        <p class="kp-kpi-value">${kal ? `<a href="${filtreQS({ okul: ST.okulId })}#ders/${kal.ders}" style="color:inherit;text-decoration:none">${esc(kal.ad)}</a>` : '–'}</p>
        <p class="kp-kpi-foot">${kalAlt}</p></article>
    </section>`;
  }

  function aksiyonButonu(u) {
    const g = (ST.veri.aksiyonGecmisi || {})[u.anahtar];
    if (!ST.veri.yetki.aksiyon) return '';
    if (u.aksiyon.tur === 'veri_girisi') return `<a class="kp-btn kp-btn-sm" href="/index.html?page=import">${esc(u.aksiyon.etiket)}</a>`;
    return `<button type="button" class="kp-btn kp-btn-sm kp-btn-accent" data-aksiyon="${esc(u.anahtar)}"${ST.aksiyonAktif ? '' : ' disabled aria-disabled="true" title="Aksiyonlar bir sonraki adımda etkinleşecek"'}>${esc(u.aksiyon.etiket)}</button>`
      + (g ? '' : '');
  }
  function gecmisNotu(u) {
    const g = (ST.veri.aksiyonGecmisi || {})[u.anahtar];
    return g ? `<div class="kp-alert-note">Bu uyarı için ${trTarih(g.tarih)} tarihinde ${esc(turAd(g.tur))} gönderildi.</div>` : '';
  }
  function turAd(t) { return { ogretmen_bildirim: 'öğretmen bildirimi', odev_oneri: 'ödev önerisi', veli_bildirim: 'veli bildirimi' }[t] || t; }

  function uyariSatiri(u) {
    const detay = u.detayLink && u.detayLink.tip === 'sube'
      ? `<a class="kp-btn kp-btn-sm" href="${filtreQS({ okul: ST.okulId })}#sube/${encodeURIComponent(u.detayLink.id)}">Detaya git</a>`
      : `<button type="button" class="kp-btn kp-btn-sm" data-katilmayan="${u.hedef && u.hedef.denemeId}">Detaya git</button>`;
    return `<li class="kp-alert" data-kod="${esc(u.kod)}"><span class="kp-alert-dot" aria-hidden="true"></span>
      <div><h3>${esc(u.baslik)}</h3><p>${esc(u.detay)}</p>${gecmisNotu(u)}</div>
      <div class="kp-alert-actions">${detay}${aksiyonButonu(u)}</div></li>`;
  }

  function uyarilarCiz(d, hepsi) {
    const liste = hepsi ? d.uyarilar : d.uyarilar.slice(0, 5);
    const ic = liste.length
      ? `<ul class="kp-alerts">${liste.map(uyariSatiri).join('')}</ul>`
      : '<p class="kp-empty">Bu dönem dikkat gerektiren bir durum yok.</p>';
    const tum = !hepsi && d.uyarilar.length > 5
      ? `<p style="margin:12px 0 0"><a href="${filtreQS({ okul: ST.okulId })}#uyarilar">Tümünü gör (${d.uyarilar.length})</a></p>` : '';
    return `<article class="kp-card"><h2>Dikkat gerektirenler${d.uyarilar.length ? ` <span class="kp-tag">${d.uyarilar.length}</span>` : ''}</h2>
      <p class="kp-card-sub">Sistem her deneme sonucundan ve dönem seçiminden sonra yeniden hesaplar.</p>${ic}${tum}</article>`;
  }

  function veriKartiCiz(d) {
    const v = d.veriDurumu;
    const li = [];
    v.yuklenmemis.forEach((x) => li.push(`<li class="kp-bad"><div><strong>${esc(x.ad)} (${kisaTarih(x.tarih)})</strong><span>Sonuç yüklenmemiş, katılım 0 görünüyor.</span></div></li>`));
    if (v.karne) {
      const k = v.karne;
      li.push(`<li class="${k.eksik ? 'kp-warn' : ''}"><div><strong>${esc(k.ad)} sonuçları</strong><span>Eksiksiz sonuç: ${k.hazir} / ${k.toplam}${k.eksik ? ` · ${k.eksik} sonuçta ders bilgisi eksik` : ''}.</span></div></li>`);
    }
    li.push(`<li><div><strong>${v.sorunsuzSayisi} deneme sorunsuz</strong><span>Sonuçlar ve sıralamalar güncel.</span></div></li>`);
    return `<article class="kp-card"><h2>Veri durumu</h2><p class="kp-card-sub">${v.toplam} deneme kayıtlı · seçili dönem</p>
      <ul class="kp-data-list">${li.join('')}</ul>
      <a class="kp-btn kp-btn-sm" href="/index.html?page=import">Veri girişine git</a>
      <a class="kp-btn kp-btn-sm" href="${filtreQS({ okul: ST.okulId })}#veri" style="margin-left:6px">Veri Durumu ekranı</a></article>`;
  }

  function dersCiz(d) {
    const L = d.dersler.liste;
    if (!L.length) return `<article class="kp-card"><h2>Ders başarısı</h2><p class="kp-empty">Bu dönemde ders verisi yok.</p></article>`;
    const esik = d.dersler.esik;
    const satir = (x) => `<button type="button" class="kp-hbar" data-ders="${x.ders}" aria-label="${esc(x.ad)} başarı ${yuzde(x.oran)}, ${fmt(x.net)} / ${fmt(x.soru, 0)} net, ders detayını aç">
        <span class="kp-hbar-name"><span>${esc(x.kisa)}</span><span class="kp-tag">×${x.katsayi}</span></span>
        <span class="kp-hbar-track"><span class="kp-hbar-fill${x.esikAlti ? ' kp-low' : ''}" style="width:${Math.max(0, Math.min(100, x.oran * 100))}%"></span><span class="kp-hbar-thr" style="left:${esik}%"></span></span>
        <span class="kp-hbar-val">${yuzde(x.oran)} · ${fmt(x.net)}/${fmt(x.soru, 0)}</span></button>`;
    return `<article class="kp-card"><h2>${esc(d.dersler.baslik)}</h2>
      <p class="kp-card-sub">Ders başarı oranı = ortalama net / soru sayısı · ${d.dersler.denemeSayisi} deneme</p>
      <div class="kp-hbars" role="group" aria-label="Ders başarı oranları grafiği">${L.map(satir).join('')}</div>
      <div class="kp-legend"><span><i style="background:var(--kp-orange)"></i>%${fmt(esik, 0)}'ın altında</span><span><i style="background:var(--kp-blue)"></i>%${fmt(esik, 0)} ve üstü</span>${d.kartlar.puan.lgs === false ? '' : '<span>×4 = LGS katsayısı</span>'}</div>
      <div class="kp-sr"><table><caption>Ders başarısı</caption><thead><tr><th>Ders</th><th>Başarı</th><th>Net</th><th>Soru</th></tr></thead>
      <tbody>${L.map((x) => `<tr><td>${esc(x.ad)}</td><td>${yuzde(x.oran)}</td><td>${fmt(x.net)}</td><td>${fmt(x.soru, 0)}</td></tr>`).join('')}</tbody></table></div></article>`;
  }

  function degisimCiz(d) {
    const g = d.degisim;
    if (!g.var) return `<article class="kp-card"><h2>Dönem değişimi</h2><p class="kp-empty">${esc(g.mesaj)}</p></article>`;
    const maks = Math.max(0.5, ...g.dersler.map((x) => Math.abs(x.fark)));
    const satir = (x) => {
      const w = Math.round(Math.abs(x.fark) / maks * 100);
      return `<div class="kp-div${x.belirgin ? '' : ' kp-faint'}"><span class="kp-div-name">${esc(x.kisa)}</span>
        <span class="kp-div-l">${x.fark < 0 ? `<span style="width:${w}%"></span>` : ''}</span>
        <span class="kp-div-r">${x.fark > 0 ? `<span style="width:${w}%"></span>` : ''}</span>
        <span class="kp-div-v ${x.fark < 0 ? 'kp-down' : 'kp-up'}">${isaretli(x.fark)}</span></div>`;
    };
    return `<article class="kp-card"><h2>${esc(g.baslik)}</h2>
      <p class="kp-card-sub">${esc(g.once)} (${g.onceDeneme} deneme) → ${esc(g.sonra)} (${g.sonraDeneme} deneme), ortalama net farkı</p>
      <div role="img" aria-label="Önceki döneme göre ders net farkları grafiği">${g.dersler.map(satir).join('')}</div>
      <div class="kp-legend"><span><i style="background:var(--kp-orange)"></i>Düşüş</span><span><i style="background:var(--kp-teal-chart)"></i>Artış</span></div>
      <p class="kp-note">Denemeler farklı yayınevlerinden olduğu için ±${fmt(g.esik)} netin altındaki farklar belirgin sayılmaz (soluk gösterilir).</p>
      <div class="kp-sr"><table><caption>Dönem değişimi</caption><thead><tr><th>Ders</th><th>${esc(g.once)}</th><th>${esc(g.sonra)}</th><th>Fark</th></tr></thead>
      <tbody>${g.dersler.map((x) => `<tr><td>${esc(x.ad)}</td><td>${fmt(x.once)}</td><td>${fmt(x.sonra)}</td><td>${isaretli(x.fark)}</td></tr>`).join('')}</tbody></table></div></article>`;
  }

  function subeTabloCiz(d, tamEkran) {
    const S = d.subeler;
    if (!ST.sube.dersler) ST.sube.dersler = S.varsayilanDersler.slice();
    const dersler = ST.sube.dersler;
    const tumDersler = d.dersler.liste.map((x) => x.ders);
    const kolonlar = [
      ['sube', 'Şube'], ['ogrenci', 'Öğrenci'], ['toplamNet', 'Toplam net'], ['puan', 'LGS puanı'], ['yanlis', 'Ort. yanlış'],
      ...dersler.map((k) => [`d:${k}`, kisaAd(k)]),
      ['puanFark', `${(d.donem.once || {}).etiket || 'Önceki'} → ${(d.donem.sonra || {}).etiket || 'bu dönem'} puan`],
    ];
    const deger = (s, k) => (k.startsWith('d:') ? s.dersler[k.slice(2)] : s[k]);
    const satirlar = S.satirlar.slice().sort((a, b) => {
      const x = deger(a, ST.sube.sira), y = deger(b, ST.sube.sira);
      if (typeof x === 'string') return ST.sube.yon * String(x).localeCompare(String(y), 'tr');
      return ST.sube.yon * ((x == null ? -1e9 : x) - (y == null ? -1e9 : y));
    });
    const baslik = (k, ad) => {
      const aktif = ST.sube.sira === k;
      const yon = aktif ? (ST.sube.yon > 0 ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" aria-sort="${yon}"><button type="button" data-sirala="${k}">${esc(ad)}${aktif ? (ST.sube.yon > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    };
    const trendHucre = (s) => {
      if (s.puanOnce == null || s.puanSonra == null) return '–';
      const cls = s.trend === 'dusus' ? 'kp-down' : (s.trend === 'artis' ? 'kp-up' : '');
      return `<span class="${cls}">${fmt(s.puanOnce)} → ${fmt(s.puanSonra)}</span>`;
    };
    const govde = satirlar.map((s) => `<tr data-sube="${esc(s.sube)}" tabindex="-1">
        <td><a href="${filtreQS({ okul: ST.okulId })}#sube/${encodeURIComponent(s.sube)}">${esc(s.sube)}</a></td>
        <td>${s.ogrenci == null ? '–' : s.ogrenci}</td><td>${fmt(s.toplamNet)}</td><td>${fmt(s.puan)}</td><td>${fmt(s.yanlis, 1)}</td>
        ${dersler.map((k) => `<td>${fmt(s.dersler[k])}</td>`).join('')}<td>${trendHucre(s)}</td></tr>`).join('');
    const secici = `<div class="kp-col-pick" role="group" aria-label="Tabloda gösterilecek dersler"><span>Ders kolonları:</span>
      ${tumDersler.map((k) => `<label><input type="checkbox" data-kolon="${k}"${dersler.includes(k) ? ' checked' : ''}>${esc(kisaAd(k))}</label>`).join('')}</div>`;
    return `<article class="kp-card"><h2>${esc(S.baslik)}</h2>
      <p class="kp-card-sub">${d.dersler.denemeSayisi} deneme ortalaması · satıra tıklayınca şube detayı açılır${tamEkran ? '' : ''}</p>
      ${secici}
      <div class="kp-table-wrap"><table class="kp-table"><caption class="kp-sr">Şube karşılaştırması</caption>
      <thead><tr>${kolonlar.map(([k, a]) => baslik(k, a)).join('')}</tr></thead><tbody>${govde || `<tr class="kp-plain"><td colspan="${kolonlar.length}">Bu dönemde şube verisi yok.</td></tr>`}</tbody></table></div></article>`;
  }

  function katilimCiz(d) {
    const K = d.katilim;
    if (!K.cubuklar.length) return `<article class="kp-card"><h2>Katılım</h2><p class="kp-empty">Bu dönemde deneme yok.</p></article>`;
    const kayitli = d.kayitli || 1;
    const H = 170;
    const hedefY = H * (K.hedef / 100);
    const cub = K.cubuklar.map((c) => {
      const h = c.yuklendi ? Math.max(3, Math.round(c.katilan / kayitli * H)) : 6;
      const cls = !c.yuklendi ? ' kp-none' : (c.hedefAlti ? ' kp-under' : '');
      const etiket = c.yuklendi ? String(c.katilan) : 'yüklenmedi';
      return `<button type="button" class="kp-vbar" data-katilmayan="${c.id}" aria-label="${esc(c.ad)} ${kisaTarih(c.tarih)}: ${c.yuklendi ? `${c.katilan} öğrenci katıldı, katılmayanları göster` : 'sonuç yüklenmedi'}">
        <span class="kp-vbar-n">${esc(etiket)}</span><span class="kp-vbar-col${cls}" style="height:${h}px"></span>
        <span class="kp-vbar-lbl">${esc(c.ad)}<br>${kisaTarih(c.tarih)}</span></button>`;
    }).join('');
    return `<article class="kp-card"><h2>${esc(K.baslik)}</h2>
      <p class="kp-card-sub">Deneme başına katılan öğrenci · kayıtlı ${d.kayitli} · kesikli çizgi = %${fmt(K.hedef, 0)} hedef · çubuğa tıklayınca katılmayanlar açılır</p>
      <div class="kp-vbars-wrap"><div class="kp-vbars-inner">
        <div class="kp-target" style="bottom:${hedefY + 44}px"><span>%${fmt(K.hedef, 0)} hedef</span></div>
        <div class="kp-vbars" style="height:${H + 70}px">${cub}</div></div></div>
      <div class="kp-sr"><table><caption>Katılım</caption><thead><tr><th>Deneme</th><th>Tarih</th><th>Katılan</th><th>Oran</th></tr></thead>
      <tbody>${K.cubuklar.map((c) => `<tr><td>${esc(c.ad)}</td><td>${trTarih(c.tarih)}</td><td>${c.yuklendi ? c.katilan : 'yüklenmedi'}</td><td>${yuzde(c.oran)}</td></tr>`).join('')}</tbody></table></div></article>`;
  }

  function anaCiz(d, hepsi) {
    if (!d.yetki.analiz) {
      // Veri Giriş Admini: yalnız Veri Durumu kartı
      $('#kp-view').innerHTML = `<div class="kp-container">${baslikCiz(d, `${d.seviye || ''}. sınıflar`, sonDenemeMetni(d))}${veriKartiCiz(d)}</div>`;
      filtreBagla();
      return;
    }
    if (!d.sonDeneme && !d.veriDurumu.toplam) {
      $('#kp-view').innerHTML = `<div class="kp-container">${baslikCiz(d, `${d.seviye || ''}. sınıflar`, '')}
        <div class="kp-card kp-state"><h2>Bu dönemde değerlendirilmiş deneme yok</h2><p>Deneme sonuçları yüklendiğinde kokpit kendiliğinden dolar.</p>
        <a class="kp-btn kp-btn-primary" href="${filtreQS({ okul: ST.okulId })}#veri">Veri Durumu</a></div></div>`;
      filtreBagla();
      return;
    }
    if (hepsi) {
      $('#kp-view').innerHTML = `<div class="kp-container">${baslikCiz(d, 'Dikkat gerektirenler', sonDenemeMetni(d), { crumbAd: 'Tüm uyarılar' })}
        ${uyarilarCiz(d, true)}</div>`;
      filtreBagla(); bagla(); return;
    }
    $('#kp-view').innerHTML = `<div class="kp-container">
      ${baslikCiz(d, `${d.seviye}. sınıflar`, sonDenemeMetni(d), { rapor: true })}
      ${kpiCiz(d)}
      <div class="kp-grid-2">${uyarilarCiz(d)}${veriKartiCiz(d)}</div>
      <div class="kp-grid-eq">${dersCiz(d)}${degisimCiz(d)}</div>
      <div id="kp-sube-kart">${subeTabloCiz(d)}</div>
      ${katilimCiz(d)}
      <p class="kp-note">LGS puanı katsayılı yaklaşık hesaptır (Türkçe, Matematik, Fen ×4; diğerleri ×1). Yanıt süresi ${fmt(d.sureMs, 0)} ms.</p>
    </div>`;
    filtreBagla(); bagla();
  }

  function subeKartBagla() {
    const kart = $('#kp-sube-kart');
    if (!kart) return;
    kart.querySelectorAll('[data-sirala]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sirala;
      if (ST.sube.sira === k) ST.sube.yon *= -1; else { ST.sube.sira = k; ST.sube.yon = k === 'sube' ? 1 : -1; }
      kart.innerHTML = subeTabloCiz(ST.veri); subeKartBagla();
      const yeni = kart.querySelector(`[data-sirala="${k}"]`); if (yeni) yeni.focus();
    }));
    kart.querySelectorAll('[data-kolon]').forEach((c) => c.addEventListener('change', () => {
      const k = c.dataset.kolon;
      const L = ST.sube.dersler;
      if (c.checked && !L.includes(k)) L.push(k);
      if (!c.checked) ST.sube.dersler = L.filter((x) => x !== k);
      kart.innerHTML = subeTabloCiz(ST.veri); subeKartBagla();
      const yeni = kart.querySelector(`[data-kolon="${k}"]`); if (yeni) yeni.focus();
    }));
    kart.querySelectorAll('tbody tr[data-sube]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      location.hash = `sube/${encodeURIComponent(tr.dataset.sube)}`;
    }));
  }

  function bagla() {
    const v = $('#kp-view');
    v.querySelectorAll('[data-katilmayan]').forEach((b) => b.addEventListener('click', () => katilmayanlar(b.dataset.katilmayan)));
    v.querySelectorAll('.kp-hbar[data-ders]').forEach((b) => b.addEventListener('click', () => { location.hash = `ders/${b.dataset.ders}`; }));
    v.querySelectorAll('[data-aksiyon]').forEach((b) => b.addEventListener('click', () => {
      const u = ST.veri.uyarilar.find((x) => x.anahtar === b.dataset.aksiyon);
      if (u && typeof window.KokpitAksiyon === 'function') window.KokpitAksiyon(u);
    }));
    subeKartBagla();
  }

  async function katilmayanlar(denemeId) {
    if (!denemeId || denemeId === 'undefined') return;
    modalAc('Katılmayan öğrenciler', '<p>Yükleniyor…</p>');
    try {
      const r = await api(okulYolu(`/katilmayanlar${filtreQS({ deneme: denemeId, seviye: ST.veri.seviye })}`));
      const L = r.ogrenciler;
      $('#kp-modal-title').textContent = `${r.deneme.ad} · ${trTarih(r.deneme.tarih)}`;
      $('#kp-modal-body').innerHTML = `<p>${r.deneme.katilan} / ${r.deneme.kayitli} öğrenci katıldı, <strong>${L.length} öğrenci girmedi</strong>.</p>
        ${L.length ? `<div class="kp-table-wrap"><table class="kp-table"><thead><tr><th>Öğrenci</th><th>No</th><th>Şube</th></tr></thead>
        <tbody>${L.map((o) => `<tr class="kp-plain"><td>${esc(o.ad)}</td><td>${esc(o.numara || '–')}</td><td>${esc(o.sube || '–')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    } catch (e) {
      $('#kp-modal-body').innerHTML = `<p class="kp-info">${esc(e.message)}</p>`;
    }
  }

  // ---------------------------------------------------------- rapor (adım 6)
  function raporIste(format, btn) {
    if (typeof window.KokpitRapor === 'function') window.KokpitRapor(format, btn);
    else toast('Raporlar bir sonraki adımda etkinleşecek.');
  }

  // ---------------------------------------------------------- çizim
  const EKRANLAR = {};
  async function ciz() {
    menuCiz();
    const r = rota();
    if (ST.kapsam === 'veri' && !['ana', 'veri', 'kademe'].includes(r.ad)) { location.hash = 'veri'; return; }
    if (EKRANLAR[r.ad]) {
      if (r.ad === 'ana') { await EKRANLAR.ana(); return; }  // Okul Geneli kendi verisini yükler
      // Detay ekranı doğrudan açıldıysa (paylaşılan bağlantı) uyarı/yetki verisini de yükle
      const anahtar = `${ST.okulId}${filtreQS()}`;
      if (!ST.veri || ST.veriAnahtar !== anahtar) {
        try { ST.veri = await api(okulYolu(filtreQS())); ST.veriAnahtar = anahtar; ST.kapsam = ST.veri.kapsam; } catch (e) { /* ekran kendi hatasını gösterir */ }
      }
      await EKRANLAR[r.ad](r.id); return;
    }
    iskelet();
    try {
      const qs = filtreQS();
      const d = await api(okulYolu(qs));
      ST.veri = d; ST.veriAnahtar = `${ST.okulId}${qs}`;
      ST.kapsam = d.kapsam;
      if (r.ad !== rota().ad) return;  // bu arada ekran değişti
      if (r.ad === 'subeler') {
        $('#kp-view').innerHTML = `<div class="kp-container">${baslikCiz(d, 'Şubeler', sonDenemeMetni(d))}<div id="kp-sube-kart">${subeTabloCiz(d, true)}</div></div>`;
        filtreBagla(); bagla();
      } else {
        anaCiz(d, r.ad === 'uyarilar');
      }
      document.title = `${d.seviye ? d.seviye + '. sınıflar' : 'Kademe'} · ${d.okul.ad}`;
    } catch (e) {
      hataCiz(e);
    }
  }

  async function basla() {
    try {
      const r = await api('/api/kokpit/okullar');
      ST.okullar = r.okullar; ST.kapsam = r.kapsam;
      let id = Number(params().get('okul')) || null;
      if (!id && r.kapsam === 'platform') {
        try { const a = JSON.parse(sessionStorage.getItem('lgs_acting_school') || 'null'); if (a && a.id) id = Number(a.id); } catch (e) { /* yoksay */ }
      }
      if (!id || !r.okullar.some((o) => o.id === id)) id = r.kendiOkulu || (r.okullar[0] && r.okullar[0].id);
      if (!id) {
        $('#kp-view').innerHTML = '<div class="kp-container"><div class="kp-card kp-state"><h2>Okul bulunamadı</h2><p>Hesabınıza bağlı bir okul yok.</p></div></div>';
        return;
      }
      ST.okulId = id;
      if (Number(params().get('okul')) !== id) setParams({ okul: id }, false);
      await ciz();
    } catch (e) {
      if (e.status === 403) {
        $('#kp-view').innerHTML = `<div class="kp-container"><div class="kp-card kp-state"><h2>Erişim yok</h2><p>${esc(e.message)}</p><a class="kp-btn" href="/">Ana sayfaya dön</a></div></div>`;
      } else hataCiz(e);
    }
  }

  window.addEventListener('hashchange', () => { ciz(); const m = $('#kp-main'); if (m) m.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  window.addEventListener('popstate', ciz);
  $('#kp-modal-close').addEventListener('click', modalKapat);
  $('#kp-modal').addEventListener('click', (e) => { if (e.target.id === 'kp-modal') modalKapat(); });

  // Diğer modüller (detay ekranları, aksiyonlar, raporlar) için ortak yardımcılar
  window.Kokpit = {
    ST, api, okulYolu, filtreQS, esc, fmt, isaretli, yuzde, trTarih, kisaTarih, dersAd, kisaAd, DERS_AD, DERS_KISA,
    toast, modalAc, modalKapat, baslikCiz, filtreBagla, sonDenemeMetni, iskelet, hataCiz, ciz, EKRANLAR, setParams, params,
    bagla, menuCiz, turAd, kademeCrumb,
  };
  document.addEventListener('DOMContentLoaded', basla);
  if (document.readyState !== 'loading') basla();
})();
