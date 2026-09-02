// ============================================
// LGS Deneme Takip - Import Module - Excel/CSV Sekmesi
// ============================================
// Bu nesne js/import.js içinde diğer parçalarla Object.assign edilerek
// tek bir ImportModule oluşturur - tüm parçalar aynı `this` durumunu
// (parsedData, columnMapping, _opticalProfiles vb.) paylaşır.

const ImportExcel = {

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

          <div id="excel-mapping-template-bar"></div>
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
      let merges = null;

      if (ext === 'csv') {
        const text = await file.text();
        data = this.parseCSV(text);
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        merges = sheet['!merges'] || null;
      }

      if (!data || data.length < 2) {
        UI.toast('Dosyada yeterli veri bulunamadı', 'danger');
        return;
      }

      this.currentFile = file;
      const { headers, rows } = this.buildHeadersAndRows(data, merges);
      if (rows.length === 0) {
        UI.toast('Dosyada başlıktan sonra veri satırı bulunamadı (boş şablon olabilir)', 'warning');
        return;
      }
      await this.showExcelPreview(headers, rows);
    } catch (err) {
      console.error('Excel parse error:', err);
      UI.toast('Dosya okunurken hata oluştu: ' + err.message, 'danger');
    }
  },

  // ---- Başlık satırlarını çözümle + veri satırlarını ayır ----
  // Çoğu dosyada tek satır başlık vardır (ör. "Türkçe D", "Türkçe Y"). Ancak
  // bazı kurum/optik firmalarının (ör. Orbim "Kurum Net Listesi") dışa
  // aktardığı Excel'lerde ders adı üstte birleştirilmiş tek hücrede, D/Y/N
  // alt başlıkları ise onun altındaki ayrı bir satırdadır. Böyle 2 satırlı
  // gruplu başlıkları "Ders D"/"Ders Y"/"Ders N" gibi TEK satıra indirgeyip
  // mevcut autoMapColumns/ders anahtar kelime eşleştirmesinin değişmeden
  // çalışmasını sağlıyoruz.
  buildHeadersAndRows(data, merges) {
    const row0 = data[0] || [];
    const row1 = data[1] || [];
    const width = Math.max(row0.length, row1.length);

    const subTokens = Array.from({ length: width }, (_, i) => String(row1[i] ?? '').trim().toLocaleUpperCase('tr-TR'));
    const subHeaderHits = subTokens.filter(t => ['D', 'Y', 'N', 'B', 'DOĞRU', 'DOGRU', 'YANLIŞ', 'YANLIS', 'BOŞ', 'BOS', 'NET', 'SORU S.', 'SORU SAYISI'].includes(t)).length;
    const looksLikeGroupedHeader = subHeaderHits >= 2;

    if (!looksLikeGroupedHeader) {
      return {
        headers: row0.map(h => String(h ?? '').trim()),
        rows: data.slice(1).filter(r => r.some(cell => cell !== '' && cell != null)),
      };
    }

    // 1. satırdaki grup adını (ders adı vb.) sütunlara yay
    const groupByCol = new Array(width).fill('');
    if (merges && merges.length) {
      // Gerçek Excel birleşik hücre bilgisi varsa (yalnızca .xlsx), grup adını
      // SADECE o birleşimin kapsadığı sütunlara kesin olarak uygula - böylece
      // etiketsiz bırakılmış bir grup (ör. "Toplam" bloğu) yanlışlıkla bir
      // önceki dersin adını miras almaz.
      merges.forEach(m => {
        if (m.s.r !== 0 || m.e.r !== 0) return; // sadece 1. satır içindeki (yatay) birleşimler
        const label = String(row0[m.s.c] ?? '').trim();
        for (let c = m.s.c; c <= m.e.c; c++) groupByCol[c] = label;
      });
      for (let i = 0; i < width; i++) {
        if (!groupByCol[i]) {
          const v = String(row0[i] ?? '').trim();
          if (v) groupByCol[i] = v;
        }
      }
    } else {
      // Birleşik hücre bilgisi yok (CSV) - bir sonraki dolu hücreye kadar sağa doğru doldur
      let last = '';
      for (let i = 0; i < width; i++) {
        const v = String(row0[i] ?? '').trim();
        if (v) last = v;
        groupByCol[i] = last;
      }
    }

    const headers = [];
    for (let i = 0; i < width; i++) {
      const group = groupByCol[i] || '';
      const sub = String(row1[i] ?? '').trim();
      headers.push(sub ? `${group} ${sub}`.trim() : group);
    }

    return {
      headers,
      rows: data.slice(2).filter(r => r.some(cell => cell !== '' && cell != null)),
    };
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
  async showExcelPreview(headers, rows) {
    const examType = this.getSelectedExamType('excel');

    this.parsedData = rows;
    this.headers = headers;

    // Kayıtlı bir eşleştirme şablonu varsa uygula, yoksa otomatik tahmin et
    await this.applyColumnMappingWithTemplates(headers, examType, 'excel');

    // Render preview table
    this.renderPreviewTable(headers, rows, 'excel');

    document.getElementById('excel-preview-section').style.display = '';
    document.getElementById('excel-preview-count').textContent = `${rows.length} satır bulundu`;
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
    document.getElementById('excel-mapping-template-bar').innerHTML = '';
    document.getElementById('excel-column-mapping').innerHTML = '';
    document.getElementById('excel-preview-table').innerHTML = '';
    this.parsedData = [];
    this.headers = [];
    this.columnMapping = {};
    const input = document.getElementById('excel-file-input');
    if (input) input.value = '';
  },
};
