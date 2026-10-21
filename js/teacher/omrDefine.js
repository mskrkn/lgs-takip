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
let _omrEditAnswerKey = {};      // duzenleme panelinin KENDI cevap anahtari durumu (create formuyla karismasin diye ayri)
let _omrEditQuestionCount = 0;   // duzenlemede soru sayisi SABITTIR (fiziksel kagit zaten basilmis olabilir)

// Kagidin FIZIKSEL kapasitesi (bkz. omr_form.py QUESTION_COUNT_MAX) - ogretmen
// serbestce soru sayisi girebilir (kullanici isteğiyle 2026-09-17: sabit
// secenekler yerine elle giris) ama bu sayidan fazlasi kagitta hic yer
// bulamaz, o yuzden ust sinir burada da uygulanir. Girilen sayiya gore
// sunucu HANGI FIZIKSEL SABLONU (bkz. omr_form.py select_template)
// kullanacagini kendisi secer - ogretmen sadece soru sayisini girer:
// 1-20 -> "compact20" (70mm, 6 kagit/A4, standart kucuk kagit - 2026-09-23'te
// eski 25'lik "compact"in yerini aldi, "Okul No" bloğu da kaldırıldı),
// 21-50 -> "quarter50" (ceyrek A4, 4 kagit/A4, kucuk balon), 51-100 ->
// "quarter100" (ceyrek A4, en kucuk balon). Asagidaki _OMR_TEMPLATE_COLS SADECE bu ekrandaki onizlemenin
// kac sutuna bolunecegini belirler (gorsel), gercek PDF geometrisiyle
// birebir ayni olmasi gerekmez.
const OMR_QUESTION_COUNT_MAX = 100;

function _omrGetQuestionCount() {
  const raw = parseInt(document.getElementById('omr-f-count').value, 10);
  if (!raw || raw < 1) return 1;
  if (raw > OMR_QUESTION_COUNT_MAX) return OMR_QUESTION_COUNT_MAX;
  return raw;
}

