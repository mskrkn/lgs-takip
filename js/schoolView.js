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

  async renderStudents() {
    const container = document.getElementById('page-students');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const data = await this._loadOverview();
      const rows = [...data.students].sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '', 'tr'));
      container.innerHTML = `
        ${this._banner()}
        <div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">🎓</span> Öğrenciler (${rows.length})</h3></div>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
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
          </table></div>
        </div>`;
    } catch (err) {
      container.innerHTML = `${this._banner()}<p class="text-muted mt-2">❌ ${_svEscapeHtml(err.message)}</p>`;
    }
  },

  async renderExams() {
    const container = document.getElementById('page-exams');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const data = await this._loadOverview();
      container.innerHTML = `
        ${this._banner()}
        <div class="card mt-2">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📝</span> Denemeler (${data.exams.length})</h3></div>
          <div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="text-align:left;color:var(--text-muted)"><th style="padding:8px">Deneme</th><th style="padding:8px">Tarih</th><th style="padding:8px">Tür</th></tr>
            ${data.exams.map(e => `<tr style="border-top:1px solid var(--bg-glass-border);cursor:pointer" onclick="App.navigateTo('exam-detail', {examId: ${e.id}})">
              <td style="padding:8px">${_svEscapeHtml(e.name)}</td>
              <td style="padding:8px">${_svEscapeHtml(e.date || '-')}</td>
              <td style="padding:8px">${_svEscapeHtml(e.exam_type || '-')}</td>
            </tr>`).join('')}
          </table></div>
        </div>`;
    } catch (err) {
      container.innerHTML = `${this._banner()}<p class="text-muted mt-2">❌ ${_svEscapeHtml(err.message)}</p>`;
    }
  },

  async renderExamDetail(examId) {
    const container = document.getElementById('page-exam-detail');
    if (!container) return;
    container.innerHTML = `${this._banner()}<p class="text-muted mt-2">Yükleniyor...</p>`;
    try {
      const res = await fetch(`/api/teacher/exam/${examId}${this._schoolQuery()}`);
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
        </div>` : ''}`;
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
