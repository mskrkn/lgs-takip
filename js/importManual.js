// ============================================
// LGS Deneme Takip - Import Module - Manuel Giriş Sekmesi
// ============================================
// Bu nesne js/import.js içinde diğer parçalarla Object.assign edilerek
// tek bir ImportModule oluşturur - tüm parçalar aynı `this` durumunu
// (parsedData, columnMapping, _opticalProfiles vb.) paylaşır.

const ImportManual = {

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
            <input type="text" class="form-input font-mono" id="manual-${sub.key}-net" readonly style="background:rgba(20,184,166,0.05);color:var(--accent-primary-light)">
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
          <div style="flex:1;padding:16px;background:rgba(20,184,166,0.05);border-radius:12px;border:1px solid rgba(20,184,166,0.15);">
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
};