function _omrTemplateColsForCount(count) {
  if (count <= 25) return 2;
  if (count <= 50) return 4;
  return 5;
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
        <span class="text-muted" style="font-size:12px">1-25 arası normal, 26-50 ve 51-100 arası daha yoğun (küçük daireli) optik kağıt kullanılır - kağıt otomatik seçilir.</span>
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
// Basili formla (bkz. omr_form.py) AYNI gorsel dile (buyuk, kalin daireler)
// sahip bir HTML taslak - ogretmen dogru sikki gercek kagitta oldugu gibi
// tiklayarak isaretler. Sutun sayisi soru sayisina gore degisir (bkz.
// _omrTemplateColsForCount) - gercek basili kagit da soru sayisi arttikca
// (26+) daha COK sutuna gecer (bkz. omr_form.py TEMPLATES), bu ekran o
// degisimi kabaca yansitir; piksel-birebir esitlik gerekmez, sadece her
// soruya bir yer ayrilmasi yeterli.
function _omrRenderAnswerKeySheet() {
  const count = _omrGetQuestionCount();
  const sheet = document.getElementById('omr-answer-key-sheet');
  const nCols = _omrTemplateColsForCount(count);
  const rowsPerCol = Math.ceil(count / nCols);
  const cols = Array.from({ length: nCols }, () => []);
  for (let q = 1; q <= count; q++) {
    cols[Math.floor((q - 1) / rowsPerCol)].push(_omrBuildSheetRow(q));
  }
  sheet.innerHTML = `
    <div class="omr-sheet-cols">
      ${cols.map(col => `<div class="omr-sheet-col">${col.join('')}</div>`).join('')}
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

  // Faz 3: sınıf boyutlu karşılaştırma tablosu (Ders|Öğretmen|Test|Katılım|
  // Ortalama) - test listesinin ÜSTÜNE, öğrencilerden türetilmiş sınıf
  // listesiyle (bkz. şube filtresi deseni) enjekte edilir, ayrı bir HTML
  // konteynerine ihtiyaç duymaz.
  const classNames = [...new Set(((_omrOverview && _omrOverview.students) || []).map(s => s.class_name).filter(Boolean))].sort();
  const classReportHtml = classNames.length ? `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h4 style="margin:0">📊 Sınıf Kazanım Raporu</h4>
        <select id="omr-class-report-select" class="form-control" style="max-width:200px" onchange="_omrLoadClassReport(this.value)">
          <option value="">Sınıf seçin...</option>
          ${classNames.map(c => `<option value="${_omrEsc(c)}">${_omrEsc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="omr-class-report-body" style="margin-top:10px"></div>
      <div id="omr-class-kazanim-body" style="margin-top:14px"></div>
      <div id="omr-class-subject-body" style="margin-top:14px"></div>
      <div id="omr-class-student-body" style="margin-top:14px"></div>
    </div>
  ` : '';

  if (!exams.length) {
    root.innerHTML = classReportHtml + '<p class="text-muted">Henüz tanımlı test yok.</p>';
    return;
  }
  root.innerHTML = classReportHtml + exams.map(e => `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <strong>${_omrEsc(e.title)}</strong>
          ${e.createdByName ? `<span class="text-muted" title="Bu testi ekleyen" style="font-size:11px"> · 👤 ${_omrEsc(e.createdByName)}</span>` : ''}
          <div class="text-muted" style="font-size:12px">
            ${_omrEsc(e.subject_name || '-')} · ${e.grade_level ? e.grade_level + '. Sınıf' : 'Sınıf belirtilmedi'} · ${e.question_count} soru
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" onclick="_omrOpenEditExam(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">✏️ Düzenle</button>
          <button type="button" class="btn btn-sm btn-primary" onclick="_omrOpenPaperDialog(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">📄 Form Oluştur</button>
          <button type="button" class="btn btn-sm" onclick="_omrOpenScanView(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">📷 Kamerayla Tara</button>
          <button type="button" class="btn btn-sm" onclick="_omrOpenReviewPanel(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">🔍 İncele</button>
          <button type="button" class="btn btn-sm" onclick="_omrOpenQuestionReport(${e.id})">📊 Soru Analizi</button>
          <button type="button" class="btn btn-sm" onclick="_omrOpenReportPanel(${e.id})">📑 Raporlar</button>
          <button type="button" class="btn btn-sm" style="color:#f43f5e" onclick="_omrDeleteExam(${e.id}, '${_omrEsc(e.title).replace(/'/g, "\\'")}')">🗑 Sil</button>
        </div>
      </div>
      <div id="omr-edit-panel-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
      <div id="omr-paper-dialog-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
      <div id="omr-review-panel-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
      <div id="omr-question-report-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
      <div id="omr-report-panel-${e.id}" style="display:none;margin-top:10px;border-top:1px solid var(--border,#333);padding-top:10px"></div>
    </div>
  `).join('');
}

// Faz 3: sınıf boyutlu karşılaştırma tablosu - bkz. api_teacher_omr_class_report.
async function _omrLoadClassReport(className) {
  const body = document.getElementById('omr-class-report-body');
  if (!body) return;
  const blockIds = ['omr-class-kazanim-body', 'omr-class-subject-body', 'omr-class-student-body'];
  if (!className) {
    body.innerHTML = '';
    blockIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    return;
  }
  _omrLoadReportBlock('omr-class-kazanim-body', '🎯 Kazanım Özeti', 'kazanim', { className });
  _omrLoadReportBlock('omr-class-subject-body', '📚 Ders Bazlı Rapor', 'subject', { className });
  _omrRenderStudentPicker(className);
  body.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  const data = await fetch(`/api/teacher/omr/class-report?className=${encodeURIComponent(className)}`).then(r => r.json());
  if (data.error) { body.innerHTML = `<p class="text-muted">❌ ${_omrEsc(data.error)}</p>`; return; }
  if (!data.report || !data.report.length) {
    body.innerHTML = '<p class="text-muted">Bu sınıfa henüz resmen uygulanmış bir Kazanım Denemesi yok.</p>';
    return;
  }
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
      <strong>🧑‍🏫 Sınıfa Uygulanan Testler</strong>
      <span>${_omrDownloadLinks('class_tests', { className })}</span>
    </div>
    <div class="table-wrapper"><table class="simple-table">
      <tr><th>Ders</th><th>Öğretmen</th><th>Test</th><th>Katılım</th><th>Ortalama Net</th></tr>
      ${data.report.map(row => `
        <tr>
          <td>${_omrEsc(row.subjectName)}</td>
          <td>${_omrEsc(row.teacherName)}</td>
          <td>${_omrEsc(row.examTitle)}</td>
          <td>${_omrEsc(row.participation)}</td>
          <td>${row.avgNet ?? '-'}</td>
        </tr>
      `).join('')}
    </table></div>`;
}

// ============================================================
// Aşama B - Raporlar + PDF/Excel/CSV/TXT dışa aktarma (bkz. omr_reports.py,
// GET /api/teacher/omr/reports/<kind>)
// ============================================================

const OMR_REPORT_KINDS = [
  ['basic', 'Basit Sonuç'],
  ['detailed', 'Detaylı (soru soru)'],
  ['class_compare', 'Sınıf Karşılaştırma'],
  ['question', 'Soru Analizi (rapor)'],
  ['answer_dist', 'Cevap Dağılımı (A/B/C/D)'],
];

function _omrReportUrl(kind, params, fmt) {
  return `/api/teacher/omr/reports/${kind}?${new URLSearchParams({ ...params, format: fmt })}`;
}

function _omrDownloadLinks(kind, params) {
  return [['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV'], ['txt', 'TXT']].map(([fmt, label]) =>
    `<a class="btn btn-sm" href="${_omrReportUrl(kind, params, fmt)}" download>⬇ ${label}</a>`).join(' ');
}

function _omrRenderReportTable(report) {
  const notes = (report.notes || []).map(n => `<p class="text-muted" style="font-size:12px;margin:6px 0 0">ℹ️ ${_omrEsc(n)}</p>`).join('');
  if (!report.rows.length) {
    return `<p class="text-muted">Bu rapor için henüz onaylanmış sonuç yok.</p>${notes}`;
  }
  return `
    <div style="font-weight:600;margin-bottom:2px">${_omrEsc(report.title)}</div>
    <div class="text-muted" style="font-size:12px;margin-bottom:6px">${_omrEsc(report.subtitle || '')}</div>
    <div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table class="simple-table">
      <tr>${report.columns.map(c => `<th style="white-space:nowrap">${_omrEsc(String(c))}</th>`).join('')}</tr>
      ${report.rows.map(r => `<tr>${r.map(v => `<td style="white-space:nowrap">${_omrEsc(v === null || v === undefined ? '' : String(v))}</td>`).join('')}</tr>`).join('')}
    </table></div>${notes}`;
}

function _omrOpenReportPanel(examDefId) {
  const container = document.getElementById(`omr-report-panel-${examDefId}`);
  if (!container) return;
  const isOpen = container.style.display !== 'none';
  document.querySelectorAll('[id^="omr-report-panel-"]').forEach(el => el.style.display = 'none');
  if (isOpen) return;
  container.style.display = 'block';
  container.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="omr-report-kind-${examDefId}" class="form-control" style="max-width:240px" onchange="_omrRefreshReportPanel(${examDefId})">
        ${OMR_REPORT_KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select>
      <span id="omr-report-links-${examDefId}"></span>
    </div>
    <div id="omr-report-body-${examDefId}" style="margin-top:10px"></div>`;
  _omrRefreshReportPanel(examDefId);
}

async function _omrRefreshReportPanel(examDefId) {
  const kind = document.getElementById(`omr-report-kind-${examDefId}`).value;
  const body = document.getElementById(`omr-report-body-${examDefId}`);
  const links = document.getElementById(`omr-report-links-${examDefId}`);
  if (!body || !links) return;
  const params = { examId: examDefId };
  links.innerHTML = _omrDownloadLinks(kind, params);
  body.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  try {
    const report = await fetch(_omrReportUrl(kind, params, 'json')).then(r => r.json());
    body.innerHTML = report.error ? `<p class="text-muted">❌ ${_omrEsc(report.error)}</p>` : _omrRenderReportTable(report);
  } catch (err) {
    body.innerHTML = '<p class="text-muted">❌ Rapor yüklenemedi.</p>';
  }
}

// Sınıf kartındaki rapor blokları (kazanım özeti, ders bazlı, öğrenci bazlı)
// için ortak yükleyici: başlık + indirme bağlantıları + ekranda tablo.
async function _omrLoadReportBlock(hostId, heading, kind, params) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = `<p class="text-muted">${_omrEsc(heading)} yükleniyor...</p>`;
  try {
    const report = await fetch(_omrReportUrl(kind, params, 'json')).then(r => r.json());
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <strong>${_omrEsc(heading)}</strong>
        <span>${_omrDownloadLinks(kind, params)}</span>
      </div>
      ${report.error ? `<p class="text-muted">❌ ${_omrEsc(report.error)}</p>` : _omrRenderReportTable(report)}`;
  } catch (err) {
    host.innerHTML = `<p class="text-muted">❌ ${_omrEsc(heading)} yüklenemedi.</p>`;
  }
}

// Öğrenci bazlı rapor: seçilen sınıfın öğrencilerinden biri seçilince yüklenir.
function _omrRenderStudentPicker(className) {
  const host = document.getElementById('omr-class-student-body');
  if (!host) return;
  const students = ((_omrOverview && _omrOverview.students) || [])
    .filter(st => st.class_name === className)
    .sort((a, b) => (a.first_name + ' ' + a.last_name).localeCompare(b.first_name + ' ' + b.last_name, 'tr'));
  host.innerHTML = `
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">
      <strong>👤 Öğrenci Raporu</strong>
      <select id="omr-class-student-select" class="form-control" style="max-width:280px" onchange="_omrLoadStudentReport(this.value)">
        <option value="">Öğrenci seçin...</option>
        ${students.map(st => `<option value="${st.id}">${_omrEsc(st.first_name)} ${_omrEsc(st.last_name)} (${_omrEsc(st.school_number || '-')})</option>`).join('')}
      </select>
    </div>
    <div id="omr-class-student-report" style="margin-top:8px"></div>`;
}

async function _omrLoadStudentReport(studentId) {
  const host = document.getElementById('omr-class-student-report');
  if (!host) return;
  if (!studentId) { host.innerHTML = ''; return; }
  const params = { studentId };
  host.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  try {
    const report = await fetch(_omrReportUrl('student', params, 'json')).then(r => r.json());
    host.innerHTML = `
      <div style="text-align:right;margin-bottom:6px">${_omrDownloadLinks('student', params)}</div>
      ${report.error ? `<p class="text-muted">❌ ${_omrEsc(report.error)}</p>` : _omrRenderReportTable(report)}`;
  } catch (err) {
    host.innerHTML = '<p class="text-muted">❌ Öğrenci raporu yüklenemedi.</p>';
  }
}

// Faz 3: per-soru zorluk raporu - bkz. api_teacher_omr_question_stats.
async function _omrOpenQuestionReport(examDefId) {
  const container = document.getElementById(`omr-question-report-${examDefId}`);
  if (!container) return;
  const isOpen = container.style.display !== 'none';
  document.querySelectorAll('[id^="omr-question-report-"]').forEach(el => el.style.display = 'none');
  if (isOpen) return;
  container.style.display = 'block';
  container.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  const data = await fetch(`/api/teacher/omr/exams/${examDefId}/question-stats`).then(r => r.json());
  if (data.error) { container.innerHTML = `<p class="text-muted">❌ ${_omrEsc(data.error)}</p>`; return; }
  if (!data.questions.length) {
    container.innerHTML = `<p class="text-muted">Henüz onaylanmış bir tarama yok.</p>`;
    return;
  }
  container.innerHTML = `
    <p class="text-muted" style="font-size:12px">${data.scanCount} onaylanmış tarama üzerinden.</p>
    <div class="table-wrapper"><table class="simple-table">
      <tr><th>Soru</th><th>Doğru</th><th>Yanlış</th><th>Boş</th><th>Şüpheli</th><th>Başarı %</th></tr>
      ${data.questions.map(q => `
        <tr${q.successRate !== null && q.successRate < 50 ? ' style="color:#fb7185"' : ''}>
          <td>${q.question}</td><td>${q.correct}</td><td>${q.wrong}</td><td>${q.blank}</td><td>${q.flagged}</td>
          <td>${q.successRate !== null ? q.successRate + '%' : '-'}</td>
        </tr>
      `).join('')}
    </table></div>`;
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
    matched_qr: 'QR', manual: 'Elle', unmatched: '❌ Eşleşmedi', pending: '-',
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

// Kamera ekranındaki "Düzenle" sayfası (omrScan.js) aynı detay görünümünü
// kamera overlay'i İÇİNDE göstermek için kendi konteynerini verir. Sayfa
// kapanıp DOM'dan çıkınca (document.body.contains) otomatik olarak geçersiz
// sayılır ve İncele paneli eskisi gibi varsayılan konteyneri kullanır.
let _omrDetailHostOverride = null;

async function _omrOpenScanDetail(scanId, examDefId, examTitle, hostEl) {
  if (hostEl) {
    _omrDetailHostOverride = hostEl;
    // Aynı taramanın detayı İncele panelinde de açıksa çift element id'si
    // (omr-detail-status-N vb.) oluşmasın diye oradakini boşalt.
    const pageHost = document.getElementById(`omr-scan-detail-${examDefId}`);
    if (pageHost) pageHost.innerHTML = '';
  }
  const overrideValid = _omrDetailHostOverride && document.body.contains(_omrDetailHostOverride);
  const host = overrideValid ? _omrDetailHostOverride : document.getElementById(`omr-scan-detail-${examDefId}`);
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

  const readOnly = scan.status !== 'needs_review';
  _omrSheetState = {
    scanId, readOnly,
    template: scan.formTemplate || 'compact',
    examTitle: scan.examTitle || examTitle || '',
    studentName: scan.student ? `${scan.student.first_name || ''} ${scan.student.last_name || ''}`.trim() : '',
    imageKind: scan.imageKind || null,
    showPhoto: scan.imageKind === 'rectified',
    questions: (scan.perQuestion ? scan.perQuestion.questions : []).map(q => ({ ...q })),
    original: {},
  };
  _omrSheetState.questions.forEach(q => { _omrSheetState.original[q.question] = q.answer || null; });

  host.innerHTML = `
    <div class="card" style="display:flex;gap:16px;flex-wrap:wrap">
      <div style="flex:0 1 340px;min-width:240px">
        <div id="omr-sheet-${scanId}"></div>
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
        <div id="omr-sheet-summary-${scanId}"></div>
        <div id="omr-detail-status-${scanId}" class="text-muted" style="font-size:13px;margin-top:8px"></div>
        ${!readOnly ? `
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" id="omr-sheet-save-${scanId}" onclick="_omrSaveCorrections(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">💾 Düzeltmeleri Kaydet</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="_omrApproveScan(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">✅ Onayla</button>
            <button type="button" class="btn btn-sm" onclick="_omrRejectScan(${scanId}, ${examDefId}, '${_omrEsc(examTitle).replace(/'/g, "\\'")}')">🚫 Reddet</button>
          </div>` : `<p class="text-muted" style="font-size:12px">${scan.status === 'approved' ? '✅ Onaylandı, düzenlenemez.' : '🚫 Reddedildi.'}</p>`}
      </div>
    </div>
  `;
  _omrRenderSheet();
}

// ============================================================
// Tarama detayı: cevaplar kağıdın KENDİ yerleşimi üzerinde (öğretmen
// isteği 2026-10-21: "doğru/yanlış/boş ya da yanlış okuma, optik kağıdın
// üzerinde olursa daha işlevsel"). Kağıt omrGeometry.js şablonuyla basılı
// haliyle aynı ölçülerde (mm cinsinden viewBox) çizilir. Telefon motorunun
// gönderdiği önizleme DÜZELTİLMİŞ tam kağıt olduğundan (bkz. server.py
// imageKind) varsa cevaplar doğrudan kağıdın fotoğrafının üstüne çizilir.
// Bir balona dokunmak o soruyu o şıkla değiştirir, işaretli balona tekrar
// dokunmak boş yapar - sunucu (corrections ucu) notu yeniden hesaplar.
// ============================================================
let _omrSheetState = null;
const OMR_SHEET_COLORS = { correct: '#16a34a', wrong: '#dc2626', multi: '#f59e0b', ambiguous: '#f59e0b' };

function _omrSheetOutcome(q) {
  if (!q.answer) return 'blank';
  if (q.status === 'multi' || q.status === 'ambiguous') return q.status;
  return q.answer === q.keyAnswer ? 'correct' : 'wrong';
}

function _omrSheetChanges() {
  const st = _omrSheetState;
  if (!st) return {};
  const changes = {};
  st.questions.forEach(q => {
    const now = q.answer || null;
    if (now !== st.original[q.question] || (q.edited && (q.outcome === 'multi' || q.outcome === 'ambiguous'))) changes[q.question] = now;
  });
  return changes;
}

function _omrSheetSvg(st) {
  const G = window.OmrGeometry;
  const t = G.TEMPLATES[st.template] || G.TEMPLATES.compact;
  const W = t.formWMm, H = t.formHMm, r = t.answerBubbleDMm / 2;
  const photo = st.showPhoto && st.imageKind === 'rectified';
  const parts = [];
  if (photo) {
    parts.push(`<image href="/api/teacher/omr/scans/${st.scanId}/image" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`);
  } else {
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="1.5" fill="#fff" stroke="#cbd5e1" stroke-width="0.3"/>`);
    const fs = t.fiducialSizeMm;
    Object.values(G.fiducialCentersMm(t)).forEach(([x, y]) => parts.push(`<rect x="${x - fs / 2}" y="${y - fs / 2}" width="${fs}" height="${fs}" fill="#111"/>`));
    const [qx0, qy0, qx1, qy1] = t.qrBoxMm;
    parts.push(`<rect x="${qx0}" y="${qy0}" width="${qx1 - qx0}" height="${qy1 - qy0}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.3" stroke-dasharray="1 0.8"/>`);
    parts.push(`<text x="${(qx0 + qx1) / 2}" y="${(qy0 + qy1) / 2 + 1}" font-size="3" text-anchor="middle" fill="#94a3b8">QR</text>`);
    parts.push(`<text x="${qx1 + 2.5}" y="${qy0 + 4}" font-size="3.2" font-weight="700" fill="#111">${_omrEsc(st.examTitle.slice(0, 22))}</text>`);
    if (st.studentName) parts.push(`<text x="${qx1 + 2.5}" y="${qy0 + 8.5}" font-size="2.8" font-weight="600" fill="#334155">${_omrEsc(st.studentName.slice(0, 24))}</text>`);
  }
  const letters = G.CHOICES || ['A', 'B', 'C', 'D'];
  const rowH = G.answerRowHMm(t);
  st.questions.forEach(q => {
    const outcome = _omrSheetOutcome(q);
    const [ax, ay] = G.questionBubbleCenterMm(t, q.question, 0);
    const [dx] = G.questionBubbleCenterMm(t, q.question, letters.length - 1);
    if (outcome === 'multi' || outcome === 'ambiguous') {
      parts.push(`<rect x="${ax - r - 5}" y="${ay - rowH / 2 + 0.6}" width="${dx - ax + 2 * r + 6}" height="${rowH - 1.2}" rx="1.2" fill="#f59e0b" fill-opacity="0.18" stroke="#f59e0b" stroke-width="0.35"/>`);
    }
    if (!photo) parts.push(`<text x="${ax - r - 1.2}" y="${ay + 1.1}" font-size="3.2" font-weight="700" text-anchor="end" fill="${outcome === 'blank' ? '#94a3b8' : '#111'}">${q.question}</text>`);
    letters.forEach((L, i) => {
      const [cx, cy] = G.questionBubbleCenterMm(t, q.question, i);
      const marked = q.answer === L;
      const isKey = q.keyAnswer === L;
      const color = marked ? (OMR_SHEET_COLORS[outcome] || '#475569') : null;
      // Öğrenci yanlış yaptıysa ya da boş bıraktıysa doğru şık yeşil halkayla gösterilir
      const keyRing = isKey && outcome !== 'correct';
      if (marked) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="${photo ? 0.55 : 1}" stroke="${color}" stroke-width="0.3"/>`);
      } else if (!photo) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#9ca3af" stroke-width="0.25"/>`);
      }
      if (keyRing) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 0.55}" fill="none" stroke="#16a34a" stroke-width="0.7"/>`);
      if (!photo || marked) parts.push(`<text x="${cx}" y="${cy + 0.95}" font-size="2.5" font-weight="700" text-anchor="middle" fill="${marked ? '#fff' : '#9ca3af'}" pointer-events="none">${L}</text>`);
      if (!st.readOnly) parts.push(`<circle class="omr-bubble-hit" data-q="${q.question}" data-c="${L}" cx="${cx}" cy="${cy}" r="${r + 0.9}" fill="transparent" style="cursor:pointer"/>`);
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;border-radius:8px;background:#fff;touch-action:manipulation" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

function _omrRenderSheet() {
  const st = _omrSheetState;
  if (!st) return;
  const el = document.getElementById(`omr-sheet-${st.scanId}`);
  if (!el) return;
  if (!window.OmrGeometry) { el.innerHTML = '<p class="text-muted">Kağıt görünümü yüklenemedi.</p>'; return; }
  const photoToggle = st.imageKind === 'rectified' ? `
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button type="button" class="btn btn-sm ${!st.showPhoto ? 'btn-primary' : ''}" onclick="_omrSheetTogglePhoto(false)">📝 Form</button>
      <button type="button" class="btn btn-sm ${st.showPhoto ? 'btn-primary' : ''}" onclick="_omrSheetTogglePhoto(true)">📷 Kağıdın fotoğrafı</button>
    </div>` : (st.imageKind === 'photo' ? `<a href="/api/teacher/omr/scans/${st.scanId}/image" target="_blank" rel="noopener" style="font-size:12.5px;display:inline-block;margin-bottom:8px">📷 Ham fotoğrafı aç</a>` : '');
  el.innerHTML = photoToggle + _omrSheetSvg(st) + `
    <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11.5px;margin-top:8px;color:var(--text-muted,#888)">
      <span><b style="color:#16a34a">●</b> Doğru</span><span><b style="color:#dc2626">●</b> Yanlış</span>
      <span><b style="color:#16a34a">◯</b> Doğru cevap</span><span><b style="color:#f59e0b">▬</b> Şüpheli okuma</span>
    </div>
    ${!st.readOnly ? '<p class="text-muted" style="font-size:12px;margin:6px 0 0">Yanlış okunan soruda doğru şıkkın balonuna dokunun; işaretli balona tekrar dokunmak o soruyu boş yapar.</p>' : ''}`;
  if (!st.readOnly) {
    el.querySelector('svg').addEventListener('click', (e) => {
      const hit = e.target.closest('.omr-bubble-hit');
      if (!hit) return;
      const q = st.questions.find(x => x.question === Number(hit.dataset.q));
      if (!q) return;
      q.answer = q.answer === hit.dataset.c && !(q.status === 'multi' || q.status === 'ambiguous') ? null : hit.dataset.c;
      q.status = q.answer ? 'single' : 'blank';
      q.edited = true;
      _omrRenderSheet();
    });
  }
  _omrRenderSheetSummary();
}

window._omrSheetTogglePhoto = function (on) {
  if (!_omrSheetState) return;
  _omrSheetState.showPhoto = on;
  _omrRenderSheet();
};

function _omrRenderSheetSummary() {
  const st = _omrSheetState;
  const el = st && document.getElementById(`omr-sheet-summary-${st.scanId}`);
  if (!el) return;
  const count = { correct: 0, wrong: 0, blank: 0, flagged: 0 };
  st.questions.forEach(q => {
    const o = _omrSheetOutcome(q);
    if (o === 'multi' || o === 'ambiguous') count.flagged++; else count[o]++;
  });
  const net = Math.max(0, Math.round((count.correct - count.wrong / 3) * 100) / 100);
  const changed = Object.keys(_omrSheetChanges()).length;
  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:13px;font-weight:700;margin-bottom:6px">
      <span style="padding:3px 9px;border-radius:99px;background:rgba(22,163,74,.15);color:#16a34a">✅ ${count.correct} doğru</span>
      <span style="padding:3px 9px;border-radius:99px;background:rgba(220,38,38,.15);color:#dc2626">❌ ${count.wrong} yanlış</span>
      <span style="padding:3px 9px;border-radius:99px;background:rgba(148,163,184,.18)">⬜ ${count.blank} boş</span>
      ${count.flagged ? `<span style="padding:3px 9px;border-radius:99px;background:rgba(245,158,11,.18);color:#d97706">⚠️ ${count.flagged} şüpheli</span>` : ''}
      <span style="padding:3px 9px;border-radius:99px;background:rgba(99,102,241,.15)">Net ${net}</span>
    </div>
    ${count.flagged && !st.readOnly ? '<p style="font-size:12.5px;color:#d97706;margin:0 0 6px">Turuncu satırlarda okuma emin değil - kağıda bakıp doğru şıkka dokunun.</p>' : ''}
    ${changed ? `<p style="font-size:12.5px;margin:0">✏️ <b>${changed}</b> soruda kaydedilmemiş değişiklik var.</p>` : ''}`;
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

// Kağıt görünümünde değiştirilen soruları kaydeder. reopen=false: onaydan
// hemen önce çağrıldığında detayı yeniden yüklemeden sonucu döner.
async function _omrSaveCorrections(scanId, examDefId, examTitle, reopen = true) {
  const statusEl = document.getElementById(`omr-detail-status-${scanId}`);
  const corrections = (_omrSheetState && _omrSheetState.scanId === scanId) ? _omrSheetChanges() : {};
  if (!Object.keys(corrections).length) {
    if (reopen && statusEl) statusEl.textContent = 'Değiştirilmiş soru yok - kağıtta bir balona dokunarak düzeltin.';
    return true;
  }
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/corrections`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corrections }),
  });
  const data = await res.json();
  if (!res.ok) { if (statusEl) statusEl.textContent = '❌ ' + data.error; return false; }
  if (reopen) {
    await _omrOpenScanDetail(scanId, examDefId, examTitle);
    const el = document.getElementById(`omr-detail-status-${scanId}`);
    if (el) el.textContent = '✅ Düzeltmeler kaydedildi.';
  }
  return true;
}

