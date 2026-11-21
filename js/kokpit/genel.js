// ============================================================
// Okul Geneli - yönetim panelinin açılış sayfası (okul-kokpiti.html#)
// ------------------------------------------------------------
// Okul geneli göstergeler, tüm kademelerden en önemli uyarılar, veri
// kalitesi, her sınıf kademesi için özet kartı ve Öğrenci Bul. Kademe
// kartına tıklayınca o kademenin ayrıntılı ekranı (#kademe?seviye=8) açılır.
// ============================================================
(function () {
  'use strict';
  const K = window.Kokpit;
  if (!K) return;
  const { esc, fmt, isaretli, yuzde, trTarih, api, okulYolu, ST } = K;
  const $ = (s, r) => (r || document).querySelector(s);
  const sayi = (n) => (n == null ? '–' : Number(n).toLocaleString('tr-TR'));

  // Yönetim panelindeki işlemler: /index.html?page=...&islem=... (js/app.js derin bağlantı)
  const HIZLI = [
    ['Öğrenci ekle', '/index.html?page=students&islem=ogrenci-ekle'],
    ['Kullanıcı ekle', '/index.html?page=users'],
    ['Yeni deneme', '/index.html?page=exams&islem=deneme-ekle'],
    ['Veri girişi', '/index.html?page=import'],
    ['Soru girişi', '/index.html?page=question-bank'],
    ['Rapor oluştur', '/index.html?page=reports'],
  ];
  K.hizliIslemler = function () {
    if (!(ST.kapsam === 'okul' || ST.kapsam === 'platform')) {
      return '<a class="kp-btn" href="/index.html?page=import">Veri girişi</a>';
    }
    return `<details class="kp-hizli"><summary class="kp-btn kp-btn-accent">Hızlı işlemler</summary>
      <ul role="list">${HIZLI.map(([ad, href]) => `<li><a href="${href}">${esc(ad)}</a></li>`).join('')}</ul></details>`;
  };
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.kp-hizli[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  function kademeLink(sev, hash) {
    const p = new URLSearchParams();
    p.set('okul', ST.okulId);
    p.set('seviye', sev);
    return `?${p.toString()}#${hash || 'kademe'}`;
  }

  function kademeKarti(k, yetki) {
    const baslik = `<div class="kp-kademe-ust"><h3>${esc(k.seviye)}. sınıflar</h3>
      ${k.uyariSayisi ? `<span class="kp-tag kp-tag-uyari">${k.uyariSayisi} uyarı</span>` : ''}</div>
      <p class="kp-card-sub">${sayi(k.kayitli)} öğrenci${k.subeSayisi != null ? ` · ${k.subeSayisi} şube` : ''} · ${k.degerlendirilen} deneme${k.sonDeneme ? ` · son ${trTarih(k.sonDeneme.tarih)}` : ''}</p>`;
    if (!yetki.analiz) {
      return `<a class="kp-card kp-kademe" href="${kademeLink(k.seviye, 'veri')}">${baslik}
        <p class="kp-kademe-satir">${k.veriDurumu.yuklenmemis ? `<span class="kp-badge-bad">${k.veriDurumu.yuklenmemis} deneme yüklenmemiş</span>` : '<span class="kp-badge-ok">Yüklenmemiş deneme yok</span>'}</p></a>`;
    }
    if (!k.degerlendirilen) {
      return `<a class="kp-card kp-kademe" href="${kademeLink(k.seviye)}">${baslik}<p class="kp-empty">Bu yıl değerlendirilmiş deneme yok.</p></a>`;
    }
    const dersler = (k.dersler || []).map((d) => `<span class="kp-mini" title="${esc(d.kisa)} %${Math.round((d.oran || 0) * 100)}">
        <span class="kp-mini-ad">${esc(d.kisa)}</span><span class="kp-mini-bar"><span class="${d.esikAlti ? 'kp-low' : ''}" style="width:${Math.max(0, Math.min(100, (d.oran || 0) * 100))}%"></span></span>
        <span class="kp-mini-v">%${Math.round((d.oran || 0) * 100)}</span></span>`).join('');
    return `<a class="kp-card kp-kademe" href="${kademeLink(k.seviye)}" aria-label="${esc(k.seviye)}. sınıflar ayrıntısını aç">
      ${baslik}
      <div class="kp-kademe-kpi">
        <div><small>Toplam net</small><b>${fmt(k.toplamNet, 1)}<small> / ${fmt(k.soru, 0)}</small></b></div>
        <div><small>${k.lgs ? 'LGS puanı' : 'Başarı'}</small><b>${k.lgs ? fmt(k.puan, 1) : yuzde(k.oran)}</b>
          ${k.lgs && k.puanFark != null ? `<small class="${k.puanFark < 0 ? 'kp-down' : 'kp-up'}">${esc(k.sonraEtiket || '')} ${isaretli(k.puanFark, 1)}</small>` : ''}</div>
        <div><small>Son katılım</small><b>${yuzde(k.katilim)}</b></div>
      </div>
      <div class="kp-mini-liste" aria-label="Ders başarı oranları">${dersler}</div>
      <p class="kp-kademe-satir">${k.enIyiSube ? `En iyi şube <b>${esc(k.enIyiSube.sube)}</b> (${fmt(k.enIyiSube.toplamNet, 1)})` : ''}${k.enZayifSube ? ` · en geride <b>${esc(k.enZayifSube.sube)}</b> (${fmt(k.enZayifSube.toplamNet, 1)})` : ''}</p>
      ${k.kaldirac ? `<p class="kp-kademe-satir">En büyük kaldıraç: <b>${esc(k.kaldirac.ad)}</b> (${yuzde(k.kaldirac.oran)})</p>` : ''}
      <span class="kp-kademe-git">Ayrıntıyı aç →</span></a>`;
  }

  function uyariSatiri(u, yetki) {
    const detay = u.detayLink && u.detayLink.tip === 'sube'
      ? `<a class="kp-btn kp-btn-sm" href="${kademeLink(u.seviye, `sube/${encodeURIComponent(u.detayLink.id)}`)}">Detaya git</a>`
      : `<a class="kp-btn kp-btn-sm" href="${kademeLink(u.seviye)}">Detaya git</a>`;
    const gecmis = u.gecmis ? `<div class="kp-alert-note">Bu uyarı için ${trTarih(u.gecmis.tarih)} tarihinde ${esc(K.turAd(u.gecmis.tur))} gönderildi.</div>` : '';
    const aksiyon = yetki.aksiyon && u.aksiyon.tur !== 'veri_girisi'
      ? `<button type="button" class="kp-btn kp-btn-sm kp-btn-accent" data-genel-aksiyon="${esc(u.anahtar)}">${esc(u.aksiyon.etiket)}</button>` : '';
    return `<li class="kp-alert" data-kod="${esc(u.kod)}"><span class="kp-alert-dot" aria-hidden="true"></span>
      <div><h3><span class="kp-tag">${esc(u.seviye)}. sınıf</span> ${esc(u.baslik)}</h3><p>${esc(u.detay)}</p>${gecmis}</div>
      <div class="kp-alert-actions">${detay}${aksiyon}</div></li>`;
  }

  function veriKalitesiKarti(d) {
    const q = d.veriKalitesi;
    const yuklenmemis = d.kademeler.reduce((a, k) => a + (k.veriDurumu.yuklenmemis || 0), 0);
    const eksik = d.kademeler.reduce((a, k) => a + (k.veriDurumu.eksikSonuc || 0), 0);
    const li = (sinif, baslik, acik) => `<li class="${sinif}"><div><strong>${baslik}</strong><span>${acik}</span></div></li>`;
    return `<article class="kp-card"><h2>Veri durumu</h2><p class="kp-card-sub">Kayıt ve deneme verisinin eksikleri</p>
      <ul class="kp-data-list">
        ${li(yuklenmemis ? 'kp-bad' : '', yuklenmemis ? `${yuklenmemis} deneme yüklenmemiş` : 'Yüklenmemiş deneme yok', 'Kayıtlı ama sonucu girilmemiş denemeler.')}
        ${li(eksik ? 'kp-warn' : '', eksik ? `${eksik} sonuçta ders bilgisi eksik` : 'Eksik sonuç yok', 'Bir dersin doğru/yanlış bilgisi olmayan sonuçlar.')}
        ${li(q.subesiz ? 'kp-warn' : '', q.subesiz ? `${sayi(q.subesiz)} öğrencinin şubesi yok` : 'Şubesiz öğrenci yok', 'Şubesi olmayan öğrenci kademe ve şube analizlerine girmez.')}
        ${li(q.velisiz ? 'kp-warn' : '', `${sayi(q.velisiz)} / ${sayi(q.ogrenci)} öğrencinin bağlı velisi yok`, 'Veli bildirimleri yalnızca hesabı bağlı velilere gider.')}
      </ul>
      <a class="kp-btn kp-btn-sm" href="/index.html?page=import">Veri girişine git</a>
      <a class="kp-btn kp-btn-sm" href="?okul=${ST.okulId}#veri" style="margin-left:6px">Veri Durumu ekranı</a></article>`;
  }

  function ogrenciBulKarti() {
    return `<article class="kp-card"><h2>Öğrenci bul</h2><p class="kp-card-sub">Ad, soyad ya da okul numarasıyla arayın</p>
      <label class="kp-sr" for="kp-ara">Öğrenci ara</label>
      <input id="kp-ara" class="kp-ara" type="search" placeholder="Örn. Ayşe Yılmaz ya da 1234" autocomplete="off">
      <div id="kp-ara-sonuc" aria-live="polite"></div></article>`;
  }

  function aramaBagla() {
    const inp = $('#kp-ara');
    if (!inp) return;
    let t = null;
    let sira = 0;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = inp.value.trim();
        const kut = $('#kp-ara-sonuc');
        if (q.length < 2) { kut.innerHTML = ''; return; }
        const benim = ++sira;
        try {
          const r = await api(okulYolu(`/ogrenci-ara?q=${encodeURIComponent(q)}`));
          if (benim !== sira) return;
          kut.innerHTML = r.ogrenciler.length ? `<ul class="kp-ara-liste">${r.ogrenciler.map((o) => `<li>
              <div><strong>${esc(o.ad)}</strong><span>${esc(o.numara || '–')} · ${esc(o.sube || 'şubesiz')}</span></div>
              <div class="kp-ara-net">${o.denemeSayisi ? `son ${fmt(o.sonNet, 1)} net · ort. ${fmt(o.ortNet, 1)} · ${o.denemeSayisi} deneme` : 'deneme sonucu yok'}</div>
              ${o.seviye && o.sube ? `<a class="kp-btn kp-btn-sm" href="${kademeLink(o.seviye, `sube/${encodeURIComponent(o.sube)}`)}">Şubesi</a>` : ''}</li>`).join('')}</ul>`
            : '<p class="kp-empty">Eşleşen öğrenci yok.</p>';
        } catch (e) { kut.innerHTML = `<p class="kp-info">${esc(e.message)}</p>`; }
      }, 250);
    });
  }

  K.EKRANLAR.ana = async function () {
    K.iskelet();
    let d;
    try { d = await api(okulYolu('/genel')); } catch (e) { K.hataCiz(e); return; }
    ST.kapsam = d.kapsam;
    ST.genel = d;
    K.menuCiz();
    const t = d.toplam;
    const alt = `${sayi(t.ogrenci)} öğrenci · ${t.kademe} kademe · ${sayi(t.sube)} şube · ${t.degerlendirilen} deneme değerlendirildi`
      + (d.sonDeneme ? ` · son deneme ${esc(d.sonDeneme.ad)} (${esc(d.sonDeneme.seviye)}. sınıf, ${trTarih(d.sonDeneme.tarih)})` : '');
    const yetki = d.yetki;
    const uyarilar = yetki.analiz ? `<article class="kp-card"><h2>Dikkat gerektirenler${d.uyarilar.length ? ` <span class="kp-tag">${d.uyarilar.length}</span>` : ''}</h2>
        <p class="kp-card-sub">Tüm kademelerden en önemlileri · her kademenin tam listesi kendi ekranında</p>
        ${d.uyarilar.length ? `<ul class="kp-alerts">${d.uyarilar.slice(0, 6).map((u) => uyariSatiri(u, yetki)).join('')}</ul>` : '<p class="kp-empty">Bu yıl dikkat gerektiren bir durum yok.</p>'}</article>` : '';
    $('#kp-view').innerHTML = `<div class="kp-container">
      <header class="kp-head"><div>
        <p class="kp-eyebrow">${esc(d.okul.ad)} · ${esc(d.egitimYili)}</p>
        <h1>Okul Geneli</h1><p class="kp-sub">${alt}</p></div>
        <div class="kp-filters">${K.hizliIslemler()}</div></header>
      ${d.kademeler.length ? '' : '<div class="kp-card kp-state"><h2>Henüz öğrenci ya da deneme yok</h2><p>Öğrenci ve deneme sonuçları eklendikçe bu sayfa kendiliğinden dolar.</p></div>'}
      <section aria-label="Sınıf kademeleri"><div class="kp-kademeler">${d.kademeler.map((k) => kademeKarti(k, yetki)).join('')}</div></section>
      <div class="kp-grid-2">${uyarilar || ''}${veriKalitesiKarti(d)}</div>
      ${yetki.analiz ? ogrenciBulKarti() : ''}
      ${yetki.analiz ? '<p class="kp-note">LGS puanı katsayılı yaklaşık hesaptır ve yalnızca LGS türü denemelerde gösterilir.</p>' : ''}
    </div>`;
    document.title = `Okul Geneli · ${d.okul.ad}`;
    aramaBagla();
    $('#kp-view').querySelectorAll('[data-genel-aksiyon]').forEach((b) => b.addEventListener('click', () => {
      const u = d.uyarilar.find((x) => x.anahtar === b.dataset.genelAksiyon);
      if (u && typeof window.KokpitAksiyon === 'function') window.KokpitAksiyon(u);
    }));
  };
})();
