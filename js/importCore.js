// ============================================
// LGS Deneme Takip - Import Module - Ortak Altyapı
// (sekme geçişi, deneme seçimi, sürükle-bırak, sütun eşleştirme şablon
// motoru, önizleme tablosu gibi Excel/PDF/Optik sekmelerinin hepsinin
// paylaştığı genel yardımcılar)
// ============================================
// Bu nesne js/import.js içinde diğer parçalarla Object.assign edilerek
// tek bir ImportModule oluşturur - tüm parçalar aynı `this` durumunu
// (parsedData, columnMapping, _opticalProfiles vb.) paylaşır.

const ImportCore = {
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
  async onImportExamSelectChange(prefix) {
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
        await this.applyColumnMappingWithTemplates(headers, examType, prefix);
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

  // ---- Auto-map columns ----
  autoMapColumns(headers, examType) {
    const mapping = {};

    const cleanHeaders = headers.map(h => normalizeTrText(h));

    // 1. Full name patterns (Single column containing both First and Last name)
    const fullNamePatterns = [
      'öğrenci ve ad soyad', 'ogrenci ve ad soyad', 'ögrenci ve ad soyad', 'öğrenci ad ve soyad',
      'adı soyadı', 'adi soyadi', 'ad soyad', 'adı ve soyadı', 'adi ve soyadi',
      'öğrenci adı soyadı', 'ogrenci adi soyadi', 'öğrenci adı', 'ogrenci adi',
      'öğrenci ad soyad', 'isim soyisim', 'öğrenci', 'ogrenci', 'isim',
      'adsoyad', // bitişik yazım (ör. OptikOkuma'nın ADSOYAD sütunu)
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

    // If no combined full name, check separate First and Last Name.
    // "... adı"/"... ad" ile biten ama kişiyle ilgisi olmayan bileşik başlıklar
    // (KURUM_ADI, İL_ADI, DERS_ADI, SINAV_ADI gibi - normalizeTrText alt çizgiyi
    // boşluğa çevirdiği için "kurum adi" da " adi" ile biter) yanlışlıkla
    // öğrenci adı sanılmasın diye bu tür başlıklarda endsWith eşleşmesi atlanır.
    const nonPersonHeaderWords = ['kurum', 'okul', 'il', 'ilçe', 'ilce', 'ders', 'sınav', 'sinav', 'şube', 'sube', 'salon'];
    if (!foundFullName) {
      cleanHeaders.forEach((h, idx) => {
        const isNonPersonCompound = nonPersonHeaderWords.some(w => h.startsWith(w + ' '));
        if (!mapping.lastName && lastNamePatterns.some(p => h === p || (!isNonPersonCompound && h.endsWith(' ' + p)))) {
          mapping.lastName = idx;
        } else if (!mapping.firstName && firstNamePatterns.some(p => h === p || (!isNonPersonCompound && h.endsWith(' ' + p)))) {
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

    return this.renderFoundFieldsSummary() + fields.map(f => {
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

  // Otomatik sütun eşleştirmesinden sonra hangi temel alanların bulunduğunu
  // özetleyen küçük bir "🔍 Bulunan Bilgiler" rozet satırı (bkz. renderColumnMapping)
  renderFoundFieldsSummary() {
    const m = this.columnMapping || {};
    const hasName = m.fullName !== undefined || (m.firstName !== undefined && m.lastName !== undefined);
    const hasSubjects = Object.keys(m).some(k => k.endsWith('_correct') || k.endsWith('_wrong') || k.endsWith('_net'));
    const items = [
      { label: 'Öğrenci No', found: m.schoolNumber !== undefined },
      { label: 'Ad Soyad', found: hasName },
      { label: 'Sınıf', found: m.className !== undefined },
      { label: 'Dersler', found: hasSubjects },
    ];
    return `
      <div class="found-fields-summary">
        <span class="found-fields-title">🔍 Bulunan Bilgiler</span>
        <div class="found-fields-row">
          ${items.map(i => `<span class="found-field-chip ${i.found ? 'found' : 'missing'}">${i.found ? '✅' : '⬜'} ${i.label}</span>`).join('')}
        </div>
      </div>
    `;
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

  // ==== Sütun Eşleştirme Şablonları (Excel/CSV/PDF) ====
  // Bir öğretmen bir dosyanın sütunlarını bir kez eşleştirip şablon olarak
  // kaydettiğinde, aynı başlıklara sahip sonraki dosyalarda bu eşleştirme
  // otomatik uygulanır (optikProfiles'ın Excel/PDF tarafındaki karşılığı).

  // Başlık listesinden, şablon eşleşmesinde kullanılan normalize imza üretir
  buildHeaderSignature(headers) {
    return (headers || []).map(h => normalizeTrText(h)).filter(Boolean).sort().join('|');
  },

  // Kayıtlı şablonlar arasından mevcut başlıklara en iyi uyanı bulur.
  // Şablonun eşleştirdiği alan başlıklarının en az %80'i mevcut dosyada
  // birebir (normalize edilmiş) bulunmalı.
  findBestColumnMappingProfile(profiles, headers) {
    const currentSet = new Set((headers || []).map(h => normalizeTrText(h)).filter(Boolean));
    let best = null;
    let bestScore = 0;
    for (const p of profiles || []) {
      const fieldHeaders = Object.values(p.headerByField || {});
      if (fieldHeaders.length === 0) continue;
      const matched = fieldHeaders.filter(h => currentSet.has(h)).length;
      const score = matched / fieldHeaders.length;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore >= 0.8 ? best : null;
  },

  // Bir şablonun (başlık adına göre saklanan) alan eşleştirmesini, mevcut
  // dosyanın başlık sırasına göre sütun indekslerine çözer
  resolveColumnMapping(profile, headers) {
    const norm = (headers || []).map(h => normalizeTrText(h));
    const mapping = {};
    for (const [field, headerNorm] of Object.entries(profile?.headerByField || {})) {
      const idx = norm.indexOf(headerNorm);
      if (idx !== -1) mapping[field] = idx;
    }
    return mapping;
  },

  // Mevcut (indeks bazlı) eşleştirmeyi, başlık adına göre kaydedilebilir hale getirir
  buildHeaderByFieldFromMapping(mapping, headers) {
    const norm = (headers || []).map(h => normalizeTrText(h));
    const headerByField = {};
    for (const [field, idx] of Object.entries(mapping || {})) {
      if (idx != null && norm[idx]) headerByField[field] = norm[idx];
    }
    return headerByField;
  },

  // Kayıtlı şablonlardan en iyi eşleşeni uygular (bulunamazsa autoMapColumns'a düşer)
  // ve şablon seçim çubuğunu + sütun eşleştirme UI'ını yeniden çizer.
  async applyColumnMappingWithTemplates(headers, examType, prefix) {
    const profiles = await db.getColumnMappingProfiles(examType);
    this._columnMappingProfilesByPrefix = this._columnMappingProfilesByPrefix || {};
    this._columnMappingProfilesByPrefix[prefix] = profiles;
    this._activeMappingTemplateId = this._activeMappingTemplateId || {};

    const best = this.findBestColumnMappingProfile(profiles, headers);
    if (best) {
      this.columnMapping = this.resolveColumnMapping(best, headers);
      this._activeMappingTemplateId[prefix] = best.id;
      UI.toast(`Kayıtlı eşleştirme şablonu uygulandı: "${best.label}"`, 'success');
    } else {
      this.columnMapping = this.autoMapColumns(headers, examType);
      this._activeMappingTemplateId[prefix] = null;
    }

    document.getElementById(`${prefix}-mapping-template-bar`).innerHTML =
      this.renderMappingTemplateBar(profiles, prefix, this._activeMappingTemplateId[prefix]);
    document.getElementById(`${prefix}-column-mapping`).innerHTML =
      this.renderColumnMapping(headers, prefix, examType);
  },

  renderMappingTemplateBar(profiles, prefix, activeId) {
    const options = (profiles || []).map(p =>
      `<option value="${p.id}" ${activeId === p.id ? 'selected' : ''}>⭐ ${p.label}</option>`
    ).join('');
    return `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:rgba(20,184,166,0.05);border-radius:10px;border:1px solid rgba(20,184,166,0.15)">
        <label class="form-label" style="margin:0;white-space:nowrap">📋 Eşleştirme Şablonu</label>
        <select class="form-select" style="max-width:240px" onchange="ImportModule.onMappingTemplateSelect(this,'${prefix}')">
          <option value="">-- Otomatik / Elle --</option>
          ${options}
        </select>
        <input type="text" class="form-input" id="${prefix}-mapping-template-name" placeholder="Yeni şablon adı (örn: XYZ Optik LGS)" style="max-width:220px">
        <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.saveColumnMappingTemplate('${prefix}')">💾 Şablon Olarak Kaydet</button>
        ${activeId ? `<button type="button" class="btn btn-ghost btn-sm" onclick="ImportModule.deleteColumnMappingTemplate('${prefix}', ${activeId})">🗑️ Şablonu Sil</button>` : ''}
      </div>
    `;
  },

  onMappingTemplateSelect(selectEl, prefix) {
    const id = selectEl.value ? parseInt(selectEl.value, 10) : null;
    const profiles = (this._columnMappingProfilesByPrefix && this._columnMappingProfilesByPrefix[prefix]) || [];
    const examType = this.getSelectedExamType(prefix);
    this._activeMappingTemplateId = this._activeMappingTemplateId || {};
    this._activeMappingTemplateId[prefix] = id;

    if (id) {
      const profile = profiles.find(p => p.id === id);
      this.columnMapping = profile ? this.resolveColumnMapping(profile, this.headers) : {};
    } else {
      this.columnMapping = this.autoMapColumns(this.headers, examType);
    }

    document.getElementById(`${prefix}-column-mapping`).innerHTML = this.renderColumnMapping(this.headers, prefix, examType);
    document.getElementById(`${prefix}-mapping-template-bar`).innerHTML = this.renderMappingTemplateBar(profiles, prefix, id);
  },

  async saveColumnMappingTemplate(prefix) {
    const mapping = this.columnMapping;
    if (!mapping || Object.keys(mapping).length === 0) {
      UI.toast('Kaydedilecek bir eşleştirme yok', 'warning');
      return;
    }

    const nameInput = document.getElementById(`${prefix}-mapping-template-name`);
    const label = nameInput?.value?.trim();
    if (!label) {
      UI.toast('Lütfen şablon için bir ad girin', 'warning');
      return;
    }

    const examType = this.getSelectedExamType(prefix);
    const headerByField = this.buildHeaderByFieldFromMapping(mapping, this.headers);

    const id = await db.addColumnMappingProfile({
      examType,
      label,
      signature: this.buildHeaderSignature(this.headers),
      headerByField,
    });

    UI.toast('Eşleştirme şablonu kaydedildi - aynı formattaki bir sonraki dosyada otomatik uygulanacak', 'success');

    this._activeMappingTemplateId = this._activeMappingTemplateId || {};
    this._activeMappingTemplateId[prefix] = id;
    const profiles = await db.getColumnMappingProfiles(examType);
    this._columnMappingProfilesByPrefix = this._columnMappingProfilesByPrefix || {};
    this._columnMappingProfilesByPrefix[prefix] = profiles;
    document.getElementById(`${prefix}-mapping-template-bar`).innerHTML = this.renderMappingTemplateBar(profiles, prefix, id);
  },

  async deleteColumnMappingTemplate(prefix, id) {
    const ok = await UI.confirm('Bu eşleştirme şablonunu silmek istediğinize emin misiniz?');
    if (!ok) return;

    await db.deleteColumnMappingProfile(id);
    UI.toast('Şablon silindi', 'success');

    const examType = this.getSelectedExamType(prefix);
    this._activeMappingTemplateId = this._activeMappingTemplateId || {};
    this._activeMappingTemplateId[prefix] = null;
    const profiles = await db.getColumnMappingProfiles(examType);
    this._columnMappingProfilesByPrefix = this._columnMappingProfilesByPrefix || {};
    this._columnMappingProfilesByPrefix[prefix] = profiles;
    document.getElementById(`${prefix}-mapping-template-bar`).innerHTML = this.renderMappingTemplateBar(profiles, prefix, null);
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

  _escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
