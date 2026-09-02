// ============================================
// LGS Deneme Takip - Import Module - Optik/TXT Sekmesi
// ============================================
// Bu nesne js/import.js içinde diğer parçalarla Object.assign edilerek
// tek bir ImportModule oluşturur - tüm parçalar aynı `this` durumunu
// (parsedData, columnMapping, _opticalProfiles vb.) paylaşır.

const ImportOptical = {

  // ---- Optical / TXT Import UI ----
  _opticalExamType: 'LGS',
  _opticalProfiles: [],
  _opticalBlockOverrides: {},
  _opticalDetectedEncoding: null,
  _opticalLines: [],

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
            <div style="display:flex;gap:8px;align-items:center">
              <select class="form-select" id="optical-profile-select" onchange="ImportModule.onOpticalProfileChange()" style="flex:1">
                <option value="">-- Önce veri girin --</option>
              </select>
              <button type="button" class="btn btn-danger btn-sm" id="optical-profile-delete-btn" style="display:none" onclick="ImportModule.deleteSelectedOpticalProfile()">🗑 Sil</button>
            </div>
          </div>
          <div id="optical-block-mapping" class="mt-2"></div>
          <div id="optical-field-preview"></div>
          <div id="optical-calibrator" class="mt-2" style="display:none"></div>
        </div>

        <!-- Cevap Anahtarları -->
        <div class="card mt-2" style="background:var(--bg-secondary);border:1px solid rgba(255,255,255,0.08);padding:16px;border-radius:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <h4 style="margin:0;font-size:15px;display:flex;align-items:center;gap:6px;"><span>🔑</span> Cevap Anahtarları</h4>
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('optical-answer-key-excel-input').click()">📊 Cevap Anahtarını Excel'den Yükle</button>
              <input type="file" id="optical-answer-key-excel-input" accept=".xlsx,.xls" style="display:none" onchange="ImportModule.onAnswerKeyExcelSelected(event)">
            </div>
          </div>
          <p class="text-muted" style="font-size:11px;margin:-6px 0 10px;">Sıra / Ders / Soru_ID / Kazanımlar / Dizilim / A Kitapçığı Cevap Anahtarı / B Kitapçığı Cevap Anahtarı sütunlarını içeren bir Excel yükleyin - cevap anahtarları otomatik doldurulur ve her sorunun konusu (kazanım) bu denemenin soru/konu analizinde kullanılır.</p>
          <div id="optical-answer-key-excel-info" style="font-size:12px;margin-bottom:8px;"></div>
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
      const { text, encoding } = await this._readFileWithTurkishEncoding(file);
      this._opticalDetectedEncoding = encoding;
      const textarea = document.getElementById('optical-raw-textarea');
      if (textarea) {
        textarea.value = textarea.value.trim() ? `${textarea.value.replace(/\s+$/, '')}\n${text}` : text;
      }
      await this.onOpticalContentChange();
      UI.toast(`"${file.name}" eklendi (${text.split(/\r?\n/).filter(l => l.trim()).length} satır)`, 'success');
    } catch (err) {
      console.error('Optical file read error:', err);
      UI.toast('Dosya okunurken hata oluştu: ' + err.message, 'danger');
    }
  },

  // Kodlama etiketini öğretmene gösterilecek okunur isme çevirir
  _opticalEncodingLabel(encoding) {
    const labels = {
      'utf-8': 'UTF-8',
      'utf-8-bom': 'UTF-8 (BOM)',
      'windows-1254': 'Windows-1254 (Türkçe)',
    };
    return labels[encoding] || encoding || 'Bilinmiyor';
  },

  // Türkçe optik dosyaları için encoding algılama: CP1254 / ISO-8859-9 / UTF-8
  // Tespit edilen kodlamayı da döner ({ text, encoding }) - içe aktarma
  // ekranındaki "Format Tespiti" bilgi satırında öğretmene gösterilir.
  _readFileWithTurkishEncoding(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target.result;
        const bytes = new Uint8Array(buffer);

        // UTF-8 BOM kontrolü (EF BB BF)
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
          resolve({ text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8-bom' });
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
            resolve({ text: new TextDecoder('windows-1254').decode(buffer), encoding: 'windows-1254' });
          } else {
            resolve({ text, encoding });
          }
        } catch (_) {
          resolve({ text: new TextDecoder('windows-1254').decode(buffer), encoding: 'windows-1254' });
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

  // Format tespit bilgi satırına eklenen kodlama/ayraç detayı
  _opticalFormatDetailsSuffix(profile) {
    const parts = [];
    if (this._opticalDetectedEncoding) parts.push(`Kodlama: ${this._opticalEncodingLabel(this._opticalDetectedEncoding)}`);
    if (profile) parts.push(profile.kind === 'delimited' ? `Ayraç: "${profile.delimiter}"` : 'Ayraç: Sabit genişlik (kolon)');
    return parts.length ? ' · ' + parts.join(' · ') : '';
  },

  // Yapıştırılan/yüklenen metin değiştikçe: formatı otomatik tespit et,
  // profil seçili değilse (veya "otomatik" ise) en iyi eşleşmeyi öner.
  async onOpticalContentChange() {
    const textarea = document.getElementById('optical-raw-textarea');
    const infoEl = document.getElementById('optical-detected-format-info');
    const text = textarea?.value || '';
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 5);
    this._opticalLines = lines;
    if (lines.length === 0) {
      if (infoEl) infoEl.textContent = 'Henüz veri girilmedi.';
      this._opticalDetectedEncoding = null;
      this.refreshOpticalFieldPreview();
      return;
    }

    if (!this._opticalProfiles || this._opticalProfiles.length === 0) {
      await this.initOpticalTab();
    }

    const sel = document.getElementById('optical-profile-select');
    const manualChoice = sel?.value;
    if (manualChoice && manualChoice !== '__calibrate__') {
      // Kullanıcı elle bir profil seçmiş - tespiti sadece bilgi amaçlı göster
      const manualProfile = (this._opticalProfiles || []).find(p => p.id === manualChoice);
      if (infoEl) infoEl.textContent = `${lines.length} kayıt bulundu. Seçili profil kullanılacak.${this._opticalFormatDetailsSuffix(manualProfile)}`;
      this.onOpticalProfileChange();
      return;
    }

    const detected = await OptikProfiles.detectBest(lines);
    if (detected && detected.confidence >= 0.5) {
      if (infoEl) infoEl.textContent = `${lines.length} kayıt bulundu. Algılanan format: "${detected.profile.label}" (Güven: %${Math.round(detected.confidence * 100)})${this._opticalFormatDetailsSuffix(detected.profile)}`;
      if (sel) sel.value = detected.profile.id;
    } else {
      if (infoEl) infoEl.textContent = `${lines.length} kayıt bulundu. Format otomatik tanınamadı - lütfen elle seçin ya da kalibratörle yeni bir profil tanımlayın.${this._opticalFormatDetailsSuffix(null)}`;
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
      this.refreshOpticalFieldPreview();
      this._updateOpticalProfileDeleteBtn(null);
      return;
    }
    if (calibrator) { calibrator.style.display = 'none'; calibrator.innerHTML = ''; }

    const profile = (this._opticalProfiles || []).find(p => p.id === val);
    if (!profile) {
      document.getElementById('optical-answer-keys').innerHTML = '<p class="text-muted" style="font-size:12px">Bir format profili seçin.</p>';
      if (blockMappingEl) blockMappingEl.innerHTML = '';
      this._opticalActiveProfileId = null;
      this.refreshOpticalFieldPreview();
      this._updateOpticalProfileDeleteBtn(null);
      return;
    }

    this._opticalActiveProfileId = profile.id;
    this._opticalExamType = profile.examType;
    this._opticalBlockOverrides = {};

    if (blockMappingEl) {
      blockMappingEl.innerHTML = OptikProfiles.profileNeedsBlockMapping(profile) ? this.buildBlockMappingHtml(profile) : '';
    }

    document.getElementById('optical-answer-keys').innerHTML = this.renderAnswerKeyInputs(profile.examType, ['A', 'B'], profile);
    this.refreshOpticalFieldPreview();
    this._updateOpticalProfileDeleteBtn(profile);
  },

  // Sadece kullanıcı tarafından kaydedilmiş (builtIn:false) profillerde "Sil"
  // butonu gösterilir - hazır profiller silinemez.
  _updateOpticalProfileDeleteBtn(profile) {
    const btn = document.getElementById('optical-profile-delete-btn');
    if (!btn) return;
    btn.style.display = (profile && !profile.builtIn) ? '' : 'none';
  },

  async deleteSelectedOpticalProfile() {
    const profile = (this._opticalProfiles || []).find(p => p.id === this._opticalActiveProfileId);
    if (!profile || profile.builtIn) return;
    const ok = await UI.confirm(`"${profile.label}" profilini kalıcı olarak silmek istediğinize emin misiniz?`, '🗑 Profili Sil');
    if (!ok) return;
    await db.deleteOptikProfile(profile.id);
    UI.toast('Profil silindi', 'success');
    this._opticalActiveProfileId = null;
    await this.initOpticalTab();
    const sel = document.getElementById('optical-profile-select');
    if (sel) sel.value = '';
    this.onOpticalProfileChange();
  },

  // "HAM VERİ → ALGILANAN ALAN" onay tablosu: seçili profille örnek bir
  // satırı ayrıştırıp öğretmene hangi alanın nereye okunduğunu gösterir.
  refreshOpticalFieldPreview() {
    const container = document.getElementById('optical-field-preview');
    if (!container) return;

    const profile = (this._opticalProfiles || []).find(p => p.id === this._opticalActiveProfileId);
    if (!profile || !this._opticalLines || this._opticalLines.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.buildFieldPreviewHtml(profile, this._opticalLines);
  },

  buildFieldPreviewHtml(profile, lines) {
    let rec = null;
    for (const line of (lines || []).slice(0, 20)) {
      const r = OptikProfiles.extractLine(profile, line, this._opticalBlockOverrides);
      if (r) { rec = r; break; }
    }
    if (!rec) return '';

    const subjects = getSubjectsForExam(profile.examType);
    const rows = [];
    if (rec.schoolNumber) rows.push(['Öğrenci No', rec.schoolNumber]);
    const fullName = [rec.firstName, rec.lastName].filter(Boolean).join(' ');
    if (fullName) rows.push(['Öğrenci Adı', fullName]);
    if (rec.className) rows.push(['Sınıf', rec.className]);
    if (rec.booklet) rows.push(['Kitapçık', rec.booklet]);
    if (rec.meta?.tcNo) rows.push(['TC No', rec.meta.tcNo]);
    if (rec.meta?.tcNo2) rows.push(['TC No (2)', rec.meta.tcNo2]);
    rec.answerBlocks.forEach(b => {
      const subjLabel = b.subjectKey
        ? (subjects.find(s => s.key === b.subjectKey)?.name || b.subjectKey)
        : (b.label || `Blok ${b.index + 1}`);
      rows.push([`Cevap Dizisi — ${subjLabel}`, b.raw]);
    });

    if (rows.length === 0) return '';

    return `
      <div class="mt-2">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">
          👁️ Alan Eşleştirme Önizlemesi <small>(ilk geçerli kayıttan örneklenmiştir)</small>
        </div>
        <div class="preview-table-container" style="max-height:280px;overflow:auto">
          <table>
            <thead><tr><th style="white-space:nowrap">Algılanan Alan</th><th>Ham Değer</th></tr></thead>
            <tbody>
              ${rows.map(([label, val]) => `
                <tr>
                  <td style="white-space:nowrap;color:var(--accent-primary-light);font-weight:600">${this._escapeHtml(label)}</td>
                  <td class="font-mono" style="word-break:break-all">${this._escapeHtml(val)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
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
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap">
          <input type="text" class="form-input" id="optical-block-mapping-name" placeholder="Format adı (örn: LIMIT Optik)" style="max-width:220px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="ImportModule.saveOpticalProfileWithMapping()">💾 Bu Formatı Kaydet</button>
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
    this.refreshOpticalFieldPreview();
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
    const nameInput = document.getElementById('optical-block-mapping-name');
    const customLabel = nameInput?.value?.trim();

    let blockIdx = 0;
    const fields = base.fields.map(f => {
      if (f.role !== 'answerBlock') return f;
      const i = blockIdx++;
      return { ...f, subjectKey: f.subjectKey || this._opticalBlockOverrides[i] };
    });
    const newProfile = { ...base, id: undefined, builtIn: false, label: customLabel || `${base.label} (kaydedilmiş eşleme)`, fields };
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
    const colors = { A: { bg: 'rgba(20,184,166,0.04)', border: 'rgba(20,184,166,0.15)', text: 'var(--accent-primary-light)', icon: '📘' },
                      B: { bg: 'rgba(245,158,11,0.04)', border: 'rgba(245,158,11,0.15)', text: '#fbbf24', icon: '📙' } };
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

  // ---- Cevap Anahtarını Excel'den Yükleme (Sıra/Ders/Soru_ID/Kazanımlar/Dizilim/A-B) ----
  // Sadece cevap anahtarı harflerini doldurmakla kalmaz, her sorunun hangi
  // konuya (kazanım) ait olduğunu da `this._opticalTopicMap` içinde saklar.
  // Bu harita, dizilim sırasına göre evaluateAnswers'ın ürettiği perQuestion
  // diziyle AYNI SIRADA hizalanır - importOpticalData() sırasında deneme
  // kaydına yazılır ve db.getExamTopicAnalysis / getStudentTopicAnalysis
  // tarafından "hangi konu az anlaşılmış" analizinde kullanılır.
  // "Ders" hücresi tek bir sözcük/kısa ifade olduğu için subjectSets.js'teki
  // kısa keywords (ör. 'tür', 'tar', 'ink') yanlış pozitif üretebilir - "Din
  // Kültürü" içindeki "kültürü" alt dizesi 'tür' anahtar kelimesiyle eşleşip
  // yanlışlıkla Türkçe'ye atanabilir. Bu yüzden önce TAM ders adı eşleşmesi
  // denenir, sonra (varsa) en UZUN anahtar kelime kazanır - kısa/rastgele
  // alt-dize çakışmaları böylece elenir.
  _matchSubjectByDersName(dersNorm, subjects) {
    const exact = subjects.find(s => normalizeTrText(s.name) === dersNorm);
    if (exact) return exact;

    let best = null, bestLen = 0;
    subjects.forEach(s => {
      (s.keywords || [normalizeTrText(s.name)]).forEach(k => {
        if (dersNorm.includes(k) && k.length > bestLen) { best = s; bestLen = k.length; }
      });
    });
    return best;
  },

  async onAnswerKeyExcelSelected(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) await this.loadAnswerKeyExcel(file);
  },

  async loadAnswerKeyExcel(file) {
    const infoEl = document.getElementById('optical-answer-key-excel-info');
    const setInfo = (html, isError) => { if (infoEl) infoEl.innerHTML = `<span style="color:${isError ? '#ef4444' : '#10b981'}">${html}</span>`; };

    if (typeof XLSX === 'undefined') {
      UI.toast('Excel kütüphanesi yüklenemedi', 'danger');
      return;
    }
    if (!document.getElementById('optical-answer-keys')?.children.length) {
      UI.toast('Önce optik verisini yapıştırın/yükleyin ve bir format profili seçin - cevap anahtarı kutuları görününce Excel yüklenebilir', 'warning');
      return;
    }

    try {
      const profile = (this._opticalProfiles || []).find(p => p.id === this._opticalActiveProfileId);
      const examType = profile?.examType || this._opticalExamType || 'LGS';
      const subjects = getSubjectsForExam(examType);

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (!data || data.length < 2) {
        setInfo('Excel dosyasında yeterli veri bulunamadı.', true);
        return;
      }

      const headerRow = (data[0] || []).map(h => normalizeTrText(h));
      const findCol = (matcher) => headerRow.findIndex(matcher);
      const colDers = findCol(h => h.includes('ders'));
      const colSoruId = findCol(h => h.includes('soru') && h.includes('id'));
      const colKazanim = findCol(h => h.includes('kazan'));
      const colDizilim = findCol(h => h.includes('dizilim'));
      const colA = findCol(h => h.startsWith('a ') && (h.includes('kitap') || h.includes('cevap') || h.includes('anahtar')));
      const colB = findCol(h => h.startsWith('b ') && (h.includes('kitap') || h.includes('cevap') || h.includes('anahtar')));

      if (colDers === -1 || colDizilim === -1) {
        setInfo('Excel\'de "Ders" ve "Dizilim" sütunları bulunamadı - dosya formatını kontrol edin.', true);
        return;
      }

      const bySubject = {}; // subjectKey -> [{dizilim, soruId, kazanim, a, b}]
      const unmatchedDers = new Set();

      data.slice(1).forEach((row, i) => {
        const dersRaw = row?.[colDers];
        if (dersRaw == null || String(dersRaw).trim() === '') return;
        const dersNorm = normalizeTrText(dersRaw);
        const subject = this._matchSubjectByDersName(dersNorm, subjects);
        if (!subject) { unmatchedDers.add(String(dersRaw).trim()); return; }

        const dizilimRaw = colDizilim !== -1 ? row[colDizilim] : null;
        const dizilim = parseInt(dizilimRaw);
        (bySubject[subject.key] ||= []).push({
          dizilim: isNaN(dizilim) ? i : dizilim,
          soruId: colSoruId !== -1 ? row[colSoruId] : null,
          kazanim: colKazanim !== -1 ? String(row[colKazanim] || '').trim() : '',
          a: colA !== -1 ? String(row[colA] ?? '').trim() : '',
          b: colB !== -1 ? String(row[colB] ?? '').trim() : '',
        });
      });

      if (Object.keys(bySubject).length === 0) {
        setInfo('Hiçbir satır tanınan bir derse eşlenemedi. "Ders" sütunundaki adları kontrol edin.', true);
        return;
      }

      this._opticalTopicMap = this._opticalTopicMap || {};
      const filledSubjects = [];
      const mismatches = [];

      subjects.forEach(sub => {
        const entries = bySubject[sub.key];
        if (!entries || entries.length === 0) return;
        entries.sort((a, b) => a.dizilim - b.dizilim);

        const keyA = entries.map(e => (e.a ? e.a.charAt(0).toUpperCase() : ' ')).join('');
        const keyB = entries.map(e => (e.b ? e.b.charAt(0).toUpperCase() : ' ')).join('');
        const inputA = document.getElementById(`key-a-${sub.key}`);
        const inputB = document.getElementById(`key-b-${sub.key}`);
        if (inputA && keyA.trim()) inputA.value = keyA;
        if (inputB && keyB.trim()) inputB.value = keyB;

        this._opticalTopicMap[sub.key] = entries.map(e => ({ dizilim: e.dizilim, soruId: e.soruId, kazanim: e.kazanim }));
        filledSubjects.push(`${sub.name} (${entries.length})`);
        if (entries.length !== sub.questions) mismatches.push(`${sub.name}: ${entries.length} satır bulundu, beklenen ${sub.questions}`);
      });

      if (unmatchedDers.size > 0) mismatches.push(`Eşlenemeyen ders adı: ${[...unmatchedDers].join(', ')}`);

      let msg = `✅ ${filledSubjects.join(', ')} için cevap anahtarı ve konu haritası yüklendi.`;
      if (mismatches.length > 0) msg += `<br>⚠ ${mismatches.join(' · ')}`;
      setInfo(msg, mismatches.length > 0 && filledSubjects.length === 0);
      UI.toast('Cevap anahtarı Excel\'den yüklendi', 'success');
    } catch (err) {
      console.error('Answer key excel parse error:', err);
      setInfo('Dosya okunurken hata oluştu: ' + err.message, true);
    }
  },

  // ---- Sabit Genişlikli Kalibratör (yeni/bilinmeyen formatlar için) ----
  _calibratorRoleLabels() {
    return { schoolNumber: 'Okul No', firstName: 'Ad', lastName: 'Soyad', fullName: 'Ad Soyad (birleşik)', className: 'Sınıf', booklet: 'Kitapçık', tcNo: 'TC No', answerBlock: 'Cevap Bloğu', ignore: 'Yoksay' };
  },

  buildCalibratorHtml() {
    if (!this._calibratorFields) {
      this._calibratorFields = [
        { role: 'schoolNumber', start: 0, end: 10 },
        { role: 'fullName', start: 10, end: 30 },
        { role: 'className', start: 30, end: 33 },
        { role: 'booklet', start: 33, end: 35 },
      ];
    }
    if (this._calibratorActiveFieldIdx == null || !this._calibratorFields[this._calibratorActiveFieldIdx]) {
      this._calibratorActiveFieldIdx = 0;
    }
    const roleOptions = ['schoolNumber', 'firstName', 'lastName', 'fullName', 'className', 'booklet', 'tcNo', 'answerBlock', 'ignore'];
    const roleLabels = this._calibratorRoleLabels();
    const textarea = document.getElementById('optical-raw-textarea');
    const sampleLine = (textarea?.value || '').split(/\r?\n/).find(l => l.trim().length > 5) || '';
    const ruler = Array.from({ length: Math.ceil(sampleLine.length / 10) }, (_, i) => String(i * 10).padEnd(10)).join('');

    const fieldRows = this._calibratorFields.map((f, i) => {
      const active = i === this._calibratorActiveFieldIdx;
      const focusAttr = `onfocus="ImportModule.setCalibratorActiveField(${i})"`;
      return `
      <div data-cf-row="${i}" onclick="ImportModule.setCalibratorActiveField(${i})" style="display:flex;gap:6px;align-items:center;padding:4px 6px;flex-wrap:wrap;border-left:3px solid ${active ? '#10b981' : 'transparent'};background:${active ? 'rgba(16,185,129,0.10)' : 'transparent'};border-radius:4px;cursor:pointer;">
        ${active ? '<span title="Örnek satırdan seçim buraya yazılacak" style="font-size:13px">🖱️</span>' : '<span style="width:13px;display:inline-block"></span>'}
        <select class="form-select" style="max-width:170px" data-cf-idx="${i}" data-cf-prop="role" ${focusAttr} onchange="ImportModule.onCalibratorFieldChange(this)">
          ${roleOptions.map(r => `<option value="${r}" ${f.role === r ? 'selected' : ''}>${roleLabels[r]}</option>`).join('')}
        </select>
        <input type="number" class="form-input font-mono" style="width:80px" placeholder="Başlangıç" value="${f.start ?? ''}" data-cf-idx="${i}" data-cf-prop="start" ${focusAttr} onchange="ImportModule.onCalibratorFieldChange(this)">
        <input type="number" class="form-input font-mono" style="width:80px" placeholder="Bitiş" value="${f.end ?? ''}" data-cf-idx="${i}" data-cf-prop="end" ${focusAttr} onchange="ImportModule.onCalibratorFieldChange(this)">
        ${f.role === 'answerBlock' ? `<input type="text" class="form-input" style="width:140px" placeholder="Ders adı (etiket)" value="${f.label || ''}" data-cf-idx="${i}" data-cf-prop="label" ${focusAttr} onchange="ImportModule.onCalibratorFieldChange(this)">` : ''}
        <button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation();ImportModule.removeCalibratorField(${i})">✕</button>
      </div>
    `;
    }).join('');

    return `
      <div style="padding:14px;background:rgba(20,184,166,0.05);border:1px solid rgba(20,184,166,0.2);border-radius:10px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px">🛠 Yeni Sabit-Genişlikli Format Tanımla</div>
        <p class="text-muted" style="font-size:12px;margin-bottom:10px">
          Bir alanın satırına tıkla (🖱️ ile işaretlenir), sonra aşağıdaki örnek satırda o alana denk gelen bölgeyi fare ile seç — başlangıç/bitiş pozisyonları otomatik yazılır. İstersen elle de girebilirsin. "Test Et" ile sonucu anında gör.
        </p>

        <div style="font-family:monospace;font-size:10px;color:var(--text-muted);white-space:pre;overflow-x:auto;padding:0 8px;margin-bottom:2px">${ruler}</div>
        <input type="text" id="calibrator-sample-line" class="font-mono" readonly
          value="${this._escapeHtml(sampleLine)}"
          placeholder="(örnek satır yok - önce yukarıya bir satır yapıştırın)"
          onmouseup="ImportModule.onCalibratorSampleSelect()" onkeyup="ImportModule.onCalibratorSampleSelect()" onselect="ImportModule.onCalibratorSampleSelect()"
          style="display:block;width:100%;box-sizing:border-box;font-size:11px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);margin-bottom:10px;color:inherit;">

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

  // Aktif (seçim hedefi olan) alanı değiştirir - tam yeniden render YAPMAZ,
  // sadece satır vurgusunu günceller ki bir input'a odaklanmak o input'un
  // focus'unu çalmasın (aksi halde kullanıcı elle değer giremez).
  setCalibratorActiveField(idx) {
    this._calibratorActiveFieldIdx = idx;
    document.querySelectorAll('#calibrator-fields > div[data-cf-row]').forEach(el => {
      const active = parseInt(el.dataset.cfRow) === idx;
      el.style.background = active ? 'rgba(16,185,129,0.10)' : 'transparent';
      el.style.borderLeftColor = active ? '#10b981' : 'transparent';
      const marker = el.querySelector('span');
      if (marker) marker.textContent = active ? '🖱️' : '';
    });
  },

  // Örnek satır input'unda fare/klavye ile yapılan seçimi okuyup aktif
  // alanın başlangıç/bitiş pozisyonlarına otomatik yazar.
  onCalibratorSampleSelect() {
    const input = document.getElementById('calibrator-sample-line');
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start == null || end == null || start === end) return; // boş seçim, yoksay

    const idx = this._calibratorActiveFieldIdx;
    const field = this._calibratorFields?.[idx];
    if (!field) return;

    field.start = start;
    field.end = end;
    const startInput = document.querySelector(`#calibrator-fields input[data-cf-idx="${idx}"][data-cf-prop="start"]`);
    const endInput = document.querySelector(`#calibrator-fields input[data-cf-idx="${idx}"][data-cf-prop="end"]`);
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;

    const roleLabel = this._calibratorRoleLabels()[field.role] || field.role;
    UI.toast(`"${roleLabel}" alanı ${start}-${end} olarak ayarlandı`, 'success');
  },

  onCalibratorFieldChange(el) {
    const idx = parseInt(el.dataset.cfIdx);
    const prop = el.dataset.cfProp;
    const val = (prop === 'start' || prop === 'end') ? parseInt(el.value) : el.value;
    this._calibratorFields[idx][prop] = val;
  },

  addCalibratorField() {
    this._calibratorFields.push({ role: 'answerBlock', start: 0, end: 0, label: '' });
    this._calibratorActiveFieldIdx = this._calibratorFields.length - 1;
    document.getElementById('optical-calibrator').innerHTML = this.buildCalibratorHtml();
  },

  removeCalibratorField(idx) {
    this._calibratorFields.splice(idx, 1);
    if (this._calibratorActiveFieldIdx >= this._calibratorFields.length) {
      this._calibratorActiveFieldIdx = Math.max(0, this._calibratorFields.length - 1);
    }
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
        if (!block.raw || !block.raw.trim()) return; // bu ders bu satırda boş (ör. sayısal dosyasında sözel bloğu) - atla ki birleştirmede diğer dosyanın gerçek verisinin üzerine yazmasın
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
      <div class="card" style="padding:12px;text-align:center;background:rgba(20,184,166,0.06);border:1px solid rgba(20,184,166,0.2)">
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
      this._opticalDetectedEncoding = null;
      this._opticalLines = [];
      this._opticalTopicMap = null;
      document.getElementById('optical-answer-keys').innerHTML = '';
      const excelInfoEl = document.getElementById('optical-answer-key-excel-info');
      if (excelInfoEl) excelInfoEl.innerHTML = '';
      const blockMappingEl = document.getElementById('optical-block-mapping');
      if (blockMappingEl) blockMappingEl.innerHTML = '';
      const fieldPreviewEl = document.getElementById('optical-field-preview');
      if (fieldPreviewEl) fieldPreviewEl.innerHTML = '';
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
          // Soru bazlı D/Y/B dizisi - konu (kazanım) analizinde kullanılır
          // (bkz. importOptical.js#evaluateOpticalData, db.getExamTopicAnalysis)
          answers: subData?.perQuestion || null,
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

    // Excel'den yüklenmiş konu (kazanım) haritası varsa bu denemeye kalıcı olarak kaydet
    if (this._opticalTopicMap && Object.keys(this._opticalTopicMap).length > 0) {
      const exam = await db.getExam(examId);
      await db.updateExam(examId, { topicMap: { ...(exam?.topicMap || {}), ...this._opticalTopicMap } });
      this._opticalTopicMap = null;
    }

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
};
