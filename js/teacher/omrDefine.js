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
let _omrCurriculumCache = {};
let _omrPendingRanges = [];

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
    _omrPendingRanges = [];
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
        <input type="text" id="omr-f-topic" class="form-control" placeholder="Örn. Kesirler">
      </div>
      <div>
        <label class="form-label">Test Adı</label>
        <input type="text" id="omr-f-title" class="form-control" placeholder="Örn. Kesirler Testi 3">
      </div>
      <div>
        <label class="form-label">Soru Sayısı</label>
        <select id="omr-f-count" class="form-control">
          <option value="20">20 soru</option>
          <option value="15">15 soru</option>
        </select>
      </div>
    </div>

    <div class="mt-2">
      <label class="form-label">Cevap Anahtarı</label>
      <div id="omr-answer-key-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:8px;margin-top:6px"></div>
    </div>

    <div class="mt-2">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <label class="form-label" style="margin:0">Kazanım Aralığı (opsiyonel)</label>
        <button type="button" class="btn btn-sm" id="omr-add-range-btn">+ Aralık Ekle</button>
      </div>
      <div id="omr-range-list" style="margin-top:8px"></div>
    </div>

    <div class="mt-2" style="display:flex;align-items:center;gap:12px">
      <button type="button" class="btn btn-primary" id="omr-save-exam-btn">Test Tanımını Kaydet</button>
      <span id="omr-form-status" class="text-muted" style="font-size:13px"></span>
    </div>
  `;
}

function _omrWireForm() {
  document.getElementById('omr-f-count').addEventListener('change', _omrRenderAnswerKeyInputs);
  _omrRenderAnswerKeyInputs();

  document.getElementById('omr-add-range-btn').addEventListener('click', _omrAddRangeRow);
  document.getElementById('omr-save-exam-btn').addEventListener('click', _omrSaveExam);
}

function _omrRenderAnswerKeyInputs() {
  const count = parseInt(document.getElementById('omr-f-count').value, 10) || 20;
  const grid = document.getElementById('omr-answer-key-grid');
  let html = '';
  for (let q = 1; q <= count; q++) {
    html += `
      <div style="display:flex;align-items:center;gap:4px">
        <span style="font-size:12px;color:var(--text-muted,#888);min-width:18px">${q}.</span>
        <select class="form-control omr-ak-input" data-q="${q}" style="padding:4px">
          <option value="">-</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
      </div>`;
  }
  grid.innerHTML = html;
}

async function _omrAddRangeRow() {
  const subjectId = document.getElementById('omr-f-subject').value;
  const gradeLevel = document.getElementById('omr-f-grade').value;
  if (!subjectId) {
    alert('Kazanım aralığı eklemek için önce bir ders seçin.');
    return;
  }
  const cacheKey = `${subjectId}|${gradeLevel}`;
  if (!_omrCurriculumCache[cacheKey]) {
    const params = new URLSearchParams({ subject_id: subjectId });
    if (gradeLevel) params.set('grade_level', gradeLevel);
    const resp = await fetch(`/api/admin/question-bank/curriculum?${params}`).then(r => r.json());
    _omrCurriculumCache[cacheKey] = resp.curriculum || [];
  }
  const kazanimOptions = [];
  const walk = (nodes, path) => {
    for (const n of nodes || []) {
      const label = path ? `${path} > ${n.name}` : n.name;
      if (n.level === 'kazanim') kazanimOptions.push({ id: n.id, label });
      walk(n.children, label);
    }
  };
  walk(_omrCurriculumCache[cacheKey], '');

  const rowId = `omr-range-${Date.now()}`;
  _omrPendingRanges.push(rowId);
  const optionsHtml = kazanimOptions.map(k => `<option value="${k.id}">${_omrEsc(k.label)}</option>`).join('');
  const row = document.createElement('div');
  row.id = rowId;
  row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
  row.innerHTML = `
    <input type="number" min="1" class="form-control omr-range-from" placeholder="Baş." style="width:70px">
    <span>-</span>
    <input type="number" min="1" class="form-control omr-range-to" placeholder="Bit." style="width:70px">
    <select class="form-control omr-range-node" style="flex:1">
      <option value="">Kazanım seçin...</option>${optionsHtml}
    </select>
    <button type="button" class="btn btn-sm" onclick="document.getElementById('${rowId}').remove()">✕</button>
  `;
  document.getElementById('omr-range-list').appendChild(row);
}

function _omrCollectAnswerKey() {
  const key = {};
  document.querySelectorAll('.omr-ak-input').forEach(sel => {
    if (sel.value) key[sel.dataset.q] = sel.value;
  });
  return key;
}

function _omrCollectRanges() {
  const ranges = [];
  document.querySelectorAll('#omr-range-list > div').forEach(row => {
    const from = parseInt(row.querySelector('.omr-range-from').value, 10);
    const to = parseInt(row.querySelector('.omr-range-to').value, 10);
    const nodeSelect = row.querySelector('.omr-range-node');
    const nodeId = nodeSelect.value;
    if (from && to && nodeId) {
      ranges.push({ from, to, nodeId: parseInt(nodeId, 10), label: nodeSelect.selectedOptions[0].textContent });
    }
  });
  return ranges;
}

async function _omrSaveExam() {
  const statusEl = document.getElementById('omr-form-status');
  const title = document.getElementById('omr-f-title').value.trim();
  const questionCount = parseInt(document.getElementById('omr-f-count').value, 10);
  const answerKey = _omrCollectAnswerKey();
  const subjectIdRaw = document.getElementById('omr-f-subject').value;
  const gradeLevel = document.getElementById('omr-f-grade').value || null;
  const topic = document.getElementById('omr-f-topic').value.trim() || null;
  const curriculumRange = _omrCollectRanges();

  if (!title) { statusEl.textContent = '❌ Test adı gerekli.'; return; }
  if (Object.keys(answerKey).length !== questionCount) {
    statusEl.textContent = '❌ Tüm soruların cevabını girin.';
    return;
  }

  const payload = {
    title, questionCount, answerKey, gradeLevel, topic,
    subjectId: subjectIdRaw ? parseInt(subjectIdRaw, 10) : null,
    curriculumRange: curriculumRange.length ? curriculumRange : null,
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
        <button type="button" class="btn btn-sm btn-primary" onclick="_omrOpenPaperDialog(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">📄 Form Oluştur</button>
      </div>
      <div id="omr-paper-dialog-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
    </div>
  `).join('');
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
