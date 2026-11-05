// ============================================
// Deneme Yükleme Sihirbazı (Veri Girişi > 🧙 Yayınevi Denemesi)
// ============================================
// Yayınevi denemesinin optik TXT çıktıları + kademe başına kazanım/cevap
// anahtarı Excel'leri -> sunucuda ayrıştırma, puanlama, öğrenci eşleştirme
// (bkz. deneme_sihirbazi.py) -> önizleme (kullanıcı şüpheli satırları
// düzeltir) -> kaydet. Yazılan denemeler sunucunun kayıtlarıdır
// (platform_admin): okulun senkronu onlara dokunmaz, buradan silinebilir.
const DenemeSihirbazi = {
  _preview: null,      // son önizleme yanıtı
  _assign: {},         // satır anahtarı -> öğrenci id | 'skip' | 'new' | 'auto'
  _filter: 'oncelikli',

  _q() {
    return (typeof AdminUsers !== 'undefined' && AdminUsers._schoolQuery) ? AdminUsers._schoolQuery() : '';
  },
  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  render() {
    const today = new Date().toISOString().slice(0, 10);
    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">🧙</span> Yayınevi Denemesi Yükleme Sihirbazı</h3></div>
        <p class="text-muted" style="font-size:13px;line-height:1.6">
          Yayınevinin verdiği <b>optik TXT dosyalarını</b> (tüm sınıflar, sözel ve sayısal birlikte) ve her sınıf için
          <b>kazanım / cevap anahtarı Excel'ini</b> seçin. Sihirbaz her sınıf için ayrı bir deneme oluşturur;
          öğrencileri isim, numara ve sınıfa göre eşleştirir, kademeyi yanlış kodlayanları bulur, B kitapçığını ve
          boş bırakılan kitapçık harfini kendisi çözer. Kaydetmeden önce eşleşmeleri kontrol edersiniz.
          <br><span style="font-size:12px">Desteklenen optik biçimi: 280 karakterlik Mozaik / Datasis TXT çıktısı.</span>
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:10px">
          <div class="form-group"><label class="form-label">Deneme adı</label>
            <input type="text" class="form-input" id="wiz-name" placeholder="Örn: Mozaik Deneme 2"></div>
          <div class="form-group"><label class="form-label">Uygulama tarihi</label>
            <input type="date" class="form-input" id="wiz-date" value="${today}"></div>
          <div class="form-group"><label class="form-label">Optik TXT dosyaları</label>
            <input type="file" class="form-input" id="wiz-txt" accept=".txt,.TXT,.dat" multiple></div>
          <div class="form-group"><label class="form-label">Kazanım / cevap anahtarı (.xlsx)</label>
            <input type="file" class="form-input" id="wiz-keys" accept=".xlsx" multiple></div>
        </div>
        <button type="button" class="btn btn-primary" id="wiz-preview-btn">🔍 Önizle</button>
        <span id="wiz-status" class="text-muted" style="margin-left:10px;font-size:13px"></span>
      </div>
      <div id="wiz-result"></div>
      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">📚</span> Sihirbazla yüklenen denemeler</h3></div>
        <div id="wiz-list"><p class="text-muted">Yükleniyor...</p></div>
      </div>`;
  },

  init() {
    const btn = document.getElementById('wiz-preview-btn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => this.preview());
    const host = document.getElementById('wiz-result');
    host.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-wiz-line]');
      if (sel) { this._assign[sel.dataset.wizLine] = sel.value; this._renderCommitBar(); }
    });
    host.addEventListener('click', (e) => {
      const f = e.target.closest('[data-wiz-filter]');
      if (f) { this._filter = f.dataset.wizFilter; this._renderReview(); return; }
      if (e.target.closest('#wiz-commit-btn')) this.commit();
    });
    document.getElementById('wiz-list').addEventListener('click', (e) => {
      const d = e.target.closest('[data-wiz-delete]');
      if (d) this.deleteExam(Number(d.dataset.wizDelete), d.dataset.name);
    });
    this.loadList();
  },

  async preview() {
    const name = document.getElementById('wiz-name').value.trim();
    const date = document.getElementById('wiz-date').value;
    const txt = document.getElementById('wiz-txt').files;
    const keys = document.getElementById('wiz-keys').files;
    const status = document.getElementById('wiz-status');
    if (!name || !date) { UI.toast('Deneme adını ve tarihini girin.', 'warning'); return; }
    if (!txt.length || !keys.length) { UI.toast('Optik TXT dosyalarını ve kazanım Excel dosyalarını seçin.', 'warning'); return; }
    const fd = new FormData();
    fd.append('name', name); fd.append('date', date);
    [...txt].forEach(f => fd.append('txt', f));
    [...keys].forEach(f => fd.append('keys', f));
    status.textContent = 'Dosyalar okunuyor ve öğrenciler eşleştiriliyor...';
    document.getElementById('wiz-result').innerHTML = '';
    try {
      const res = await fetch(`/api/admin/wizard/preview${this._q()}`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error((d.error || 'Önizleme yapılamadı.') + (d.details ? ' ' + d.details.join(' · ') : ''));
      this._preview = d;
      this._assign = {};
      this._filter = 'oncelikli';
      status.textContent = '';
      this._renderPreview();
    } catch (err) {
      status.textContent = '';
      UI.toast(err.message, 'danger', 9000);
    }
  },

  _renderPreview() {
    const d = this._preview;
    const host = document.getElementById('wiz-result');
    const sc = d.statusCounts || {};
    const exists = d.grades.filter(g => g.exists);
    host.innerHTML = `
      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">📋</span> Önizleme</h3></div>
        <p style="font-size:13px">${d.lineCount} optik satırı okundu → <b>${d.studentCount} öğrenci</b> sonucu.
          Kesin eşleşen satır: <b>${sc['isim+numara'] || 0}</b> · sadece isimle: ${sc['isim'] || 0} · sadece numarayla: ${sc['numara'] || 0}
          · <span style="color:var(--warning-light)">eşleşmeyen: ${sc['eslesmedi'] || 0}</span>
          ${d.rejectedCount ? ` · <span style="color:var(--danger-light)">okunamayan satır: ${d.rejectedCount}</span>` : ''}</p>
        ${(d.errors || []).concat(d.warnings || []).map(m => `<div style="font-size:12px;color:var(--warning-light)">⚠️ ${this._esc(m)}</div>`).join('')}
        ${exists.length ? `<div style="font-size:13px;color:var(--danger-light);margin:6px 0">⛔ Bu adla deneme zaten var: ${exists.map(g => this._esc(g.examName)).join(', ')} - farklı bir ad verip yeniden önizleyin.</div>` : ''}
        <div class="table-wrapper"><table>
          <thead><tr><th>Sınıf</th><th>Oluşacak deneme</th><th>Soru (Tür/Sos/Din/İng/Mat/Fen)</th><th style="text-align:center">Öğrenci</th><th style="text-align:center">Ort. net</th><th style="text-align:center">B sırası</th></tr></thead>
          <tbody>${d.grades.map(g => `<tr>
            <td><b>${g.grade}. sınıf</b></td><td>${this._esc(g.examName)}</td>
            <td class="font-mono">${['turkce', 'inkilap', 'din', 'ingilizce', 'matematik', 'fen'].map(k => g.questionCounts[k] || '-').join(' / ')}</td>
            <td style="text-align:center">${g.students} / ${g.rosterCount}</td>
            <td style="text-align:center">${g.avgNet == null ? '-' : g.avgNet.toLocaleString('tr-TR')}</td>
            <td style="text-align:center">${g.bOrder ? '✓' : '<span title="B kitapçıklı öğrencilerin soru bazlı analizi yapılamaz" style="color:var(--warning-light)">yok</span>'}</td></tr>`).join('')}
          </tbody></table></div>
      </div>
      <div class="card mt-2" id="wiz-review"></div>
      <div class="card mt-2" id="wiz-commit"></div>`;
    this._renderReview();
    this._renderCommitBar();
  },

  _reviewRows() {
    const rows = this._preview.review || [];
    const f = this._filter;
    const has = (r, s) => r.reasons.some(x => x.includes(s));
    if (f === 'eslesmedi') return rows.filter(r => r.status === 'eslesmedi');
    if (f === 'kademe') return rows.filter(r => has(r, 'kademe'));
    if (f === 'kismi') return rows.filter(r => r.status === 'isim' || r.status === 'numara');
    if (f === 'diger') return rows.filter(r => has(r, 'kopya') || has(r, 'ikinci kağıt') || has(r, 'kitapçık'));
    if (f === 'oncelikli') return rows.filter(r => r.status === 'eslesmedi' || has(r, 'kademe') || has(r, 'ikinci kağıt') || r.status === 'numara');
    return rows;
  },

  _renderReview() {
    const box = document.getElementById('wiz-review');
    if (!box) return;
    const all = this._preview.review || [];
    const rows = this._reviewRows();
    const count = (f) => { const keep = this._filter; this._filter = f; const n = this._reviewRows().length; this._filter = keep; return n; };
    const pill = (f, label) => `<button type="button" class="filter-pill ${this._filter === f ? 'active' : ''}" data-wiz-filter="${f}">${label} (${count(f)})</button>`;
    const optFor = (r) => {
      const cur = this._assign[r.key] || 'auto';
      const autoLabel = r.status === 'eslesmedi' ? 'Atla (eklenmesin)' : `Otomatik: ${r.targetLabel || '?'}`;
      const opts = [`<option value="auto" ${cur === 'auto' ? 'selected' : ''}>${this._esc(autoLabel)}</option>`];
      (r.candidates || []).forEach(c => opts.push(`<option value="${c.id}" ${String(cur) === String(c.id) ? 'selected' : ''}>${this._esc(c.label)} · benzerlik %${Math.round(c.nameScore * 100)}</option>`));
      if (r.status !== 'eslesmedi') opts.push(`<option value="skip" ${cur === 'skip' ? 'selected' : ''}>Atla (bu satır eklenmesin)</option>`);
      opts.push(`<option value="new" ${cur === 'new' ? 'selected' : ''}>Yeni öğrenci olarak ekle</option>`);
      return `<select class="form-input" data-wiz-line="${this._esc(r.key)}" style="min-width:260px;font-size:12px;padding:4px 6px">${opts.join('')}</select>`;
    };
    box.innerHTML = `
      <div class="card-header" style="flex-wrap:wrap;gap:8px"><h3 class="card-title"><span class="card-icon">🔎</span> Kontrol edilmesi gereken satırlar</h3></div>
      <p class="text-muted" style="font-size:12px">Kesin eşleşenler (isim + numara aynı sınıfta) listelenmez. Satır bazında doğru öğrenciyi seçebilir,
        satırı atlayabilir ya da listede olmayan bir öğrenci için yeni kayıt açabilirsiniz. Aynı öğrenciye ait iki satır (sözel + sayısal) aynı öğrenciye atanırsa birleşir.</p>
      <div class="sn-sort" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${pill('oncelikli', 'Öncelikli')}${pill('eslesmedi', 'Eşleşmeyen')}${pill('kademe', 'Farklı kademe')}${pill('kismi', 'Sadece isim/numara')}${pill('diger', 'Kopya / kitapçık')}${pill('tumu', 'Tümü')}
      </div>
      ${rows.length ? `<div class="table-wrapper"><table>
        <thead><tr><th>Dosya</th><th>Optikte</th><th>Durum</th><th>Atanacak öğrenci</th><th style="text-align:right">Net</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="font-size:12px;white-space:nowrap">${this._esc(r.file)}:${r.line}<br><span class="text-muted">${r.kind === 'soz' ? 'sözel' : r.kind === 'say' ? 'sayısal' : ''}</span></td>
          <td style="font-size:12px"><b>${this._esc(r.name || '(isim yok)')}</b><br><span class="text-muted">no ${this._esc(r.num || '-')} · ${this._esc(r.classOnSheet)} · kitapçık ${this._esc(r.booklet || '?')}</span></td>
          <td style="font-size:12px">${r.reasons.map(x => `<span class="badge ${x.includes('eşleşmedi') ? 'badge-warning' : 'badge-info'}" style="margin:1px">${this._esc(x)}</span>`).join(' ')}</td>
          <td>${optFor(r)}</td>
          <td style="text-align:right;font-size:12px">${r.totalNet == null ? '-' : r.totalNet.toLocaleString('tr-TR')}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="text-muted">Bu filtrede satır yok.${all.length ? '' : ' Tüm satırlar kesin eşleşti. 🎉'}</p>`}`;
  },

  _renderCommitBar() {
    const box = document.getElementById('wiz-commit');
    if (!box || !this._preview) return;
    const d = this._preview;
    const changed = Object.values(this._assign).filter(v => v && v !== 'auto').length;
    const blocked = d.grades.some(g => g.exists);
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="wiz-commit-btn" ${blocked ? 'disabled' : ''}>💾 Kaydet: ${d.grades.length} deneme</button>
        <span class="text-muted" style="font-size:13px">${changed ? `${changed} satırda elle seçim yapıldı. ` : ''}Kaydetmeden önce veritabanının yedeği alınır.</span>
      </div>`;
  },

  async commit() {
    if (!this._preview) return;
    const ok = await UI.confirm(`${this._preview.grades.length} deneme ve yaklaşık ${this._preview.studentCount} öğrenci sonucu kaydedilecek. Devam edilsin mi?`, 'Denemeyi kaydet');
    if (!ok) return;
    const btn = document.getElementById('wiz-commit-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/wizard/commit${this._q()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this._preview.token, assignments: this._assign }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Kaydedilemedi.');
      const c = d.created;
      UI.toast(`Kaydedildi: ${Object.keys(c.exams).length} deneme, ${c.results} sonuç${c.newStudents ? `, ${c.newStudents} yeni öğrenci` : ''}.`, 'success', 8000);
      document.getElementById('wiz-result').innerHTML = `<div class="card mt-2"><p>✅ ${Object.values(c.exams).map(e => `${this._esc(e.name)} (${e.results} sonuç)`).join('<br>✅ ')}</p></div>`;
      this._preview = null;
      // Yeni kayıtlar yerel ekranlara gelsin (platform kayıtları - bkz. db.syncPlatformAdminData)
      try {
        const pa = await fetch(`/api/teacher/platform-admin-data${this._q()}`);
        if (pa.ok && typeof db !== 'undefined' && db.syncPlatformAdminData && !(typeof App !== 'undefined' && App.actingSchool)) await db.syncPlatformAdminData(await pa.json());
      } catch (e) { /* bir sonraki açılışta gelir */ }
      this.loadList();
    } catch (err) {
      UI.toast(err.message, 'danger', 9000);
      if (btn) btn.disabled = false;
    }
  },

  async loadList() {
    const box = document.getElementById('wiz-list');
    if (!box) return;
    try {
      const res = await fetch(`/api/admin/wizard/exams${this._q()}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '');
      box.innerHTML = d.exams.length ? `<div class="table-wrapper"><table>
        <thead><tr><th>Deneme</th><th>Tarih</th><th style="text-align:center">Sonuç</th><th></th></tr></thead>
        <tbody>${d.exams.map(e => `<tr><td>${this._esc(e.name)}</td><td>${this._esc(e.date)}</td><td style="text-align:center">${e.results}</td>
          <td style="text-align:right"><button type="button" class="btn btn-danger btn-sm" data-wiz-delete="${e.id}" data-name="${this._esc(e.name)}">🗑️ Sil</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="text-muted">Henüz sihirbazla yüklenmiş deneme yok.</p>';
    } catch (err) {
      box.innerHTML = '<p class="text-muted">Liste alınamadı.</p>';
    }
  },

  async deleteExam(id, name) {
    const ok = await UI.confirm(`"${this._esc(name)}" denemesi ve TÜM sonuçları silinecek. Emin misiniz?`, 'Denemeyi sil');
    if (!ok) return;
    const res = await fetch(`/api/teacher/exams/${id}${this._q()}`, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { UI.toast(d.error || 'Silinemedi.', 'danger'); return; }
    UI.toast('Deneme silindi.', 'success');
    try {
      const pa = await fetch(`/api/teacher/platform-admin-data${this._q()}`);
      if (pa.ok && typeof db !== 'undefined' && db.syncPlatformAdminData && !(typeof App !== 'undefined' && App.actingSchool)) await db.syncPlatformAdminData(await pa.json());
    } catch (e) { /* sonraki açılışta */ }
    this.loadList();
  },
};