async function _omrApproveScan(scanId, examDefId, examTitle) {
  const statusEl = document.getElementById(`omr-detail-status-${scanId}`);
  // Kaydedilmemiş kağıt düzeltmeleri varsa önce onlar - yoksa öğretmen
  // ekranda düzelttiği halde ESKİ okumayla onaylanırdı.
  if (!(await _omrSaveCorrections(scanId, examDefId, examTitle, false))) return;
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/approve`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { statusEl.textContent = '❌ ' + data.error; return; }
  statusEl.textContent = `✅ Onaylandı (net: ${data.net}).`;
  await _omrRefreshReviewList(examDefId, examTitle);
  if (typeof window._omrOnScanChanged === 'function') window._omrOnScanChanged(scanId, 'approved');
}

async function _omrRejectScan(scanId, examDefId, examTitle) {
  if (!confirm('Bu taramayı reddetmek istediğinize emin misiniz? Öğrenci yeniden taranmalı.')) return;
  const res = await fetch(`/api/teacher/omr/scans/${scanId}/reject`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error); return; }
  await _omrRefreshReviewList(examDefId, examTitle);
  if (typeof window._omrOnScanChanged === 'function') window._omrOnScanChanged(scanId, 'rejected');
}

// ---- Test tanımını düzenleme (özellikle yanlış girilmiş cevap anahtarını
// düzeltmek için - önceden kaydedilen bir test hiç değiştirilemiyordu).
// Soru sayısı ve ders BİLEREK değiştirilemez (bkz. server.py
// api_teacher_omr_update_exam docstring'i).
async function _omrOpenEditExam(examDefId, examTitle) {
  const container = document.getElementById(`omr-edit-panel-${examDefId}`);
  if (!container) return;
  const isOpen = container.style.display !== 'none';
  document.querySelectorAll('[id^="omr-edit-panel-"], [id^="omr-paper-dialog-"]').forEach(el => el.style.display = 'none');
  if (isOpen) return;
  container.style.display = 'block';
  container.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
  try {
    const exam = await fetch(`/api/teacher/omr/exams/${examDefId}`).then(r => r.json());
    if (exam.error) throw new Error(exam.error);
    _omrEditQuestionCount = exam.question_count;
    _omrEditAnswerKey = { ...(exam.answerKey || {}) };
    const gradeOptions = (_omrMeta.gradeLevels || [])
      .map(g => `<option value="${_omrEsc(g.name)}" ${String(g.name) === String(exam.grade_level || '') ? 'selected' : ''}>${_omrEsc(g.name)}. Sınıf</option>`).join('');
    container.innerHTML = `
      <h4 style="margin:0 0 4px">✏️ Test Tanımını Düzenle</h4>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 10px">
        Soru sayısı (${exam.question_count}) ve ders kaydedildikten sonra değiştirilemez - kağıt formatı buna göre basılmıştır;
        değişmesi gerekiyorsa yeni bir test tanımlayın. <strong>Cevap anahtarını değiştirirseniz, bu teste ait tüm taramalar
        (onaylanmış olanlar dahil) otomatik olarak yeniden değerlendirilir.</strong>
      </p>
      <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="form-label">Test Adı</label><input type="text" id="omr-edit-title-${examDefId}" class="form-control" value="${_omrEsc(exam.title)}"></div>
        <div><label class="form-label">Sınıf Seviyesi</label><select id="omr-edit-grade-${examDefId}" class="form-control"><option value="">Seçilmedi</option>${gradeOptions}</select></div>
        <div><label class="form-label">Konu</label><input type="text" id="omr-edit-topic-${examDefId}" class="form-control" value="${_omrEsc(exam.topic || '')}"></div>
        <div><label class="form-label">Kazanım Adı</label><input type="text" id="omr-edit-kazanim-${examDefId}" class="form-control" value="${_omrEsc(exam.kazanim_adi || '')}"></div>
      </div>
      <div class="mt-2">
        <label class="form-label">Cevap Anahtarı — doğru şıkkı işaretleyin</label>
        <div id="omr-edit-sheet-${examDefId}" class="omr-sheet mt-1"></div>
      </div>
      <div class="mt-2" style="display:flex;align-items:center;gap:12px">
        <button type="button" class="btn btn-primary" id="omr-edit-save-${examDefId}">💾 Değişiklikleri Kaydet</button>
        <button type="button" class="btn btn-sm" id="omr-edit-cancel-${examDefId}">İptal</button>
        <span id="omr-edit-status-${examDefId}" class="text-muted" style="font-size:13px"></span>
      </div>
    `;
    _omrRenderEditSheet(examDefId);
    document.getElementById(`omr-edit-save-${examDefId}`).addEventListener('click', () => _omrSaveEditExam(examDefId));
    document.getElementById(`omr-edit-cancel-${examDefId}`).addEventListener('click', () => { container.style.display = 'none'; });
  } catch (err) {
    container.innerHTML = `<p style="color:#f43f5e">Yüklenemedi: ${_omrEsc(err.message)}</p>`;
  }
}

function _omrRenderEditSheet(examDefId) {
  const count = _omrEditQuestionCount;
  const sheet = document.getElementById(`omr-edit-sheet-${examDefId}`);
  if (!sheet) return;
  const nCols = _omrTemplateColsForCount(count);
  const rowsPerCol = Math.ceil(count / nCols);
  const cols = Array.from({ length: nCols }, () => []);
  for (let q = 1; q <= count; q++) {
    cols[Math.floor((q - 1) / rowsPerCol)].push(_omrBuildEditSheetRow(q));
  }
  sheet.innerHTML = `<div class="omr-sheet-cols">${cols.map(col => `<div class="omr-sheet-col">${col.join('')}</div>`).join('')}</div>`;
  sheet.querySelectorAll('.omr-bubble').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.q, choice = btn.dataset.choice;
      _omrEditAnswerKey[q] = _omrEditAnswerKey[q] === choice ? null : choice;
      _omrRenderEditSheet(examDefId);
    });
  });
}

function _omrBuildEditSheetRow(q) {
  const choices = ['A', 'B', 'C', 'D'];
  const bubbles = choices.map(c => {
    const filled = _omrEditAnswerKey[String(q)] === c;
    return `<button type="button" class="omr-bubble${filled ? ' omr-bubble-filled' : ''}" data-q="${q}" data-choice="${c}">${c}</button>`;
  }).join('');
  return `<div class="omr-sheet-row"><span class="omr-sheet-qnum">${q}</span>${bubbles}</div>`;
}

async function _omrSaveEditExam(examDefId) {
  const statusEl = document.getElementById(`omr-edit-status-${examDefId}`);
  const title = document.getElementById(`omr-edit-title-${examDefId}`).value.trim();
  const gradeLevel = document.getElementById(`omr-edit-grade-${examDefId}`).value || null;
  const topic = document.getElementById(`omr-edit-topic-${examDefId}`).value.trim() || null;
  const kazanimAdi = document.getElementById(`omr-edit-kazanim-${examDefId}`).value.trim() || null;
  const answerKey = {};
  Object.keys(_omrEditAnswerKey).forEach(q => { if (_omrEditAnswerKey[q]) answerKey[q] = _omrEditAnswerKey[q]; });

  if (!title) { statusEl.textContent = '❌ Test adı gerekli.'; return; }
  if (Object.keys(answerKey).length !== _omrEditQuestionCount) {
    statusEl.textContent = '❌ Optik taslak üzerinde tüm soruların doğru cevabını işaretleyin.';
    return;
  }
  statusEl.textContent = 'Kaydediliyor...';
  try {
    const res = await fetch(`/api/teacher/omr/exams/${examDefId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, gradeLevel, topic, kazanimAdi, answerKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi.');
    const msg = data.answerKeyChanged
      ? `✅ Kaydedildi. ${data.regradedScans} tarama yeniden değerlendirildi${data.updatedResults ? `, ${data.updatedResults} onaylı öğrenci sonucu güncellendi` : ''}.`
      : '✅ Kaydedildi.';
    if (typeof window.EduToast === 'function') window.EduToast(msg, null, null, 6000);
    const examsResp = await fetch('/api/teacher/omr/exams').then(r => r.json());
    _omrRenderExamList(examsResp.exams || []);
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
  }
}

