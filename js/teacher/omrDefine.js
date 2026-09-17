// ============================================================
// Optik Okuma (Kamera OMR) - Faz 1: "Hızlı Test Tanımla" + form üretimi.
// Kamera/tarama ekranı (Faz 2) ve sunucu CV pipeline'ı (Faz 3) henüz yok -
// bu dosya sadece test tanımını ve öğrenci başına QR'lı PDF üretimini
// kapsar. Bağımsız bir dosya olarak tutuluyor (ogretmen.js'e karıştırılmadan)
// çünkü ogretmen.js zaten çok büyük; her ikisi de aynı global script
// kapsamını paylaştığı için renderOmrDefinePage() ogretmen.js'in nav
// tıklama işleyicisinden doğrudan çağrılabiliyor.

let _omrMeta = null;
let _omrOverview = null;
let _omrCurriculumTopics = [];   // secili ders+sinifin konu+kazanim listesi (bkz. _omrLoadCurriculumTopics)
let _omrAnswerKey = {};          // { "1": "A", "2": "C", ... } - optik taslak uzerinde tiklanarak doldurulur

// Kagidin FIZIKSEL kapasitesi (bkz. omr_form.py QUESTION_COUNT_MAX) - ogretmen
// serbestce soru sayisi girebilir (kullanici isteğiyle 2026-09-17: sabit
// 10/15/20/25 secenekleri yerine elle giris) ama bu sayidan fazlasi kagitta
// hic yer bulamaz, o yuzden ust sinir burada da uygulanir.
const OMR_QUESTION_COUNT_MAX = 25;

function _omrGetQuestionCount() {
  const raw = parseInt(document.getElementById('omr-f-count').value, 10);
  if (!raw || raw < 1) return 1;
  if (raw > OMR_QUESTION_COUNT_MAX) return OMR_QUESTION_COUNT_MAX;
  return raw;
}

