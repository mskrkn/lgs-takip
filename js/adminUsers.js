// ============================================
// LGS Deneme Takip - Yetkilendirme Yönetimi (Admin)
// Öğretmen / Veli hesapları oluşturma ve sunucuya veri gönderme
// ============================================

const AdminUsers = {

  async render() {
    const container = document.getElementById('page-users');
    if (!container) return;

    container.innerHTML = `<p class="text-muted">Yükleniyor...</p>`;

    const [users, students] = await Promise.all([
      fetch('/api/admin/users').then(r => r.json()),
      fetch('/api/admin/students').then(r => r.json()),
    ]);

    this._students = students;
    const classNames = [...new Set(students.map(s => s.class_name).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="card" style="border:1px solid rgba(20,184,166,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">☁️</span> Sunucuya Veri Gönder</h3>
        </div>
        <p class="text-muted mb-2">
          Yeni deneme/öğrenci eklediğinizde veya sonuç aktardığınızda, veriler birkaç saniye
          içinde otomatik olarak sunucuya gönderilir. Hemen göndermek isterseniz butona basabilirsiniz.
        </p>
        <button class="btn btn-primary" onclick="AdminUsers.syncToServer()">📤 Şimdi Gönder</button>
        <div id="sync-server-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
      </div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">➕</span> Yeni Hesap Oluştur</h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
          <div>
            <label class="form-label">Rol</label>
            <select id="new-user-role" class="form-control" onchange="AdminUsers.onRoleChange()">
              <option value="teacher">Öğretmen</option>
              <option value="parent">Veli</option>
              <option value="student">Öğrenci</option>
            </select>
          </div>
          <div>
            <label class="form-label">Görünen İsim</label>
            <input type="text" id="new-user-displayname" class="form-control" placeholder="Örn: Ayşe Öğretmen">
          </div>
          <div>
            <label class="form-label">Kullanıcı Adı</label>
            <input type="text" id="new-user-username" class="form-control" placeholder="Örn: ayse.ogretmen">
          </div>
          <div>
            <label class="form-label">Şifre</label>
            <input type="text" id="new-user-password" class="form-control" placeholder="En az 4 karakter">
          </div>
          <div id="new-user-class-wrap">
            <label class="form-label">Sınıf(lar) (Öğretmen İçin)</label>
            <div id="new-user-classlist-wrap" style="max-height:220px;overflow-y:auto;border:1px solid var(--bg-glass-border);border-radius:10px;padding:8px">
              <label style="display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:15px;cursor:pointer;font-weight:700;border-bottom:1px solid var(--bg-glass-border);margin-bottom:6px;padding-bottom:10px">
                <input type="checkbox" id="new-user-all-classes" style="width:16px;height:16px" onchange="AdminUsers.onAllClassesToggle()">
                🏫 Tümü (Okul Müdürü gibi tüm sınıflar)
              </label>
              ${classNames.map(c => `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:15px;cursor:pointer">
                  <input type="checkbox" class="new-user-class-checkbox" value="${c}" style="width:16px;height:16px">
                  ${c}
                </label>`).join('')}
            </div>
            <small class="text-muted" style="display:block;margin-top:6px">Birden fazla sınıf seçilebilir, ya da "Tümü" ile hepsine erişim verilebilir.</small>
          </div>
          <div id="new-user-student-wrap" style="display:none">
            <label class="form-label">Sınıf (Öğrenci İçin)</label>
            <select id="new-user-student-class" class="form-control" onchange="AdminUsers.onStudentClassChange()">
              <option value="">Sınıf seçin...</option>
              ${classNames.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <label class="form-label mt-2">Öğrenci</label>
            <select id="new-user-studentid" class="form-control" disabled>
              <option value="">Önce bir sınıf seçin...</option>
            </select>
          </div>
          <div id="new-user-children-wrap" style="display:none">
            <label class="form-label">Çocuk(lar) (Veli İçin, birden fazla seçilebilir)</label>
            <div style="max-height:160px;overflow-y:auto;border:1px solid var(--bg-glass-border);border-radius:10px;padding:8px">
              ${students.map(s => `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:15px;cursor:pointer">
                  <input type="checkbox" class="new-user-child-checkbox" value="${s.id}" style="width:16px;height:16px">
                  ${s.first_name} ${s.last_name} (${s.class_name || '-'})
                </label>`).join('')}
            </div>
          </div>
        </div>
        <button class="btn btn-primary mt-2" onclick="AdminUsers.createUser()">Hesabı Oluştur</button>
      </div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">👥</span> Mevcut Hesaplar</h3>
        </div>
        <div id="users-list">${this._renderUsersTable(users)}</div>
      </div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🔑</span> Kendi Şifremi Değiştir</h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
          <div>
            <label class="form-label">Mevcut Şifre</label>
            <input type="password" id="own-password-current" class="form-control">
          </div>
          <div>
            <label class="form-label">Yeni Şifre</label>
            <input type="password" id="own-password-new" class="form-control" placeholder="En az 4 karakter">
          </div>
        </div>
        <button class="btn btn-secondary mt-2" onclick="AdminUsers.changeOwnPassword()">Şifremi Değiştir</button>
      </div>
    `;

    this.onRoleChange();
  },

  _roleLabel(role) {
    return { teacher: '👨‍🏫 Öğretmen', parent: '👪 Veli', student: '🎓 Öğrenci' }[role] || role;
  },

  _renderUsersTable(users) {
    if (!users.length) return '<p class="text-muted">Henüz öğretmen/veli/öğrenci hesabı oluşturulmadı.</p>';
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Rol</th><th style="padding:8px">Ad</th><th style="padding:8px">Kullanıcı Adı</th>
        <th style="padding:8px">Kapsam</th><th style="padding:8px">Durum</th><th style="padding:8px"></th>
      </tr>`;
    users.forEach(u => {
      const scope = u.role === 'teacher' ? (u.className || '-') : (u.studentName || '-');
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${this._roleLabel(u.role)}</td>
        <td style="padding:8px">${u.displayName || '-'}</td>
        <td style="padding:8px">${u.username}</td>
        <td style="padding:8px">${scope}</td>
        <td style="padding:8px">${u.active ? '<span style="color:#4ade80">● Aktif</span>' : '<span style="color:#fb7185">● Pasif</span>'}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="AdminUsers.resetPassword(${u.id})">🔑 Şifre Sıfırla</button>
          <button class="btn btn-secondary btn-sm" onclick="AdminUsers.toggleActive(${u.id})">${u.active ? '⏸️ Pasifleştir' : '▶️ Aktifleştir'}</button>
          <button class="btn btn-danger btn-sm" onclick="AdminUsers.deleteUser(${u.id})">🗑️</button>
        </td>
      </tr>`;
    });
    html += '</table></div>';
    return html;
  },

  onRoleChange() {
    const role = document.getElementById('new-user-role').value;
    document.getElementById('new-user-class-wrap').style.display = role === 'teacher' ? '' : 'none';
    document.getElementById('new-user-student-wrap').style.display = role === 'student' ? '' : 'none';
    document.getElementById('new-user-children-wrap').style.display = role === 'parent' ? '' : 'none';
  },

  onAllClassesToggle() {
    const allChecked = document.getElementById('new-user-all-classes').checked;
    document.querySelectorAll('.new-user-class-checkbox').forEach(cb => {
      cb.disabled = allChecked;
      if (allChecked) cb.checked = false;
    });
  },

  onStudentClassChange() {
    const className = document.getElementById('new-user-student-class').value;
    const studentSelect = document.getElementById('new-user-studentid');
    if (!className) {
      studentSelect.disabled = true;
      studentSelect.innerHTML = '<option value="">Önce bir sınıf seçin...</option>';
      return;
    }
    const filtered = (this._students || [])
      .filter(s => s.class_name === className)
      .sort((a, b) => (a.first_name + ' ' + a.last_name).localeCompare(b.first_name + ' ' + b.last_name, 'tr'));
    studentSelect.disabled = false;
    studentSelect.innerHTML = '<option value="">Öğrenci seçin...</option>' +
      filtered.map(s => `<option value="${s.id}">${s.first_name} ${s.last_name}</option>`).join('');
  },

  // Bir değişiklikten (öğrenci/deneme/sonuç ekleme, silme, içe aktarma) sonra
  // db.js -> _notifyChange() tarafından çağrılır. Art arda gelen değişiklikleri
  // tek gönderimde toplamak için debounce edilir (bkz. syncToServer).
  _autoSyncTimer: null,
  scheduleAutoSync() {
    if (this._autoSyncTimer) clearTimeout(this._autoSyncTimer);
    // Kısa bir gecikme: art arda gelen değişiklikleri (ör. toplu içe aktarım
    // sırasında öğrenci+deneme+sonuç birlikte eklenirken) tek gönderimde
    // toplar, ama sekme kapatılmadan önce gönderimin kaçırılma riskini
    // düşük tutmak için eskisinden (2500ms) daha kısa tutulur.
    this._autoSyncTimer = setTimeout(() => this.syncToServer(true), 1000);
  },

  _syncInFlight: false,
  _syncQueued: false,
  async syncToServer(silent = false, force = false) {
    if (this._syncInFlight) {
      // Zaten devam eden bir gönderim var; bitince en güncel veriyle tekrar gönder.
      this._syncQueued = true;
      return;
    }
    this._syncInFlight = true;

    const statusEl = document.getElementById('sync-server-status');
    if (statusEl) statusEl.textContent = 'Gönderiliyor...';
    try {
      const fullData = await db.exportData();
      if (force) fullData.force = true;
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullData),
      });
      const result = await res.json();
      if (res.status === 409 && result.requiresForce && !silent) {
        // Sunucu, mevcut veriyi buyuk olcude azaltacak bir gonderimi
        // guvenlik icin reddetti (bkz. server.py api_admin_sync). Sessiz
        // otomatik gonderimde ASLA otomatik onaylamayin - sadece admin'in
        // bilingli "Simdi Gonder" tiklamasinda sorup force ile tekrar dene.
        this._syncInFlight = false;
        const ok = confirm(
          result.error + '\n\nYine de bu cihazdaki veriyle değiştirmek istiyor musunuz?'
        );
        if (ok) return this.syncToServer(silent, true);
        if (statusEl) statusEl.textContent = '⏸️ Gönderim iptal edildi (veri farkı onaylanmadı).';
        return;
      }
      if (!res.ok) throw new Error(result.error || 'Gönderim başarısız.');
      const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (statusEl) statusEl.textContent = `✅ Otomatik gönderildi (${time}): ${result.counts.students} öğrenci, ${result.counts.exams} deneme, ${result.counts.results} sonuç.`;
      if (!silent) UI.toast('Veriler sunucuya gönderildi.', 'success');
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌ ' + err.message;
      // Otomatik gönderim sessizce başarısız olursa öğretmen/veli/öğrenci
      // eski veriyi görmeye devam eder ve kimse fark etmez - bu yüzden hata
      // durumunda (silent=true olsa bile) kullanıcıya mutlaka bir toast
      // gösteriyoruz; yalnızca başarı durumunda sessiz kalınır.
      const msg = silent
        ? 'Değişiklikler otomatik olarak sunucuya gönderilemedi: ' + err.message + ' (Kullanıcılar sayfasından "Şimdi Gönder" ile tekrar deneyebilirsiniz.)'
        : 'Sunucuya gönderim başarısız: ' + err.message;
      if (typeof UI !== 'undefined') UI.toast(msg, 'danger');
      console.warn('Sunucu senkronizasyonu başarısız:', err.message);
    } finally {
      this._syncInFlight = false;
      if (this._syncQueued) {
        this._syncQueued = false;
        this.scheduleAutoSync();
      }
    }
  },

  async createUser() {
    const role = document.getElementById('new-user-role').value;
    const displayName = document.getElementById('new-user-displayname').value.trim();
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value;

    const allClasses = document.getElementById('new-user-all-classes').checked;
    const selectedClasses = Array.from(document.querySelectorAll('.new-user-class-checkbox:checked')).map(cb => cb.value);
    if (role === 'teacher' && !allClasses && !selectedClasses.length) {
      UI.toast('Öğretmen için en az bir sınıf seçin ya da "Tüm Sınıflar" işaretleyin.', 'warning');
      return;
    }
    const className = allClasses ? '*' : selectedClasses.join(',');

    const studentId = document.getElementById('new-user-studentid').value;
    const studentIds = Array.from(document.querySelectorAll('.new-user-child-checkbox:checked'))
      .map(cb => Number(cb.value));

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role, displayName, username, password,
          className: role === 'teacher' ? className : undefined,
          studentId: role === 'student' ? Number(studentId) : undefined,
          studentIds: role === 'parent' ? studentIds : undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Hesap oluşturulamadı.');
      UI.toast('Hesap oluşturuldu: ' + username, 'success');
      this.render();
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async deleteUser(id) {
    if (!confirm('Bu hesabı silmek istediğinize emin misiniz?')) return;
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    UI.toast('Hesap silindi.', 'info');
    this.render();
  },

  async toggleActive(id) {
    const res = await fetch(`/api/admin/users/${id}/toggle-active`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast(result.active ? 'Hesap aktifleştirildi.' : 'Hesap pasifleştirildi.', 'info');
    this.render();
  },

  async changeOwnPassword() {
    const currentPassword = document.getElementById('own-password-current').value;
    const newPassword = document.getElementById('own-password-new').value;
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Şifre değiştirilemedi.');
      UI.toast('Şifreniz güncellendi.', 'success');
      document.getElementById('own-password-current').value = '';
      document.getElementById('own-password-new').value = '';
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async resetPassword(id) {
    const pw = prompt('Yeni şifreyi girin (en az 4 karakter):');
    if (!pw) return;
    const res = await fetch(`/api/admin/users/${id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'Şifre sıfırlanamadı.', 'danger'); return; }
    UI.toast('Şifre güncellendi.', 'success');
  },

  async logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  },
};
