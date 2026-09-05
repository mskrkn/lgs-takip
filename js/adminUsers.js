// ============================================
// LGS Deneme Takip - Yetkilendirme Yönetimi (Admin)
// Öğretmen / Veli hesapları oluşturma ve sunucuya veri gönderme
// ============================================

const AdminUsers = {

  // "7/A", "8/C" gibi sinif adlarini sinif seviyesine (7, 8, ...) gore
  // gruplar - once "Sinif Duzeyi" (5./6./7./8. Siniflar) secilir, sonra o
  // duzeyin subeleri (7/A, 7/B, ...) ikinci kutuda gorunur. Seviye onteki
  // olmayan adlar (varsa) "Diger" grubuna duser.
  _groupClassesByGrade(classNames) {
    const groups = {};
    const other = [];
    (classNames || []).forEach(c => {
      const m = /^(\d+)\s*\/\s*(.+)$/.exec(c || '');
      if (m) {
        (groups[m[1]] = groups[m[1]] || []).push(c);
      } else if (c) {
        other.push(c);
      }
    });
    const result = Object.keys(groups)
      .sort((a, b) => Number(a) - Number(b))
      .map(grade => ({ grade, label: `${grade}. Sınıflar`, classes: groups[grade] }));
    if (other.length) result.push({ grade: null, label: 'Diğer', classes: other });
    return result;
  },

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
    this._classGroups = this._groupClassesByGrade(classNames);

    // Gercek admin mi, yoksa hesap ekleme/listeleme yetkisi devredilmis bir
    // ogretmen mi (bkz. /api/admin/users/<id>/delegate)? Senkron (/api/admin/sync)
    // ve hesap silme/pasiflestirme/sifre sifirlama SADECE gercek admin'e acik -
    // delege bu butonlari hic gormez (arka planda zaten 403 doner ama once
    // arayuzde gostermemek daha temiz).
    const isRealAdmin = App.currentUser?.role === 'admin';

    container.innerHTML = `
      ${isRealAdmin ? `
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
      </div>` : ''}

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
            <label class="form-label">Sınıf Düzeyi (Öğrenci İçin)</label>
            <select id="new-user-student-grade" class="form-control" onchange="AdminUsers.onStudentGradeChange()">
              <option value="">Sınıf düzeyi seçin...</option>
              ${this._classGroups.map(g => `<option value="${g.label}">${g.label}</option>`).join('')}
            </select>
            <label class="form-label mt-2">Şube</label>
            <select id="new-user-student-class" class="form-control" disabled onchange="AdminUsers.onStudentClassChange()">
              <option value="">Önce sınıf düzeyini seçin...</option>
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
          <h3 class="card-title"><span class="card-icon">📑</span> Toplu Hesap Oluştur (Excel/CSV)</h3>
        </div>
        <p class="text-muted mb-2">
          Sütunlar: <b>rol</b> (öğretmen/veli/öğrenci), <b>kullanıcı_adı</b>, <b>şifre</b>,
          <b>görünen_isim</b>, <b>sınıf_veya_öğrenci</b> (öğretmen için sınıf adı — örn. 8/A;
          veli/öğrenci için okul numarası veya tam ad-soyad). Her satır ayrı işlenir, biri
          başarısız olursa diğerleri etkilenmez.
        </p>
        <input type="file" id="bulk-user-file" accept=".xlsx,.xls,.csv" class="form-control">
        <button class="btn btn-primary mt-2" onclick="AdminUsers.bulkImportUsers()">Dosyayı İçe Aktar</button>
        <div id="bulk-user-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
        <div id="bulk-user-results" style="margin-top:10px"></div>
      </div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">👥</span> Mevcut Hesaplar</h3>
        </div>
        <div id="users-list">${this._renderUsersTable(users, isRealAdmin)}</div>
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

  _renderUsersTable(users, isRealAdmin) {
    if (!users.length) return '<p class="text-muted">Henüz öğretmen/veli/öğrenci hesabı oluşturulmadı.</p>';
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Rol</th><th style="padding:8px">Ad</th><th style="padding:8px">Kullanıcı Adı</th>
        <th style="padding:8px">Kapsam</th><th style="padding:8px">Durum</th><th style="padding:8px"></th>
      </tr>`;
    users.forEach(u => {
      const scope = u.role === 'teacher' ? (u.className || '-') : (u.studentName || '-');
      // Silme/pasiflestirme/sifre sifirlama SADECE gercek admin'e gorunur -
      // yetki devredilmis bir ogretmen bu butonlari hic gormez (arka planda
      // zaten 403 doner, ama arayuzde hic gostermemek daha net).
      const adminOnlyActions = isRealAdmin ? `
          <button class="btn btn-secondary btn-sm" onclick="AdminUsers.resetPassword(${u.id})">🔑 Şifre Sıfırla</button>
          <button class="btn btn-secondary btn-sm" onclick="AdminUsers.toggleActive(${u.id})">${u.active ? '⏸️ Pasifleştir' : '▶️ Aktifleştir'}</button>
          <button class="btn btn-danger btn-sm" onclick="AdminUsers.deleteUser(${u.id})">🗑️</button>` : '';
      const delegateBtn = (isRealAdmin && u.role === 'teacher')
        ? `<button class="btn btn-secondary btn-sm" onclick="AdminUsers.setDelegate(${u.id}, ${!u.isDelegate})">
            ${u.isDelegate ? '⬇️ Yönetici Yardımcılığını Kaldır' : '⬆️ Yönetici Yardımcısı Yap'}
          </button>` : '';
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${this._roleLabel(u.role)}${u.isDelegate ? ' <span style="color:#2DD4BF;font-size:11px">(Yönetici Yrd.)</span>' : ''}</td>
        <td style="padding:8px">${u.displayName || '-'}</td>
        <td style="padding:8px">${u.username}</td>
        <td style="padding:8px">${scope}</td>
        <td style="padding:8px">${u.active ? '<span style="color:#4ade80">● Aktif</span>' : '<span style="color:#fb7185">● Pasif</span>'}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">${delegateBtn}${adminOnlyActions}</td>
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

  onStudentGradeChange() {
    const gradeLabel = document.getElementById('new-user-student-grade').value;
    const classSelect = document.getElementById('new-user-student-class');
    const group = (this._classGroups || []).find(g => g.label === gradeLabel);
    if (!group) {
      classSelect.disabled = true;
      classSelect.innerHTML = '<option value="">Önce sınıf düzeyini seçin...</option>';
    } else {
      classSelect.disabled = false;
      classSelect.innerHTML = '<option value="">Şube seçin...</option>' +
        group.classes.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    this.onStudentClassChange();
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
  async syncToServer(silent = false) {
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
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullData),
      });
      const result = await res.json();
      if (res.status === 409 && result.requiresForce) {
        // Sunucu, mevcut veriyi buyuk olcude azaltacak (or: bu cihazin yerel
        // verisi eksik/bos) bir gonderimi guvenlik icin reddetti (bkz.
        // server.py api_admin_sync). KASITLI OLARAK burada bir "yine de
        // gonder" secenegi YOK - bir confirm() penceresi kolayca dusunmeden
        // tiklanip gecilebiliyor ve 2026-09-04'te tam olarak boyle gercek
        // veri yeniden silindi. Bu durumda TEK gunvenli yol: sistem
        // yoneticisiyle iletisime gecmek (sunucu tarafinda elle kontrol
        // gerektirir).
        if (statusEl) {
          statusEl.innerHTML = `⚠️ Gönderim güvenlik nedeniyle durduruldu: bu cihazdaki veri `
            + `sunucudakinden çok daha az görünüyor (muhtemelen bu cihaz/tarayıcı güncel değil). `
            + `<b>Lütfen sistem yöneticinizle iletişime geçin, kendiniz üzerine yazmayı denemeyin.</b>`;
        }
        if (!silent) UI.toast('Gönderim güvenlik nedeniyle durduruldu - sistem yöneticinizle iletişime geçin.', 'danger');
        console.warn('Sync reddedildi (requiresForce):', result);
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

  async setDelegate(id, grant) {
    if (grant && !confirm('Bu öğretmen artık kendi okulunuz için öğretmen/öğrenci hesabı ekleyebilecek ve mevcut hesapları listeleyebilecek (silme/pasifleştirme yetkisi olmayacak). Onaylıyor musunuz?')) return;
    const res = await fetch(`/api/admin/users/${id}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant }),
    });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast(grant ? 'Yönetici yardımcısı yapıldı.' : 'Yönetici yardımcılığı kaldırıldı.', 'success');
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

  // ---- Toplu Hesap Oluşturma (Excel/CSV) ----
  // js/importExcel.js'teki processExcelFile ile aynı okuma deseni (SheetJS +
  // basit CSV ayrıştırıcı) - ama bu tamamen ayrı bir akış: deneme SONUCU
  // değil, LOGIN HESABI (kullanıcı adı/şifre) satırları içe aktarıyor.
  _bulkNormalizeText(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ı/g, 'i')
      .replace(/\s+/g, ' ');
  },

  _bulkHeaderKey(h) {
    const norm = this._bulkNormalizeText(h).replace(/[^a-z0-9]/g, '');
    const map = {
      rol: 'role', role: 'role',
      kullaniciadi: 'username', kullaniciadı: 'username', username: 'username', kullanici: 'username',
      sifre: 'password', şifre: 'password', parola: 'password', password: 'password',
      gorunenisim: 'displayName', görünenisim: 'displayName', adsoyad: 'displayName',
      isim: 'displayName', ad: 'displayName', displayname: 'displayName',
      sinifveyaogrenci: 'target', sınıfveyaöğrenci: 'target', sinif: 'target',
      ogrenci: 'target', öğrenci: 'target', okulno: 'target', okulnumarasi: 'target',
    };
    return map[norm] || null;
  },

  _bulkNormalizeRole(v) {
    const n = this._bulkNormalizeText(v);
    if (['ogretmen', 'öğretmen', 'teacher'].includes(n)) return 'teacher';
    if (['veli', 'parent'].includes(n)) return 'parent';
    if (['ogrenci', 'öğrenci', 'student'].includes(n)) return 'student';
    return null;
  },

  // Okul numarasına, yoksa normalize edilmiş ad-soyada göre TEK bir eşleşme
  // arar - AdminUsers._students zaten /api/admin/students'tan çekilmiş listedir.
  _matchStudent(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    const byNumber = (this._students || []).filter(
      s => s.school_number && String(s.school_number).trim() === raw
    );
    if (byNumber.length === 1) return byNumber[0];
    const target = this._bulkNormalizeText(raw);
    const byName = (this._students || []).filter(
      s => this._bulkNormalizeText(`${s.first_name} ${s.last_name}`) === target
    );
    if (byName.length === 1) return byName[0];
    return null;
  },

  async _bulkParseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let rows2d;
    if (ext === 'csv') {
      const text = await file.text();
      rows2d = text.split(/\r?\n/).filter(l => l.trim()).map(
        line => line.split(/[,;]/).map(c => c.trim().replace(/^"|"$/g, ''))
      );
    } else {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows2d = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    }
    if (!rows2d || rows2d.length < 2) return { headerMap: {}, rows: [] };
    const headerRow = rows2d[0];
    const headerMap = {};
    headerRow.forEach((h, i) => {
      const key = this._bulkHeaderKey(h);
      if (key) headerMap[key] = i;
    });
    const rows = rows2d.slice(1).filter(r => r.some(c => String(c || '').trim()));
    return { headerMap, rows };
  },

  async bulkImportUsers() {
    const fileInput = document.getElementById('bulk-user-file');
    const statusEl = document.getElementById('bulk-user-status');
    const resultsEl = document.getElementById('bulk-user-results');
    const file = fileInput.files[0];
    if (!file) { UI.toast('Önce bir dosya seçin.', 'warning'); return; }

    let headerMap, rows;
    try {
      ({ headerMap, rows } = await this._bulkParseFile(file));
    } catch (err) {
      UI.toast('Dosya okunamadı: ' + err.message, 'danger');
      return;
    }
    if (headerMap.role == null || headerMap.username == null || headerMap.password == null) {
      UI.toast('Dosyada "rol", "kullanıcı_adı" ve "şifre" sütunları bulunamalı.', 'danger');
      return;
    }
    if (!rows.length) { UI.toast('Dosyada veri satırı bulunamadı.', 'warning'); return; }

    const results = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNo = i + 2; // 1. satır başlık
      const role = this._bulkNormalizeRole(row[headerMap.role]);
      const username = String(row[headerMap.username] || '').trim();
      const password = String(row[headerMap.password] || '').trim();
      const displayName = headerMap.displayName != null ? String(row[headerMap.displayName] || '').trim() : '';
      const target = headerMap.target != null ? String(row[headerMap.target] || '').trim() : '';

      if (!role) { results.push({ rowNo, username, ok: false, error: 'Geçersiz rol (öğretmen/veli/öğrenci olmalı)' }); continue; }
      if (!username || !password) { results.push({ rowNo, username, ok: false, error: 'Kullanıcı adı/şifre eksik' }); continue; }

      const payload = { username, password, displayName, role };
      if (role === 'teacher') {
        if (!target) { results.push({ rowNo, username, ok: false, error: 'Sınıf adı eksik' }); continue; }
        payload.className = target;
      } else {
        const student = this._matchStudent(target);
        if (!student) { results.push({ rowNo, username, ok: false, error: `Öğrenci eşleşmedi: "${target}"` }); continue; }
        if (role === 'student') payload.studentId = student.id;
        else payload.studentIds = [student.id];
      }

      statusEl.textContent = `İşleniyor: satır ${rowNo}/${rows.length + 1}...`;
      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        results.push(res.ok ? { rowNo, username, ok: true } : { rowNo, username, ok: false, error: result.error || 'Bilinmeyen hata' });
      } catch (err) {
        results.push({ rowNo, username, ok: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.ok).length;
    statusEl.textContent = `Tamamlandı: ${successCount}/${results.length} başarılı.`;
    resultsEl.innerHTML = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Satır</th><th style="padding:6px">Kullanıcı Adı</th><th style="padding:6px">Sonuç</th></tr>
      ${results.map(r => `<tr style="border-top:1px solid var(--bg-glass-border)">
        <td style="padding:6px">${r.rowNo}</td><td style="padding:6px">${r.username || '-'}</td>
        <td style="padding:6px">${r.ok ? '<span style="color:#4ade80">✅ Oluşturuldu</span>' : `<span style="color:#fb7185">❌ ${r.error}</span>`}</td>
      </tr>`).join('')}
    </table></div>`;
    // Tam sayfa render() cagirmiyoruz - yukarida gosterdigimiz sonuc
    // tablosu hemen silinirdi. Sadece "Mevcut Hesaplar" tablosunu tazeliyoruz.
    if (successCount > 0) {
      const usersListEl = document.getElementById('users-list');
      if (usersListEl) {
        const freshUsers = await fetch('/api/admin/users').then(r => r.json());
        const isRealAdmin = App.currentUser?.role === 'admin';
        usersListEl.innerHTML = this._renderUsersTable(freshUsers, isRealAdmin);
      }
    }
  },
};