function _omrEsc(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderOmrDefinePage() {
  const formRoot = document.getElementById('omr-define-root');
  const listRoot = document.getElementById('omr-exam-list');
  if (!formRoot || !listRoot) return;
  formRoot.innerHTML = '<p class="text-muted">Yükleniyor...</p>';

  try {
    const [meta, overview, examsResp] = await Promise.all([
      fetch('/api/teacher/omr/meta').then(r => r.json()),
      fetch('/api/teacher/overview').then(r => r.json()),
      fetch('/api/teacher/omr/exams').then(r => r.json()),
    ]);
    _omrMeta = meta;
    _omrOverview = overview;
    _omrCurriculumTopics = [];
    _omrAnswerKey = {};
    formRoot.innerHTML = _omrBuildFormHtml();
    _omrWireForm();
    _omrRenderExamList(examsResp.exams || []);
  } catch (err) {
    formRoot.innerHTML = `<p style="color:#f43f5e">Yüklenemedi: ${_omrEsc(err.message)}</p>`;
  }
}

function _omrBuildFormHtml() {
  const subjectOptions = (_omrMeta.subjects || [])
    .map(s => `<option value="${s.id}">${_omrEsc(s.name)}</option>`).join('');
  const gradeOptions = (_omrMeta.gradeLevels || [])
    .map(g => `<option value="${_omrEsc(g.name)}">${_omrEsc(g.name)}. Sınıf</option>`).join('');
  return `
    <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      <div>
        <label class="form-label">Ders</label>
        <select id="omr-f-subject" class="form-control">
          <option value="">Ders seçin...</option>${subjectOptions}
        </select>
      </div>
      <div>
        <label class="form-label">Sınıf Seviyesi</label>
        <select id="omr-f-grade" class="form-control">
          <option value="">Seçilmedi</option>${gradeOptions}
        </select>
      </div>
      <div>
        <label class="form-label">Konu</label>
        <select id="omr-f-topic" class="form-control" disabled>
          <option value="">Önce ders ve sınıf seçin...</option>
        </select>
      </div>
      <div>
        <label class="form-label">Kazanım</label>
        <select id="omr-f-kazanim" class="form-control" disabled>
          <option value="">Önce konu seçin...</option>
        </select>
      </div>
      <div>
        <label class="form-label">Test Adı</label>
        <input type="text" id="omr-f-title" class="form-control" placeholder="Örn. Kesirler Testi 3">
      </div>
      <div>
        <label class="form-label">Soru Sayısı</label>
        <input type="number" id="omr-f-count" class="form-control" min="1" max="${OMR_QUESTION_COUNT_MAX}" value="20">
        <span class="text-muted" style="font-size:12px">Optik kağıtta ${OMR_QUESTION_COUNT_MAX} soruya kadar alan var; fazlası boş kalır ve değerlendirilmez.</span>
      </div>
    </div>

    <div class="mt-2">
      <label class="form-label">Cevap Anahtarı — doğru şıkkı optik taslak üzerinde işaretleyin</label>
      <div id="omr-answer-key-sheet" class="omr-sheet mt-1"></div>
    </div>

    <div class="mt-2" style="display:flex;align-items:center;gap:12px">
      <button type="button" class="btn btn-primary" id="omr-save-exam-btn">Test Tanımını Kaydet</button>
      <span id="omr-form-status" class="text-muted" style="font-size:13px"></span>
    </div>
  `;
}

function _omrWireForm() {
  const countInput = document.getElementById('omr-f-count');
  countInput.addEventListener('input', () => {
    _omrAnswerKey = {};
    _omrRenderAnswerKeySheet();
  });
  countInput.addEventListener('change', () => {
    countInput.value = _omrGetQuestionCount();  // gecersiz/sinir disi deger yazildiysa alanda da duzelt
  });
  _omrRenderAnswerKeySheet();

  document.getElementById('omr-f-subject').addEventListener('change', _omrLoadCurriculumTopics);
  document.getElementById('omr-f-grade').addEventListener('change', _omrLoadCurriculumTopics);
  document.getElementById('omr-f-topic').addEventListener('change', _omrPopulateKazanimSelect);
  document.getElementById('omr-save-exam-btn').addEventListener('click', _omrSaveExam);
}

// ---- Optik taslak üzerinde cevap anahtarı işaretleme ----
// Basili formla (bkz. omr_form.py) AYNI gorsel dile (buyuk, kalin
// daireler, 2 sutun x 13 satir - 25 soruluk fiziksel maks. kapasiteye gore,
// bkz. omr_form.py ANSWER_ROWS_PER_COL) sahip bir HTML taslak - ogretmen
// dogru sikki gercek kagitta oldugu gibi tiklayarak isaretler.
function _omrRenderAnswerKeySheet() {
  const count = _omrGetQuestionCount();
  const sheet = document.getElementById('omr-answer-key-sheet');
  const col1 = [], col2 = [];
  for (let q = 1; q <= count; q++) {
    (q <= 13 ? col1 : col2).push(_omrBuildSheetRow(q));
  }
  sheet.innerHTML = `
    <div class="omr-sheet-cols">
      <div class="omr-sheet-col">${col1.join('')}</div>
      <div class="omr-sheet-col">${col2.join('')}</div>
    </div>
  `;
  sheet.querySelectorAll('.omr-bubble').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.q, choice = btn.dataset.choice;
      _omrAnswerKey[q] = _omrAnswerKey[q] === choice ? null : choice;
      _omrRenderAnswerKeySheet();
    });
  });
}

function _omrBuildSheetRow(q) {
  const choices = ['A', 'B', 'C', 'D'];
  const bubbles = choices.map(c => {
    const filled = _omrAnswerKey[String(q)] === c;
    return `<button type="button" class="omr-bubble${filled ? ' omr-bubble-filled' : ''}" data-q="${q}" data-choice="${c}">${c}</button>`;
  }).join('');
  return `<div class="omr-sheet-row"><span class="omr-sheet-qnum">${q}</span>${bubbles}</div>`;
}