// Ogretmenin yanlislikla/deneme amacli olusturdugu bir testi TAMAMEN
// siler - basilan kagitlar, taramalar (gorselleri dahil) ve onaylanmis
// sonuclar birlikte gider (bkz. server.py api_teacher_omr_delete_exam).
async function _omrDeleteExam(examDefId, examTitle) {
  const ok = confirm(
    `"${examTitle}" testini silmek istediğinize emin misiniz?\n\n` +
    `Bu testle ilgili TÜM taramalar, basılan kağıt kayıtları ve (varsa) onaylanmış öğrenci sonuçları da SİLİNİR. ` +
    `Bu işlem GERİ ALINAMAZ.\n\nSadece yanlışlıkla/deneme amaçlı oluşturduğunuz gereksiz testler için kullanın.`
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/teacher/omr/exams/${examDefId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Silinemedi.');
    const parts = [];
    if (data.deletedScans) parts.push(`${data.deletedScans} tarama`);
    if (data.deletedResults) parts.push(`${data.deletedResults} onaylı sonuç`);
    const msg = parts.length ? `🗑 Test silindi (${parts.join(', ')} dahil).` : '🗑 Test silindi.';
    if (typeof window.EduToast === 'function') window.EduToast(msg, null, null, 6000);
    const examsResp = await fetch('/api/teacher/omr/exams').then(r => r.json());
    _omrRenderExamList(examsResp.exams || []);
  } catch (err) {
    alert('❌ ' + err.message);
  }
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
