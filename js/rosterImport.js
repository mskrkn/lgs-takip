// ============================================
// LGS Deneme Takip - e-Okul "Sınıf Listesi" PDF'inden toplu öğrenci içe
// aktarma (bkz. server.py _parse_student_roster_pdf / api_import_roster).
// ============================================
// Hem App.renderStudents() (okulun kendi admini, IndexedDB) hem
// SchoolView.renderStudents() (platform sahibi "Okula Gir" ile, sunucu API'si)
// tarafından çağrılır - ikisi de bu TEK modülü kullanır, sadece
// import-roster çağrısına eklenecek `?school_id=` sorgu param'ı farklıdır
// (bkz. schoolQuery parametresi). Öğrenci ekleme/güncelleme HER ZAMAN
// sunucudaki /api/admin/students/import-roster üzerinden yapılır (okulun
// kendi admini için de) - bu uç zaten dört göz/eşleştirme mantığını
// merkezi olarak barındırıyor, IndexedDB'ye ayrıca yazmaya gerek yok
// (okulun sonraki senkronu zaten sunucudaki güncel veriyi geri çeker).

const RosterImport = {
  _parsed: null,
  _onDone: null,
  _mode: 'server',

  // mode: 'server' -> /api/admin/students/import-roster (platform sahibi
  // "Okula Gir" ile, o okulun kendi tarayıcısı/IndexedDB'si YOK - bkz.
  // SchoolView.js). 'local' -> okulun kendi admini, mevcut db.addStudent()
  // (IndexedDB) döngüsüyle yazar - böylece kendi ekranında ANINDA görünür,
  // sonraki senkronu sunucuya normal şekilde taşır (bkz. App.renderStudents).
  openModal({ mode = 'server', schoolQuery = '', onDone = null } = {}) {
    this._parsed = null;
    this._mode = mode;
    this._schoolQuery = schoolQuery;
    this._onDone = onDone;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'roster-import-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>📋 Sınıf Listesi PDF ile Toplu Öğrenci Ekle</h2>
          <button class="modal-close" onclick="RosterImport.close()">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted" style="font-size:13px;margin-bottom:12px">
            e-Okul'un ürettiği resmi "Sınıf Listesi" PDF'ini yükleyin (bir okulun tüm sınıf/şubelerini
            tek dosyada içerebilir). Okul numarasıyla eşleşen öğrenciler güncellenir, eşleşmeyenler
            yeni eklenir - hiçbir öğrenci silinmez veya çiftlenmez.
          </p>
          <div class="drop-zone" id="roster-drop-zone">
            <div class="drop-icon">📄</div>
            <h3>PDF'i sürükleyip bırakın</h3>
            <p>veya dosya seçmek için tıklayın (.pdf)</p>
            <input type="file" id="roster-file-input" accept=".pdf" style="display:none">
          </div>
          <div id="roster-import-status" style="margin-top:14px"></div>
          <div id="roster-import-preview"></div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center">
          <button class="btn btn-ghost" onclick="RosterImport.close()">İptal</button>
          <button class="btn btn-primary" id="roster-confirm-btn" style="display:none" onclick="RosterImport.confirm()">
            ✅ Onayla ve İçe Aktar
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const dz = document.getElementById('roster-drop-zone');
    const input = document.getElementById('roster-file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) this._handleFile(input.files[0]);
    });
  },

  close() {
    document.getElementById('roster-import-modal')?.remove();
    this._parsed = null;
  },

  async _handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      UI.toast('Lütfen bir PDF dosyası seçin.', 'warning');
      return;
    }
    const statusEl = document.getElementById('roster-import-status');
    const previewEl = document.getElementById('roster-import-preview');
    statusEl.innerHTML = `<p class="text-muted">⏳ PDF ayrıştırılıyor...</p>`;
    previewEl.innerHTML = '';
    document.getElementById('roster-confirm-btn').style.display = 'none';

    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/admin/students/parse-roster-pdf', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF ayrıştırılamadı.');
      this._parsed = data;
      statusEl.innerHTML = `<p style="color:var(--success)">✅ ${data.schoolNameGuess ? `<b>${data.schoolNameGuess}</b> - ` : ''}${data.totalClasses} şube, ${data.totalStudents} öğrenci tespit edildi. Aşağıdan kontrol edip onaylayın.</p>`;
      previewEl.innerHTML = `
        <div class="table-wrapper" style="max-height:280px;overflow:auto;margin-top:8px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Sınıf</th><th style="padding:6px">Öğrenci Sayısı</th></tr>
            ${data.classes.map(c => `<tr style="border-top:1px solid var(--bg-glass-border)"><td style="padding:6px">${c.className}</td><td style="padding:6px">${c.students.length}</td></tr>`).join('')}
          </table>
        </div>`;
      document.getElementById('roster-confirm-btn').style.display = '';
    } catch (err) {
      statusEl.innerHTML = `<p style="color:var(--danger)">❌ ${err.message}</p>`;
    }
  },

  async confirm() {
    if (!this._parsed) return;
    const statusEl = document.getElementById('roster-import-status');
    const confirmBtn = document.getElementById('roster-confirm-btn');
    confirmBtn.disabled = true;
    statusEl.innerHTML = `<p class="text-muted">⏳ İçe aktarılıyor (${this._parsed.totalStudents} öğrenci)...</p>`;

    const students = [];
    this._parsed.classes.forEach(c => {
      c.students.forEach(s => students.push({ ...s, className: c.className }));
    });

    try {
      if (this._mode === 'local') {
        await this._confirmLocal(students, statusEl);
      } else {
        await this._confirmServer(students);
      }
      this.close();
      if (this._onDone) this._onDone();
    } catch (err) {
      statusEl.innerHTML = `<p style="color:var(--danger)">❌ ${err.message}</p>`;
      confirmBtn.disabled = false;
    }
  },

  async _confirmServer(students) {
    const res = await fetch(`/api/admin/students/import-roster${this._schoolQuery}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'İçe aktarılamadı.');
    UI.toast(`✅ ${data.created} yeni eklendi, ${data.updated} güncellendi, ${data.unchanged} zaten güncel.`, 'success');
  },

  // Okulun kendi admini için: sunucuya değil, mevcut db.addStudent()
  // (IndexedDB) akışına yazar - böylece Öğrenciler ekranında anında
  // görünür, sonraki normal senkron sunucuya taşır.
  async _confirmLocal(students, statusEl) {
    let created = 0, updated = 0;
    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const before = await db.db.students.count();
      await db.addStudent(
        { schoolNumber: s.schoolNumber, firstName: s.firstName, lastName: s.lastName, className: s.className },
        { overwriteClassName: true, overwriteName: true, enforceLimit: false },
      );
      const after = await db.db.students.count();
      if (after > before) created++; else updated++;
      if (i % 100 === 0) {
        statusEl.innerHTML = `<p class="text-muted">⏳ İçe aktarılıyor... (${i + 1}/${students.length})</p>`;
      }
    }
    UI.toast(`✅ ${created} yeni eklendi, ${updated} güncellendi/eşleşti.`, 'success');
  },
};