function _omrCollectAnswerKey() {
  const key = {};
  Object.keys(_omrAnswerKey).forEach(q => { if (_omrAnswerKey[q]) key[q] = _omrAnswerKey[q]; });
  return key;
}

// ---- Konu/Kazanım (seeds/omr_konu_kazanim/*.json'dan, bkz. server.py
// api_teacher_omr_curriculum_topics) ----
async function _omrLoadCurriculumTopics() {
  const subjectId = document.getElementById('omr-f-subject').value;
  const gradeLevel = document.getElementById('omr-f-grade').value;
  const topicSelect = document.getElementById('omr-f-topic');
  const kazanimSelect = document.getElementById('omr-f-kazanim');
  _omrCurriculumTopics = [];
  kazanimSelect.innerHTML = '<option value="">Önce konu seçin...</option>';
  kazanimSelect.disabled = true;

  if (!subjectId || !gradeLevel) {
    topicSelect.innerHTML = '<option value="">Önce ders ve sınıf seçin...</option>';
    topicSelect.disabled = true;
    return;
  }
  topicSelect.innerHTML = '<option value="">Yükleniyor...</option>';
  topicSelect.disabled = true;
  try {
    const resp = await fetch(`/api/teacher/omr/curriculum-topics?subjectId=${subjectId}&gradeLevel=${gradeLevel}`).then(r => r.json());
    _omrCurriculumTopics = resp.konular || [];
    if (!_omrCurriculumTopics.length) {
      topicSelect.innerHTML = '<option value="">Bu ders/sınıf için konu bulunamadı</option>';
      return;
    }
    topicSelect.innerHTML = '<option value="">Konu seçin...</option>' +
      _omrCurriculumTopics.map((t, i) => `<option value="${i}">${_omrEsc(t.konu_adi)}</option>`).join('');
    topicSelect.disabled = false;
  } catch (err) {
    topicSelect.innerHTML = '<option value="">Yüklenemedi</option>';
  }
}

function _omrPopulateKazanimSelect() {
  const idx = document.getElementById('omr-f-topic').value;
  const kazanimSelect = document.getElementById('omr-f-kazanim');
  if (idx === '' || !_omrCurriculumTopics[idx]) {
    kazanimSelect.innerHTML = '<option value="">Önce konu seçin...</option>';
    kazanimSelect.disabled = true;
    return;
  }
  const kazanimlar = _omrCurriculumTopics[idx].kazanimlar || [];
  kazanimSelect.innerHTML = '<option value="">Kazanım seçin (opsiyonel)...</option>' +
    kazanimlar.map((k, i) => `<option value="${i}">${_omrEsc(k.kazanim_adi)}</option>`).join('');
  kazanimSelect.disabled = false;
}

async function _omrSaveExam() {
  const statusEl = document.getElementById('omr-form-status');
  const title = document.getElementById('omr-f-title').value.trim();
  const questionCount = _omrGetQuestionCount();
  const answerKey = _omrCollectAnswerKey();
  const subjectIdRaw = document.getElementById('omr-f-subject').value;
  const gradeLevel = document.getElementById('omr-f-grade').value || null;
  const topicIdx = document.getElementById('omr-f-topic').value;
  const kazanimIdx = document.getElementById('omr-f-kazanim').value;
  const topicObj = topicIdx !== '' ? _omrCurriculumTopics[topicIdx] : null;
  const kazanimObj = (topicObj && kazanimIdx !== '') ? topicObj.kazanimlar[kazanimIdx] : null;

  if (!title) { statusEl.textContent = '❌ Test adı gerekli.'; return; }
  if (Object.keys(answerKey).length !== questionCount) {
    statusEl.textContent = '❌ Optik taslak üzerinde tüm soruların doğru cevabını işaretleyin.';
    return;
  }

  const payload = {
    title, questionCount, answerKey, gradeLevel,
    topic: topicObj ? topicObj.konu_adi : null,
    kazanimKodu: kazanimObj ? kazanimObj.kazanim_kodu : null,
    kazanimAdi: kazanimObj ? kazanimObj.kazanim_adi : null,
    subjectId: subjectIdRaw ? parseInt(subjectIdRaw, 10) : null,
  };

  statusEl.textContent = 'Kaydediliyor...';
  try {
    const res = await fetch('/api/teacher/omr/exams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi.');
    statusEl.textContent = '✅ Kaydedildi.';
    _omrAnswerKey = {};
    _omrRenderAnswerKeySheet();
    document.getElementById('omr-f-title').value = '';
    const examsResp = await fetch('/api/teacher/omr/exams').then(r => r.json());
    _omrRenderExamList(examsResp.exams || []);
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
  }
}

