// ============================================
// LGS Deneme Takip - Süper Admin: Admin Hesapları Yönetimi
// (admin-panel-prompt.md bölüm 1) Admin Yardımcısı / Okul Admini / Veri
// Girişi Admini hesabı oluşturma, düzenleme, aktif/pasif yapma. Sadece
// admins.manage iznine sahip hesaplara (bkz. App.currentUser.canManageAdmins)
// açık - js/schools.js'in komşusu, aynı desenleri (escape yardımcısı, kart
// düzeni) tekrar kullanır.
// ============================================

const SUB_ROLE_LABELS = {
  ASSISTANT_ADMIN: 'Admin Yardımcısı',
  INSTITUTION_ADMIN: 'Okul Admini',
  DATA_ADMIN: 'Veri Girişi Admini',
  PLATFORM_ADMIN: 'Süper Admin',
};
// PLATFORM_ADMIN (Süper Admin) bilerek dışarıda - bkz. server.py
// ASSIGNABLE_ADMIN_SUBROLES yorumu: platform sahipliği kadar hassas bir
// atama bu ekrandan yapılamaz.
const ASSIGNABLE_SUB_ROLES = ['ASSISTANT_ADMIN', 'INSTITUTION_ADMIN', 'DATA_ADMIN'];

const Admins = {

  async render() {
    const container = document.getElementById('page-admins');
    if (!container) return;

    container.innerHTML = `<p class="text-muted">Yükleniyor...</p>`;

    let admins = [], schools = [];
    try {
      const [adminsRes, schoolsRes] = await Promise.all([
        fetch('/api/superadmin/admins'),
        fetch('/api/superadmin/organizations'),
      ]);
      if (!adminsRes.ok) throw new Error((await adminsRes.json()).error || 'Adminler yüklenemedi.');
      admins = await adminsRes.json();
      schools = schoolsRes.ok ? await schoolsRes.json() : [];
    } catch (err) {
      container.innerHTML = `<p class="text-muted">❌ ${err.message}</p>`;
      return;
    }
    this._admins = admins;
    this._schools = schools;

    container.innerHTML = `
      <div class="card" style="border:1px solid rgba(20,184,166,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🔐</span> Adminler</h3>
        </div>
        ${this._renderAdminsTable(admins)}
      </div>

      <div class="card mt-2" id="edit-admin-card" style="display:none"></div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">➕</span> Yeni Admin Ekle</h3>
        </div>
        ${this._renderAdminForm('new')}
        <button class="btn btn-primary mt-2" onclick="Admins.createAdmin()">Admini Oluştur</button>
        <div id="new-admin-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
      </div>
    `;
    this._wireRoleToggle('new');
  },

  _renderAdminsTable(admins) {
    if (!admins.length) return '<p class="text-muted">Henüz admin oluşturulmadı.</p>';
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Ad Soyad</th><th style="padding:8px">Rol</th>
        <th style="padding:8px">Okul</th><th style="padding:8px">İletişim</th>
        <th style="padding:8px">Durum</th><th style="padding:8px"></th>
      </tr>`;
    admins.forEach(a => {
      const canEdit = ASSIGNABLE_SUB_ROLES.includes(a.subRole);
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${_schoolsEscapeHtml(a.displayName)}${a.isSelf ? ' <span style="color:#2DD4BF;font-size:11px">(Siz)</span>' : ''}<br><span style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml(a.username)}</span></td>
        <td style="padding:8px">${_schoolsEscapeHtml(SUB_ROLE_LABELS[a.subRole] || a.subRole)}</td>
        <td style="padding:8px">${_schoolsEscapeHtml(a.organizationName || '—')}</td>
        <td style="padding:8px">${_schoolsEscapeHtml(a.email || '—')}<br><span style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml(a.phone || '')}</span></td>
        <td style="padding:8px">${a.active ? '<span style="color:#4ade80">● Aktif</span>' : '<span style="color:#fb7185">● Pasif</span>'}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">
          ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="Admins.editAdmin(${a.id})">✏️ Düzenle</button>` : ''}
          ${a.isSelf ? '' : `<button class="btn btn-secondary btn-sm" onclick="Admins.toggleStatus(${a.id})">${a.active ? '⏸️ Pasifleştir' : '▶️ Aktifleştir'}</button>`}
        </td>
      </tr>`;
    });
    html += '</table></div>';
    return html;
  },

  _schoolOptions(selectedId) {
    return (this._schools || []).map(s =>
      `<option value="${s.id}" ${Number(selectedId) === s.id ? 'selected' : ''}>${_schoolsEscapeHtml(s.name)}</option>`
    ).join('');
  },

  _renderAdminForm(prefix, admin) {
    const subRole = admin?.subRole && ASSIGNABLE_SUB_ROLES.includes(admin.subRole) ? admin.subRole : 'INSTITUTION_ADMIN';
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
        <div>
          <label class="form-label">Ad Soyad</label>
          <input type="text" id="${prefix}-admin-displayname" class="form-control" value="${_schoolsEscapeHtml(admin?.displayName || '')}" placeholder="Örn: Ayşe Yılmaz">
        </div>
        <div>
          <label class="form-label">E-posta (opsiyonel)</label>
          <input type="text" id="${prefix}-admin-email" class="form-control" value="${_schoolsEscapeHtml(admin?.email || '')}" placeholder="ayse@ornek.com">
        </div>
        <div>
          <label class="form-label">Telefon (opsiyonel)</label>
          <input type="text" id="${prefix}-admin-phone" class="form-control" value="${_schoolsEscapeHtml(admin?.phone || '')}" placeholder="0xxx xxx xx xx">
        </div>
        <div>
          <label class="form-label">Rol</label>
          <select id="${prefix}-admin-subrole" class="form-control" onchange="Admins._onRoleChange('${prefix}')">
            <option value="ASSISTANT_ADMIN" ${subRole === 'ASSISTANT_ADMIN' ? 'selected' : ''}>Admin Yardımcısı</option>
            <option value="INSTITUTION_ADMIN" ${subRole === 'INSTITUTION_ADMIN' ? 'selected' : ''}>Okul Admini</option>
            <option value="DATA_ADMIN" ${subRole === 'DATA_ADMIN' ? 'selected' : ''}>Veri Girişi Admini</option>
          </select>
        </div>
        <div id="${prefix}-admin-school-wrap" style="${subRole === 'ASSISTANT_ADMIN' ? 'display:none' : ''}">
          <label class="form-label">Okul</label>
          <select id="${prefix}-admin-school" class="form-control">
            <option value="">— Okul seçin —</option>
            ${this._schoolOptions(admin?.organizationId)}
          </select>
        </div>
        ${admin ? '' : `
        <div>
          <label class="form-label">Kullanıcı Adı</label>
          <input type="text" id="${prefix}-admin-username" class="form-control" placeholder="Örn: ayse.yardimci">
        </div>
        <div>
          <label class="form-label">Şifre</label>
          <input type="text" id="${prefix}-admin-password" class="form-control" placeholder="En az 4 karakter">
        </div>`}
      </div>
    `;
  },

  _wireRoleToggle(prefix) {
    this._onRoleChange(prefix);
  },

  _onRoleChange(prefix) {
    const subRole = document.getElementById(`${prefix}-admin-subrole`)?.value;
    const wrap = document.getElementById(`${prefix}-admin-school-wrap`);
    if (wrap) wrap.style.display = subRole === 'ASSISTANT_ADMIN' ? 'none' : '';
  },

  async createAdmin() {
    const displayName = document.getElementById('new-admin-displayname').value.trim();
    const email = document.getElementById('new-admin-email').value.trim();
    const phone = document.getElementById('new-admin-phone').value.trim();
    const subRole = document.getElementById('new-admin-subrole').value;
    const organizationId = document.getElementById('new-admin-school').value || null;
    const username = document.getElementById('new-admin-username').value.trim();
    const password = document.getElementById('new-admin-password').value;

    const statusEl = document.getElementById('new-admin-status');
    statusEl.textContent = 'Oluşturuluyor...';
    try {
      const res = await fetch('/api/superadmin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, phone, subRole, organizationId, username, password }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Admin oluşturulamadı.');
      UI.toast(`"${displayName}" admin olarak eklendi.`, 'success');
      await this.render();
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      UI.toast(err.message, 'danger');
    }
  },

  editAdmin(adminId) {
    const admin = (this._admins || []).find(a => a.id === adminId);
    if (!admin) return;
    const card = document.getElementById('edit-admin-card');
    card.style.display = '';
    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title"><span class="card-icon">✏️</span> "${_schoolsEscapeHtml(admin.displayName)}" Adminini Düzenle</h3>
      </div>
      ${this._renderAdminForm('edit', admin)}
      <div class="mt-2">
        <button class="btn btn-primary" onclick="Admins.saveAdminEdit(${admin.id})">Kaydet</button>
        <button class="btn btn-secondary" onclick="Admins.cancelAdminEdit()">İptal</button>
      </div>
      <div id="edit-admin-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
    `;
    this._wireRoleToggle('edit');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  cancelAdminEdit() {
    const card = document.getElementById('edit-admin-card');
    card.style.display = 'none';
    card.innerHTML = '';
  },

  async saveAdminEdit(adminId) {
    const displayName = document.getElementById('edit-admin-displayname').value.trim();
    const email = document.getElementById('edit-admin-email').value.trim();
    const phone = document.getElementById('edit-admin-phone').value.trim();
    const subRole = document.getElementById('edit-admin-subrole').value;
    const organizationId = document.getElementById('edit-admin-school').value || null;

    const statusEl = document.getElementById('edit-admin-status');
    statusEl.textContent = 'Kaydediliyor...';
    try {
      const res = await fetch(`/api/superadmin/admins/${adminId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, phone, subRole, organizationId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Güncellenemedi.');
      UI.toast('Admin bilgileri güncellendi.', 'success');
      await this.render();
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      UI.toast(err.message, 'danger');
    }
  },

  async toggleStatus(adminId) {
    try {
      const res = await fetch(`/api/superadmin/admins/${adminId}/toggle-status`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'İşlem başarısız.');
      UI.toast(result.active ? 'Admin aktifleştirildi.' : 'Admin pasifleştirildi - artık giriş yapamaz.', 'info');
      await this.render();
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },
};
