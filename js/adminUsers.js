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

  // Super_admin bir okula "girmisse" (bkz. js/schools.js manageSchoolUsers)
  // App.actingSchool {id,name} dolu olur - bu okulun hesap uclarina bu
  // sorgu string'i eklenerek erisiliyor (server.py _effective_org_id).
  // Gercek okul admini/delege icin bos string - kendi organization_id'lerine
  // zaten sabitler, ekstra bir sey gondermelerine gerek/izin yok.
  _schoolQuery() {
    return (App.currentUser?.actsAsSuperAdmin && App.actingSchool)
      ? `?school_id=${App.actingSchool.id}` : '';
  },

  async exitSchoolContext() {
    if (App._dirtyForms.size > 0) {
      const ok = await UI.confirm(
        'Kaydedilmemiş değişiklikler var, okuldan çıkılsın mı? Kaydedilmemiş veriler kaybolur.',
        '⚠️ Okuldan Çık'
      );
      if (!ok) return;
      App._dirtyForms.clear();
    }
    App.actingSchool = null;
    if (App.currentUser?.role === 'super_admin' && !App.currentUser?.organizationId) {
      // Saf platform hesabinin (kendi okulu yok) tek sayfasi Okullar'dir.
      document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.style.display = item.dataset.page === 'schools' ? '' : 'none';
      });
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => {
        item.style.display = item.dataset.page === 'schools' ? '' : 'none';
      });
      App.navigateTo('schools');
    } else {
      // Platform sahibi admin: butun nav zaten gorunur kaliyor, sadece
      // kendi okuluna (normal admin paneline) geri doner.
      App.navigateTo('dashboard');
    }
  },

  async render() {
    const container = document.getElementById('page-users');
    if (!container) return;

    if (App.needsActiveSchool()) {
      // Dogrudan gecmis/geri tusuyla ya da header'daki Aktif Okul
      // seçicisinden önce okul seçmeden buraya düşülduyse - sessizce
      // başka bir sayfaya yönlendirmek yerine bu ekranın içinde bir seçim
      // istemi gösterilir (bkz. App.showSchoolRequiredPrompt). Platform
      // sahibi hibrit admin icin bu sorun degil - okul_id verilmeyince
      // kendi okuluna sabitlenir (bkz. server.py _effective_org_id).
      App.showSchoolRequiredPrompt('page-users');
      return;
    }

    container.innerHTML = `<p class="text-muted">Yükleniyor...</p>`;

    const q = this._schoolQuery();
    const [users, students] = await Promise.all([
      fetch(`/api/admin/users${q}`).then(r => r.json()),
      fetch(`/api/admin/students${q}`).then(r => r.json()),
    ]);

    this._students = students;
    const classNames = [...new Set(students.map(s => s.class_name).filter(Boolean))].sort();
    this._classGroups = this._groupClassesByGrade(classNames);

    // Gercek admin mi, yoksa hesap ekleme/listeleme yetkisi devredilmis bir
    // ogretmen mi (bkz. /api/admin/users/<id>/delegate)? Senkron (/api/admin/sync)
    // SADECE gercek okul admin'ine acik - bu, admin'in KENDI tarayicisindaki
    // yerel (IndexedDB) deneme verisini gonderir, super_admin'in tarayicisinda
    // o okulun verisi hic yok. Ama hesap silme/pasiflestirme/sifre
    // sifirlama/delege yetkisi hem gercek admin'e hem "bir okula girmis"
    // super_admin'e acik (ikisi de sunucu tarafinda role=("admin","super_admin")
    // ile izinli) - delege bir ogretmen ise bunlarin hicbirini goremez.
    // "Baska bir okulu goruntuluyor" durumunda (App.actingSchool dolu) - bu
    // gercek super_admin de olabilir, platform sahibi admin de - senkron
    // (KENDI tarayicisinin verisi) bu context'te ANLAMSIZ, o yuzden isRealAdmin
    // bilerek false'a duser (bkz. asagidaki "Sunucuya Veri Gonder" karti).
    const isRealAdmin = App.currentUser?.role === 'admin' && !App.actingSchool;
    const canManageAccounts = isRealAdmin || (App.currentUser?.actsAsSuperAdmin && !!App.actingSchool);
    this._users = users; // Bölüm 6 filtreleri (branş/sınıf/durum/isim) için
    this._canManageAccounts = canManageAccounts;
    // 2026-11-10: 1200+ ogrenci hesapli okulda tum satirlar (+ veli formunda
    // her ogrenci icin bir onay kutusu) tek seferde cizilince sayfa donuyordu.
    // Tablo parca parca, veli cocuk listesi aramayla ve sinirli cizilir.
    this._tableLimit = this.TABLE_PAGE;
    this._childSel = new Set();

    container.innerHTML = `
      ${App.currentUser?.actsAsSuperAdmin && App.actingSchool ? `
      <div class="card" style="border:1px solid rgba(99,102,241,0.35);background:rgba(99,102,241,0.08)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <span>🏫 <b>${App.actingSchool.name}</b> okulunun hesapları yönetiliyor</span>
          <button class="btn btn-secondary btn-sm" onclick="AdminUsers.exitSchoolContext()">⬅️ Okullara Dön</button>
        </div>
      </div>` : ''}

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
          <div id="new-user-subject-wrap">
            <label class="form-label">Branş (Öğretmen İçin, opsiyonel)</label>
            <input type="text" id="new-user-subject" class="form-control" placeholder="Örn: Matematik">
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
            <label class="form-label mt-2">Sınıf Öğretmenliği (opsiyonel)</label>
            <select id="new-user-homeroom-class" class="form-control">
              <option value="">Yok</option>
              ${classNames.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <small class="text-muted" style="display:block;margin-top:6px">Seçilirse bu öğretmen, branşı ne olursa olsun, bu sınıfın TÜM Optik Okuma denemelerini görebilir.</small>
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
            <input type="text" id="new-user-child-search" class="form-control" style="margin-bottom:6px"
              placeholder="Öğrenci adı / sınıf / numara ara..." oninput="AdminUsers._renderChildList()">
            <div id="new-user-child-list" style="max-height:200px;overflow-y:auto;border:1px solid var(--bg-glass-border);border-radius:10px;padding:8px"></div>
            <small id="new-user-child-selected" class="text-muted" style="display:block;margin-top:6px"></small>
          </div>
        </div>
        <button class="btn btn-primary mt-2" onclick="AdminUsers.createUser()">Hesabı Oluştur</button>
      </div>

      ${(typeof StudentAccounts !== 'undefined' && canManageAccounts) ? StudentAccounts.cardHtml() : ''}

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
          <h3 class="card-title"><span class="card-icon">🔗</span> Öğretmen Davet Linki</h3>
        </div>
        <p class="text-muted mb-2">
          Bu linki öğretmenlerinizle paylaşın — kendi kullanıcı adı/şifresini seçip
          okulunuza öğretmen olarak kaydolabilirler.
        </p>
        <div id="teacher-invite-box" class="text-muted">Yükleniyor...</div>
        ${canManageAccounts ? '<button class="btn btn-secondary mt-2" onclick="AdminUsers.regenerateTeacherInvite()">🔄 Linki Yeniden Oluştur (eskisi geçersiz olur)</button>' : ''}
      </div>

      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">👥</span> Mevcut Hesaplar</h3>
        </div>
        ${this._renderUserFilters(users)}
        <div id="users-list">${this._renderUsersTable(users, canManageAccounts, true)}</div>
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
    this._loadTeacherInvite();
    if (typeof StudentAccounts !== 'undefined' && canManageAccounts) StudentAccounts.mount();
  },

  _roleLabel(role) {
    return { teacher: '👨‍🏫 Öğretmen', parent: '👪 Veli', student: '🎓 Öğrenci' }[role] || role;
  },

  // admin-panel-prompt.md bölüm 6: Öğretmen Paneli filtreleri (branş, girdiği
  // sınıf, durum, isim arama) - "Kullanıcılar" (öğretmen/veli/öğrenci hepsi
  // bir arada) sayfasının üstüne eklendi, ayrı bir sayfa açmak yerine mevcut
  // hesap yönetimi akışıyla aynı yerde tutuldu.
  _renderUserFilters(users) {
    const subjects = [...new Set(users.filter(u => u.role === 'teacher' && u.subject).map(u => u.subject))].sort();
    const classNames = [...new Set(users.filter(u => u.role === 'teacher' && u.className).map(u => u.className))].sort();
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <input type="text" id="users-filter-search" class="form-control" style="max-width:220px" placeholder="İsim ara..." oninput="AdminUsers._onUserSearchInput()">
        <select id="users-filter-role" class="form-control" style="max-width:160px" onchange="AdminUsers._applyUserFilters()">
          <option value="">Tüm Roller</option>
          <option value="teacher">Öğretmen</option>
          <option value="parent">Veli</option>
          <option value="student">Öğrenci</option>
        </select>
        <select id="users-filter-subject" class="form-control" style="max-width:160px" onchange="AdminUsers._applyUserFilters()">
          <option value="">Tüm Branşlar</option>
          ${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
        <select id="users-filter-class" class="form-control" style="max-width:160px" onchange="AdminUsers._applyUserFilters()">
          <option value="">Tüm Sınıflar</option>
          ${classNames.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <select id="users-filter-status" class="form-control" style="max-width:140px" onchange="AdminUsers._applyUserFilters()">
          <option value="">Tüm Durumlar</option>
          <option value="active">Aktif</option>
          <option value="inactive">Pasif</option>
        </select>
      </div>
    `;
  },

  // 2026-11-11 kullanici: 50 yeterli, fazlasi kasmasin
  TABLE_PAGE: 50,
  CHILD_LIST_MAX: 50,

  _onUserSearchInput() {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this._applyUserFilters(), 250);
  },

  _showMoreUsers() {
    this._tableLimit += this.TABLE_PAGE;
    document.getElementById('users-list').innerHTML =
      this._renderUsersTable(this._lastFilteredUsers || this._users || [], this._canManageAccounts, true);
  },

  _renderChildList() {
    const box = document.getElementById('new-user-child-list');
    if (!box) return;
    const q = (document.getElementById('new-user-child-search')?.value || '').toLocaleLowerCase('tr-TR').trim();
    const all = this._students || [];
    const match = q ? all.filter(s =>
      `${s.first_name} ${s.last_name} ${s.class_name || ''} ${s.school_number || ''}`.toLocaleLowerCase('tr-TR').includes(q)) : all;
    // Secili olanlar her zaman listede kalsin (arama degisince kaybolmasin)
    const shown = all.filter(s => this._childSel.has(s.id) && !match.includes(s))
      .concat(match.slice(0, this.CHILD_LIST_MAX));
    box.innerHTML = shown.map(s => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:15px;cursor:pointer">
        <input type="checkbox" class="new-user-child-checkbox" value="${s.id}" style="width:16px;height:16px"
          ${this._childSel.has(s.id) ? 'checked' : ''} onchange="AdminUsers._toggleChild(${s.id}, this.checked)">
        ${s.first_name} ${s.last_name} (${s.class_name || '-'})
      </label>`).join('') +
      (match.length > this.CHILD_LIST_MAX
        ? `<div class="text-muted" style="font-size:12.5px;padding:6px 2px">${match.length} öğrenciden ilk ${this.CHILD_LIST_MAX} tanesi gösteriliyor — aramayla daraltın.</div>`
        : (match.length ? '' : '<div class="text-muted" style="font-size:12.5px;padding:6px 2px">Eşleşen öğrenci yok.</div>'));
    this._updateChildSelectedNote();
  },

  _toggleChild(id, on) {
    if (on) this._childSel.add(id); else this._childSel.delete(id);
    this._updateChildSelectedNote();
  },

  _updateChildSelectedNote() {
    const el = document.getElementById('new-user-child-selected');
    if (!el) return;
    const names = (this._students || []).filter(s => this._childSel.has(s.id)).map(s => `${s.first_name} ${s.last_name}`);
    el.textContent = names.length ? `Seçili: ${names.join(', ')}` : '';
  },

  _applyUserFilters() {
    this._tableLimit = this.TABLE_PAGE;
    const q =(document.getElementById('users-filter-search')?.value || '').toLocaleLowerCase('tr-TR').trim();
    const role = document.getElementById('users-filter-role')?.value || '';
    const subject = document.getElementById('users-filter-subject')?.value || '';
    const className = document.getElementById('users-filter-class')?.value || '';
    const status = document.getElementById('users-filter-status')?.value || '';
    const filtered = (this._users || []).filter(u => {
      if (q && !(u.displayName || '').toLocaleLowerCase('tr-TR').includes(q) && !(u.username || '').toLocaleLowerCase('tr-TR').includes(q)) return false;
      if (role && u.role !== role) return false;
      if (subject && u.subject !== subject) return false;
      if (className && u.className !== className) return false;
      if (status === 'active' && !u.active) return false;
      if (status === 'inactive' && u.active) return false;
      return true;
    });
    document.getElementById('users-list').innerHTML = this._renderUsersTable(filtered, this._canManageAccounts, true);
  },

  _renderUsersTable(allUsers, isRealAdmin, paged = false) {
    if (paged) this._lastFilteredUsers = allUsers;
    if (!allUsers.length) return '<p class="text-muted">Eşleşen hesap bulunamadı.</p>';
    const limit = paged ? (this._tableLimit || this.TABLE_PAGE) : Infinity;
    const users = allUsers.length > limit ? allUsers.slice(0, limit) : allUsers;
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Rol</th><th style="padding:8px">Ad</th><th style="padding:8px">Kullanıcı Adı</th>
        <th style="padding:8px">Branş</th><th style="padding:8px">Kapsam</th><th style="padding:8px">Durum</th><th style="padding:8px"></th>
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
      const teachingBtn = (isRealAdmin && u.role === 'teacher')
        ? `<button class="btn btn-secondary btn-sm" onclick="AdminUsers.editTeaching(${u.id})">✏️ Branş / Sınıflar</button>` : '';
      // Koordinatör (müdür / müdür yrd. / rehber öğretmen): öğretmen panelinde
      // okulun tüm sınıflarını SALT OKUNUR görür ("Okul Geneli" sayfası).
      const coordinatorBtn = (isRealAdmin && u.role === 'teacher')
        ? `<button class="btn btn-secondary btn-sm" onclick="AdminUsers.setCoordinator(${u.id}, ${!u.isCoordinator})">
            ${u.isCoordinator ? '🏫 Koordinatörlüğü Kaldır' : '🏫 Koordinatör Yap'}
          </button>` : '';
      const homeroomBtn = (isRealAdmin && u.role === 'teacher')
        ? `<button class="btn btn-secondary btn-sm" onclick="AdminUsers.setHomeroom(${u.id}, '${(u.homeroomClassName || '').replace(/'/g, "\\'")}')">🏠 Sınıf Öğretmenliği</button>`
        : '';
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${this._roleLabel(u.role)}${u.isDelegate ? ' <span style="color:#2DD4BF;font-size:11px">(Yönetici Yrd.)</span>' : ''}${u.isCoordinator ? ' <span style="color:#a78bfa;font-size:11px">(Koordinatör)</span>' : ''}</td>
        <td style="padding:8px">${u.displayName || '-'}</td>
        <td style="padding:8px">${u.username}</td>
        <td style="padding:8px">${u.subject || '-'}</td>
        <td style="padding:8px">${scope}${u.homeroomClassName ? ` <span title="Sınıf Öğretmeni" style="color:#f59e0b;font-size:11px">🏠 ${u.homeroomClassName}</span>` : ''}</td>
        <td style="padding:8px">${u.active ? '<span style="color:#4ade80">● Aktif</span>' : '<span style="color:#fb7185">● Pasif</span>'}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">${teachingBtn}${homeroomBtn}${coordinatorBtn}${delegateBtn}${adminOnlyActions}</td>
      </tr>`;
    });
    html += '</table></div>';
    if (users.length < allUsers.length) {
      html += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">
        <span class="text-muted" style="font-size:13px">${allUsers.length} hesabın ${users.length} tanesi gösteriliyor — aramak için yukarıdaki filtreleri kullanın.</span>
        <button class="btn btn-secondary btn-sm" onclick="AdminUsers._showMoreUsers()">Daha fazla göster</button>
      </div>`;
    }
    return html;
  },

  async _loadTeacherInvite() {
    const box = document.getElementById('teacher-invite-box');
    if (!box) return;
    try {
      const res = await fetch(`/api/admin/teacher-invite${this._schoolQuery()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Davet linki alınamadı.');
      box.innerHTML = `<code style="word-break:break-all;background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:8px;display:inline-block">${data.url}</code>
        <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="AdminUsers._copyText('${data.url}')">📋 Kopyala</button>`;
    } catch (err) {
      box.textContent = '❌ ' + err.message;
    }
  },

  async regenerateTeacherInvite() {
    if (!confirm('Yeni bir link oluşturulacak, eski link artık çalışmayacak. Emin misiniz?')) return;
    const res = await fetch(`/api/admin/teacher-invite/regenerate${this._schoolQuery()}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { UI.toast(data.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast('Yeni davet linki oluşturuldu.', 'success');
    this._loadTeacherInvite();
  },

  _copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => UI.toast('Panoya kopyalandı.', 'success'),
        () => {}
      );
    }
  },

  onRoleChange() {
    const role = document.getElementById('new-user-role').value;
    document.getElementById('new-user-subject-wrap').style.display = role === 'teacher' ? '' : 'none';
    document.getElementById('new-user-class-wrap').style.display = role === 'teacher' ? '' : 'none';
    document.getElementById('new-user-student-wrap').style.display = role === 'student' ? '' : 'none';
    document.getElementById('new-user-children-wrap').style.display = role === 'parent' ? '' : 'none';
    if (role === 'parent') this._renderChildList();
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
  // Geçici hata (çevrimdışı, sunucu meşgul) sonrası artan aralıklarla otomatik
  // tekrar deneme - değişiklikler giden kutusunda beklediği için kaybolmaz.
  _retryCount: 0,
  _retryTimer: null,
  _scheduleRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    const delays = [5000, 15000, 30000, 60000];
    const d = delays[Math.min(this._retryCount, delays.length - 1)];
    this._retryCount++;
    this._retryTimer = setTimeout(() => { this._retryTimer = null; this.syncToServer(true); }, d);
  },
  async syncToServer(silent = false) {
    if (this._syncInFlight) {
      // Zaten devam eden bir gönderim var; bitince giden kutusu tekrar gönderilir.
      this._syncQueued = true;
      return 'queued';
    }
    this._syncInFlight = true;

    const statusEl = document.getElementById('sync-server-status');
    if (statusEl) statusEl.textContent = 'Gönderiliyor...';
    try {
      // 5B: TAM veri değil, yalnızca giden kutusundaki değişiklikler gönderilir
      // (bkz. db._installOutboxHooks, server.py api_admin_sync_delta).
      const { ops, maxSeq } = await db.readOutbox();
      if (!ops.length) {
        if (maxSeq) await db.removeOutboxUpTo(maxSeq); // birbirini götüren işlemler (aç-sil)
        db.clearPendingSync();
        if (statusEl) statusEl.textContent = '✅ Gönderilecek değişiklik yok - sunucu güncel.';
        if (!silent) UI.toast('Sunucu güncel, gönderilecek değişiklik yok.', 'success');
        return 'ok';
      }
      let res = await fetch('/api/admin/sync-delta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      });
      let result = await res.json();
      if (res.status === 409 && result.requiresConfirm && !silent) {
        // Elle gönderimde kullanıcıya açıkça sorulur (otomatik gönderimde ASLA).
        const delCount = ops.filter(o => o.op === 'delete').length;
        const ok = await UI.confirm(
          `${result.error}<br><br>Bu cihazda bekleyen <b>${delCount} silme</b> işlemi var. Bunlar gerçekten sizin yaptığınız silmelerse ` +
          `onaylayın; emin değilseniz <b>Vazgeç</b>'e basın ve Ayarlar'dan "Sunucudaki veriyi yeniden yükle"yi kullanın.`,
          'Toplu silme onayı');
        if (ok) {
          res = await fetch('/api/admin/sync-delta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ops: ops.map(o => o.op === 'delete' ? { ...o, mass: true } : o) }),
          });
          result = await res.json();
        }
      }
      if (res.status === 409 && result.requiresConfirm) {
        // Onaysız toplu silme: değişiklikler giden kutusunda KALIR (kaybolmaz).
        if (statusEl) statusEl.innerHTML = `⚠️ ${result.error} <b>Değişiklikler bu cihazda bekletiliyor.</b> Ayarlar'dan "Şimdi gönder" ile onaylayabilir ya da "Sunucudaki veriyi yeniden yükle" ile bu cihazdaki değişiklikleri atabilirsiniz.`;
        UI.toast('Çok sayıda silme güvenlik nedeniyle gönderilmedi - Ayarlar\'dan onaylayın ya da sunucudaki veriyi yeniden yükleyin.', 'danger', 10000);
        console.warn('Fark senkronu reddedildi (requiresConfirm):', result);
        return 'requiresConfirm';
      }
      if (!res.ok) throw new Error(result.error || 'Gönderim başarısız.');
      this._retryCount = 0;
      await db.applyIdMap(result.idMap);
      const remaining = await db.removeOutboxUpTo(maxSeq);
      if (!remaining) db.clearPendingSync();
      if (result.skipped && result.skipped.length) {
        console.info('Sunucu bazı kayıtları atladı:', result.skipped);
      }
      const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (statusEl) statusEl.textContent = `✅ ${time}: ${ops.length} değişiklik sunucuya gönderildi.`;
      if (!silent) UI.toast(`${ops.length} değişiklik sunucuya gönderildi.`, 'success');
      if (remaining) this.scheduleAutoSync(); // gönderim sırasında yeni değişiklik geldi
      return 'ok';
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌ ' + err.message + ' (değişiklikler bu cihazda bekletiliyor, tekrar denenecek)';
      // Otomatik gönderim sessizce başarısız olursa kimse fark etmez - hata
      // durumunda (silent=true olsa bile) toast gösterilir. Değişiklikler giden
      // kutusunda kalır, sonraki değişiklikte ya da açılışta tekrar gönderilir.
      const msg = silent
        ? 'Değişiklikler sunucuya gönderilemedi: ' + err.message + ' (bu cihazda bekletiliyor, otomatik tekrar denenecek)'
        : 'Sunucuya gönderim başarısız: ' + err.message;
      // Toast yalnızca ilk başarısızlıkta - otomatik tekrar denemeler sessiz.
      if (typeof UI !== 'undefined' && !this._retryCount) UI.toast(msg, 'danger');
      console.warn('Sunucu senkronizasyonu başarısız:', err.message);
      this._scheduleRetry();
      return 'error';
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
    const studentIds = [...(this._childSel || [])].map(Number);
    const subject = document.getElementById('new-user-subject').value.trim();
    const homeroomClassName = document.getElementById('new-user-homeroom-class')?.value || '';

    try {
      const res = await fetch(`/api/admin/users${this._schoolQuery()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role, displayName, username, password,
          className: role === 'teacher' ? className : undefined,
          subject: role === 'teacher' ? subject : undefined,
          homeroomClassName: role === 'teacher' ? homeroomClassName : undefined,
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
    await fetch(`/api/admin/users/${id}${this._schoolQuery()}`, { method: 'DELETE' });
    UI.toast('Hesap silindi.', 'info');
    this.render();
  },

  async toggleActive(id) {
    const res = await fetch(`/api/admin/users/${id}/toggle-active${this._schoolQuery()}`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast(result.active ? 'Hesap aktifleştirildi.' : 'Hesap pasifleştirildi.', 'info');
    this.render();
  },

  async setDelegate(id, grant) {
    if (grant && !confirm('Bu öğretmen artık kendi okulunuz için öğretmen/öğrenci hesabı ekleyebilecek ve mevcut hesapları listeleyebilecek (silme/pasifleştirme yetkisi olmayacak). Onaylıyor musunuz?')) return;
    const res = await fetch(`/api/admin/users/${id}/delegate${this._schoolQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant }),
    });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast(grant ? 'Yönetici yardımcısı yapıldı.' : 'Yönetici yardımcılığı kaldırıldı.', 'success');
    this.render();
  },

  // Branş + girdiği sınıflar (Faz 2): daha önce ikisi de yalnızca hesap
  // açılırken girilebiliyordu. Değişiklik öğretmenin panelinde hemen geçerli.
  async editTeaching(id) {
    const u = (this._users || []).find(x => x.id === id);
    if (!u) { UI.toast('Öğretmen bulunamadı, listeyi yenileyin.', 'warning'); return; }
    let meta;
    try {
      const res = await fetch(`/api/admin/class-names${this._schoolQuery()}`);
      meta = await res.json();
      if (!res.ok) throw new Error(meta.error || 'Sınıf listesi alınamadı.');
    } catch (err) { UI.toast(err.message, 'danger'); return; }
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const all = u.classList === '*';
    const mine = new Set(Array.isArray(u.classList) ? u.classList : []);
    const legacy = u.subject && !meta.branches.includes(u.subject) ? u.subject : null;
    const byGrade = {};
    meta.classNames.forEach(c => { const g = (c.match(/^\s*(\d+)/) || [])[1] || 'Diğer'; (byGrade[g] = byGrade[g] || []).push(c); });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px">
        <div class="modal-header"><h2>✏️ ${esc(u.displayName || u.username)}: Branş ve Sınıflar</h2><button class="modal-close" data-close>✕</button></div>
        <div class="modal-body">
          <label style="font-weight:600;font-size:13px">Branş</label>
          <select id="teach-subject" class="form-control" style="margin:6px 0 4px">
            <option value="">(Seçilmedi)</option>
            ${meta.branches.map(b => `<option value="${esc(b)}" ${u.subject === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
          </select>
          ${legacy ? `<div style="font-size:12px;color:var(--text-muted)">Şu an kayıtlı: "${esc(legacy)}" - listeden doğru branşı seçip kaydedin.</div>` : ''}
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Öğretmen panelindeki sınıf kartlarında bu dersin netleri öne çıkar.</div>
          <label style="font-weight:600;font-size:13px">Girdiği sınıflar</label>
          <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13px"><input type="checkbox" id="teach-all" ${all ? 'checked' : ''}> Tüm sınıflar (okulun tamamını görür)</label>
          <div id="teach-classes" style="${all ? 'opacity:.4;pointer-events:none' : ''}">
            ${Object.keys(byGrade).map(g => `
              <div style="margin:8px 0 4px;font-size:12px;font-weight:700;color:var(--text-muted)">${esc(g)}. SINIF
                <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 8px;margin-left:6px" data-grade-toggle="${esc(g)}">hepsi</button></div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${byGrade[g].map(c => `<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--bg-glass-border);border-radius:10px;font-size:13px;cursor:pointer">
                  <input type="checkbox" value="${esc(c)}" data-grade="${esc(g)}" ${mine.has(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}
              </div>`).join('')}
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px">
          <button class="btn btn-secondary" data-close>Vazgeç</button>
          <button class="btn btn-primary" id="teach-save">Kaydet</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    overlay.querySelector('#teach-all').addEventListener('change', (e) => {
      const box = overlay.querySelector('#teach-classes');
      box.style.opacity = e.target.checked ? '.4' : ''; box.style.pointerEvents = e.target.checked ? 'none' : '';
    });
    overlay.querySelectorAll('[data-grade-toggle]').forEach(b => b.addEventListener('click', () => {
      const boxes = [...overlay.querySelectorAll(`input[data-grade="${b.dataset.gradeToggle}"]`)];
      const on = !boxes.every(x => x.checked);
      boxes.forEach(x => { x.checked = on; });
    }));
    overlay.querySelector('#teach-save').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const classes = overlay.querySelector('#teach-all').checked ? '*'
        : [...overlay.querySelectorAll('#teach-classes input:checked')].map(x => x.value);
      if (classes !== '*' && !classes.length) { UI.toast('En az bir sınıf seçin ya da "Tüm sınıflar"ı işaretleyin.', 'warning'); return; }
      btn.disabled = true;
      try {
        const res = await fetch(`/api/admin/users/${id}/teaching${this._schoolQuery()}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: overlay.querySelector('#teach-subject').value, classes }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Kaydedilemedi.');
        UI.toast(`Kaydedildi: ${result.subject || 'branş yok'} · ${result.className}`, 'success');
        close();
        this.render();
      } catch (err) { UI.toast(err.message, 'danger'); btn.disabled = false; }
    });
  },

  async setCoordinator(id, grant) {
    if (grant && !confirm('Bu öğretmen, öğretmen panelinde okulun TÜM sınıflarının sonuçlarını görebilecek ("Okul Geneli" sayfası). Veri girme/silme yetkisi olmaz; ödev ve mesaj yine yalnızca kendi sınıflarına gider. Onaylıyor musunuz?')) return;
    const res = await fetch(`/api/admin/users/${id}/coordinator${this._schoolQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant }),
    });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast(grant ? 'Koordinatör yapıldı. Öğretmen paneli yenilenince "Okul Geneli" görünür.' : 'Koordinatörlük kaldırıldı.', 'success');
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

  async setHomeroom(id, currentClassName) {
    const value = prompt(
      'Sınıf öğretmenliği için sınıf adı girin (örn: 8/A), kaldırmak için boş bırakıp onaylayın:',
      currentClassName || ''
    );
    if (value === null) return; // iptal
    const res = await fetch(`/api/admin/users/${id}/homeroom${this._schoolQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ className: value.trim() }),
    });
    const result = await res.json();
    if (!res.ok) { UI.toast(result.error || 'İşlem başarısız.', 'danger'); return; }
    UI.toast(result.homeroomClassName ? `Sınıf öğretmenliği: ${result.homeroomClassName}` : 'Sınıf öğretmenliği kaldırıldı.', 'success');
    this.render();
  },

  async resetPassword(id) {
    const pw = prompt('Yeni şifreyi girin (en az 4 karakter):');
    if (!pw) return;
    const res = await fetch(`/api/admin/users/${id}/password${this._schoolQuery()}`, {
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
    // KRITIK: PWA service worker'i (sw.js) ve tum Cache Storage'i temizle -
    // aktif bir service worker kaydi varken ayni tarayicida ard arda farkli
    // okul hesaplariyla giris yapildiginda (test/dogrulama sirasinda tespit
    // edildi), bir SONRAKI girisin /api/me yaniti ONCEKI hesabin bilgisini
    // gosterebiliyordu - hicbir tekil ag yaniti "service worker'dan geldi"
    // olarak isaretlenmese bile (bkz. arastirma notlari). Cikis, hesap
    // degistirmenin en dogal noktasi oldugu icin temiz sayfa burada garanti
    // ediliyor - bir sonraki giris sifirdan, hicbir eski service worker/
    // cache olmadan baslar.
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch (e) {
      console.warn('Service worker/cache temizligi basarisiz (kritik degil):', e);
    }
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
        const res = await fetch(`/api/admin/users${this._schoolQuery()}`, {
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
        const freshUsers = await fetch(`/api/admin/users${this._schoolQuery()}`).then(r => r.json());
        this._users = freshUsers;
        this._applyUserFilters();
      }
    }
  },
};