function _omrRenderExamList(exams) {
  const root = document.getElementById('omr-exam-list');
  if (!root) return;
  if (!exams.length) {
    root.innerHTML = '<p class="text-muted">Henüz tanımlı test yok.</p>';
    return;
  }
  root.innerHTML = exams.map(e => `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <strong>${_omrEsc(e.title)}</strong>
          <div class="text-muted" style="font-size:12px">
            ${_omrEsc(e.subject_name || '-')} · ${e.grade_level ? e.grade_level + '. Sınıf' : 'Sınıf belirtilmedi'} · ${e.question_count} soru
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm btn-primary" onclick="_omrOpenPaperDialog(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">📄 Form Oluştur</button>
          <button type="button" class="btn btn-sm" onclick="_omrOpenScanView(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">📷 Kamerayla Tara</button>
          <button type="button" class="btn btn-sm" onclick="_omrOpenReviewPanel(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">🔍 İncele</button>
        </div>
      </div>
      <div id="omr-paper-dialog-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
      <div id="omr-review-panel-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
    </div>
  `).join('');
}

// ============================================================
// Faz 4 - İnceleme/Onay
// ============================================================

async function _omrOpenReviewPanel(examDefId, examTitle) {
  const container = document.getElementById(`omr-review-panel-${examDefId}`);
  if (!container) return;
  const isOpen = container.style.display !== 'none';
  document.querySelectorAll('[id^="omr-review-panel-"]').forEach(el => el.style.display = 'none');
  if (isOpen) return;

  container.style.display = 'block';
  container.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  await _omrRefreshReviewList(examDefId, examTitle);
}

