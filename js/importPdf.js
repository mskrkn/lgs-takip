// ============================================
// LGS Deneme Takip - Import Module - PDF Sekmesi
// ============================================
// Bu nesne js/import.js içinde diğer parçalarla Object.assign edilerek
// tek bir ImportModule oluşturur - tüm parçalar aynı `this` durumunu
// (parsedData, columnMapping, _opticalProfiles vb.) paylaşır.

const ImportPDF = {

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

          <div id="pdf-mapping-template-bar"></div>
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

      await this.showPDFPreview(extractedTable.headers, extractedTable.rows);
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
  async showPDFPreview(headers, rows) {
    const examType = this.getSelectedExamType('pdf');
    this.parsedData = rows;

    await this.applyColumnMappingWithTemplates(headers, examType, 'pdf');

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
    document.getElementById('pdf-mapping-template-bar').innerHTML = '';
    document.getElementById('pdf-column-mapping').innerHTML = '';
    document.getElementById('pdf-preview-table').innerHTML = '';
    this.parsedData = [];
    this.headers = [];
    this.columnMapping = {};
    const input = document.getElementById('pdf-file-input');
    if (input) input.value = '';
  },
};
