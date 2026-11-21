// ============================================================
// Bildirimler (öğretmen / veli) - Okul Kokpiti'nden gelen panel içi
// bildirimler ve öğretmenin taslak ödev önerileri. Taslak, mevcut ödev
// sisteminin kendi ucuyla (POST /api/teacher/assignments) yayınlanır;
// kokpit öğrenciye doğrudan ödev göndermez.
// ============================================================
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tarih = (s) => (s || '').replace('T', ' ').slice(0, 16);
  let toastT = null;
  function toast(m) { const t = $('#kp-toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4500); }

  async function api(yol, sec) {
    const r = await fetch(yol, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, sec || {}));
    if (r.status === 401) { location.href = '/login.html'; throw new Error('Oturum kapandı.'); }
    let b = null; try { b = await r.json(); } catch (e) { b = null; }
    if (!r.ok) throw new Error((b && b.error) || `Sunucu hatası (${r.status})`);
    return b;
  }

  async function liste() {
    const r = await api('/api/bildirimler');
    const geri = { teacher: '/ogretmen.html', parent: '/veli.html', student: '/ogrenci.html' }[r.rol] || '/';
    $('#bd-geri').href = geri;
    $('#bd-liste').innerHTML = r.bildirimler.length ? `<ul class="kp-alerts">${r.bildirimler.map((b) => `
      <li class="kp-alert" data-id="${b.id}"><span class="kp-alert-dot" aria-hidden="true" style="${b.okundu ? 'background:#CBD5E1' : ''}"></span>
        <div><h3>${esc(b.baslik)}${b.okundu ? '' : ' <span class="kp-tag">yeni</span>'}</h3><p style="white-space:pre-line">${esc(b.metin)}</p><p><small>${esc(tarih(b.tarih))}</small></p></div>
        <div class="kp-alert-actions">${b.link ? `<a class="kp-btn kp-btn-sm" href="${esc(b.link)}" data-okundu="${b.id}">Aç</a>` : ''}
        ${b.okundu ? '' : `<button type="button" class="kp-btn kp-btn-sm" data-okundu="${b.id}">Okundu</button>`}</div></li>`).join('')}</ul>`
      : '<p class="kp-empty">Bildiriminiz yok.</p>';
    document.querySelectorAll('[data-okundu]').forEach((el) => el.addEventListener('click', async (e) => {
      const href = el.getAttribute('href');
      if (href) e.preventDefault();
      try { await api(`/api/bildirimler/${el.dataset.okundu}/okundu`, { method: 'POST' }); } catch (err) { /* yoksay */ }
      if (href) location.href = href; else liste();
    }));
    if (r.rol === 'teacher') taslakListesi();
  }

  async function taslakListesi() {
    const r = await api('/api/kokpit/taslaklar');
    if (!r.taslaklar.length) return;
    $('#bd-taslaklar').hidden = false;
    const durum = { taslak: 'Onay bekliyor', yayinlandi: 'Yayınlandı', reddedildi: 'Reddedildi' };
    $('#bd-taslak-liste').innerHTML = `<ul class="kp-data-list">${r.taslaklar.map((t) => `<li class="${t.durum === 'taslak' ? 'kp-warn' : ''}"><div>
      <strong><a href="?taslak=${t.id}">${esc(t.baslik)}</a></strong><span>${esc(durum[t.durum] || t.durum)} · ${esc(tarih(t.tarih))}</span></div></li>`).join('')}</ul>`;
  }

  async function taslak(id) {
    const kut = $('#bd-taslak');
    kut.innerHTML = '<div class="kp-card"><p>Taslak yükleniyor…</p></div>';
    let t;
    try { t = await api(`/api/kokpit/taslaklar/${id}`); } catch (e) { kut.innerHTML = `<div class="kp-card"><p class="kp-info">${esc(e.message)}</p></div>`; return; }
    const islenmis = t.durum !== 'taslak';
    kut.innerHTML = `<article class="kp-card"><h2>${esc(t.baslik)}</h2>
      <p class="kp-card-sub">Okul yönetiminin taslak ödev önerisi · ${esc(t.sube)} · ${esc(t.dersAd)} · ${esc(tarih(t.tarih))}</p>
      <p style="white-space:pre-line">${esc(t.aciklama || '')}</p>
      ${t.kazanimlar.length ? `<p><strong>Kazanımlar:</strong> ${t.kazanimlar.map(esc).join('; ')}</p>` : ''}
      ${islenmis ? `<p class="kp-ok">Bu taslak ${t.durum === 'yayinlandi' ? 'yayınlandı' : 'reddedildi'}.</p>` : `
      <form id="bd-form" class="kp-settings" style="margin-top:12px">
        <label class="kp-field">Ödev başlığı<input name="title" value="${esc(t.baslik)}" required></label>
        <label class="kp-field">Son teslim (isteğe bağlı)<input name="dueDate" type="date"></label>
        <label class="kp-field">Atama modu<select name="mode">
          ${t.sorular.length ? `<option value="manual">Önerilen ${t.sorular.length} soru (tüm sınıfa aynı)</option>` : ''}
          <option value="auto"${t.sorular.length ? '' : ' selected'}>Otomatik: dersten ${t.soruSayisi} soru</option>
          <option value="smart">Akıllı: her öğrenciye zayıf becerilerinden ${t.soruSayisi} soru</option></select></label>
      </form>
      ${t.sorular.length ? `<details style="margin-top:10px"><summary>Önerilen sorular (${t.sorular.length})</summary><ul>${t.sorular.map((q) => `<li>${esc(q.kod || '#' + q.id)} ${esc(q.metin || (q.gorsel ? '(görsel soru)' : ''))}</li>`).join('')}</ul></details>` : ''}
      <p class="kp-info">Yayınlayana kadar öğrenciler bu ödevi görmez.</p>
      <div class="kp-modal-actions"><button type="button" class="kp-btn" id="bd-red">Reddet</button>
        <button type="button" class="kp-btn kp-btn-primary" id="bd-yayinla">Onayla ve yayınla</button></div>
      <div id="bd-mesaj" role="status"></div>`}</article>`;
    if (islenmis) return;
    const mesaj = (m) => { $('#bd-mesaj').innerHTML = `<p class="kp-info">${esc(m)}</p>`; };
    $('#bd-red').addEventListener('click', async () => {
      try { await api(`/api/kokpit/taslaklar/${id}/durum`, { method: 'POST', body: JSON.stringify({ durum: 'reddedildi' }) }); toast('Taslak reddedildi.'); taslak(id); taslakListesi(); } catch (e) { mesaj(e.message); }
    });
    $('#bd-yayinla').addEventListener('click', async (ev) => {
      const f = new FormData($('#bd-form'));
      const mode = f.get('mode');
      const govde = { mode, className: t.sube, title: f.get('title'), description: t.aciklama, dueDate: f.get('dueDate') || null };
      if (mode === 'manual') govde.questionIds = t.sorular.map((q) => q.id);
      else { govde.subjectId = t.subjectId; govde.questionCount = t.soruSayisi; }
      ev.target.disabled = true;
      try {
        const r = await api('/api/teacher/assignments', { method: 'POST', body: JSON.stringify(govde) });
        await api(`/api/kokpit/taslaklar/${id}/durum`, { method: 'POST', body: JSON.stringify({ durum: 'yayinlandi', odevId: r.id }) });
        toast('Ödev yayınlandı. Ödevler ekranınızda görünür.');
        taslak(id); taslakListesi();
      } catch (e) { mesaj(e.message); ev.target.disabled = false; }
    });
  }

  const tid = Number(new URLSearchParams(location.search).get('taslak'));
  if (tid) taslak(tid);
  liste().catch((e) => { $('#bd-liste').innerHTML = `<p class="kp-info">${esc(e.message)}</p>`; });
})();
