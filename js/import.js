// ============================================
// LGS Deneme Takip - Import Module (Excel/CSV/PDF)
// ============================================

const ImportModule = {
  parsedData: [],
  columnMapping: {},
  currentFile: null,
  currentExamId: null,
  _examsCache: [],
  _manualActiveExamType: 'LGS',

  // ---- Render Import Page ----
  render() {
    return `
      <div class="tabs" id="import-tabs">
        <button class="tab-btn active" data-tab="import-manual">📝 Manuel Giriş</button>
        <button class="tab-btn" data-tab="import-excel">📊 Excel / CSV</button>
        <button class="tab-btn" data-tab="import-pdf">📄 PDF</button>
        <button class="tab-btn" data-tab="import-optical">🔤 Optik / TXT Değerlendirme</button>
      </div>

      <!-- Manuel Giriş -->
      <div class="tab-content active" id="import-manual">
        ${this.renderManualForm()}
      </div>

      <!-- Excel/CSV Import -->
      <div class="tab-content" id="import-excel">
        ${this.renderExcelImport()}
      </div>

      <!-- PDF Import -->
      <div class="tab-content" id="import-pdf">
        ${this.renderPDFImport()}
      </div>

      <!-- Optik / TXT Import -->
      <div class="tab-content" id="import-optical">
        ${this.renderOpticalImport()}
      </div>
    `;
  },

  // ---- Manual Form ----
  buildManualSubjectInputsHtml(examType) {
    return getSubjectsForExam(examType).map(sub => `
      <div class="card" style="padding:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          ${UI.subjectBadge(sub.key)}
          <span class="text-muted" style="font-size:12px">(${sub.questions} soru)</span>
        </div>
        <div class="form-row" style="grid-template-columns: repeat(3, 1fr);">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Doğru</label>
            <input type="number" class="form-input" id="manual-${sub.key}-correct" min="0" max="${sub.questions}" value="0" oninput="ImportModule.calcManualNets()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Yanlış</label>
            <input type="number" class="form-input" id="manual-${sub.key}-wrong" min="0" max="${sub.questions}" value="0" oninput="ImportModule.calcManualNets()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Net</label>
            <input type="text" class="form-input font-mono" id="manual-${sub.key}-net" readonly style="background:rgba(99,102,241,0.05);color:var(--accent-primary-light)">
          </div>
        </div>
      </div>
    `).join('');
  },

  renderManualForm() {
    const subjectInputs = this.buildManualSubjectInputsHtml(this._manualActiveExamType);

    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📝</span> Manuel Sonuç Girişi</h3>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Deneme Seçin</label>
            <select class="form-select" id="manual-exam-select" onchange="ImportModule.onManualExamChange()">
              <option value="">-- Deneme seçin --</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Öğrenci (Okul No veya Ad Soyad)</label>
            <input type="text" class="form-input" id="manual-student-search" placeholder="Okul numarası veya ad soyad yazın...">
            <div id="manual-student-results" style="margin-top:8px"></div>
          </div>
        </div>

        <input type="hidden" id="manual-selected-student-id">

        <div id="manual-subject-inputs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:16px;">
          ${subjectInputs}
        </div>

        <div style="margin-top:20px;display:flex;gap:12px;align-items:center;">
          <div style="flex:1;padding:16px;background:rgba(99,102,241,0.05);border-radius:12px;border:1px solid rgba(99,102,241,0.15);">
            <span class="text-muted" style="font-size:13px">Toplam Net:</span>
            <span class="font-mono font-bold" id="manual-total-net" style="font-size:20px;margin-left:8px;color:var(--accent-primary-light)">0.00</span>
          </div>
          <button class="btn btn-primary btn-lg" onclick="ImportModule.saveManualResult()">
            💾 Kaydet
          </button>
        </div>
      </div>
    `;
  },

  // ---- Excel/CSV Import ----
  renderExcelImport() {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📊</span> Excel / CSV Dosyası İle Toplu Giriş</h3>
          <button class="btn btn-secondary btn-sm" onclick="ImportModule.downloadTemplate()">📥 Şablon İndir</button>
        </div>

        <div class="drop-zone" id="excel-drop-zone">
          <div class="drop-icon">📊</div>
          <h3>Excel veya CSV dosyasını sürükleyip bırakın</h3>
          <p>veya dosya seçmek için tıklayın (.xlsx, .xls, .csv)</p>
          <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" style="display:none">
        </div>

        <div class="form-row mt-2">
          <div class="form-group">
            <label class="form-label">Deneme Seçin veya Yeni Oluşturun</label>
            <select class="form-select" id="excel-exam-select">
              <option value="">-- Deneme seçin --</option>
              <option value="__new__">+ Yeni Deneme Oluştur</option>
            </select>
          </div>
          <div class="form-group" id="excel-new-exam-group" style="display:none">
            <label class="form-label">Yeni Deneme Adı</label>
            <div class="form-inline">
              <input type="text" class="form-input" id="excel-new-exam-name" placeholder="Örn: Deneme 5">
              <input type="date" class="form-input" id="excel-new-exam-date" style="width:180px">
            </div>
          </div>
        </div>
        <div class="form-row" id="excel-new-exam-type-row" style="display:none">
          <div class="form-group">
            <label class="form-label">Yeni Denemenin Sınav Türü</label>
            <select class="form-select" id="excel-new-exam-type" onchange="ImportModule.onImportExamSelectChange('excel')">
              ${Object.keys(EXAM_TYPE_LABELS).map(t => `<option value="${t}">${EXAM_TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="excel-preview-section" style="display:none" class="mt-2">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">👁️</span> Önizleme</h3>
            <span class="badge badge-info" id="excel-preview-count"></span>
          </div>

          <div id="excel-column-mapping" class="column-mapping mb-2"></div>

          <div id="excel-preview-table" class="preview-table-container"></div>

          <div style="margin-top:16px;display:flex;gap:12px;justify-content:flex-end;align-items:center;">
            <span class="text-muted" id="excel-error-count"></span>
            <button class="btn btn-ghost" onclick="ImportModule.clearExcelPreview()">İptal</button>
            <button class="btn btn-success btn-lg" onclick="ImportModule.importExcelData()">
              ✅ Verileri İçe Aktar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // ---- PDF Import ----
  renderPDFImport() {
    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📄</span> PDF Dosyasından Toplu Giriş</h3>
        </div>

        <div class="drop-zone" id="pdf-drop-zone">
          <div class="drop-icon">📄</div>
          <h3>Deneme sonuç PDF'ini sürükleyip bırakın</h3>
          <p>veya dosya seçmek için tıklayın (.pdf)</p>
          <input type="file" id="pdf-file-input" accept=".pdf" style="display:none">
        </div>

        <div class="form-row mt-2">
          <div class="form-group">
            <label class="form-label">Deneme Seçin veya Yeni Oluşturun</label>
            <select class="form-select" id="pdf-exam-select">
              <option value="">-- Deneme seçin --</option>
              <option value="__new__">+ Yeni Deneme Oluştur</option>
            </select>
          </div>
          <div class="form-group" id="pdf-new-exam-group" style="display:none">
            <label class="form-label">Yeni Deneme Adı</label>
            <div class="form-inline">
              <input type="text" class="form-input" id="pdf-new-exam-name" placeholder="Örn: Deneme 5">
              <input type="date" class="form-input" id="pdf-new-exam-date" style="width:180px">
            </div>
          </div>
        </div>
        <div class="form-row" id="pdf-new-exam-type-row" style="display:none">
          <div class="form-group">
            <label class="form-label">Yeni Denemenin Sınav Türü</label>
            <select class="form-select" id="pdf-new-exam-type" onchange="ImportModule.onImportExamSelectChange('pdf')">
              ${Object.keys(EXAM_TYPE_LABELS).map(t => `<option value="${t}">${EXAM_TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="pdf-processing" style="display:none" class="mt-2">
          <div style="text-align:center;padding:40px">
            <div class="loading-spinner" style="width:40px;height:40px;border-width:3px;margin:0 auto"></div>
            <p class="text-muted mt-2">PDF işleniyor, lütfen bekleyin...</p>
          </div>
        </div>

        <div id="pdf-preview-section" style="display:none" class="mt-2">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <h3 class="card-title"><span class="card-icon">👁️</span> PDF Önizleme & Ayıklanan Tablo</h3>
              <span class="badge badge-info" id="pdf-preview-count"></span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm" onclick="ImportModule.downloadPDFAsCSV()">📥 CSV Olarak İndir (.csv)</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.downloadPDFAsExcel()">📊 Excel (.xlsx) Olarak İndir</button>
            </div>
          </div>

          <div id="pdf-column-mapping" class="column-mapping mb-2"></div>

          <div id="pdf-preview-table" class="preview-table-container"></div>

          <div style="margin-top:16px;display:flex;gap:12px;justify-content:flex-end;align-items:center;">
            <span class="text-muted" id="pdf-error-count"></span>
            <button class="btn btn-ghost" onclick="ImportModule.clearPDFPreview()">İptal</button>
            <button class="btn btn-success btn-lg" onclick="ImportModule.importPDFData()">
              ✅ Verileri İçe Aktar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // ---- Initialize Event Listeners ----
  init() {
    // Tab switching
    document.querySelectorAll('#import-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#import-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page-section.active .tab-content').forEach(tc => tc.classList.remove('active'));
        e.target.classList.add('active');
        const tabId = e.target.dataset.tab;
        document.getElementById(tabId)?.classList.add('active');
      });
    });

    // Load exams into selects
    this.loadExamSelects();
    this.calcManualNets();
    this.initOpticalTab();

    // Manual student search
    const searchInput = document.getElementById('manual-student-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => this.searchManualStudent(searchInput.value), 250);
      });
      searchInput.addEventListener('focus', () => {
        if (!searchInput.value.trim()) {
          this.searchManualStudent('');
        }
      });
    }

    // Excel drop zone
    this.setupDropZone('excel-drop-zone', 'excel-file-input', (file) => this.processExcelFile(file));

    // PDF drop zone
    this.setupDropZone('pdf-drop-zone', 'pdf-file-input', (file) => this.processPDFFile(file));

    // Optical drop zone
    this.setupDropZone('optical-drop-zone', 'optical-file-input', (file) => this.processOpticalFile(file));

    // Exam select change for new exam fields
    ['excel', 'pdf', 'optical'].forEach(prefix => {
      const sel = document.getElementById(`${prefix}-exam-select`);
      if (sel) {
        sel.addEventListener('change', () => this.onImportExamSelectChange(prefix));
      }
    });
  },

  // Deneme seçim kutusu değiştiğinde: yeni-deneme alanlarını göster/gizle ve
  // (excel/pdf sekmelerinde) bir dosya zaten yüklenmişse sütun eşlemesini
  // seçilen sınavın ders setine göre yeniden kur.
  onImportExamSelectChange(prefix) {
    const sel = document.getElementById(`${prefix}-exam-select`);
    if (!sel) return;
    const newGroup = document.getElementById(`${prefix}-new-exam-group`);
    if (newGroup) newGroup.style.display = sel.value === '__new__' ? '' : 'none';
    const newTypeRow = document.getElementById(`${prefix}-new-exam-type-row`);
    if (newTypeRow) newTypeRow.style.display = sel.value === '__new__' ? '' : 'none';

    if ((prefix === 'excel' || prefix === 'pdf') && this.parsedData && this.parsedData.length > 0) {
      const headers = this.headers || [];
      if (headers.length > 0) {
        const examType = this.getSelectedExamType(prefix);
        this.columnMapping = this.autoMapColumns(headers, examType);
        document.getElementById(`${prefix}-column-mapping`).innerHTML = this.renderColumnMapping(headers, prefix, examType);
      }
    }
  },

  // Seçili (veya oluşturulmak üzere olan) denemenin sınav türünü döner
  getSelectedExamType(prefix) {
    const sel = document.getElementById(`${prefix}-exam-select`);
    const val = sel?.value;
    if (!val) return 'LGS';
    if (val === '__new__') {
      return document.getElementById(`${prefix}-new-exam-type`)?.value || 'LGS';
    }
    const exam = (this._examsCache || []).find(e => String(e.id) === String(val));
    return exam?.examType || 'LGS';
  },

  // ---- Load Exam Selects ----
  async loadExamSelects() {
    const exams = await db.getAllExams();
    this._examsCache = exams;
    ['manual-exam-select', 'excel-exam-select', 'pdf-exam-select', 'optical-exam-select'].forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      // Keep first option(s)
      const firstOptions = selId === 'manual-exam-select' ? 1 : 2;
      while (sel.options.length > firstOptions) sel.remove(firstOptions);
      exams.forEach(exam => {
        const opt = document.createElement('option');
        opt.value = exam.id;
        opt.textContent = `[${EXAM_TYPE_LABELS[exam.examType] || 'LGS'}] ${exam.name} (${UI.formatDate(exam.date)})`;
        sel.appendChild(opt);
      });
    });
  },

  // ---- Drop Zone Setup ----
  setupDropZone(zoneId, inputId, callback) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) callback(file);
    });

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) callback(file);
    });
  },

  // ---- Manual Form: Net Calculation ----
  calcManualNets() {
    let totalNet = 0;
    getSubjectsForExam(this._manualActiveExamType).forEach(sub => {
      const correct = parseInt(document.getElementById(`manual-${sub.key}-correct`)?.value) || 0;
      const wrong = parseInt(document.getElementById(`manual-${sub.key}-wrong`)?.value) || 0;
      const net = correct - wrong / 3;
      const netEl = document.getElementById(`manual-${sub.key}-net`);
      if (netEl) netEl.value = net.toFixed(2);
      totalNet += net;
    });
    const totalEl = document.getElementById('manual-total-net');
    if (totalEl) totalEl.textContent = totalNet.toFixed(2);
  },

  // Deneme seçimi değiştiğinde manuel giriş ders kartlarını seçilen sınavın
  // türüne göre yeniden oluşturur.
  async onManualExamChange() {
    const sel = document.getElementById('manual-exam-select');
    const examId = parseInt(sel?.value);
    const exam = examId ? await db.getExam(examId) : null;
    this._manualActiveExamType = exam?.examType || 'LGS';
    const container = document.getElementById('manual-subject-inputs');
    if (container) container.innerHTML = this.buildManualSubjectInputsHtml(this._manualActiveExamType);
    this.calcManualNets();
  },

  // ---- Manual Student Search ----
  async searchManualStudent(query) {
    const container = document.getElementById('manual-student-results');
    if (!container) return;

    const trimmed = (query || '').trim();
    const students = trimmed.length > 0 ? await db.searchStudents(trimmed) : (await db.getAllStudents()).slice(0, 8);

    if (students.length === 0) {
      const safeQuery = trimmed.replace(/"/g, '&quot;');
      container.innerHTML = `
        <div style="padding:12px;background:rgba(255,255,255,0.02);border:1px dashed var(--bg-glass-border);border-radius:8px;text-align:center">
          <p class="text-muted" style="font-size:13px;margin-bottom:8px">"${safeQuery}" adında öğrenci bulunamadı.</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.quickAddStudent('${safeQuery.replace(/'/g, "\\'")}')">➕ "${safeQuery}" Öğrencisini Oluştur</button>
        </div>
      `;
      return;
    }

    container.innerHTML = students.map(s => `
      <div class="search-result-item" onclick="ImportModule.selectManualStudent(${s.id}, '${s.firstName} ${s.lastName}', '${s.schoolNumber}')" style="border-radius:8px;margin-bottom:4px;border:1px solid var(--bg-glass-border);cursor:pointer">
        <div class="result-avatar">${UI.avatar()}</div>
        <div class="result-info">
          <h4>${s.firstName} ${s.lastName}</h4>
          <p>${s.schoolNumber} • ${s.className || 'Sınıf belirtilmemiş'}</p>
        </div>
        <span class="badge badge-purple" style="font-size:11px">Seç</span>
      </div>
    `).join('');
  },

  async quickAddStudent(nameInput) {
    if (!nameInput) return;
    const parts = nameInput.trim().split(/\s+/);
    const firstName = parts[0] || 'Öğrenci';
    const lastName = parts.slice(1).join(' ') || '';
    const schoolNumber = String(Math.floor(1000 + Math.random() * 9000));

    const id = await db.addStudent({
      firstName,
      lastName,
      schoolNumber,
      className: '',
    });

    UI.toast(`${firstName} ${lastName} (No: ${schoolNumber}) oluşturuldu ve seçildi!`, 'success');
    this.selectManualStudent(id, `${firstName} ${lastName}`, schoolNumber);
  },

  selectManualStudent(id, name, schoolNumber) {
    document.getElementById('manual-selected-student-id').value = id;
    document.getElementById('manual-student-search').value = `${name} (${schoolNumber})`;
    document.getElementById('manual-student-results').innerHTML = '';
  },

  // ---- Save Manual Result ----
  async saveManualResult() {
    const examId = parseInt(document.getElementById('manual-exam-select')?.value);
    const studentId = parseInt(document.getElementById('manual-selected-student-id')?.value);

    if (!examId) {
      UI.toast('Lütfen bir deneme seçin', 'warning');
      return;
    }
    if (!studentId) {
      UI.toast('Lütfen bir öğrenci seçin', 'warning');
      return;
    }

    const subjects = {};
    getSubjectsForExam(this._manualActiveExamType).forEach(sub => {
      subjects[sub.key] = {
        correct: parseInt(document.getElementById(`manual-${sub.key}-correct`)?.value) || 0,
        wrong: parseInt(document.getElementById(`manual-${sub.key}-wrong`)?.value) || 0,
      };
    });

    await db.addResult({ studentId: Number(studentId), examId: Number(examId), subjects });
    UI.toast('Sonuç başarıyla kaydedildi!', 'success');

    // Reset form
    getSubjectsForExam(this._manualActiveExamType).forEach(sub => {
      document.getElementById(`manual-${sub.key}-correct`).value = 0;
      document.getElementById(`manual-${sub.key}-wrong`).value = 0;
    });
    this.calcManualNets();
    document.getElementById('manual-selected-student-id').value = '';
    document.getElementById('manual-student-search').value = '';
  },

  // ---- Download Template ----
  downloadTemplate() {
    const subjects = getSubjectsForExam(this.getSelectedExamType('excel'));
    const headers = ['Okul No', 'Ad', 'Soyad', 'Sınıf'];
    subjects.forEach(sub => {
      headers.push(`${sub.name} D`);
      headers.push(`${sub.name} Y`);
    });

    const sampleRow = ['1001', 'Ahmet', 'Yılmaz', '8/A'];
    subjects.forEach(() => {
      sampleRow.push('10');
      sampleRow.push('3');
    });

    const csv = [headers.join(','), sampleRow.join(',')].join('\n');
    UI.downloadFile('\uFEFF' + csv, 'deneme_sonuc_sablonu.csv', 'text/csv;charset=utf-8');
    UI.toast('Şablon dosyası indirildi', 'success');
  },

  // ---- Process Excel/CSV File ----
  async processExcelFile(file) {
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      let data;

      if (ext === 'csv') {
        const text = await file.text();
        data = this.parseCSV(text);
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      }

      if (!data || data.length < 2) {
        UI.toast('Dosyada yeterli veri bulunamadı', 'danger');
        return;
      }

      this.currentFile = file;
      this.showExcelPreview(data);
    } catch (err) {
      console.error('Excel parse error:', err);
      UI.toast('Dosya okunurken hata oluştu: ' + err.message, 'danger');
    }
  },

  // ---- Parse CSV ----
  parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    return lines.map(line => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if ((ch === ',' || ch === ';') && !inQuotes) { result.push(current.trim()); current = ''; }
        else { current += ch; }
      }
      result.push(current.trim());
      return result;
    });
  },

  // ---- Show Excel Preview ----
  showExcelPreview(data) {
    const headers = data[0].map(h => String(h || '').trim());
    const rows = data.slice(1).filter(r => r.some(cell => cell !== '' && cell != null));
    const examType = this.getSelectedExamType('excel');

    // Auto-detect column mapping
    this.columnMapping = this.autoMapColumns(headers, examType);
    this.parsedData = rows;
    this.headers = headers;

    // Render column mapping
    const mappingHtml = this.renderColumnMapping(headers, 'excel', examType);
    document.getElementById('excel-column-mapping').innerHTML = mappingHtml;

    // Render preview table
    this.renderPreviewTable(headers, rows, 'excel');

    document.getElementById('excel-preview-section').style.display = '';
    document.getElementById('excel-preview-count').textContent = `${rows.length} satır bulundu`;
  },

  // ---- Auto-map columns ----
  autoMapColumns(headers, examType) {
    const mapping = {};

    const cleanHeaders = headers.map(h => normalizeTrText(h));

    // 1. Full name patterns (Single column containing both First and Last name)
    const fullNamePatterns = [
      'öğrenci ve ad soyad', 'ogrenci ve ad soyad', 'ögrenci ve ad soyad', 'öğrenci ad ve soyad',
      'adı soyadı', 'adi soyadi', 'ad soyad', 'adı ve soyadı', 'adi ve soyadi',
      'öğrenci adı soyadı', 'ogrenci adi soyadi', 'öğrenci adı', 'ogrenci adi',
      'öğrenci ad soyad', 'isim soyisim', 'öğrenci', 'ogrenci', 'isim'
    ];

    // 2. Separate First Name
    const firstNamePatterns = ['adı', 'adi', 'ad', 'first'];

    // 3. Separate Last Name
    const lastNamePatterns = ['soyadı', 'soyadi', 'soyad', 'soy ad', 'last'];

    // 4. School Number
    const schoolNumberPatterns = [
      'öğrenci okul no', 'ogrenci okul no', 'okul no', 'öğrenci no', 'ogrenci no',
      'okulno', 'okul_no', 'öğr no', 'öğr. no', 'ogr no', 'numara', 'numarası', 'numarasi'
    ];

    // 5. Class Name
    const classPatterns = [
      'öğrencinin sınıfı', 'ogrencinin sinifi', 'öğrenci sınıfı', 'ogrenci sinifi', 'ögrenci sınıfı', 'ögrenci sinifi',
      'sınıfı', 'sinifi', 'sınıf', 'sinif', 'şubesi', 'subesi', 'şube', 'sube', 'class', 'sube/sinif', 'sinif/sube'
    ];

    // Check for School Number (exact or standard token match)
    cleanHeaders.forEach((h, idx) => {
      if (schoolNumberPatterns.some(p => h === p || h.startsWith(p + ' ') || h.endsWith(' ' + p))) {
        if (!mapping.schoolNumber) mapping.schoolNumber = idx;
      }
    });

    // Check for Class
    cleanHeaders.forEach((h, idx) => {
      if (classPatterns.some(p => h === p || h.includes(p))) {
        if (!mapping.className) mapping.className = idx;
      }
    });

    // Check for Combined Full Name first
    let foundFullName = false;
    cleanHeaders.forEach((h, idx) => {
      if (!foundFullName && fullNamePatterns.some(p => h === p || h.includes(p))) {
        mapping.fullName = idx;
        foundFullName = true;
      }
    });

    // If no combined full name, check separate First and Last Name
    if (!foundFullName) {
      cleanHeaders.forEach((h, idx) => {
        if (!mapping.lastName && lastNamePatterns.some(p => h === p || h.endsWith(' ' + p))) {
          mapping.lastName = idx;
        } else if (!mapping.firstName && firstNamePatterns.some(p => h === p || h.endsWith(' ' + p))) {
          mapping.firstName = idx;
        }
      });
    }

    // Subject prefixes and type detectors (seçilen sınav türünün ders setinden üretilir)
    const subjectKeywords = {};
    getSubjectsForExam(examType).forEach(sub => {
      subjectKeywords[sub.key] = sub.keywords || [normalizeTrText(sub.name)];
    });

    cleanHeaders.forEach((h, idx) => {
      for (const [subKey, keywords] of Object.entries(subjectKeywords)) {
        const matchesSubject = keywords.some(k => h.includes(k));
        if (matchesSubject) {
          // Check for Doğru (Correct)
          if (
            h.includes(' d') || h.endsWith('d') || h.includes('doğru') || h.includes('dogru') || h.includes(' c')
          ) {
            if (!mapping[`${subKey}_correct`]) mapping[`${subKey}_correct`] = idx;
          }
          // Check for Yanlış (Wrong)
          else if (
            h.includes(' y') || h.endsWith('y') || h.includes('yanlış') || h.includes('yanlis') || h.includes(' w')
          ) {
            if (!mapping[`${subKey}_wrong`]) mapping[`${subKey}_wrong`] = idx;
          }
          // Check for Net
          else if (
            h.includes(' n') || h.endsWith('n') || h.includes('net')
          ) {
            if (!mapping[`${subKey}_net`]) mapping[`${subKey}_net`] = idx;
          }
        }
      }
    });

    return mapping;
  },

  // ---- Render Column Mapping UI ----
  renderColumnMapping(headers, prefix, examType) {
    const fields = [
      { key: 'schoolNumber', label: 'Okul No', required: false },
      { key: 'fullName', label: 'Ad Soyad (Tek Sütun)', required: false },
      { key: 'firstName', label: 'Ad (Ayrı İse)', required: false },
      { key: 'lastName', label: 'Soyad (Ayrı İse)', required: false },
      { key: 'className', label: 'Sınıf', required: false },
    ];

    getSubjectsForExam(examType).forEach(sub => {
      fields.push({ key: `${sub.key}_correct`, label: `${sub.name} Doğru`, required: false });
      fields.push({ key: `${sub.key}_wrong`, label: `${sub.name} Yanlış`, required: false });
      fields.push({ key: `${sub.key}_net`, label: `${sub.name} Net`, required: false });
    });

    return fields.map(f => {
      const options = headers.map((h, idx) =>
        `<option value="${idx}" ${this.columnMapping[f.key] === idx ? 'selected' : ''}>${h}</option>`
      ).join('');
      return `
        <div class="mapping-item">
          <label>${f.label} ${f.required ? '<span style="color:var(--danger)">*</span>' : ''}</label>
          <select class="form-select" data-field="${f.key}" data-prefix="${prefix}" onchange="ImportModule.updateMapping(this)">
            <option value="">-- Seçin --</option>
            ${options}
          </select>
        </div>
      `;
    }).join('');
  },

  updateMapping(selectEl) {
    const field = selectEl.dataset.field;
    const val = selectEl.value;
    if (val === '') {
      delete this.columnMapping[field];
    } else {
      this.columnMapping[field] = parseInt(val);
    }
  },

  // ---- Render Preview Table ----
  renderPreviewTable(headers, rows, prefix) {
    let html = '<table><thead><tr>';
    headers.forEach(h => { html += `<th>${h}</th>`; });
    html += '</tr></thead><tbody>';

    const maxPreview = Math.min(rows.length, 50);
    for (let i = 0; i < maxPreview; i++) {
      html += '<tr>';
      rows[i].forEach(cell => { html += `<td>${cell ?? ''}</td>`; });
      html += '</tr>';
    }

    html += '</tbody></table>';
    if (rows.length > 50) {
      html += `<p class="text-muted text-center mt-1">...ve ${rows.length - 50} satır daha</p>`;
    }
    document.getElementById(`${prefix}-preview-table`).innerHTML = html;
  },

  // Helper to extract rows to import
  buildRowsToImport(examType) {
    const mapping = this.columnMapping;
    const rowsToImport = [];

    for (const row of this.parsedData) {
      let schoolNumber = mapping.schoolNumber != null ? String(row[mapping.schoolNumber] ?? '').trim() : '';
      let firstName = '';
      let lastName = '';
      let className = mapping.className != null ? normalizeClassName(row[mapping.className] ?? '') : '';

      if (mapping.fullName != null) {
        const full = String(row[mapping.fullName] ?? '').trim();
        if (full) {
          const parts = full.split(/\s+/);
          if (parts.length === 1) {
            firstName = parts[0];
            lastName = '';
          } else {
            firstName = parts.slice(0, -1).join(' ');
            lastName = parts[parts.length - 1];
          }
        }
      } else if (mapping.firstName != null && mapping.lastName != null && mapping.firstName === mapping.lastName) {
        const full = String(row[mapping.firstName] ?? '').trim();
        if (full) {
          const parts = full.split(/\s+/);
          firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
          lastName = parts.length > 1 ? parts[parts.length - 1] : '';
        }
      } else {
        firstName = mapping.firstName != null ? String(row[mapping.firstName] ?? '').trim() : '';
        lastName = mapping.lastName != null ? String(row[mapping.lastName] ?? '').trim() : '';
        if (firstName.includes(' ') && !lastName) {
          const parts = firstName.split(/\s+/);
          firstName = parts.slice(0, -1).join(' ');
          lastName = parts[parts.length - 1];
        }
      }

      if (!schoolNumber && !firstName) continue;

      const subjects = {};
      getSubjectsForExam(examType).forEach(sub => {
        const correctIdx = mapping[`${sub.key}_correct`];
        const wrongIdx = mapping[`${sub.key}_wrong`];
        const netIdx = mapping[`${sub.key}_net`];

        let correct = 0, wrong = 0;
        if (correctIdx != null) {
          const raw = String(row[correctIdx] ?? '').replace(',', '.').trim();
          correct = parseInt(raw, 10) || 0;
        }
        if (wrongIdx != null) {
          const raw = String(row[wrongIdx] ?? '').replace(',', '.').trim();
          wrong = parseInt(raw, 10) || 0;
        }

        if (netIdx != null && correctIdx == null) {
          const raw = String(row[netIdx] ?? '').replace(',', '.').trim();
          const net = parseFloat(raw) || 0;
          correct = net;
          wrong = 0;
        }

        subjects[sub.key] = { correct, wrong };
      });

      rowsToImport.push({
        studentData: { schoolNumber, firstName, lastName, className },
        subjects,
      });
    }

    return rowsToImport;
  },

  // ---- Import Excel Data ----
  async importExcelData() {
    const examId = await this.getOrCreateExam('excel');
    if (!examId) return;

    const mapping = this.columnMapping;
    if (mapping.schoolNumber == null && mapping.fullName == null && mapping.firstName == null) {
      UI.toast('Lütfen en azından Okul No veya Ad Soyad sütununu eşleştirin', 'warning');
      return;
    }

    const exam = await db.getExam(examId);
    const rowsToImport = this.buildRowsToImport(exam?.examType || 'LGS');
    if (rowsToImport.length === 0) {
      UI.toast('İçe aktarılacak geçerli satır bulunamadı', 'warning');
      return;
    }

    const res = await db.batchImportResults(examId, rowsToImport);
    await db.repairAndLinkStudents();

    UI.toast(`${res.imported} sonuç başarıyla içe aktarıldı ve öğrencilerle eşleştirildi!${res.errors > 0 ? ` (${res.errors} hata)` : ''}`, res.errors > 0 ? 'warning' : 'success');
    this.clearExcelPreview();
    this.loadExamSelects();

    if (typeof App !== 'undefined') App.refreshCurrentPage();
  },

  clearExcelPreview() {
    document.getElementById('excel-preview-section').style.display = 'none';
    document.getElementById('excel-column-mapping').innerHTML = '';
    document.getElementById('excel-preview-table').innerHTML = '';
    this.parsedData = [];
    this.headers = [];
    this.columnMapping = {};
    const input = document.getElementById('excel-file-input');
    if (input) input.value = '';
  },

  // ---- Process PDF File (Advanced Structure & Table Extraction) ----
  async processPDFFile(file) {
    try {
      document.getElementById('pdf-processing').style.display = '';
      document.getElementById('pdf-preview-section').style.display = 'none';

      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

      // Extract raw text lines across all pages
      const rawPages = await this.extractPDFRawPages(pdf);

      // 1. Try specialized Deneme Result List Parser (e.g. Haruniye, Nartest, KDS, Karnemiz vb.)
      let extractedTable = this.parseDenemeListPDF(rawPages);

      // 2. If not a standard deneme list, fallback to generalized geometric table extraction
      if (!extractedTable || extractedTable.rows.length === 0) {
        extractedTable = await this.extractStructuredPDFTable(pdf, rawPages);
      }

      document.getElementById('pdf-processing').style.display = 'none';

      if (!extractedTable || extractedTable.rows.length === 0) {
        UI.toast('PDF dosyasında okunabilir tablo verisi bulunamadı', 'danger');
        return;
      }

      this.currentFile = file;
      this.headers = extractedTable.headers;
      this.parsedData = extractedTable.rows;

      this.showPDFPreview(extractedTable.headers, extractedTable.rows);
    } catch (err) {
      console.error('PDF parse error:', err);
      document.getElementById('pdf-processing').style.display = 'none';
      UI.toast('PDF okunurken hata oluştu: ' + err.message, 'danger');
    }
  },

  // Extract raw text lines from PDF pages
  async extractPDFRawPages(pdf) {
    const rawPages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const items = textContent.items
        .map(item => ({
          text: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || (item.str.length * 6),
          height: item.height || Math.abs(item.transform[0]) || 10,
        }))
        .filter(item => item.text.length > 0);

      if (items.length === 0) continue;

      items.sort((a, b) => b.y - a.y);

      const lines = [];
      let curLine = [items[0]];
      let curY = items[0].y;

      for (let i = 1; i < items.length; i++) {
        const it = items[i];
        if (Math.abs(it.y - curY) <= 5.0) {
          curLine.push(it);
        } else {
          curLine.sort((a, b) => a.x - b.x);
          lines.push(curLine);
          curLine = [it];
          curY = it.y;
        }
      }
      if (curLine.length > 0) {
        curLine.sort((a, b) => a.x - b.x);
        lines.push(curLine);
      }

      rawPages.push({ pageNum, lines });
    }

    return rawPages;
  },

  // Specialized Parser for Deneme Result Lists (Net Listesi)
  parseDenemeListPDF(rawPages) {
    const dataRows = [];
    const ignoreKeywords = [
      'ortalamas', 'ortalama', 'okul net listesi', 'turkiye geneli', 'türkiye geneli',
      'nartest', 'sinav adi', 'sınav adı', 'ilce', 'ilçe', 'puan-1', 'sayfa', 'kodu',
      'haruniye ortaokulu', 'kurum', 'dereceler'
    ];

    rawPages.forEach(page => {
      page.lines.forEach(line => {
        const fullLineText = line.map(it => it.text).join(' ').trim();
        const normText = normalizeTrText(fullLineText);

        if (ignoreKeywords.some(kw => normText.includes(kw))) return;
        if (normText.startsWith('d y n') || normText.includes('turkce sosyal')) return;

        const tokens = fullLineText.split(/\s+/).filter(t => t.length > 0);
        if (tokens.length < 15) return;

        // Check if starts with row sequence number
        if (!/^\d{1,4}$/.test(tokens[0])) return;

        // Find the class token (e.g. 5/A, 5-A, 5A, 6A, 6/G, 6-G, 6, 7A, 8A, or 5..8)
        let classIdx = -1;
        for (let i = 1; i < tokens.length - 15; i++) {
          if (/^(?:[1-9]|1[0-2])[\/\-\.\_\s]?[A-Za-zĞÜŞİÖÇğüşiöç]?$/i.test(tokens[i])) {
            let isFollowedByNumbers = true;
            for (let j = i + 1; j <= Math.min(tokens.length - 1, i + 5); j++) {
              if (!/^[\d,.\-+]+$/.test(tokens[j])) {
                isFollowedByNumbers = false;
                break;
              }
            }
            if (isFollowedByNumbers) {
              classIdx = i;
              break;
            }
          }
        }

        if (classIdx === -1) {
          // If class index not found by pattern, attempt to find by backwards counting numbers
          let numCount = 0;
          for (let i = tokens.length - 1; i >= 1; i--) {
            if (/^[\d,.\-+]+$/.test(tokens[i])) {
              numCount++;
            } else {
              if (numCount >= 18) {
                classIdx = i;
              }
              break;
            }
          }
        }

        if (classIdx !== -1) {
          const sira = tokens[0];
          const frontTokens = tokens.slice(1, classIdx);
          const className = normalizeClassName(tokens[classIdx] || '');
          const scoreTokens = tokens.slice(classIdx + 1);

          if (scoreTokens.length >= 18) {
            let ogrNo = '';
            let nameTokens = [];

            if (frontTokens.length > 0) {
              if (/^\d+$/.test(frontTokens[0])) {
                if (frontTokens.length > 1 && /^\d+$/.test(frontTokens[1])) {
                  ogrNo = frontTokens[0] + frontTokens[1];
                  nameTokens = frontTokens.slice(2);
                } else {
                  ogrNo = frontTokens[0];
                  nameTokens = frontTokens.slice(1);
                }
              } else {
                ogrNo = '';
                nameTokens = frontTokens;
              }
            }

            let fullName = nameTokens.join(' ');
            // Clean OCR spacing & character joins
            fullName = fullName
              .replace(/YUSU\s+F/g, 'YUSUF')
              .replace(/ÇINAR\s+HALEPLİOĞL$/g, 'ÇINAR HALEPLİOĞLU')
              .replace(/BERRU\s+HALEPLİOĞL$/g, 'BERRU HALEPLİOĞLU')
              .replace(/ABDURRAHMA\s+N/g, 'ABDURRAHMAN')
              .replace(/FEVZİ\s+AKSA\s+Y/g, 'FEVZİ AKSAY')
              .replace(/MUSTAFARID/g, 'MUSTAFA RID')
              .replace(/RÜZG\s+AR/g, 'RÜZGAR')
              .replace(/ONAT\s+ÖZGÜ\s+M\s+RT/g, 'ONAT ÖZGÜMÜRT')
              .replace(/ALPEREN\s+KILIÇPARLA$/g, 'ALPEREN KILIÇPARLAR')
              .replace(/ELİFBM/g, 'ELİF')
              .replace(/MEHM\s+TAKİF/g, 'MEHMET AKİF')
              .replace(/BERKAY\s+DEMİPEİ/g, 'BERKAY DEMİREL')
              .replace(/ABDULLAH\s+SAN\s+AR/g, 'ABDULLAH SANCAR')
              .replace(/AHMET\s+BURA\s+K/g, 'AHMET BURAK')
              .replace(/BERKAY\s+YILDIRI\s+M/g, 'BERKAY YILDIRIM')
              .replace(/YAĞIZMEHME\s+SARIÇİÇEK/g, 'YAĞIZ MEHMET SARIÇİÇEK')
              .replace(/YAĞIZMEHME/g, 'YAĞIZ MEHMET')
              .replace(/İBRAHİ\s+EFE/g, 'İBRAHİM EFE')
              .replace(/İKRA\s+İZ\*İ/g, 'İKRA İZGİ');

            const turk_d = scoreTokens[0] || '0';
            const turk_y = scoreTokens[1] || '0';
            const turk_n = scoreTokens[2] || '0';

            const sos_d = scoreTokens[3] || '0';
            const sos_y = scoreTokens[4] || '0';
            const sos_n = scoreTokens[5] || '0';

            const din_d = scoreTokens[6] || '0';
            const din_y = scoreTokens[7] || '0';
            const din_n = scoreTokens[8] || '0';

            const ing_d = scoreTokens[9] || '0';
            const ing_y = scoreTokens[10] || '0';
            const ing_n = scoreTokens[11] || '0';

            const mat_d = scoreTokens[12] || '0';
            const mat_y = scoreTokens[13] || '0';
            const mat_n = scoreTokens[14] || '0';

            const fen_d = scoreTokens[15] || '0';
            const fen_y = scoreTokens[16] || '0';
            const fen_n = scoreTokens[17] || '0';

            let puan = '';
            if (scoreTokens.length >= 22) {
              puan = scoreTokens[21] || '';
            }

            dataRows.push([
              sira,
              ogrNo,
              fullName,
              className,
              turk_d,
              turk_y,
              turk_n,
              sos_d,
              sos_y,
              sos_n,
              din_d,
              din_y,
              din_n,
              ing_d,
              ing_y,
              ing_n,
              mat_d,
              mat_y,
              mat_n,
              fen_d,
              fen_y,
              fen_n,
              puan
            ]);
          }
        }
      });
    });

    if (dataRows.length >= 2) {
      const headers = [
        'sıra',
        'Öğrenci OKUL NO',
        'Ögrenci ve ad soyad',
        'Ögrenci sınıfı',
        'TÜRKÇE doğru',
        'TÜRKÇE Yanlış',
        'TÜRKÇE Net',
        'SOSYAL BİLGİLER ve inkilap Doğru',
        'SOSYAL BİLGİLER  ve inkilap Yanlış',
        'SOSYAL BİLGİLER  ve inkilap Net',
        'DİN KÜLTÜRÜ AHL Doğru',
        'DİN KÜLTÜRÜ AHL Yanlış',
        'DİN KÜLTÜRÜ AHL net',
        'İNGİLİZCE Doğru',
        'İNGİLİZCE Yanlış',
        'İNGİLİZCE Net',
        'MATEMATİK Doğru',
        'MATEMATİK Yanlış',
        'MATEMATİK Net',
        'FEN BİLİMLERİ Doğru',
        'FEN BİLİMLERİ Yanlış',
        'FEN BİLİMLERİ net',
        'Puan'
      ];
      return { headers, rows: dataRows };
    }

    return null;
  },

  async extractStructuredPDFTable(pdf, preExtractedPages) {
    const rawPages = preExtractedPages || await this.extractPDFRawPages(pdf);

    // Detect column anchors (X-binning) across candidate table lines
    const allTableLines = [];
    const xCoordinates = [];

    rawPages.forEach(p => {
      p.lines.forEach(line => {
        if (line.length >= 3) {
          allTableLines.push(line);
          line.forEach(item => {
            xCoordinates.push(item.x);
          });
        }
      });
    });

    if (xCoordinates.length === 0) return null;

    // Cluster X coordinates into distinct column positions (tolerance ~14px)
    xCoordinates.sort((a, b) => a - b);
    const colClusters = [];
    let curCluster = [xCoordinates[0]];

    for (let i = 1; i < xCoordinates.length; i++) {
      const x = xCoordinates[i];
      const clusterAvg = curCluster.reduce((sum, v) => sum + v, 0) / curCluster.length;
      if (Math.abs(x - clusterAvg) <= 14) {
        curCluster.push(x);
      } else {
        colClusters.push({
          xCenter: clusterAvg,
          count: curCluster.length,
        });
        curCluster = [x];
      }
    }
    if (curCluster.length > 0) {
      colClusters.push({
        xCenter: curCluster.reduce((sum, v) => sum + v, 0) / curCluster.length,
        count: curCluster.length,
      });
    }

    // Keep column clusters that have sufficient occurrences across rows
    const minOccurrences = Math.max(2, Math.floor(allTableLines.length * 0.05));
    const validColumns = colClusters
      .filter(c => c.count >= minOccurrences)
      .sort((a, b) => a.xCenter - b.xCenter);

    if (validColumns.length < 3) {
      validColumns.length = 0;
      colClusters.forEach(c => validColumns.push(c));
      validColumns.sort((a, b) => a.xCenter - b.xCenter);
    }

    // Find the Table Header Row(s)
    const headerKeywords = [
      'okul', 'no', 'ad', 'soyad', 'isim', 'sinif', 'sınıf', 'şube', 'sube',
      'turkce', 'türkçe', 'matematik', 'mat', 'fen', 'inkilap', 'inkılap',
      'din', 'ingilizce', 'ing', 'dogru', 'doğru', 'yanlis', 'yanlış',
      'net', 'toplam', 'puan', 'sira', 'sıra', 'd', 'y', 'n'
    ];

    let headerLineIndices = [];
    let bestHeaderScore = 0;

    const firstPageLines = rawPages[0].lines;
    firstPageLines.forEach((line, idx) => {
      const lineText = line.map(it => normalizeTrText(it.text)).join(' ');
      let score = 0;
      headerKeywords.forEach(kw => {
        if (lineText.includes(kw)) score++;
      });
      if (score >= 2 && score > bestHeaderScore) {
        bestHeaderScore = score;
        headerLineIndices = [idx];
        if (idx + 1 < firstPageLines.length) {
          const nextText = firstPageLines[idx + 1].map(it => normalizeTrText(it.text)).join(' ');
          let nextScore = 0;
          headerKeywords.forEach(kw => { if (nextText.includes(kw)) nextScore++; });
          if (nextScore >= 2) headerLineIndices.push(idx + 1);
        }
      }
    });

    // Helper to slot a line's items into columns
    function slotLineIntoColumns(line) {
      const row = Array(validColumns.length).fill('');
      line.forEach(item => {
        let bestCol = 0;
        let minDiff = Infinity;
        for (let c = 0; c < validColumns.length; c++) {
          const diff = Math.abs(item.x - validColumns[c].xCenter);
          if (diff < minDiff) {
            minDiff = diff;
            bestCol = c;
          }
        }
        if (row[bestCol]) {
          row[bestCol] += ' ' + item.text;
        } else {
          row[bestCol] = item.text;
        }
      });
      return row;
    }

    // Build Headers
    let headerRow = [];
    if (headerLineIndices.length === 1) {
      headerRow = slotLineIntoColumns(firstPageLines[headerLineIndices[0]]);
    } else if (headerLineIndices.length > 1) {
      const r1 = slotLineIntoColumns(firstPageLines[headerLineIndices[0]]);
      const r2 = slotLineIntoColumns(firstPageLines[headerLineIndices[1]]);

      let lastSubject = '';
      const filledR1 = r1.map(val => {
        const clean = normalizeTrText(val);
        if (clean && !['d', 'y', 'n', 'doğru', 'yanlış', 'net'].includes(clean)) {
          lastSubject = val;
        }
        return lastSubject || val;
      });

      headerRow = validColumns.map((_, i) => {
        const top = filledR1[i] || '';
        const bot = r2[i] || '';
        if (top && bot && top !== bot) {
          return `${top} ${bot}`.trim();
        }
        return (top || bot || `Sütun ${i + 1}`).trim();
      });
    } else {
      headerRow = validColumns.map((_, i) => `Sütun ${i + 1}`);
    }

    // Process all Student Data Rows
    const dataRows = [];

    rawPages.forEach(page => {
      page.lines.forEach((line, lIdx) => {
        if (page.pageNum === 1 && headerLineIndices.includes(lIdx)) return;

        const lineText = line.map(it => normalizeTrText(it.text)).join(' ');
        let hScore = 0;
        headerKeywords.forEach(kw => { if (lineText.includes(kw)) hScore++; });
        if (hScore >= 4) return; // Repeated header line

        if (line.length <= 2 && (lineText.includes('sayfa') || lineText.includes('rapor') || lineText.includes('tarih'))) return;

        const rowCells = slotLineIntoColumns(line);

        const filledCells = rowCells.filter(c => c.trim().length > 0);
        if (filledCells.length >= 2) {
          const hasData = rowCells.some(c => /\d/.test(c) || /[a-zA-ZğüşıöçĞÜŞİÖÇ]{3,}/.test(c));
          if (hasData) {
            dataRows.push(rowCells);
          }
        }
      });
    });

    return {
      headers: headerRow,
      rows: dataRows
    };
  },

  // ---- Show PDF Preview ----
  showPDFPreview(headers, rows) {
    const examType = this.getSelectedExamType('pdf');
    this.columnMapping = this.autoMapColumns(headers, examType);
    this.parsedData = rows;

    const mappingHtml = this.renderColumnMapping(headers, 'pdf', examType);
    document.getElementById('pdf-column-mapping').innerHTML = mappingHtml;

    this.renderPreviewTable(headers, rows, 'pdf');

    document.getElementById('pdf-preview-section').style.display = '';
    document.getElementById('pdf-preview-count').textContent = `${rows.length} satır bulundu`;
  },

  // ---- Download extracted PDF data as clean CSV file (semicolon delimited with UTF-8 BOM) ----
  downloadPDFAsCSV() {
    if (!this.parsedData || this.parsedData.length === 0) {
      UI.toast('İndirilecek veri bulunamadı', 'warning');
      return;
    }

    const headers = this.headers || (this.parsedData[0] ? this.parsedData[0].map((_, i) => `Sütun ${i + 1}`) : []);
    const rows = [headers, ...this.parsedData];

    const csvContent = rows.map(row =>
      row.map(val => {
        const str = String(val ?? '');
        if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(';')
    ).join('\r\n');

    const baseName = (this.currentFile?.name?.replace(/\.[^/.]+$/, '') || 'deneme_sonuclari');
    UI.downloadFile('\uFEFF' + csvContent, `${baseName}.csv`, 'text/csv;charset=utf-8');
    UI.toast('Veriler CSV (.csv) formatında indirildi!', 'success');
  },

  // ---- Download extracted PDF data as clean Excel file ----
  downloadPDFAsExcel() {
    if (!this.parsedData || this.parsedData.length === 0) {
      UI.toast('İndirilecek veri bulunamadı', 'warning');
      return;
    }

    const headers = this.headers || (this.parsedData[0] ? this.parsedData[0].map((_, i) => `Sütun ${i + 1}`) : []);
    const aoa = [headers, ...this.parsedData];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deneme_Sonuclari');

    const baseName = (this.currentFile?.name?.replace(/\.[^/.]+$/, '') || 'pdf_deneme_sonuclari');
    XLSX.writeFile(wb, `${baseName}_ayiklanmis.xlsx`);
    UI.toast('Ayıklanan veriler Excel (.xlsx) olarak indirildi!', 'success');
  },

  // ---- Import PDF Data ----
  async importPDFData() {
    const examId = await this.getOrCreateExam('pdf');
    if (!examId) return;

    const mapping = this.columnMapping;
    if (mapping.schoolNumber == null && mapping.fullName == null && mapping.firstName == null) {
      UI.toast('Lütfen en azından Okul No veya Ad Soyad sütununu eşleştirin', 'warning');
      return;
    }

    const exam = await db.getExam(examId);
    const rowsToImport = this.buildRowsToImport(exam?.examType || 'LGS');
    if (rowsToImport.length === 0) {
      UI.toast('İçe aktarılacak geçerli satır bulunamadı', 'warning');
      return;
    }

    const res = await db.batchImportResults(examId, rowsToImport);
    await db.repairAndLinkStudents();

    UI.toast(`${res.imported} sonuç başarıyla içe aktarıldı ve öğrencilerle eşleştirildi!${res.errors > 0 ? ` (${res.errors} hata)` : ''}`, res.errors > 0 ? 'warning' : 'success');
    this.clearPDFPreview();
    this.loadExamSelects();
    if (typeof App !== 'undefined') App.refreshCurrentPage();
  },

  clearPDFPreview() {
    document.getElementById('pdf-preview-section').style.display = 'none';
    document.getElementById('pdf-column-mapping').innerHTML = '';
    document.getElementById('pdf-preview-table').innerHTML = '';
    this.parsedData = [];
    this.headers = [];
    this.columnMapping = {};
    const input = document.getElementById('pdf-file-input');
    if (input) input.value = '';
  },

  // ---- Optical / TXT Import UI ----
  _opticalExamType: 'LGS',
  _opticalProfiles: [],
  _opticalBlockOverrides: {},

  renderOpticalImport() {
    return `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 class="card-title"><span class="card-icon">🔤</span> Optik / TXT Dosyası ile Otomatik Değerlendirme</h3>
            <p class="text-muted" style="font-size:12px;margin-top:2px;">
              Farklı okul/optik firması formatlarını otomatik tanır (ya da yeni bir format tanımlamanı sağlar), cevap anahtarına göre Doğru/Yanlış/Boş ve Net analizini yapar.
            </p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.loadSampleOpticalData()">
            ✨ Örnek Test Verisi Yükle
          </button>
        </div>

        <!-- Deneme Seçimi -->
        <div class="form-row mt-2">
          <div class="form-group">
            <label class="form-label">Deneme Seçin veya Yeni Oluşturun</label>
            <select class="form-select" id="optical-exam-select" onchange="ImportModule.onImportExamSelectChange('optical')">
              <option value="">-- Deneme seçin --</option>
              <option value="__new__">+ Yeni Deneme Oluştur</option>
            </select>
          </div>
          <div class="form-group" id="optical-new-exam-group" style="display:none">
            <label class="form-label">Yeni Deneme Adı</label>
            <div class="form-inline">
              <input type="text" class="form-input" id="optical-new-exam-name" placeholder="Örn: 8. Sınıf KDS Deneme 1">
              <input type="date" class="form-input" id="optical-new-exam-date" style="width:180px">
            </div>
          </div>
        </div>
        <div class="form-row" id="optical-new-exam-type-row" style="display:none">
          <div class="form-group">
            <label class="form-label">Yeni Denemenin Sınav Türü</label>
            <select class="form-select" id="optical-new-exam-type">
              ${Object.keys(EXAM_TYPE_LABELS).map(t => `<option value="${t}">${EXAM_TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Format Tespiti / Seçimi -->
        <div class="card mt-2" style="background:var(--bg-secondary);border:1px solid rgba(255,255,255,0.08);padding:16px;border-radius:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <h4 style="margin:0;font-size:15px;display:flex;align-items:center;gap:6px;"><span>🧬</span> Optik Format</h4>
            <span id="optical-detected-format-info" class="text-muted" style="font-size:12px;">Henüz veri girilmedi.</span>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Format Profili</label>
            <select class="form-select" id="optical-profile-select" onchange="ImportModule.onOpticalProfileChange()">
              <option value="">-- Önce veri girin --</option>
            </select>
          </div>
          <div id="optical-block-mapping" class="mt-2"></div>
          <div id="optical-calibrator" class="mt-2" style="display:none"></div>
        </div>

        <!-- Cevap Anahtarları -->
        <div class="card mt-2" style="background:var(--bg-secondary);border:1px solid rgba(255,255,255,0.08);padding:16px;border-radius:12px;">
          <h4 style="margin:0 0 12px;font-size:15px;display:flex;align-items:center;gap:6px;"><span>🔑</span> Cevap Anahtarları</h4>
          <div id="optical-answer-keys" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px;"></div>
        </div>

        <!-- Dosya Yükleme veya Metin Yapıştırma -->
        <div class="drop-zone mt-2" id="optical-drop-zone" style="padding:24px;">
          <div class="drop-icon" style="font-size:32px;">📑</div>
          <h3 style="font-size:15px;margin:4px 0;">Optik / TXT dosyasını sürükleyip bırakın veya tıklayın</h3>
          <p style="font-size:12px;">Birden fazla dosya sırayla yüklenirse (ör. sayısal.txt + sözel.txt) aynı öğrencinin satırları otomatik birleştirilir</p>
          <input type="file" id="optical-file-input" accept=".txt,.dat,.csv" style="display:none">
        </div>

        <div class="form-group mt-2">
          <label class="form-label" style="display:flex;justify-content:space-between;">
            <span>Veya Optik Satırlarını Buraya Yapıştırın:</span>
            <span class="text-muted" style="font-size:11px;">(Her satır 1 öğrenci)</span>
          </label>
          <textarea id="optical-raw-textarea" class="form-input font-mono" rows="6" placeholder="Optik satırlarını buraya yapıştırın..." style="font-size:11px;line-height:1.4;white-space:pre;overflow-x:auto;" oninput="ImportModule.onOpticalContentChange()"></textarea>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-ghost btn-sm" onclick="ImportModule.clearOpticalPreview(true)">🗑 Metni Temizle</button>
          <button type="button" class="btn btn-primary btn-lg" onclick="ImportModule.evaluateOpticalData()">
            ⚡ Optik Verileri Analiz Et & Değerlendir
          </button>
        </div>

        <!-- Önizleme ve Sonuç Tablosu Bölümü -->
        <div id="optical-preview-section" style="display:none;" class="mt-3">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <h3 class="card-title"><span class="card-icon">📊</span> Değerlendirme & Sonuç Tablosu</h3>
              <span class="badge badge-success" id="optical-preview-count">0 Öğrenci</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm" onclick="ImportModule.downloadOpticalAsCSV()">📥 CSV İndir (.csv)</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.downloadOpticalAsExcel()">📊 Excel İndir (.xlsx)</button>
            </div>
          </div>

          <!-- Özet Kartları -->
          <div id="optical-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;margin-bottom:16px;"></div>

          <!-- Sonuç Tablosu -->
          <div id="optical-preview-table" class="preview-table-container" style="max-height:480px;overflow:auto;"></div>

          <div style="margin-top:16px;display:flex;gap:12px;justify-content:flex-end;align-items:center;">
            <button class="btn btn-ghost" onclick="ImportModule.clearOpticalPreview()">Temizle</button>
            <button class="btn btn-success btn-lg" onclick="ImportModule.importOpticalData()">
              ✅ Verileri Sisteme Aktar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // Optik sekmesi ilk render edildiğinde format profili listesini doldurur
  async initOpticalTab() {
    this._opticalProfiles = await OptikProfiles.getAllProfiles();
    const sel = document.getElementById('optical-profile-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Otomatik tespit edilecek --</option>' +
      this._opticalProfiles.map(p => `<option value="${p.id}">${p.builtIn ? '' : '⭐ '}${p.label} (${EXAM_TYPE_LABELS[p.examType] || p.examType})</option>`).join('') +
      '<option value="__calibrate__">➕ Yeni format tanımla (Kalibratör)</option>';
  },

  // Process Optical File - Türkçe karakter kodlamasını otomatik algıla.
  // Yeni dosya, mevcut metnin ÜZERİNE değil SONUNA eklenir - böylece
  // sayısal.txt + sözel.txt gibi aynı denemenin iki parçası art arda
  // yüklenip birlikte değerlendirilebilir (bkz. mergeOpticalRows).
  async processOpticalFile(file) {
    try {
      const text = await this._readFileWithTurkishEncoding(file);
      const textarea = document.getElementById('optical-raw-textarea');
      if (textarea) {
        textarea.value = textarea.value.trim() ? `${textarea.value.replace(/\s+$/, '')}\n${text}` : text;
      }
      this.onOpticalContentChange();
      UI.toast(`"${file.name}" eklendi (${text.split(/\r?\n/).filter(l => l.trim()).length} satır)`, 'success');
    } catch (err) {
      console.error('Optical file read error:', err);
      UI.toast('Dosya okunurken hata oluştu: ' + err.message, 'danger');
    }
  },

  // Türkçe optik dosyaları için encoding algılama: CP1254 / ISO-8859-9 / UTF-8
  _readFileWithTurkishEncoding(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target.result;
        const bytes = new Uint8Array(buffer);

        // UTF-8 BOM kontrolü (EF BB BF)
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
          resolve(new TextDecoder('utf-8').decode(buffer));
          return;
        }

        // UTF-8 geçerliliği kontrolü
        let utf8Valid = true;
        let hasHighBytes = false;
        for (let i = 0; i < Math.min(bytes.length, 1000); i++) {
          const b = bytes[i];
          if (b > 0x7F) {
            hasHighBytes = true;
            if ((b & 0xE0) === 0xC0 && i + 1 < bytes.length && (bytes[i+1] & 0xC0) === 0x80) {
              i++;
            } else if ((b & 0xF0) === 0xE0 && i + 2 < bytes.length && (bytes[i+1] & 0xC0) === 0x80 && (bytes[i+2] & 0xC0) === 0x80) {
              i += 2;
            } else {
              utf8Valid = false;
              break;
            }
          }
        }

        // UTF-8 mi yoksa Türkçe Windows mi?
        let encoding = 'utf-8';
        if (!utf8Valid || !hasHighBytes) {
          // Yüksek byte var ama geçerli UTF-8 değil => Windows-1254 (Türkçe)
          encoding = hasHighBytes ? 'windows-1254' : 'utf-8';
        }

        try {
          const text = new TextDecoder(encoding).decode(buffer);
          // Hâlâ bozuk karakter varsa alternatife geç
          if (text.includes('\uFFFD') && encoding === 'utf-8') {
            resolve(new TextDecoder('windows-1254').decode(buffer));
          } else {
            resolve(text);
          }
        } catch (_) {
          resolve(new TextDecoder('windows-1254').decode(buffer));
        }
      };
      reader.onerror = () => reject(new Error('Dosya okunamadı'));
      reader.readAsArrayBuffer(file);
    });
  },

  // Sample data loader
  loadSampleOpticalData() {
    const sample = `7108744962  176ÖMER      TÜRKOĞLU  8C            *A BABDBDCCBDDCB BBCAABA BA DDCD          CAADBCBBDC          ACBDBCBCAB          D  BC DBBDADACD CAD DAAADCBA DBDCCB CBBA
710874496200178VEYSEL    GÜZEL     8B            *ADBABDBCABBDDCBCBBBAABAABACAACD          CAABBCDBDC                              CBDDDBACDBDABCACDDDDBCACAABCCDBDCCDBCDBA
7108      00215NAZLI               8C            *BAADBBCBCDDAACDBDCABDDCADCABDAB          CDBBCBDAAC          BACBCBDDCA          DD C DCDDA ABDAD A AABDDBDCDDBD ABCDAAAD
710874496200190ERVA      TÜRK      8C            *BAABBBCBCDDBCCCBDAABDDCADCABDDB          CDBBCBDBCC          B CBCB B             DAC AA      DAD   CAB CBDCCDBD ABCDADAD
710874496200323AYNUR ELA BİRMO     8A            *BAADBBCBCDDAACDBDACBDDCAACABDDB          CDBBCBDADC           ADBABDB A          BDAC A ADADDBDACD  CDBDCBA CDBDCAB DAAAD
7108744962209  GÜLSÜM    KÖSE      8C            *BAADDBCBCDDBDCDBDCABDDCADCABDAB          CDBBCBDAAC          BACBCBDD A          BCACADC DA AB C  B CABBCB CCDBDCABCDDAAD
7108      00186EDANUR    BOYRAZ                  *ADBAADBDCABDDCBBBBBAABCBCDCDACD          CAADBCBBDC          AC DBCBBA           B   C    B   C  C   DAA  C   DBACC B B A
710874496200198N ZEHRA   KURT      8C            *ADBABDBDCCADCCBCBBDAABADBACDACD          CAADBCBBDC          ABDABCBCAB          CCBBCADBADABACDBCADBDAABDCBACDBDCCDBCBBA
710874496200110MELEK     BEYAZDURNA8C            *BAADBABBCDDBACDBDCABDDCADCABDAB          CDBBCBDAAC          BACACBDDCA          BDDCBDCADADAB ACAABAABCCBDCCDDDCABCDAAAD
710874496200330FATİH     SEVİMLİ   8C            *ADBADDBDCCCCDABCDBDCABADBABDACD          CAADBCBBDC          ACADBCBCAB          CDCACADBADABACB CADBDAAADCBACDBCCCBBCBBA
7108744962  309MÜSLÜM    ÖNER      8C            *BAABBCABCD BA D CAABDDCADBA D B          CDBBCBDBAA          BACBCBCDCA          BDAC A ADA D A CB  AABBC DCCDBD CBC DAAD
710874496200292YUSUF KAANGÖK       8C            *ADB CABD CA CCBCDBCAABADBABAACD          C ADBCDBDC          DDB C B AB          BDBC AB C DBD  AD  BDAAACCA BDBDCCD BDBA
710874496200122İLYAS     ŞAHİN     8D            *BACAD C  D A A CAA B ADABABA  B          CD CABBC D                              BABAADA  ADDAD   B CAC A BC DD B B  A  A
710874496200308RAĞA                8A            *ADBABCBDCABBDCBCCBDAABADCDCDACD          CAADBCBBDC           ABD BBCA           A BBCDC DBADADB CADDDABADD ACDBDCC BC BA
710874496200317ENSAR     GARİP     8D            *AABBACBDCACBDACBD    DAABC DADD          ABADBDBDAA          CADBAD              BDBADDBCABDBACB     ACADBABDBADBACA     `;
    const textarea = document.getElementById('optical-raw-textarea');
    if (textarea) textarea.value = sample;
    const profileSel = document.getElementById('optical-profile-select');
    if (profileSel) profileSel.value = 'lgs-legacy-fixedwidth';
    this.onOpticalContentChange();
  },

  // Yapıştırılan/yüklenen metin değiştikçe: formatı otomatik tespit et,
  // profil seçili değilse (veya "otomatik" ise) en iyi eşleşmeyi öner.
  async onOpticalContentChange() {
    const textarea = document.getElementById('optical-raw-textarea');
    const infoEl = document.getElementById('optical-detected-format-info');
    const text = textarea?.value || '';
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 5);
    if (lines.length === 0) {
      if (infoEl) infoEl.textContent = 'Henüz veri girilmedi.';
      return;
    }

    if (!this._opticalProfiles || this._opticalProfiles.length === 0) {
      await this.initOpticalTab();
    }

    const sel = document.getElementById('optical-profile-select');
    const manualChoice = sel?.value;
    if (manualChoice && manualChoice !== '__calibrate__') {
      // Kullanıcı elle bir profil seçmiş - tespiti sadece bilgi amaçlı göster
      if (infoEl) infoEl.textContent = `${lines.length} satır bulundu. Seçili profil kullanılacak.`;
      this.onOpticalProfileChange();
      return;
    }

    const detected = await OptikProfiles.detectBest(lines);
    if (detected && detected.confidence >= 0.5) {
      if (infoEl) infoEl.textContent = `${lines.length} satır bulundu. Algılanan format: "${detected.profile.label}" (Güven: %${Math.round(detected.confidence * 100)})`;
      if (sel) sel.value = detected.profile.id;
    } else {
      if (infoEl) infoEl.textContent = `${lines.length} satır bulundu. Format otomatik tanınamadı - lütfen elle seçin ya da kalibratörle yeni bir profil tanımlayın.`;
      if (sel) sel.value = '';
    }
    this.onOpticalProfileChange();
  },

  // Profil seçimi değiştiğinde: blok eşleme formunu ve cevap anahtarı
  // kutularını seçilen profile/sınav türüne göre yeniden kurar.
  onOpticalProfileChange() {
    const sel = document.getElementById('optical-profile-select');
    const val = sel?.value;
    const calibrator = document.getElementById('optical-calibrator');
    const blockMappingEl = document.getElementById('optical-block-mapping');

    if (val === '__calibrate__') {
      if (calibrator) { calibrator.style.display = ''; calibrator.innerHTML = this.buildCalibratorHtml(); }
      if (blockMappingEl) blockMappingEl.innerHTML = '';
      document.getElementById('optical-answer-keys').innerHTML = '';
      return;
    }
    if (calibrator) { calibrator.style.display = 'none'; calibrator.innerHTML = ''; }

    const profile = (this._opticalProfiles || []).find(p => p.id === val);
    if (!profile) {
      document.getElementById('optical-answer-keys').innerHTML = '<p class="text-muted" style="font-size:12px">Bir format profili seçin.</p>';
      if (blockMappingEl) blockMappingEl.innerHTML = '';
      return;
    }

    this._opticalActiveProfileId = profile.id;
    this._opticalExamType = profile.examType;
    this._opticalBlockOverrides = {};

    if (blockMappingEl) {
      blockMappingEl.innerHTML = OptikProfiles.profileNeedsBlockMapping(profile) ? this.buildBlockMappingHtml(profile) : '';
    }

    document.getElementById('optical-answer-keys').innerHTML = this.renderAnswerKeyInputs(profile.examType, ['A', 'B'], profile);
  },

  // Blok -> ders eşleme formu (profilde subjectKey atanmamış bloklar için)
  buildBlockMappingHtml(profile) {
    const subjects = getSubjectsForExam(profile.examType);
    const blocks = profile.fields.filter(f => f.role === 'answerBlock');
    let blockIdx = 0;
    const rows = blocks.map(f => {
      const i = blockIdx++;
      const width = f.end != null ? (f.end - f.start) : null;
      const lenInfo = width != null ? `${width} karakter` : (f.label || `Blok ${i + 1}`);
      const preset = f.subjectKey || '';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <span style="min-width:170px;font-size:12px;color:var(--text-muted)">${f.label || `Blok ${i + 1}`} <small>(${lenInfo})</small></span>
          <select class="form-select" style="max-width:260px" data-block-idx="${i}" onchange="ImportModule.onOpticalBlockMappingChange(this)" ${preset ? 'disabled' : ''}>
            <option value="">-- Ders seçin --</option>
            ${subjects.map(s => `<option value="${s.key}" ${preset === s.key ? 'selected' : ''}>${s.name} (${s.questions} soru)</option>`).join('')}
          </select>
        </div>
      `;
    }).join('');

    return `
      <div style="padding:12px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.2);border-radius:10px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#f59e0b">⚠ Blok → Ders Eşlemesi Gerekli</div>
        <p class="text-muted" style="font-size:12px;margin-bottom:10px">
          Bu format için hangi cevap bloğunun hangi derse ait olduğu bilinmiyor (resmi soru sayılarıyla tam örtüşmüyor). Aşağıdan bir kez eşleyin - istersen sonra profil olarak kaydedip tekrar sorulmasını engelleyebilirsin.
        </p>
        ${rows}
        <div style="margin-top:10px;display:flex;justify-content:flex-end">
          <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.saveOpticalProfileWithMapping()">💾 Bu Eşlemeyi Profil Olarak Kaydet</button>
        </div>
      </div>
    `;
  },

  onOpticalBlockMappingChange(selectEl) {
    const idx = parseInt(selectEl.dataset.blockIdx);
    if (selectEl.value) this._opticalBlockOverrides[idx] = selectEl.value;
    else delete this._opticalBlockOverrides[idx];
    const activeProfile = (this._opticalProfiles || []).find(p => p.id === this._opticalActiveProfileId);
    document.getElementById('optical-answer-keys').innerHTML = this.renderAnswerKeyInputs(this._opticalExamType, ['A', 'B'], activeProfile);
  },

  // Mevcut blok eşlemesini kalıcı bir profil olarak kaydeder (builtIn:false)
  async saveOpticalProfileWithMapping() {
    const base = (this._opticalProfiles || []).find(p => p.id === this._opticalActiveProfileId);
    if (!base) return;
    const missing = base.fields.filter((f, _i) => f.role === 'answerBlock').some((f, i) => !f.subjectKey && this._opticalBlockOverrides[i] == null);
    if (missing) {
      UI.toast('Lütfen tüm blokları bir derse eşleyin', 'warning');
      return;
    }
    let blockIdx = 0;
    const fields = base.fields.map(f => {
      if (f.role !== 'answerBlock') return f;
      const i = blockIdx++;
      return { ...f, subjectKey: f.subjectKey || this._opticalBlockOverrides[i] };
    });
    const newProfile = { ...base, id: undefined, builtIn: false, label: `${base.label} (kaydedilmiş eşleme)`, fields };
    await db.addOptikProfile(newProfile);
    UI.toast('Profil kaydedildi - bir sonraki içe aktarımda otomatik tanınacak', 'success');
    await this.initOpticalTab();
    const sel = document.getElementById('optical-profile-select');
    if (sel) { sel.value = ''; }
    this.onOpticalContentChange();
  },

  // Sınav türüne ve kitapçık harflerine göre dinamik cevap anahtarı giriş kutuları
  renderAnswerKeyInputs(examType, bookletLetters, profile) {
    const subjects = getSubjectsForExam(examType);
    const defaults = profile?.defaultAnswerKeys || {};
    const colors = { A: { bg: 'rgba(99,102,241,0.04)', border: 'rgba(99,102,241,0.15)', text: 'var(--accent-primary-light)', icon: '📘' },
                      B: { bg: 'rgba(236,72,153,0.04)', border: 'rgba(236,72,153,0.15)', text: '#f472b6', icon: '📙' } };
    return bookletLetters.map(letter => {
      const c = colors[letter] || colors.A;
      const letterDefaults = defaults[letter] || {};
      return `
        <div style="padding:12px;background:${c.bg};border:1px solid ${c.border};border-radius:10px;">
          <div style="font-weight:700;color:${c.text};margin-bottom:8px;font-size:13px;">${c.icon} ${letter} Kitapçığı Cevapları</div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
            ${subjects.map(s => `
              <div><span style="display:inline-block;width:110px;font-weight:600">${s.name.substring(0, 14)} (${s.questions}):</span>
                <input type="text" id="key-${letter.toLowerCase()}-${s.key}" class="form-input font-mono" maxlength="${s.questions}" style="display:inline-block;width:calc(100% - 120px);padding:4px 8px;font-size:12px;" placeholder="Cevap anahtarı..." value="${letterDefaults[s.key] || ''}">
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  },

  // ---- Sabit Genişlikli Kalibratör (yeni/bilinmeyen formatlar için) ----
  buildCalibratorHtml() {
    if (!this._calibratorFields) {
      this._calibratorFields = [
        { role: 'schoolNumber', start: 0, end: 10 },
        { role: 'fullName', start: 10, end: 30 },
        { role: 'className', start: 30, end: 33 },
        { role: 'booklet', start: 33, end: 35 },
      ];
    }
    const roleOptions = ['schoolNumber', 'firstName', 'lastName', 'fullName', 'className', 'booklet', 'tcNo', 'answerBlock', 'ignore'];
    const roleLabels = { schoolNumber: 'Okul No', firstName: 'Ad', lastName: 'Soyad', fullName: 'Ad Soyad (birleşik)', className: 'Sınıf', booklet: 'Kitapçık', tcNo: 'TC No', answerBlock: 'Cevap Bloğu', ignore: 'Yoksay' };
    const textarea = document.getElementById('optical-raw-textarea');
    const sampleLine = (textarea?.value || '').split(/\r?\n/).find(l => l.trim().length > 5) || '';
    const ruler = Array.from({ length: Math.ceil(sampleLine.length / 10) }, (_, i) => String(i * 10).padEnd(10)).join('');

    const fieldRows = this._calibratorFields.map((f, i) => `
      <div style="display:flex;gap:6px;align-items:center;padding:4px 0;flex-wrap:wrap">
        <select class="form-select" style="max-width:170px" data-cf-idx="${i}" data-cf-prop="role" onchange="ImportModule.onCalibratorFieldChange(this)">
          ${roleOptions.map(r => `<option value="${r}" ${f.role === r ? 'selected' : ''}>${roleLabels[r]}</option>`).join('')}
        </select>
        <input type="number" class="form-input font-mono" style="width:80px" placeholder="Başlangıç" value="${f.start ?? ''}" data-cf-idx="${i}" data-cf-prop="start" onchange="ImportModule.onCalibratorFieldChange(this)">
        <input type="number" class="form-input font-mono" style="width:80px" placeholder="Bitiş" value="${f.end ?? ''}" data-cf-idx="${i}" data-cf-prop="end" onchange="ImportModule.onCalibratorFieldChange(this)">
        ${f.role === 'answerBlock' ? `<input type="text" class="form-input" style="width:140px" placeholder="Ders adı (etiket)" value="${f.label || ''}" data-cf-idx="${i}" data-cf-prop="label" onchange="ImportModule.onCalibratorFieldChange(this)">` : ''}
        <button type="button" class="btn btn-danger btn-sm" onclick="ImportModule.removeCalibratorField(${i})">✕</button>
      </div>
    `).join('');

    return `
      <div style="padding:14px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.2);border-radius:10px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px">🛠 Yeni Sabit-Genişlikli Format Tanımla</div>
        <p class="text-muted" style="font-size:12px;margin-bottom:10px">Gerçek bir örnek satırı yükle/yapıştır, sonra her alanın başlangıç/bitiş karakter pozisyonunu (0'dan başlayarak) gir. "Test Et" ile sonucu anında gör.</p>

        <div style="font-family:monospace;font-size:10px;color:var(--text-muted);white-space:pre;overflow-x:auto;margin-bottom:2px">${ruler}</div>
        <div style="font-family:monospace;font-size:11px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:6px;white-space:pre;overflow-x:auto;margin-bottom:10px">${sampleLine || '(örnek satır yok - önce yukarıya bir satır yapıştırın)'}</div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Sınav Türü</label>
            <select class="form-select" id="calibrator-exam-type">
              ${Object.keys(EXAM_TYPE_LABELS).map(t => `<option value="${t}">${EXAM_TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Profil Adı</label>
            <input type="text" class="form-input" id="calibrator-profile-name" placeholder="Örn: Şu Okulun Optik Formatı">
          </div>
        </div>

        <div id="calibrator-fields">${fieldRows}</div>
        <button type="button" class="btn btn-ghost btn-sm mt-1" onclick="ImportModule.addCalibratorField()">➕ Alan Ekle</button>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.testCalibrator()">🧪 Test Et</button>
          <button type="button" class="btn btn-success btn-sm" onclick="ImportModule.saveCalibratedProfile()">💾 Profili Kaydet</button>
        </div>
        <div id="calibrator-test-result" class="mt-2" style="font-size:12px;font-family:monospace;white-space:pre-wrap"></div>
      </div>
    `;
  },

  onCalibratorFieldChange(el) {
    const idx = parseInt(el.dataset.cfIdx);
    const prop = el.dataset.cfProp;
    const val = (prop === 'start' || prop === 'end') ? parseInt(el.value) : el.value;
    this._calibratorFields[idx][prop] = val;
  },

  addCalibratorField() {
    this._calibratorFields.push({ role: 'answerBlock', start: 0, end: 0, label: '' });
    document.getElementById('optical-calibrator').innerHTML = this.buildCalibratorHtml();
  },

  removeCalibratorField(idx) {
    this._calibratorFields.splice(idx, 1);
    document.getElementById('optical-calibrator').innerHTML = this.buildCalibratorHtml();
  },

  testCalibrator() {
    const textarea = document.getElementById('optical-raw-textarea');
    const sampleLine = (textarea?.value || '').split(/\r?\n/).find(l => l.trim().length > 5) || '';
    const resultEl = document.getElementById('calibrator-test-result');
    if (!sampleLine) {
      resultEl.textContent = 'Önce yukarıdaki metin alanına bir örnek satır yapıştırın.';
      return;
    }
    const tempProfile = { kind: 'fixedWidth', fields: this._calibratorFields };
    const rec = OptikProfiles.extractLine(tempProfile, sampleLine, {});
    resultEl.textContent = JSON.stringify(rec, null, 2);
  },

  async saveCalibratedProfile() {
    const label = document.getElementById('calibrator-profile-name')?.value?.trim();
    const examType = document.getElementById('calibrator-exam-type')?.value || 'LGS';
    if (!label) {
      UI.toast('Lütfen profil için bir ad girin', 'warning');
      return;
    }
    if (!this._calibratorFields.some(f => f.role === 'answerBlock')) {
      UI.toast('En az bir cevap bloğu tanımlamalısınız', 'warning');
      return;
    }
    const profile = {
      label,
      examType,
      kind: 'fixedWidth',
      optionCount: EXAM_TYPE_OPTION_COUNT[examType] || 5,
      fields: this._calibratorFields.map(f => f.role === 'answerBlock' ? { ...f, subjectKey: null } : f),
    };
    await db.addOptikProfile(profile);
    UI.toast('Yeni profil kaydedildi!', 'success');
    await this.initOpticalTab();
    const sel = document.getElementById('optical-profile-select');
    this.onOpticalContentChange();
  },

  // ---- Değerlendirme ----
  evaluateOpticalData() {
    const textarea = document.getElementById('optical-raw-textarea');
    const rawText = textarea?.value?.trim();
    if (!rawText) {
      UI.toast('Lütfen değerlendirilecek optik satırlarını girin veya dosya yükleyin', 'warning');
      return;
    }

    const profile = (this._opticalProfiles || []).find(p => p.id === this._opticalActiveProfileId);
    if (!profile) {
      UI.toast('Lütfen bir format profili seçin (ya da otomatik tespitin tamamlanmasını bekleyin)', 'warning');
      return;
    }

    const examType = profile.examType;
    const subjects = getSubjectsForExam(examType);
    const bookletLetters = ['A', 'B'];
    const keys = {};
    bookletLetters.forEach(letter => {
      keys[letter] = {};
      subjects.forEach(sub => {
        keys[letter][sub.key] = document.getElementById(`key-${letter.toLowerCase()}-${sub.key}`)?.value?.trim() || '';
      });
    });

    const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 5);
    if (lines.length === 0) {
      UI.toast('Geçerli uzunlukta optik satırı bulunamadı', 'warning');
      return;
    }

    const rawRows = [];
    lines.forEach(line => {
      const rec = OptikProfiles.extractLine(profile, line, this._opticalBlockOverrides);
      if (!rec) return;

      const activeKey = keys[rec.booklet] || keys['A'];
      const rowSubjects = {};
      rec.answerBlocks.forEach(block => {
        if (!block.subjectKey) return;
        const keyAns = activeKey[block.subjectKey];
        if (!keyAns) return; // cevap anahtarı girilmemiş blok atlanır
        rowSubjects[block.subjectKey] = OptikProfiles.evaluateAnswers(block.raw, keyAns);
      });

      rawRows.push({
        schoolNumber: rec.schoolNumber || '',
        firstName: rec.firstName,
        lastName: rec.lastName,
        fullName: `${rec.firstName} ${rec.lastName}`.trim(),
        className: normalizeClassName(rec.className),
        booklet: rec.booklet,
        subjects: rowSubjects,
      });
    });

    if (rawRows.length === 0) {
      UI.toast('Satırlar ayrıştırılamadı. Formatı ve cevap anahtarlarını kontrol ediniz.', 'danger');
      return;
    }

    const results = this.mergeOpticalRows(rawRows, subjects);
    results.sort((a, b) => b.totalNet - a.totalNet);

    this.opticalResults = results;
    this._opticalResultsExamType = examType;
    this.renderOpticalPreview(results, examType);
    UI.toast(`${results.length} öğrenci başarıyla değerlendirildi!`, 'success');
  },

  // Aynı öğrenciye (okul no, yoksa ad-soyad ile) ait birden fazla satırı
  // (ör. sözel bölüm satırı + sayısal bölüm satırı) tek sonuçta birleştirir.
  mergeOpticalRows(rawRows, subjects) {
    const byKey = new Map();
    rawRows.forEach(row => {
      const cleanNo = normalizeSchoolNo(row.schoolNumber);
      const key = cleanNo ? `no:${cleanNo}` : `name:${normalizeTrText(row.fullName)}`;
      if (!byKey.has(key)) {
        byKey.set(key, { ...row, subjects: { ...row.subjects } });
      } else {
        const existing = byKey.get(key);
        Object.assign(existing.subjects, row.subjects);
        if (!existing.className && row.className) existing.className = row.className;
      }
    });

    return [...byKey.values()].map(r => {
      let totalCorrect = 0, totalWrong = 0, totalBlank = 0, totalNet = 0;
      subjects.forEach(sub => {
        const s = r.subjects[sub.key];
        if (!s) return;
        totalCorrect += s.correct; totalWrong += s.wrong; totalBlank += s.blank; totalNet += s.net;
      });
      return { ...r, totalCorrect, totalWrong, totalBlank, totalNet: parseFloat(totalNet.toFixed(2)) };
    });
  },

  // Sonuç önizleme tablosu ve özet kartları (ders sayısı türe göre dinamik)
  renderOpticalPreview(results, examType) {
    const subjects = getSubjectsForExam(examType);
    const count = results.length;
    const totalNets = results.map(r => r.totalNet);
    const avgNet = count > 0 ? (totalNets.reduce((a, b) => a + b, 0) / count).toFixed(2) : '0.00';
    const maxNet = count > 0 ? Math.max(...totalNets).toFixed(2) : '0.00';
    const minNet = count > 0 ? Math.min(...totalNets).toFixed(2) : '0.00';

    const summaryCards = `
      <div class="card" style="padding:12px;text-align:center;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2)">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700">Öğrenci Sayısı</div>
        <div style="font-size:22px;font-weight:800;color:var(--accent-primary-light);margin-top:4px">${count}</div>
      </div>
      <div class="card" style="padding:12px;text-align:center;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2)">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700">En Yüksek Net</div>
        <div style="font-size:22px;font-weight:800;color:#10b981;margin-top:4px">${maxNet}</div>
      </div>
      <div class="card" style="padding:12px;text-align:center;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2)">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700">Ortalama Net</div>
        <div style="font-size:22px;font-weight:800;color:#f59e0b;margin-top:4px">${avgNet}</div>
      </div>
      <div class="card" style="padding:12px;text-align:center;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2)">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700">En Düşük Net</div>
        <div style="font-size:22px;font-weight:800;color:#ef4444;margin-top:4px">${minNet}</div>
      </div>
    `;
    document.getElementById('optical-summary-cards').innerHTML = summaryCards;

    let tableHtml = `
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:rgba(255,255,255,0.05);text-align:left;">
            <th style="padding:8px 6px;">#</th>
            <th style="padding:8px 6px;">No</th>
            <th style="padding:8px 6px;">Öğrenci Adı Soyadı</th>
            <th style="padding:8px 6px;">Sınıf</th>
            <th style="padding:8px 6px;">Kit.</th>
            ${subjects.map(s => `<th style="padding:8px 6px;">${s.name} (${s.questions})</th>`).join('')}
            <th style="padding:8px 6px;text-align:center;">Toplam D/Y/B</th>
            <th style="padding:8px 6px;text-align:right;font-weight:700;color:var(--accent-primary-light);">Toplam Net</th>
          </tr>
        </thead>
        <tbody>
    `;

    results.forEach((r, i) => {
      const formatSub = (s) => s ? `<span style="font-family:monospace;white-space:nowrap;"><b style="color:#10b981">${s.correct}D</b> <span style="color:#ef4444">${s.wrong}Y</span> <span style="color:var(--text-muted)">${s.blank}B</span> <small style="color:var(--accent-primary-light);margin-left:2px">(${s.net.toFixed(2)})</small></span>` : '<span class="text-muted">—</span>';

      tableHtml += `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:8px 6px;font-weight:700;color:var(--text-muted)">${i + 1}</td>
          <td style="padding:8px 6px;font-family:monospace;">${r.schoolNumber}</td>
          <td style="padding:8px 6px;font-weight:600;">${r.fullName}</td>
          <td style="padding:8px 6px;"><span class="badge badge-primary" style="font-size:10px">${r.className || '-'}</span></td>
          <td style="padding:8px 6px;"><span class="badge ${r.booklet === 'A' ? 'badge-info' : 'badge-warning'}" style="font-size:10px">${r.booklet}</span></td>
          ${subjects.map(s => `<td style="padding:8px 6px;">${formatSub(r.subjects[s.key])}</td>`).join('')}
          <td style="padding:8px 6px;text-align:center;font-family:monospace;">
            <b>${r.totalCorrect}D</b> / <span style="color:#ef4444">${r.totalWrong}Y</span> / <span style="color:var(--text-muted)">${r.totalBlank}B</span>
          </td>
          <td style="padding:8px 6px;text-align:right;font-family:monospace;font-size:13px;font-weight:800;color:var(--accent-primary-light)">
            ${r.totalNet.toFixed(2)}
          </td>
        </tr>
      `;
    });

    tableHtml += '</tbody></table>';

    document.getElementById('optical-preview-table').innerHTML = tableHtml;
    document.getElementById('optical-preview-count').textContent = `${count} Öğrenci`;
    document.getElementById('optical-preview-section').style.display = '';
  },

  // Clear optical preview (clearText=true de metin/format seçimini de sıfırlar)
  clearOpticalPreview(clearText) {
    document.getElementById('optical-preview-section').style.display = 'none';
    document.getElementById('optical-preview-table').innerHTML = '';
    document.getElementById('optical-summary-cards').innerHTML = '';
    this.opticalResults = [];
    if (clearText) {
      const textarea = document.getElementById('optical-raw-textarea');
      if (textarea) textarea.value = '';
      const infoEl = document.getElementById('optical-detected-format-info');
      if (infoEl) infoEl.textContent = 'Henüz veri girilmedi.';
      // Profil seçimini de sıfırla ki bir sonraki yapıştırma otomatik tespiti
      // tekrar çalıştırsın (aksi halde eski seçim "kullanıcı elle seçti" sayılır)
      const sel = document.getElementById('optical-profile-select');
      if (sel) sel.value = '';
      this._opticalActiveProfileId = null;
      document.getElementById('optical-answer-keys').innerHTML = '';
      const blockMappingEl = document.getElementById('optical-block-mapping');
      if (blockMappingEl) blockMappingEl.innerHTML = '';
    }
  },

  // Save optical results to Database
  async importOpticalData() {
    if (!this.opticalResults || this.opticalResults.length === 0) {
      UI.toast('İçe aktarılacak değerlendirilmiş veri bulunamadı', 'warning');
      return;
    }

    const examId = await this.getOrCreateExam('optical');
    if (!examId) return;

    const examType = this._opticalResultsExamType || 'LGS';
    const rowsToImport = this.opticalResults.map(r => {
      const subjects = {};
      getSubjectsForExam(examType).forEach(sub => {
        const subData = r.subjects[sub.key];
        subjects[sub.key] = {
          correct: subData ? subData.correct : 0,
          wrong: subData ? subData.wrong : 0,
        };
      });

      return {
        studentData: {
          schoolNumber: r.schoolNumber,
          firstName: r.firstName,
          lastName: r.lastName,
          className: r.className,
        },
        subjects,
      };
    });

    const res = await db.batchImportResults(examId, rowsToImport);
    await db.repairAndLinkStudents();

    UI.toast(`${res.imported} öğrencinin sınav sonucu başarıyla kaydedildi!${res.errors > 0 ? ` (${res.errors} hata)` : ''}`, res.errors > 0 ? 'warning' : 'success');
    this.clearOpticalPreview();
    this.loadExamSelects();

    if (typeof App !== 'undefined') App.refreshCurrentPage();
  },

  // Download evaluated data as CSV
  downloadOpticalAsCSV() {
    if (!this.opticalResults || this.opticalResults.length === 0) {
      UI.toast('Dışa aktarılacak veri bulunamadı', 'warning');
      return;
    }
    const subjects = getSubjectsForExam(this._opticalResultsExamType || 'LGS');

    const headers = ['Sıra', 'Öğrenci No', 'Ad Soyad', 'Sınıf', 'Kitapçık'];
    subjects.forEach(s => headers.push(`${s.name} Doğru`, `${s.name} Yanlış`, `${s.name} Net`));
    headers.push('Toplam Doğru', 'Toplam Yanlış', 'Toplam Boş', 'Toplam Net');

    const rows = this.opticalResults.map((r, i) => {
      const row = [i + 1, r.schoolNumber, `"${r.fullName}"`, r.className, r.booklet];
      subjects.forEach(s => {
        const sd = r.subjects[s.key];
        row.push(sd ? sd.correct : 0, sd ? sd.wrong : 0, (sd ? sd.net : 0).toFixed(2).replace('.', ','));
      });
      row.push(r.totalCorrect, r.totalWrong, r.totalBlank, r.totalNet.toFixed(2).replace('.', ','));
      return row;
    });

    const csvContent = '﻿' + [headers.join(';'), ...rows.map(row => row.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Optik_Deneme_Sonuclari_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    UI.toast('CSV dosyası indirildi', 'success');
  },

  // Download evaluated data as Excel (.xlsx)
  downloadOpticalAsExcel() {
    if (!this.opticalResults || this.opticalResults.length === 0) {
      UI.toast('Dışa aktarılacak veri bulunamadı', 'warning');
      return;
    }
    if (typeof XLSX === 'undefined') {
      UI.toast('Excel kütüphanesi yüklenemedi, lütfen CSV olarak indirin', 'warning');
      return;
    }
    const subjects = getSubjectsForExam(this._opticalResultsExamType || 'LGS');

    const headers = ['Sıra', 'Öğrenci No', 'Ad Soyad', 'Sınıf', 'Kitapçık'];
    subjects.forEach(s => headers.push(`${s.name} Doğru`, `${s.name} Yanlış`, `${s.name} Net`));
    headers.push('Toplam Doğru', 'Toplam Yanlış', 'Toplam Boş', 'Toplam Net');

    const data = [headers, ...this.opticalResults.map((r, i) => {
      const row = [i + 1, r.schoolNumber, r.fullName, r.className, r.booklet];
      subjects.forEach(s => {
        const sd = r.subjects[s.key];
        row.push(sd ? sd.correct : 0, sd ? sd.wrong : 0, Number((sd ? sd.net : 0).toFixed(2)));
      });
      row.push(r.totalCorrect, r.totalWrong, r.totalBlank, Number(r.totalNet.toFixed(2)));
      return row;
    })];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deneme Sonuçları');
    XLSX.writeFile(wb, `Optik_Deneme_Sonuclari_${new Date().toISOString().split('T')[0]}.xlsx`);
    UI.toast('Excel dosyası indirildi', 'success');
  },


  // ---- Get or Create Exam ----
  async getOrCreateExam(prefix) {
    const sel = document.getElementById(`${prefix}-exam-select`);
    let examId = sel?.value;

    if (!examId) {
      UI.toast('Lütfen bir deneme seçin veya yeni oluşturun', 'warning');
      return null;
    }

    if (examId === '__new__') {
      const name = document.getElementById(`${prefix}-new-exam-name`)?.value?.trim();
      const date = document.getElementById(`${prefix}-new-exam-date`)?.value;
      const examType = document.getElementById(`${prefix}-new-exam-type`)?.value || 'LGS';

      if (!name) {
        UI.toast('Lütfen deneme adını girin', 'warning');
        return null;
      }

      examId = await db.addExam({
        name,
        date: date || new Date().toISOString().split('T')[0],
        examType,
      });
      this.loadExamSelects();
    }

    return parseInt(examId);
  },
};