async function _omrRefreshReviewList(examDefId, examTitle) {
  const container = document.getElementById(`omr-review-panel-${examDefId}`);
  if (!container) return;
  const resp = await fetch(`/api/teacher/omr/exams/${examDefId}/scans`).then(r => r.json());
  const scans = resp.scans || [];
  const doneCount = scans.filter(s => s.status !== 'needs_review').length;

  const statusLabel = (s) => ({
    needs_review: '🟡 İncelenmedi', approved: '✅ Onaylandı', rejected: '🚫 Reddedildi',
  }[s.status] || s.status);
  const matchLabel = (s) => ({
    matched_qr: 'QR', matched_id_digits: 'No', manual: 'Elle', unmatched: '❌ Eşleşmedi', pending: '-',
  }[s.match_status] || s.match_status);

  container.innerHTML = `
    <div style="font-size:13px;color:var(--text-muted,#888);margin-bottom:8px">
      ${resp.printedCount} kağıt yazdırıldı · ${scans.length} tarandı · ${doneCount} işlem tamamlandı
    </div>
    ${scans.length === 0 ? '<p class="text-muted">Henüz tarama yok.</p>' : scans.map(s => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border,#2a2a2a);font-size:13px">
        <div>
          ${s.first_name ? _omrEsc(s.first_name) + ' ' + _omrEsc(s.last_name) : '<em>Öğrenci atanmadı</em>'}
          ${s.school_number ? '(' + _omrEsc(s.school_number) + ')' : ''}
          <span class="text-muted"> · ${matchLabel(s)} · ${statusLabel(s)}</span>
        </div>
        <button type="button" class="btn btn-sm" onclick="_omrOpenScanDetail(${s.id}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">${s.status === 'needs_review' ? 'İncele' : 'Görüntüle'}</button>
      </div>
    `).join('')}
    <div id="omr-scan-detail-${examDefId}" style="margin-top:10px"></div>
  `;
}

// Şube seçilince (ya da hiç seçilmeden, "Tüm Şubeler" varsayılanıyla) Öğrenci
// dropdown'unu o şubenin öğrencileriyle sınırlar - okul büyükse tek, uzun ve
// düz bir öğrenci listesinde doğru öğrenciyi bulmak zor oluyordu.
function _omrBuildStudentOptions(students, classFilter, selectedStudentId) {
  const filtered = classFilter ? students.filter(st => st.class_name === classFilter) : students;
  const placeholder = `<option value="">Öğrenci seçin...</option>`;
  return placeholder + filtered.map(st =>
    `<option value="${st.id}" ${selectedStudentId === st.id ? 'selected' : ''}>${_omrEsc(st.first_name)} ${_omrEsc(st.last_name)} (${_omrEsc(st.school_number || '-')}${classFilter ? '' : ', ' + _omrEsc(st.class_name || '-')})</option>`
  ).join('');
}

function _omrFilterStudentsByClass(scanId) {
  const classSelect = document.getElementById(`omr-detail-class-${scanId}`);
  const studentSelect = document.getElementById(`omr-detail-student-${scanId}`);
  if (!classSelect || !studentSelect) return;
  const students = (_omrOverview && _omrOverview.students) || [];
  const previouslySelected = Number(studentSelect.value) || null;
  studentSelect.innerHTML = _omrBuildStudentOptions(students, classSelect.value, previouslySelected);
}

async function _omrOpenScanDetail(scanId, examDefId, examTitle) {
  const host = document.getElementById(`omr-scan-detail-${examDefId}`);
  if (!host) return;
  host.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  const scan = await fetch(`/api/teacher/omr/scans/${scanId}`).then(r => r.json());

  const students = (_omrOverview && _omrOverview.students) || [];
  const classNames = [...new Set(students.map(st => st.class_name).filter(Boolean))].sort();
  const assignedStudent = students.find(st => st.id === scan.student_id);
  const currentClass = assignedStudent ? (assignedStudent.class_name || '') : '';
  const classOptions = classNames.map(c =>
    `<option value="${_omrEsc(c)}" ${c === currentClass ? 'selected' : ''}>${_omrEsc(c)}</option>`
  ).join('');
  const studentOptions = _omrBuildStudentOptions(students, currentClass, scan.student_id);

  const outcomeColor = { correct: '#22c55e', wrong: '#f43f5e', blank: '#888', multi: '#f59e0b', ambiguous: '#f59e0b' };
  const questionsHtml = (scan.perQuestion ? scan.perQuestion.questions : []).map(q => `
    <div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px">
      <span style="width:22px;color:var(--text-muted,#888)">${q.question}.</span>
      <span style="width:14px;height:14px;border-radius:50%;background:${outcomeColor[q.outcome] || '#888'};display:inline-block"></span>
      <span style="width:60px">${q.answer || '-'} ${q.keyAnswer ? '(anahtar: ' + q.keyAnswer + ')' : ''}</span>
      ${(q.outcome === 'multi' || q.outcome === 'ambiguous') ? `
        <select class="form-control omr-correction-input" data-q="${q.question}" style="padding:2px;width:60px">
          <option value="">-</option>
          <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
        </select>` : ''}
    </div>
  `).join('');

  const summary = scan.perQuestion ? scan.perQuestion.summary : null;
  const readOnly = scan.status !== 'needs_review';

  host.innerHTML = `
    <div class="card" style="display:flex;gap:16px;flex-wrap:wrap">
      <div style="flex:0 0 220px">
        <img src="/api/teacher/omr/scans/${scanId}/image" style="max-width:100%;border-radius:6px" alt="Tarama">
      </div>
      <div style="flex:1;min-width:220px">
        <div style="margin-bottom:8px">
          <label class="form-label">Şube</label>
          <select id="omr-detail-class-${scanId}" class="form-control" ${readOnly ? 'disabled' : ''} onchange="_omrFilterStudentsByClass(${scanId})">
            <option value="">Tüm Şubeler</option>${classOptions}
          </select>
        </div>
        <div style="margin-bottom:8px">
          <label class="form-label">Öğrenci</label>
          <select id="omr-detail-student-${scanId}" class="form-control" ${readOnly ? 'disabled' : ''}>
            ${studentOptions}
          </select>
          ${!readOnly ? `<button type="button" class="btn btn-sm mt-2" onclick="_omrAssignStudent(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">Öğrenciyi Kaydet</button>` : ''}
        </div>
        ${summary ? `<div class="text-muted" style="font-size:13px;margin-bottom:6px">Doğru: ${summary.correct} · Yanlış: ${summary.wrong} · Boş: ${summary.blank} · Şüpheli: ${summary.flagged}</div>` : ''}
        <div style="max-height:260px;overflow-y:auto">${questionsHtml}</div>
        <div id="omr-detail-status-${scanId}" class="text-muted" style="font-size:13px;margin-top:8px"></div>
        ${!readOnly ? `
          <div style="display:flex;gap:8px;margin-top:10px">
            <button type="button" class="btn btn-sm" onclick="_omrSaveCorrections(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">Düzeltmeleri Kaydet</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="_omrApproveScan(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">✅ Onayla</button>
            <button type="button" class="btn btn-sm" onclick="_omrRejectScan(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">🚫 Reddet</button>
          </div>` : `<p class="text-muted" style="font-size:12px">${scan.status === 'approved' ? '✅ Onaylandı, düzenlenemez.' : '🚫 Reddedildi.'}</p>`}
      </div>
    </div>
  `;
}

async function _omrAssignStudent(scanId, examDefId, examTitle) {
  const statusEl = document.getElementById(`omr-detail-status-${scanId}`);
  const studentId = document.getElementById(`omr-detail-student-${scanId}`).value;
  if (!studentId) { statusEl.textContent = '❌ Öğrenci seçin.'; return; }
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: parseInt(studentId, 10) }),
  });
  const data = await res.json();
  if (!res.ok) { statusEl.textContent = '❌ ' + data.error; return; }
  statusEl.textContent = '✅ Öğrenci kaydedildi.';
  await _omrRefreshReviewList(examDefId, examTitle);
  _omrOpenScanDetail(scanId, examDefId, examTitle);
}

async function _omrSaveCorrections(scanId, examDefId, examTitle) {
  const statusEl = document.getElementById(`omr-detail-status-${scanId}`);
  const corrections = {};
  document.querySelectorAll('.omr-correction-input').forEach(sel => {
    if (sel.value) corrections[sel.dataset.q] = sel.value;
  });
  if (!Object.keys(corrections).length) { statusEl.textContent = 'Düzeltilecek soru seçilmedi.'; return; }
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/corrections`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corrections }),
  });
  const data = await res.json();
  if (!res.ok) { statusEl.textContent = '❌ ' + data.error; return; }
  statusEl.textContent = '✅ Düzeltmeler kaydedildi.';
  _omrOpenScanDetail(scanId, examDefId, examTitle);
}

