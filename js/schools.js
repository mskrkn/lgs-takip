// ============================================
// LGS Deneme Takip - Süper Admin: Okul (Organization) Yönetimi
// Faz 1: sadece okul listeleme + yeni okul (+ ilk yönetici hesabı) oluşturma.
// Her okulun admini kendi tarayıcısından bugünküyle birebir aynı şekilde
// çalışır (bkz. js/adminUsers.js) - burası sadece o hesapları açan panel.
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

    container.innerHTML = `
      <div class="card" style="border:1px solid rgba(20,184,166,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🏫</span> Okullar</h3>
        </div>
        ${this._renderSchoolsTable(schools)}
      </div>

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
      </tr>`;
    schools.forEach(s => {
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${_schoolsEscapeHtml(s.name)}<br><span style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml(s.slug)}</span></td>
        <td style="padding:8px">${s.studentCount}</td>
        <td style="padding:8px">${s.adminCount}</td>
        <td style="padding:8px">${s.status === 'active' ? '<span style="color:#4ade80">● Aktif</span>' : s.status}</td>
        <td style="padding:8px">${(s.createdAt || '').slice(0, 10)}</td>
      </tr>`;
    });
    html += '</table></div>';
    return html;
  },

  async createSchool() {
    const name = document.getElementById('new-school-name').value.trim();
    const email = document.getElementById('new-school-email').value.trim();
    const phone = document.getElementById('new-school-phone').value.trim();
    const address = document.getElementById('new-school-address').value.trim();
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
          name, email, phone, address,
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
