// ============================================
// LGS Deneme Takip - Süper Admin: Bir Okulun Öğrenci/Deneme Verisini
// SALT OKUNUR Görüntülemesi (App.actingSchool doluyken).
//
// Mevcut js/app.js'teki renderStudents/renderExams/... TAMAMEN tarayıcının
// yerel deposundaki (IndexedDB) veriyi okur/yazar - süper adminin
// tarayıcısında hiçbir okulun yerel verisi yok, o yüzden onlara
// DOKUNULMADI. Bunun yerine burada PARALEL, sunucudan (zaten var olan
// öğretmen uçlarından - /api/teacher/overview,exam/<id>,student/<id> -
// school_id ile) okuyan, hiçbir ekleme/düzenleme/silme butonu
// İÇERMEYEN bir görünüm var. Okul admini kendi verisini yine eskisi gibi
// (js/app.js, IndexedDB) yönetir.
// ============================================

function _svEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const SchoolView = {
  _overviewCache: null,
  _overviewCacheSchoolId: null,

  _schoolQuery() {
    const id = App.actingSchool?.id;
    return id ? `?school_id=${id}` : '';
  },

  _banner() {
    return `<div class="card" style="border:1px solid rgba(99,102,241,0.35);background:rgba(99,102,241,0.08)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <span>🏫 <b>${_svEscapeHtml(App.actingSchool?.name || '')}</b> okulunun verisi görüntüleniyor (salt okunur)</span>
        <button class="btn btn-secondary btn-sm" onclick="AdminUsers.exitSchoolContext()">⬅️ Okullara Dön</button>
      </div>
    </div>`;
  },

  async _loadOverview() {
    const schoolId = App.actingSchool?.id;
    if (this._overviewCache && this._overviewCacheSchoolId === schoolId) return this._overviewCache;
    const res = await fetch(`/api/teacher/overview${this._schoolQuery()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Veri alınamadı.');
    this._overviewCache = data;
    this._overviewCacheSchoolId = schoolId;
    return data;
  },

  // Platform sahibinin bu okula dogrudan ogrenci/deneme/sonuc eklemesi -
  // bkz. server.py POST /api/teacher/students,exams,results. Yazilan
  // satirlar source='platform_admin' ile damgalanir, bu okulun kendi
  // senkronu bunlara asla dokunmaz (bkz. server.py api_admin_sync).
  _addStudentFormHtml() {
    return `<div id="sv-add-student-form" style="display:none" class="card mt-2">
      <div class="form-row" style="grid-template-columns:repeat(4,1fr)">
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Ad</label><input class="form-input" id="sv-student-firstname"></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Soyad</label><input class="form-input" id="sv-student-lastname"></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Okul No</label><input class="form-input" id="sv-student-schoolnumber"></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Sınıf</label><input class="form-input" id="sv-student-classname" placeholder="8A"></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="SchoolView.submitAddStudent()">💾 Kaydet</button>
        <button class="btn btn-secondary btn-sm" onclick="SchoolView.toggleAddStudentForm(false)">İptal</button>
      </div>
    </div>`;
  },

  toggleAddStudentForm(show) {
    const el = document.getElementById('sv-add-student-form');
    if (el) el.style.display = show ? 'block' : 'none';
  },

  async submitAddStudent() {
    const firstName = document.getElementById('sv-student-firstname')?.value.trim();
    const lastName = document.getElementById('sv-student-lastname')?.value.trim();
    const schoolNumber = document.getElementById('sv-student-schoolnumber')?.value.trim();
    const className = document.getElementById('sv-student-classname')?.value.trim();
    if (!firstName || !lastName) {
      UI.toast('Ad ve soyad gerekli.', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/teacher/students${this._schoolQuery()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, schoolNumber, className }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Öğrenci eklenemedi.');
      UI.toast(`${firstName} ${lastName} eklendi.`, 'success');
      this._overviewCache = null;
      this.renderStudents();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  },

  _studentsTableHtml(rows) {
    return `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="text-align:left;color:var(--text-muted)">
        <th style="padding:8px">Ad Soyad</th><th style="padding:8px">Sınıf</th>
        <th style="padding:8px">Son Net</th><th style="padding:8px">Sıra</th><th style="padding:8px">Durum</th>
      </tr>
      ${rows.map(s => `<tr style="border-top:1px solid var(--bg-glass-border);cursor:pointer" onclick="App.navigateTo('student-profile', {studentId: ${s.id}})">
        <td style="padding:8px">${_svEscapeHtml(s.first_name)} ${_svEscapeHtml(s.last_name)}</td>
        <td style="padding:8px">${_svEscapeHtml(s.class_name || '-')}</td>
        <td style="padding:8px">${s.latestNet ?? '-'}</td>
        <td style="padding:8px">${s.rank ?? '-'}</td>
        <td style="padding:8px">${_svEscapeHtml(s.status || '-')}</td>
      </tr>`).join('')}
    </table></div>`;
  },

  // admin-panel-prompt.md bölüm 5: Kademe → Şube hiyerarşisi, sayılarla.
  // "Okul seç" adımı bu görünüme zaten App.actingSchool set edilmeden
  // ulaşılamadığı için ayrıca gerekmiyor (bkz. Schools.enterSchool).
  _gradeCardsHtml(students) {
    const counts = {};
    students.forEach(s => {
      const grade = App.parseClassName(s.class_name).grade;
      const key = grade || '__none__';
      counts[key] = (counts[key] || 0) + 1;
    });
    const grades = Object.keys(counts).filter(k => k !== '__none__').sort((a, b) => Number(a) - Number(b));
    const cards = grades.map(g => `
      <div class="stat-card" style="cursor:pointer" onclick="SchoolView.drillIntoGrade('${g}')">
        <div class="stat-icon purple">📚</div>
        <div class="stat-value">${counts[g]}</div>
        <div class="stat-label">${g}. Sınıf</div>
      </div>`).join('');
    const noneCard = counts.__none__ ? `
      <div class="stat-card" style="cursor:pointer" onclick="SchoolView.drillIntoGrade('')">
        <div class="stat-icon orange">❔</div>
        <div class="stat-value">${counts.__none__}</div>
        <div class="stat-label">Sınıfı Belirsiz</div>
      </div>` : '';
    return `<p class="text-muted" style="margin-bottom:12px">Listelemek için bir sınıf kademesi seçin.</p>
      <div class="stats-grid">${cards}${noneCard}</div>`;
  },

  _branchCardsHtml(grade) {
    const students = (this._studentsCache || []).filter(s => App.parseClassName(s.class_name).grade === grade);
    const counts = {};
    students.forEach(s => {
      const branch = App.parseClassName(s.class_name).branch;
      const key = branch || '__none__';
      counts[key] = (counts[key] || 0) + 1;
    });
    const branches = Object.keys(counts).filter(k => k !== '__none__').sort();
    const cards = branches.map(b => `
      <div class="stat-card" style="cursor:pointer" onclick="SchoolView.drillIntoBranch('${grade}', '${b}')">
        <div class="stat-icon blue">🏷️</div>
        <div class="stat-value">${counts[b]}</div>
        <div class="stat-label">${grade}/${b}</div>
      </div>`).join('');
    const noneCard = counts.__none__ ? `
      <div class="stat-card" style="cursor:pointer" onclick="SchoolView.drillIntoBranch('${grade}', '')">
        <div class="stat-icon orange">❔</div>
        <div class="stat-value">${counts.__none__}</div>
        <div class="stat-label">Şubesi Belirsiz</div>
      </div>` : '';
    return `<button class="btn btn-secondary btn-sm mb-2" onclick="SchoolView.resetStudentsHierarchy()">◀ Kademelere Dön</button>
      <p class="text-muted" style="margin-bottom:12px">${grade}. Sınıf - bir şube seçin.</p>
      <div class="stats-grid">${cards}${noneCard}</div>`;
  },

  drillIntoGrade(grade) {
    document.getElementById('sv-students-body').innerHTML = this._branchCardsHtml(grade);
  },

  drillIntoBranch(grade, branch) {
    const rows = (this._studentsCache || []).filter(s => {
      const p = App.parseClassName(s.class_name);
      return p.grade === grade && (branch === '' ? !p.branch : p.branch === branch);
    }).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '', 'tr'));
    document.getElementById('sv-students-body').innerHTML =
      `<button class="btn btn-secondary btn-sm mb-2" onclick="SchoolView.resetStudentsHierarchy()">◀ Kademelere Dön</button>`
      + this._studentsTableHtml(rows);
  },

  resetStudentsHierarchy() {
    document.getElementById('sv-students-body').innerHTML = this._gradeCardsHtml(this._studentsCache || []);
  },

  async renderStudents() {
    const container = document.getElementById('page-students');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const data = await this._loadOverview();
      this._studentsCache = data.students;
      container.innerHTML = `
        ${this._banner()}
        <div class="card mt-2">
          <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <h3 class="card-title"><span class="card-icon">🎓</span> Öğrenciler (${data.students.length})</h3>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="SchoolView.toggleAddStudentForm(true)">➕ Öğrenci Ekle</button>
              <button class="btn btn-secondary btn-sm" onclick="RosterImport.openModal({mode:'server', schoolQuery: SchoolView._schoolQuery(), onDone: () => { SchoolView._overviewCache = null; SchoolView.renderStudents(); }})">📋 Sınıf Listesi PDF Yükle</button>
            </div>
          </div>
          ${this._addStudentFormHtml()}
          <div id="sv-students-body">${this._gradeCardsHtml(data.students)}</div>
        </div>`;
    } catch (err) {
      container.innerHTML = `${this._banner()}<p class="text-muted mt-2">❌ ${_svEscapeHtml(err.message)}</p>`;
    }
  },

  _addExamFormHtml() {
    const typeOptions = Object.keys(SUBJECT_SETS).map(t => `<option value="${t}">${t}</option>`).join('');
    return `<div id="sv-add-exam-form" style="display:none" class="card mt-2">
      <div class="form-row" style="grid-template-columns:repeat(3,1fr)">
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Deneme Adı</label><input class="form-input" id="sv-exam-name"></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Tarih</label><input type="date" class="form-input" id="sv-exam-date"></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Tür</label><select class="form-select" id="sv-exam-type">${typeOptions}</select></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="SchoolView.submitAddExam()">💾 Kaydet</button>
        <button class="btn btn-secondary btn-sm" onclick="SchoolView.toggleAddExamForm(false)">İptal</button>
      </div>
    </div>`;
  },

  toggleAddExamForm(show) {
    const el = document.getElementById('sv-add-exam-form');
    if (el) el.style.display = show ? 'block' : 'none';
  },

  async submitAddExam() {
    const name = document.getElementById('sv-exam-name')?.value.trim();
    const date = document.getElementById('sv-exam-date')?.value;
    const examType = document.getElementById('sv-exam-type')?.value || 'LGS';
    if (!name || !date) {
      UI.toast('Deneme adı ve tarihi gerekli.', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/teacher/exams${this._schoolQuery()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date, examType }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Deneme oluşturulamadı.');
      UI.toast(`"${name}" oluşturuldu.`, 'success');
      this._overviewCache = null;
      this.renderExams();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  },

  async renderExams() {
    const container = document.getElementById('page-exams');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const data = await this._loadOverview();

      // admin-panel-prompt.md bölüm 7: kademeye göre gruplu liste.
      const groups = {};
      data.exams.forEach(e => {
        const grade = e.stats?.dominantGrade || null;
        const key = grade || '__other__';
        if (!groups[key]) groups[key] = { grade, exams: [] };
        groups[key].exams.push(e);
      });
      const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === '__other__') return 1;
        if (b === '__other__') return -1;
        return Number(a) - Number(b);
      });
      const rowHtml = (e) => `<tr style="border-top:1px solid var(--bg-glass-border);cursor:pointer" onclick="App.navigateTo('exam-detail', {examId: ${e.id}})">
        <td style="padding:8px">${_svEscapeHtml(e.name)}</td>
        <td style="padding:8px">${_svEscapeHtml(e.date || '-')}</td>
        <td style="padding:8px">${_svEscapeHtml(e.exam_type || '-')}</td>
        <td style="padding:8px">${e.stats ? e.stats.studentCount : '-'}</td>
        <td style="padding:8px">${e.stats ? e.stats.totalNet : '-'}</td>
        <td style="padding:8px">${e.stats ? e.stats.highestNet : '-'}</td>
        <td style="padding:8px">${e.stats ? e.stats.lowestNet : '-'}</td>
      </tr>`;
      const groupsHtml = sortedKeys.map(key => {
        const g = groups[key];
        const title = g.grade ? `${g.grade}. Sınıf Denemeleri` : 'Diğer / Karışık Denemeler';
        return `<h4 style="font-size:14px;font-weight:600;color:var(--text-muted);margin:16px 0 8px">${title} (${g.exams.length})</h4>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)">
              <th style="padding:8px">Deneme</th><th style="padding:8px">Tarih</th><th style="padding:8px">Tür</th>
              <th style="padding:8px">Katılımcı</th><th style="padding:8px">Ort. Net</th>
              <th style="padding:8px">En Yüksek</th><th style="padding:8px">En Düşük</th>
            </tr>
            ${g.exams.map(rowHtml).join('')}
          </table></div>`;
      }).join('');

      // Veri Girişi Admini "+ Deneme Oluştur" butonunu görmez (bölüm 7).
      const canCreateExam = !App.currentUser?.dataEntryOnly;

      container.innerHTML = `
        ${this._banner()}
        <div class="card mt-2">
          <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <h3 class="card-title"><span class="card-icon">📝</span> Denemeler (${data.exams.length})</h3>
            ${canCreateExam ? `<button class="btn btn-primary btn-sm" onclick="SchoolView.toggleAddExamForm(true)">➕ Deneme Oluştur</button>` : ''}
          </div>
          ${canCreateExam ? this._addExamFormHtml() : ''}
          ${groupsHtml}
        </div>`;
    } catch (err) {
      container.innerHTML = `${this._banner()}<p class="text-muted mt-2">❌ ${_svEscapeHtml(err.message)}</p>`;
    }
  },

  _addResultFormHtml(examId, examType, students) {
    const studentOptions = students
      .slice()
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '', 'tr'))
      .map(s => `<option value="${s.id}">${_svEscapeHtml(s.first_name)} ${_svEscapeHtml(s.last_name)}${s.class_name ? ' (' + _svEscapeHtml(s.class_name) + ')' : ''}</option>`)
      .join('');
    const subjectInputs = getSubjectsForExam(examType).map(sub => `
      <div class="card" style="padding:12px;">
        <div style="margin-bottom:8px"><b style="font-size:13px">${_svEscapeHtml(sub.name)}</b>
          <span class="text-muted" style="font-size:11px"> (${sub.questions} soru)</span></div>
        <div class="form-row" style="grid-template-columns:repeat(3,1fr)">
          <div class="form-group" style="margin-bottom:0"><label class="form-label">Doğru</label>
            <input type="number" class="form-input" id="sv-result-${sub.key}-correct" min="0" max="${sub.questions}" value="0" oninput="SchoolView.calcResultNets('${examType}')"></div>
          <div class="form-group" style="margin-bottom:0"><label class="form-label">Yanlış</label>
            <input type="number" class="form-input" id="sv-result-${sub.key}-wrong" min="0" max="${sub.questions}" value="0" oninput="SchoolView.calcResultNets('${examType}')"></div>
          <div class="form-group" style="margin-bottom:0"><label class="form-label">Net</label>
            <input type="text" class="form-input font-mono" id="sv-result-${sub.key}-net" readonly value="0.00"></div>
        </div>
      </div>`).join('');
    return `<div class="card mt-2">
      <div class="card-header"><h3 class="card-title"><span class="card-icon">✍️</span> Sonuç Gir</h3></div>
      <div class="form-group"><label class="form-label">Öğrenci</label>
        <select class="form-select" id="sv-result-student"><option value="">-- Öğrenci seçin --</option>${studentOptions}</select>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:12px">${subjectInputs}</div>
      <div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="padding:12px 16px;background:rgba(20,184,166,0.05);border-radius:10px;border:1px solid rgba(20,184,166,0.15)">
          <span class="text-muted" style="font-size:12px">Toplam Net:</span>
          <span class="font-mono font-bold" id="sv-result-total-net" style="margin-left:8px">0.00</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="SchoolView.submitAddResult(${examId}, '${examType}')">💾 Kaydet</button>
      </div>
    </div>`;
  },

  calcResultNets(examType) {
    let total = 0;
    getSubjectsForExam(examType).forEach(sub => {
      const correct = parseInt(document.getElementById(`sv-result-${sub.key}-correct`)?.value) || 0;
      const wrong = parseInt(document.getElementById(`sv-result-${sub.key}-wrong`)?.value) || 0;
      const net = correct - wrong / 3;
      const netEl = document.getElementById(`sv-result-${sub.key}-net`);
      if (netEl) netEl.value = net.toFixed(2);
      total += net;
    });
    const totalEl = document.getElementById('sv-result-total-net');
    if (totalEl) totalEl.textContent = total.toFixed(2);
  },

  async submitAddResult(examId, examType) {
    const studentId = parseInt(document.getElementById('sv-result-student')?.value);
    if (!studentId) {
      UI.toast('Lütfen bir öğrenci seçin.', 'warning');
      return;
    }
    const subjects = {};
    getSubjectsForExam(examType).forEach(sub => {
      const correct = parseInt(document.getElementById(`sv-result-${sub.key}-correct`)?.value) || 0;
      const wrong = parseInt(document.getElementById(`sv-result-${sub.key}-wrong`)?.value) || 0;
      const blank = Math.max(0, sub.questions - correct - wrong);
      const net = parseFloat((correct - wrong / 3).toFixed(2));
      subjects[sub.key] = { correct, wrong, blank, net };
    });
    try {
      const res = await fetch(`/api/teacher/results${this._schoolQuery()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, examId, subjects }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Sonuç kaydedilemedi.');
      UI.toast('Sonuç kaydedildi.', 'success');
      this._overviewCache = null;
      this.renderExamDetail(examId);
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  },

  async renderExamDetail(examId) {
    const container = document.getElementById('page-exam-detail');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const [res, overview] = await Promise.all([
        fetch(`/api/teacher/exam/${examId}${this._schoolQuery()}`),
        this._loadOverview(),
      ]);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Deneme detayı alınamadı.');

      const subjectKeys = d.myClassResults[0] ? Object.keys(d.myClassResults[0].subjects || {}) : [];
      const resultsRows = d.myClassResults.map(r => `
        <tr style="border-top:1px solid var(--bg-glass-border)">
          <td style="padding:6px">${r.schoolRank}</td>
          <td style="padding:6px">${_svEscapeHtml(r.studentName)}</td>
          ${subjectKeys.map(k => `<td style="padding:6px">${(r.subjects[k] || {}).net ?? '-'}</td>`).join('')}
          <td style="padding:6px"><b>${r.totalNet}</b></td>
        </tr>`).join('');

      const classAvgRows = d.otherClassAverages.map(c => `
        <tr style="border-top:1px solid var(--bg-glass-border)">
          <td style="padding:6px">${_svEscapeHtml(c.className)}</td>
          <td style="padding:6px">${c.studentCount}</td>
          <td style="padding:6px">${c.avgNet}</td>
        </tr>`).join('');

      const topicRows = (d.topicStats || []).slice(0, 30).map(t => `
        <tr style="border-top:1px solid var(--bg-glass-border)">
          <td style="padding:6px">${_svEscapeHtml(t.kazanim)}</td>
          <td style="padding:6px">%${t.successRate}</td>
          <td style="padding:6px">${t.correct}D/${t.wrong}Y/${t.blank}B</td>
        </tr>`).join('');

      const questionRows = (d.questionStats || []).map(q => `
        <tr style="border-top:1px solid var(--bg-glass-border)">
          <td style="padding:6px">${_svEscapeHtml(q.dizilim ?? q.soruId ?? '-')}</td>
          <td style="padding:6px">${_svEscapeHtml(q.kazanim)}</td>
          <td style="padding:6px">%${q.successRate}</td>
          <td style="padding:6px">${q.correct}D/${q.wrong}Y/${q.blank}B</td>
        </tr>`).join('');

      container.innerHTML = `
        ${this._banner()}
        <div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📝</span> ${_svEscapeHtml(d.exam.name)} — ${_svEscapeHtml(d.exam.date || '')}</h3></div>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)">
              <th style="padding:6px">Sıra</th><th style="padding:6px">Öğrenci</th>
              ${subjectKeys.map(k => `<th style="padding:6px">${_svEscapeHtml(k)}</th>`).join('')}
              <th style="padding:6px">Toplam Net</th>
            </tr>
            ${resultsRows}
          </table></div>
        </div>
        <div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📊</span> Sınıf Ortalamaları</h3></div>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Sınıf</th><th style="padding:6px">Öğrenci</th><th style="padding:6px">Ort. Net</th></tr>
            ${classAvgRows}
          </table></div>
        </div>
        ${topicRows ? `<div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">🎯</span> Konu Analizi (en zayıf 30)</h3></div>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Kazanım</th><th style="padding:6px">Başarı</th><th style="padding:6px">D/Y/B</th></tr>
            ${topicRows}
          </table></div>
        </div>` : ''}
        ${questionRows ? `<div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">❓</span> Soru Bazlı Analiz</h3></div>
          <div class="table-wrapper" style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Soru</th><th style="padding:6px">Kazanım</th><th style="padding:6px">Başarı</th><th style="padding:6px">D/Y/B</th></tr>
            ${questionRows}
          </table></div>
        </div>` : ''}
        ${this._addResultFormHtml(examId, d.exam.examType, overview.students)}`;
    } catch (err) {
      container.innerHTML = `${this._banner()}<p class="text-muted mt-2">❌ ${_svEscapeHtml(err.message)}</p>`;
    }
  },

  async renderStudentProfile(studentId, examId) {
    const container = document.getElementById('page-student-profile');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const q = this._schoolQuery();
      const url = `/api/teacher/student/${studentId}${q}${examId ? (q ? '&' : '?') + 'exam_id=' + examId : ''}`;
      const res = await fetch(url);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Öğrenci profili alınamadı.');

      const trendRows = d.netTrend.map(t => `
        <tr style="border-top:1px solid var(--bg-glass-border)">
          <td style="padding:6px">${_svEscapeHtml(t.examName)}</td>
          <td style="padding:6px">${_svEscapeHtml(t.examDate || '-')}</td>
          <td style="padding:6px"><b>${t.totalNet}</b></td>
        </tr>`).join('');

      const topicRows = (d.latestExamTopicStats || []).slice(0, 20).map(t => `
        <tr style="border-top:1px solid var(--bg-glass-border)">
          <td style="padding:6px">${_svEscapeHtml(t.kazanim)}</td>
          <td style="padding:6px">%${t.successRate}</td>
        </tr>`).join('');

      const examOptions = d.results.map(r => `<option value="${r.examId}" ${r.examId === d.topicStatsExamId ? 'selected' : ''}>${_svEscapeHtml(r.examName)}</option>`).join('');

      container.innerHTML = `
        ${this._banner()}
        <div class="card mt-2">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">🎓</span> ${_svEscapeHtml(d.student.firstName)} ${_svEscapeHtml(d.student.lastName)}</h3>
          </div>
          <p class="text-muted">Sınıf: ${_svEscapeHtml(d.student.className || '-')} · Okul No: ${_svEscapeHtml(d.student.schoolNumber || '-')}</p>
          <p class="text-muted">Ortalama Net: <b>${d.averageNet ?? '-'}</b> · En İyi: <b>${d.bestNet ?? '-'}</b> · Deneme Sayısı: <b>${d.examCount}</b></p>
        </div>
        <div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📈</span> Net Trendi</h3></div>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Deneme</th><th style="padding:6px">Tarih</th><th style="padding:6px">Toplam Net</th></tr>
            ${trendRows}
          </table></div>
        </div>
        <div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">🎯</span> Konu Analizi</h3></div>
          <label class="form-label">Deneme Seç</label>
          <select class="form-control" style="max-width:320px" onchange="SchoolView.renderStudentProfile(${studentId}, Number(this.value))">
            ${examOptions}
          </select>
          <div class="table-wrapper mt-2"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:6px">Kazanım</th><th style="padding:6px">Başarı</th></tr>
            ${topicRows}
          </table></div>
        </div>`;
    } catch (err) {
      container.innerHTML = `${this._banner()}<p class="text-muted mt-2">❌ ${_svEscapeHtml(err.message)}</p>`;
    }
  },
};
