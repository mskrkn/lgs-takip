// ============================================
// LGS Deneme Takip - Süper Admin: Okul (Organization) Yönetimi
// Okul listeleme, yeni okul (+ ilk yönetici hesabı) oluşturma, mevcut bir
// okulun ad/iletişim bilgilerini düzenleme ve aktif/pasif (soft archive)
// yapma. Her okulun admini kendi tarayıcısından bugünküyle birebir aynı
// şekilde çalışır (bkz. js/adminUsers.js) - burası sadece o hesapları açan
// panel + organizations tablosunun kendi metadata/durum yönetimi.
// ============================================

// js/adminUsers.js (bu dosyanin komsusu) kullanici verisini escape'lemeden
// basiyor - onunla ayni riski tekrarlamamak icin burada kendi kucuk
// yardimcimizi tutuyoruz (global bir escapeHtml sadece ogrenci/ogretmen
// panellerinde tanimli, admin kabugunda yuklu degil).
function _schoolsEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const Schools = {

  async render() {
    const container = document.getElementById('page-schools');
    if (!container) return;

    container.innerHTML = `<p class="text-muted">Yükleniyor...</p>`;

    let schools = [];
    try {
      const res = await fetch('/api/superadmin/organizations');
      if (!res.ok) throw new Error((await res.json()).error || 'Okullar yüklenemedi.');
      schools = await res.json();
    } catch (err) {
      container.innerHTML = `<p class="text-muted">❌ ${err.message}</p>`;
      return;
    }
    this._schools = schools; // Duzenle formunun mevcut degerlerle doldurulmasi icin

    container.innerHTML = `
      <div class="card" style="border:1px solid rgba(20,184,166,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🏫</span> Okullar</h3>
        </div>
        ${this._renderSchoolsTable(schools)}
      </div>

      <div class="card mt-2" id="edit-school-card" style="display:none"></div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">➕</span> Yeni Okul Ekle</h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
          <div>
            <label class="form-label">Okul Adı</label>
            <input type="text" id="new-school-name" class="form-control" placeholder="Örn: Atatürk Ortaokulu">
          </div>
          <div>
            <label class="form-label">E-posta (opsiyonel)</label>
            <input type="text" id="new-school-email" class="form-control" placeholder="okul@ornek.com">
          </div>
          <div>
            <label class="form-label">Telefon (opsiyonel)</label>
            <input type="text" id="new-school-phone" class="form-control" placeholder="0xxx xxx xx xx">
          </div>
          <div>
            <label class="form-label">Adres (opsiyonel)</label>
            <input type="text" id="new-school-address" class="form-control" placeholder="Adres">
          </div>
          <div>
            <label class="form-label">Kullanıcı Limiti (opsiyonel)</label>
            <input type="number" min="1" id="new-school-limit" class="form-control" placeholder="Boş = sınırsız">
          </div>
          <div>
            <label class="form-label">Trial Bitiş Tarihi (opsiyonel)</label>
            <input type="date" id="new-school-trial-end" class="form-control">
          </div>
        </div>
        <p class="text-muted mt-2" style="font-size:13px">İlk Yönetici Hesabı</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
          <div>
            <label class="form-label">Görünen İsim</label>
            <input type="text" id="new-school-admin-displayname" class="form-control" placeholder="Örn: Okul Yöneticisi">
          </div>
          <div>
            <label class="form-label">Kullanıcı Adı</label>
            <input type="text" id="new-school-admin-username" class="form-control" placeholder="Örn: atakurt.admin">
          </div>
          <div>
            <label class="form-label">Şifre</label>
            <input type="text" id="new-school-admin-password" class="form-control" placeholder="En az 4 karakter">
          </div>
        </div>
        <button class="btn btn-primary mt-2" onclick="Schools.createSchool()">Okulu Oluştur</button>
        <div id="new-school-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
      </div>
    `;
  },

  _renderSchoolsTable(schools) {
    if (!schools.length) return '<p class="text-muted">Henüz okul oluşturulmadı.</p>';
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Okul</th><th style="padding:8px">Öğrenci</th>
        <th style="padding:8px">Yönetici</th><th style="padding:8px">Durum</th><th style="padding:8px">Oluşturulma</th>
        <th style="padding:8px"></th>
      </tr>`;
    schools.forEach(s => {
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${_schoolsEscapeHtml(s.name)}<br><span style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml(s.slug)}</span></td>
        <td style="padding:8px">${this._studentCountCell(s)}</td>
        <td style="padding:8px">${s.adminCount}</td>
        <td style="padding:8px">${this._statusCell(s)}</td>
        <td style="padding:8px">${(s.createdAt || '').slice(0, 10)}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-sm" data-school-id="${s.id}" data-school-name="${_schoolsEscapeHtml(s.name).replace(/"/g, '&quot;')}" onclick="Schools.enterSchool(this)">🚪 Okula Gir</button>
          <button class="btn btn-secondary btn-sm" onclick="Schools.editSchool(${s.id})">✏️ Düzenle</button>
          <button class="btn btn-secondary btn-sm" onclick="Schools.toggleStatus(${s.id})">${s.status === 'inactive' ? '▶️ Aktifleştir' : '⏸️ Pasifleştir'}</button>
          <button class="btn btn-secondary btn-sm" onclick="Schools.promptExtendTrial(${s.id})">⏳ Trial Ayarla</button>
        </td>
      </tr>`;
    });
    html += '</table></div>';
    return html;
  },

  // %80'e kadar noral, %80-95 sari, %95+ kirmizi (bkz. admin-panel-prompt.md
  // bolum 3 "limite %80-90 yaklastiginda uyari rengi").
  _limitColor(count, limit) {
    if (!limit) return 'var(--text-primary)';
    const ratio = count / limit;
    if (ratio >= 0.95) return '#fb7185';
    if (ratio >= 0.8) return '#fbbf24';
    return 'var(--text-primary)';
  },

  _studentCountCell(s) {
    if (!s.userLimit) return `${s.studentCount}`;
    return `<span style="color:${this._limitColor(s.studentCount, s.userLimit)}">${s.studentCount} / ${s.userLimit}</span>`;
  },

  _statusCell(s) {
    if (s.status === 'trial') {
      const daysLeft = s.trialEndsAt ? Math.ceil((new Date(s.trialEndsAt) - new Date()) / 86400000) : null;
      const label = daysLeft != null ? `${daysLeft >= 0 ? daysLeft : 0} gün kaldı` : '';
      return `<span style="color:#60a5fa">● Trial</span>${label ? `<br><span style="color:var(--text-muted);font-size:11px">${label}</span>` : ''}`;
    }
    if (s.status === 'active') return '<span style="color:#4ade80">● Aktif</span>';
    return '<span style="color:#fb7185">● Pasif</span>';
  },

  promptExtendTrial(schoolId) {
    const school = (this._schools || []).find(s => s.id === schoolId);
    if (!school) return;
    const current = school.trialEndsAt ? school.trialEndsAt.slice(0, 10) : '';
    const input = prompt(
      `"${school.name}" için trial bitiş tarihi (YYYY-AA-GG). Bugünden ileri bir tarih girin - okul Trial durumuna geçer/trial süresi uzar.`,
      current
    );
    if (!input) return;
    const trialEndsAt = `${input.trim()}T23:59:59`;
    this.extendTrial(schoolId, trialEndsAt);
  },

  async extendTrial(schoolId, trialEndsAt) {
    try {
      const res = await fetch(`/api/superadmin/organizations/${schoolId}/extend-trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trialEndsAt }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'İşlem başarısız.');
      UI.toast('Trial süresi güncellendi.', 'success');
      await this.render();
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  // Bu okulu super_admin adina "acar": Kullanicilar (hesap yonetimi,
  // js/adminUsers.js) VE Ogrenciler/Denemeler (salt okunur, sunucu
  // uzerinden - js/schoolView.js) sayfalari gorunur hale gelir. Ogrenci/
  // deneme EKLEME/DUZENLEME/SILME hala YOK - o hala o okulun kendi
  // tarayicisindaki yerel (IndexedDB) veri, super_admin'in tarayicisinda
  // o veri hic yok. data-* attribute'lardan okunuyor (JS string olarak
  // gomulseydi okul adindaki bir tirnak isareti HTML'i bozardi).
  enterSchool(btn) {
    const schoolId = Number(btn.dataset.schoolId);
    // Platform sahibi admin kendi okuluna "girerse" (Okullar listesinde
    // kendi okulu da gorunur) - salt-okunur SchoolView yerine normal (tam
    // yetkili) admin paneline dondur, actingSchool'i set ETME.
    if (App.currentUser?.organizationId && schoolId === App.currentUser.organizationId) {
      App.actingSchool = null;
      UI.toast('Bu zaten sizin okulunuz - normal panelden yönetebilirsiniz.', 'info');
      App.navigateTo('dashboard');
      return;
    }
    App.actingSchool = { id: schoolId, name: btn.dataset.schoolName };
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.style.display = ['users', 'students', 'exams'].includes(item.dataset.page) ? '' : 'none';
    });
    App.navigateTo('users');
  },

  editSchool(schoolId) {
    const school = (this._schools || []).find(s => s.id === schoolId);
    if (!school) return;
    const card = document.getElementById('edit-school-card');
    card.style.display = '';
    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title"><span class="card-icon">✏️</span> "${_schoolsEscapeHtml(school.name)}" Okulunu Düzenle</h3>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
        <div>
          <label class="form-label">Okul Adı</label>
          <input type="text" id="edit-school-name" class="form-control" value="${_schoolsEscapeHtml(school.name)}">
        </div>
        <div>
          <label class="form-label">E-posta (opsiyonel)</label>
          <input type="text" id="edit-school-email" class="form-control" value="${_schoolsEscapeHtml(school.email || '')}">
        </div>
        <div>
          <label class="form-label">Telefon (opsiyonel)</label>
          <input type="text" id="edit-school-phone" class="form-control" value="${_schoolsEscapeHtml(school.phone || '')}">
        </div>
        <div>
          <label class="form-label">Adres (opsiyonel)</label>
          <input type="text" id="edit-school-address" class="form-control" value="${_schoolsEscapeHtml(school.address || '')}">
        </div>
        <div>
          <label class="form-label">Kullanıcı Limiti (opsiyonel)</label>
          <input type="number" min="1" id="edit-school-limit" class="form-control" value="${school.userLimit != null ? school.userLimit : ''}" placeholder="Boş = sınırsız">
        </div>
      </div>
      <div class="mt-2">
        <button class="btn btn-primary" onclick="Schools.saveSchoolEdit(${school.id})">Kaydet</button>
        <button class="btn btn-secondary" onclick="Schools.cancelSchoolEdit()">İptal</button>
      </div>
      <div id="edit-school-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
    `;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  cancelSchoolEdit() {
    const card = document.getElementById('edit-school-card');
    card.style.display = 'none';
    card.innerHTML = '';
  },

  async saveSchoolEdit(schoolId) {
    const name = document.getElementById('edit-school-name').value.trim();
    const email = document.getElementById('edit-school-email').value.trim();
    const phone = document.getElementById('edit-school-phone').value.trim();
    const address = document.getElementById('edit-school-address').value.trim();
    const userLimit = document.getElementById('edit-school-limit').value.trim() || null;
    const statusEl = document.getElementById('edit-school-status');
    statusEl.textContent = 'Kaydediliyor...';
    try {
      const res = await fetch(`/api/superadmin/organizations/${schoolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, address, userLimit }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Güncellenemedi.');
      UI.toast('Okul bilgileri güncellendi.', 'success');
      await this.render();
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      UI.toast(err.message, 'danger');
    }
  },

  async toggleStatus(schoolId) {
    try {
      const res = await fetch(`/api/superadmin/organizations/${schoolId}/toggle-status`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'İşlem başarısız.');
      UI.toast(result.status === 'active' ? 'Okul aktifleştirildi.' : 'Okul pasifleştirildi - bu okulun kullanıcıları artık giriş yapamaz.', 'info');
      await this.render();
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async createSchool() {
    const name = document.getElementById('new-school-name').value.trim();
    const email = document.getElementById('new-school-email').value.trim();
    const phone = document.getElementById('new-school-phone').value.trim();
    const address = document.getElementById('new-school-address').value.trim();
    const userLimit = document.getElementById('new-school-limit').value.trim() || null;
    const trialEndDate = document.getElementById('new-school-trial-end').value;
    const trialEndsAt = trialEndDate ? `${trialEndDate}T23:59:59` : null;
    const adminDisplayName = document.getElementById('new-school-admin-displayname').value.trim();
    const adminUsername = document.getElementById('new-school-admin-username').value.trim();
    const adminPassword = document.getElementById('new-school-admin-password').value;

    const statusEl = document.getElementById('new-school-status');
    statusEl.textContent = 'Oluşturuluyor...';
    try {
      const res = await fetch('/api/superadmin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone, address, userLimit, trialEndsAt,
          adminDisplayName, adminUsername, adminPassword,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Okul oluşturulamadı.');
      UI.toast(`"${result.organization.name}" okulu ve yöneticisi oluşturuldu.`, 'success');
      await this.render();
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      UI.toast(err.message, 'danger');
    }
  },
};