async function _omrApproveScan(scanId, examDefId, examTitle) {
  const statusEl = document.getElementById(`omr-detail-status-${scanId}`);
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/approve`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { statusEl.textContent = '❌ ' + data.error; return; }
  statusEl.textContent = `✅ Onaylandı (net: ${data.net}).`;
  await _omrRefreshReviewList(examDefId, examTitle);
}

async function _omrRejectScan(scanId, examDefId, examTitle) {
  if (!confirm('Bu taramayı reddetmek istediğinize emin misiniz? Öğrenci yeniden taranmalı.')) return;
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/reject`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error); return; }
  await _omrRefreshReviewList(examDefId, examTitle);
}

function _omrOpenPaperDialog(examDefId, examTitle) {
  const container = document.getElementById(`omr-paper-dialog-${examDefId}`);
  if (!container) return;
  const isOpen = container.style.display !== 'none';
  document.querySelectorAll('[id^="omr-paper-dialog-"]').forEach(el => el.style.display = 'none');
  if (isOpen) return;

  const students = (_omrOverview && _omrOverview.students) || [];
  const classNames = [...new Set(students.map(s => s.class_name).filter(Boolean))].sort();
  const classOptions = classNames.map(c => `<option value="${_omrEsc(c)}">${_omrEsc(c)}</option>`).join('');

  container.style.display = 'block';
  container.innerHTML = `
    <label class="form-label">Şube</label>
    <select class="form-control" id="omr-paper-class-${examDefId}" style="max-width:200px">
      <option value="">Şube seçin...</option>${classOptions}
    </select>
    <div id="omr-paper-students-${examDefId}" style="margin-top:8px;max-height:220px;overflow-y:auto"></div>
    <button type="button" class="btn btn-primary mt-2" id="omr-paper-generate-${examDefId}" disabled>PDF Oluştur ve İndir</button>
    <span id="omr-paper-status-${examDefId}" class="text-muted" style="font-size:13px;margin-left:8px"></span>
  `;

  const classSelect = document.getElementById(`omr-paper-class-${examDefId}`);
  const studentsBox = document.getElementById(`omr-paper-students-${examDefId}`);
  const genBtn = document.getElementById(`omr-paper-generate-${examDefId}`);

  classSelect.addEventListener('change', () => {
    const cls = classSelect.value;
    const inClass = students.filter(s => s.class_name === cls);
    if (!cls) { studentsBox.innerHTML = ''; genBtn.disabled = true; return; }
    studentsBox.innerHTML = `
      <label style="display:block;margin-bottom:4px"><input type="checkbox" id="omr-select-all-${examDefId}" checked> Tümünü seç</label>
      ${inClass.map(s => `
        <label style="display:block;font-size:13px">
          <input type="checkbox" class="omr-student-check" value="${s.id}" checked>
          ${_omrEsc(s.first_name)} ${_omrEsc(s.last_name)} ${s.school_number ? '(' + _omrEsc(s.school_number) + ')' : ''}
        </label>
      `).join('')}
    `;
    genBtn.disabled = inClass.length === 0;
    document.getElementById(`omr-select-all-${examDefId}`).addEventListener('change', (ev) => {
      studentsBox.querySelectorAll('.omr-student-check').forEach(cb => cb.checked = ev.target.checked);
    });
  });

  genBtn.addEventListener('click', () => _omrGeneratePapers(examDefId, examTitle));
}

async function _omrGeneratePapers(examDefId, examTitle) {
  const statusEl = document.getElementById(`omr-paper-status-${examDefId}`);
  const studentIds = [...document.querySelectorAll(`#omr-paper-students-${examDefId} .omr-student-check:checked`)]
    .map(cb => parseInt(cb.value, 10));
  if (!studentIds.length) { statusEl.textContent = '❌ Öğrenci seçilmedi.'; return; }

  statusEl.textContent = 'Oluşturuluyor...';
  try {
    const res = await fetch(`/api/teacher/omr/exams/${examDefId}/papers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Form oluşturulamadı.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optik-form-${examTitle.replace(/[^\w\-]+/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = `✅ ${studentIds.length} kağıt oluşturuldu.`;
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
  }
}
