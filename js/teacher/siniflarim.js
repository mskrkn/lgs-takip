// ============================================
// Öğretmen Paneli - Sınıflarım / Sınıf Detayı / Okul Geneli
// ============================================
// Ana sayfanın en üstünde öğretmenin sınıfları KADEMEYE göre gruplu kartlar
// halinde (seçili denemede katılım, ortalama, kademe ortalamasına göre fark,
// kademe içi sıra). Karta tıklayınca Sınıf Detayı; okul geneli yetkisi olanlara
// (admin, tüm sınıflara yetkili öğretmen, koordinatör) "Okul Geneli" sayfası.
// Veri: /api/teacher/class-summary, /class-detail, /absent-report (server.py).
// ogretmen.js'teki showPage/escapeHtml/openStudentDetail/setStudentClass
// globallerini kullanır - bu dosya ogretmen.js'ten ÖNCE yüklenir, fonksiyonlar
// ancak boot() sonrasında çağrılır.
const Siniflarim = (function () {
  let me = null;
  let summary = null;               // son /class-summary yanıtı (tüm kademeler)
  let detailState = null;           // { className, examId, returnPage }
  let subjectReport = { key: null, data: null };  // Okul Geneli > Branş Görünümü
  let kazState = { subject: null, all: false, open: null };  // Sınıf Detayı > Kazanım Analizi filtresi + açık satır
  let detailSort = null;            // null = öğretmenin dersi varsa o, yoksa toplam; 'total' | ders anahtarı

  const ORDER = ['turkce', 'inkilap', 'din', 'ingilizce', 'matematik', 'fen'];
  // Sunucu JSON anahtarlarını alfabetik sıralıyor - dersler optik formdaki sırayla gösterilir
  const subjKeys = (obj) => Object.keys(obj || {}).sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const SHORT = { turkce: 'Tür', inkilap: 'İnk', din: 'Din', ingilizce: 'İng', matematik: 'Mat', fen: 'Fen' };
  const esc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s);
  const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // 5-7. sınıfta "inkilap" anahtarı aslında Sosyal Bilgiler (bkz. Mozaik aktarımı)
  function subjLabel(key, grade, short) {
    if (key === 'inkilap' && grade && Number(grade) < 8) return short ? 'Sos' : 'Sosyal Bilgiler';
    if (short) return SHORT[key] || key;
    return (typeof subjectName === 'function') ? subjectName(key) : key;
  }

  function signed(n, suffix) {
    if (n == null) return '<span class="sn-flat">-</span>';
    const cls = n > 0.05 ? 'sn-up' : n < -0.05 ? 'sn-down' : 'sn-flat';
    const arrow = n > 0.05 ? '▲' : n < -0.05 ? '▼' : '•';
    return `<span class="${cls}">${arrow} ${fmt(Math.abs(n))}${suffix || ''}</span>`;
  }

  function examOptions(exams, selectedId) {
    return (exams || []).map(e =>
      `<option value="${e.id}" ${e.id === selectedId ? 'selected' : ''}>${esc(e.name)}${e.date ? ' (' + esc(e.date) + ')' : ''}</option>`
    ).join('');
  }

  // ---------- Ana sayfa: Sınıflarım ----------
  function cardHtml(c, g) {
    const grade = g.grade;
    const subj = subjKeys(c.subjects).map(k => {
      const d = (c.subjects[k] != null && g.gradeStats.subjects[k] != null) ? c.subjects[k] - g.gradeStats.subjects[k] : null;
      const cls = d == null ? 'sn-flat' : d > 0.05 ? 'sn-up' : d < -0.05 ? 'sn-down' : 'sn-flat';
      return `<span title="${esc(subjLabel(k, grade))}: sınıf ${fmt(c.subjects[k])}, kademe ${fmt(g.gradeStats.subjects[k])}">${esc(subjLabel(k, grade, true))} <b class="${cls}">${fmt(c.subjects[k])}</b></span>`;
    }).join('');
    const noData = !c.participated;
    return `
      <button type="button" class="sn-card" data-sn-class="${esc(c.className)}" data-sn-exam="${g.exam ? g.exam.id : ''}" aria-label="${esc(c.className)} sınıf detayı">
        <div class="sn-card-head">
          <span class="sn-card-class">${esc(c.className)}</span>
          ${c.rank ? `<span class="sn-rank" title="Kademedeki şubeler arasında sıra">Kademede ${c.rank}./${c.rankOf}</span>` : ''}
        </div>
        <div class="sn-row"><span class="k">Katılım</span><span><b>${c.participated}</b>/${c.enrolled}${c.absent ? ` · <span class="sn-absent">${c.absent} girmedi</span>` : ''}</span></div>
        ${noData ? '<div class="sn-empty">Bu denemeye bu sınıftan katılım yok.</div>' : (c.focus ? focusHtml(c, g) : `
        <div class="sn-row"><span class="k">Sınıf ortalaması</span><span class="sn-big">${fmt(c.avgNet)}</span></div>
        <div class="sn-row"><span class="k">Kademe ort. ${fmt(g.gradeStats.avgNet)}</span><span>${signed(c.diffFromGrade, ' net')}</span></div>
        ${c.changeFromPrev != null ? `<div class="sn-row"><span class="k">Önceki denemeye göre</span><span>${signed(c.changeFromPrev)}</span></div>` : ''}`) + `
        <div class="sn-subjects">${subj}</div>`}
      </button>`;
  }

  // Öğretmenin kendi dersi (Faz 2): kartın ana bilgisi o dersin neti olur,
  // toplam net tek satıra iner.
  function focusHtml(c, g) {
    const f = c.focus;
    const q = g.exam && g.exam.questionCounts && g.exam.questionCounts[f.key];
    return `
        <div class="sn-focus">
          <div class="sn-focus-title"><span>${esc(subjLabel(f.key, g.grade))} <small>· dersiniz</small></span>
            ${f.rank ? `<span class="sn-rank" title="Bu derste kademedeki şubeler arasında sıra">Derste ${f.rank}./${f.rankOf}</span>` : ''}</div>
          <div class="sn-row"><span class="k">Sınıf ortalaması${q ? ` (${q} soru)` : ''}</span><span class="sn-big">${fmt(f.avgNet)}</span></div>
          <div class="sn-row"><span class="k">Kademe ort. ${fmt(f.gradeAvgNet)}</span><span>${signed(f.diffFromGrade, ' net')}</span></div>
          ${f.changeFromPrev != null ? `<div class="sn-row"><span class="k">Önceki denemeye göre</span><span>${signed(f.changeFromPrev)}</span></div>` : ''}
        </div>
        <div class="sn-row"><span class="k">Toplam net</span><span><b>${fmt(c.avgNet)}</b> · ${signed(c.diffFromGrade)}</span></div>`;
  }

  function gradeHeadHtml(g, extra) {
    const gs = g.gradeStats;
    return `
      <div class="sn-grade-head">
        <div class="sn-grade-title">${esc(g.grade)}. SINIF
          <small>Kademe: ${gs.participated}/${gs.enrolled} girdi · ort. ${fmt(gs.avgNet)} net · ${gs.classCount} şube</small>
        </div>
        ${g.exams && g.exams.length ? `<select class="form-input sn-exam-select" data-sn-grade-select="${esc(g.grade)}" aria-label="${esc(g.grade)}. sınıf denemesi">${examOptions(g.exams, g.exam && g.exam.id)}</select>` : ''}
        ${extra || ''}
      </div>`;
  }

  function renderDashboard() {
    const host = document.getElementById('dash-classes');
    if (!host || !summary) return;
    const ownAll = summary.myClasses == null;  // '*' öğretmen ya da admin: tüm sınıflar "benim"
    let html = `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:8px">
        <h3 class="card-title"><span class="card-icon">🏫</span> ${ownAll ? 'Okulun Sınıfları' : 'Sınıflarım'}</h3>
        ${me && me.isSchoolWideViewer ? '<button type="button" class="btn btn-secondary btn-sm" data-sn-goto-school>🏫 Okul Geneli</button>' : ''}
      </div>`;
    const grades = summary.grades.filter(g => g.classes.some(c => c.isMine));
    if (!grades.length) {
      html += '<p class="sn-empty">Size atanmış bir sınıf bulunamadı. Okul yöneticinizden sınıf ataması isteyin.</p></div>';
      host.innerHTML = html;
      return;
    }
    grades.forEach(g => {
      const mine = g.classes.filter(c => c.isMine);
      html += `<div class="sn-grade" data-sn-grade="${esc(g.grade)}">${gradeHeadHtml(g)}`;
      if (!g.exam) html += '<p class="sn-empty">Bu kademe için henüz bir Genel Deneme sonucu yok.</p>';
      else if (ownAll) html += matrixHtml(g);  // çok şube: kompakt tablo
      else html += `<div class="sn-cards">${mine.map(c => cardHtml(c, g)).join('')}</div>`;
      html += '</div>';
    });
    host.innerHTML = html + '</div>';
  }

  // ---------- Kademe × şube tablosu ----------
  function matrixHtml(g) {
    const cells = g.classes.map(c => {
      const pct = c.enrolled ? Math.round(c.participated / c.enrolled * 100) : 0;
      const tone = c.diffFromGrade == null ? '' : c.diffFromGrade >= 3 ? 'good' : c.diffFromGrade <= -3 ? 'bad' : '';
      return `<button type="button" class="sn-cell ${tone} ${summary.myClasses && c.isMine ? 'mine' : ''}" data-sn-class="${esc(c.className)}" data-sn-exam="${g.exam ? g.exam.id : ''}"
          title="${esc(c.className)}: ${c.participated}/${c.enrolled} girdi, ortalama ${fmt(c.avgNet)}, kademe farkı ${fmt(c.diffFromGrade)}">
          <b>${esc(c.className)}</b>
          <span class="n">${fmt(c.avgNet)}</span>
          <span class="p">%${pct} katılım${c.rank ? ' · ' + c.rank + '.' : ''}</span>
        </button>`;
    }).join('');
    return `<div class="sn-matrix-wrap"><div class="sn-matrix">${cells}</div></div>`;
  }

  // ---------- Okul Geneli ----------
  function renderSchool() {
    const host = document.getElementById('school-overview-body');
    if (!host || !summary) return;
    if (summary.scope !== 'school') {
      host.innerHTML = '<p class="sn-empty">Bu sayfa yalnızca okul geneli yetkisi olan hesaplar içindir.</p>';
      return;
    }
    const subjKey = subjectReport.key || summary.mySubject || 'matematik';
    let html = `<div class="card" id="sn-subject-card">
        <div class="card-header" style="flex-wrap:wrap;gap:8px">
          <h3 class="card-title"><span class="card-icon">🎓</span> Branş Görünümü</h3>
          <select class="form-input sn-exam-select" style="min-width:180px" data-sn-subject-select aria-label="Ders seç">
            ${ORDER.map(k => `<option value="${k}" ${k === subjKey ? 'selected' : ''}>${esc(k === 'inkilap' ? 'Sosyal Bilgiler / İnkılap' : subjLabel(k, '8'))}</option>`).join('')}
          </select>
        </div>
        <div id="sn-subject-body"><p class="text-muted">Yükleniyor...</p></div>
      </div>
      <div class="sn-legend">
        <span><i style="background:rgba(16,185,129,.5)"></i>Kademe ortalamasının 3+ net üstü</span>
        <span><i style="background:rgba(244,63,94,.5)"></i>3+ net altı</span>
        ${summary.myClasses ? '<span><i style="background:var(--accent-primary)"></i>Kendi sınıflarınız</span>' : ''}
        <span>Hücreye dokunun: sınıf detayı</span>
      </div>`;
    summary.grades.forEach(g => {
      html += `<div class="card mt-2 sn-grade" data-sn-grade="${esc(g.grade)}">${gradeHeadHtml(g,
        g.exam ? `<button type="button" class="btn btn-secondary btn-sm" data-sn-absent-grade="${esc(g.grade)}" data-sn-exam="${g.exam.id}">📋 Girmeyenler (${g.gradeStats.enrolled - g.gradeStats.participated})</button>` : '')}`;
      if (!g.exam) { html += '<p class="sn-empty">Bu kademe için henüz bir Genel Deneme sonucu yok.</p></div>'; return; }
      html += matrixHtml(g);
      const subj = subjKeys(g.gradeStats.subjects);
      if (subj.length) {
        html += `<div class="sn-matrix-wrap mt-2"><table class="sn-table"><thead><tr><th>Şube</th>${subj.map(k => `<th class="num">${esc(subjLabel(k, g.grade, true))}</th>`).join('')}<th class="num">Toplam</th></tr></thead><tbody>
          <tr><td><b>Kademe</b></td>${subj.map(k => `<td class="num"><b>${fmt(g.gradeStats.subjects[k])}</b></td>`).join('')}<td class="num"><b>${fmt(g.gradeStats.avgNet)}</b></td></tr>
          ${g.classes.filter(c => c.participated).map(c => `<tr><td>${esc(c.className)}</td>${subj.map(k => {
            const d = (c.subjects[k] != null) ? c.subjects[k] - g.gradeStats.subjects[k] : null;
            return `<td class="num ${d == null ? '' : d > 0.05 ? 'sn-up' : d < -0.05 ? 'sn-down' : ''}">${fmt(c.subjects[k])}</td>`;
          }).join('')}<td class="num">${fmt(c.avgNet)}</td></tr>`).join('')}
        </tbody></table></div>`;
      }
      html += `<div id="sn-absent-${esc(g.grade)}"></div></div>`;
    });
    host.innerHTML = html;
    loadSubjectReport(subjKey);
  }

  async function loadSubjectReport(key, grade, examId) {
    const body = document.getElementById('sn-subject-body');
    if (!body) return;
    if (!grade && subjectReport.key === key && subjectReport.data) { body.innerHTML = subjectReportHtml(subjectReport.data); return; }
    body.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
    try {
      const q = `subject=${encodeURIComponent(key)}${grade ? `&grade=${encodeURIComponent(grade)}&exam_id=${examId}` : ''}`;
      const d = await fetch(`/api/teacher/subject-report?${q}`).then(r => r.json());
      if (d.error) throw new Error(d.error);
      if (grade && subjectReport.data && subjectReport.key === key) {
        subjectReport.data.grades = subjectReport.data.grades.map(g => g.grade === grade ? d.grades[0] : g);
        subjectReport.data.teachers = (await fetch(`/api/teacher/subject-report?subject=${encodeURIComponent(key)}`).then(r => r.json())).teachers;
      } else {
        subjectReport = { key, data: d };
      }
      body.innerHTML = subjectReportHtml(subjectReport.data);
    } catch (err) {
      body.innerHTML = `<p class="sn-empty">Branş raporu alınamadı: ${esc(err.message)}</p>`;
    }
  }

  function subjectReportHtml(d) {
    const lbl = (g) => subjLabel(d.subject, g || '8');
    let html = '';
    if (d.teachers.length) {
      html += `<div class="sn-matrix-wrap"><table class="sn-table"><thead><tr><th>Öğretmen</th><th>Sınıfları</th><th class="num">Öğrenci</th><th class="num" title="Sınıflarının bu dersteki ortalamasının kademe ortalamasından farkı (öğrenci sayısıyla ağırlıklı)">Kademeye göre</th></tr></thead><tbody>
        ${d.teachers.map(t => `<tr><td>${esc(t.name)}</td><td>${t.allClasses ? '<span class="text-muted">Tüm sınıflar</span>' : esc(t.classes.join(', '))}</td><td class="num">${t.students || '-'}</td><td class="num">${signed(t.avgDiffFromGrade)}</td></tr>`).join('')}
      </tbody></table></div>`;
    } else {
      html += '<p class="sn-empty">Bu derse branşı girilmiş öğretmen yok. Okul yöneticisi, kullanıcı listesindeki "✏️ Branş / Sınıflar" ile atayabilir.</p>';
    }
    d.grades.forEach(g => {
      if (!g.exam) return;
      const rows = g.classes.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
      html += `<div class="sn-grade">
          <div class="sn-grade-head"><div class="sn-grade-title">${esc(g.grade)}. SINIF <small>${esc(lbl(g.grade))} kademe ort. ${fmt(g.gradeAvgNet)} net</small></div>
            ${g.exams.length > 1 ? `<select class="form-input sn-exam-select" data-sn-subj-grade="${esc(g.grade)}">${examOptions(g.exams, g.exam.id)}</select>` : `<small class="text-muted">${esc(g.exam.name)}</small>`}</div>
          <div class="sn-matrix-wrap"><table class="sn-table"><thead><tr><th class="num">Sıra</th><th>Şube</th><th>Öğretmen</th><th class="num">Katılım</th><th class="num">${esc(lbl(g.grade))}</th><th class="num">Fark</th><th class="num sn-hide-sm">Önceki</th></tr></thead><tbody>
          ${rows.map(r => `<tr data-sn-class="${esc(r.className)}" data-sn-exam="${g.exam.id}" style="cursor:pointer">
              <td class="num">${r.rank || '-'}</td><td><b>${esc(r.className)}</b></td>
              <td>${r.teachers.length ? esc(r.teachers.join(', ')) : '<span class="sn-absent">atanmamış</span>'}</td>
              <td class="num">${r.participated}/${r.enrolled}</td><td class="num"><b>${fmt(r.avgNet)}</b></td><td class="num">${signed(r.diffFromGrade)}</td>
              <td class="num sn-hide-sm">${signed(r.changeFromPrev)}</td></tr>`).join('')}
          </tbody></table></div></div>`;
    });
    return html;
  }

  async function showAbsent(grade, examId, btn) {
    const box = document.getElementById(`sn-absent-${grade}`);
    if (!box) return;
    if (box.dataset.open === '1') { box.dataset.open = ''; box.innerHTML = ''; return; }
    if (btn) btn.disabled = true;
    try {
      const d = await fetch(`/api/teacher/absent-report?grade=${encodeURIComponent(grade)}&exam_id=${examId}`).then(r => r.json());
      if (d.error) throw new Error(d.error);
      const total = d.classes.reduce((a, c) => a + c.students.length, 0);
      box.dataset.open = '1';
      box.innerHTML = `<div class="mt-2" style="border-top:1px solid var(--bg-glass-border);padding-top:12px">
          <div class="sn-grade-head"><b>${esc(d.exam.name)}: ${total} öğrenci girmedi</b>
            <div class="sn-actions"><button type="button" class="btn btn-secondary btn-sm" data-sn-absent-csv="${esc(grade)}">⬇️ Excel'e aktar</button><button type="button" class="btn btn-secondary btn-sm" data-sn-absent-pdf="${esc(grade)}">⬇️ PDF</button></div></div>
          ${d.classes.map(c => `<div class="mt-1"><div style="font-weight:700;margin-bottom:6px">${esc(c.className)} (${c.students.length})</div>
            <div class="sn-absent-list">${c.students.map(s => `<span>${s.schoolNumber ? esc(s.schoolNumber) + ' · ' : ''}${esc(s.firstName)} ${esc(s.lastName)}</span>`).join('')}</div></div>`).join('')}
        </div>`;
      box._data = d;
    } catch (err) {
      box.innerHTML = `<p class="sn-empty">Liste alınamadı: ${esc(err.message)}</p>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- Sınıf Detayı ----------
  async function openClass(className, examId) {
    const from = (typeof activePageKey === 'function') ? activePageKey() : 'dashboard';
    const returnPage = from === 'class-detail' && detailState ? detailState.returnPage : from;
    detailState = { className, examId: examId || null, returnPage: returnPage || 'dashboard' };
    showPage('class-detail');
    const sub = document.getElementById('page-subtitle');
    if (sub) sub.textContent = className;
    const host = document.getElementById('class-detail-body');
    host.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
    const q = `class_name=${encodeURIComponent(className)}${examId ? '&exam_id=' + examId : ''}`;
    let d;
    try {
      d = await fetch(`/api/teacher/class-detail?${q}`).then(r => r.json());
      if (d.error) throw new Error(d.error);
    } catch (err) {
      host.innerHTML = `<p class="sn-empty">Sınıf detayı alınamadı: ${esc(err.message)}</p>`;
      return;
    }
    if (detailState.className !== className) return;  // bu arada başka sınıf açıldı
    renderClassDetail(d);
  }

  function renderClassDetail(d) {
    const host = document.getElementById('class-detail-body');
    const g = d.summary;
    const c = g && g.classes[0];
    let html = `<div class="sn-detail-head">
        <button type="button" class="btn btn-secondary btn-sm" data-sn-back>← Geri</button>
        <h3>${esc(d.className)}</h3>
        ${d.exams.length ? `<select class="form-input sn-exam-select" data-sn-detail-exam aria-label="Deneme seç">${examOptions(d.exams, g && g.exam && g.exam.id)}</select>` : ''}
        ${d.isMine ? `<button type="button" class="btn btn-secondary btn-sm" data-sn-open-students="${esc(d.className)}">👨‍🎓 Öğrenciler sayfasında aç</button>` : ''}
      </div>`;
    if (!g || !g.exam || !c) {
      host.innerHTML = html + '<p class="sn-empty">Bu sınıfın kademesi için henüz bir Genel Deneme sonucu yok.</p>';
      return;
    }
    const qc = g.exam.questionCounts || {};
    html += `<div class="sn-tiles">
        <div class="sn-tile"><div class="v">${c.enrolled}</div><div class="l">Mevcut</div></div>
        <div class="sn-tile"><div class="v">${c.participated}</div><div class="l">Sınava giren</div></div>
        <div class="sn-tile"><div class="v ${c.absent ? 'sn-absent' : ''}">${c.absent}</div><div class="l">Girmeyen</div></div>
        <div class="sn-tile"><div class="v">${fmt(c.avgNet)}</div><div class="l">Sınıf ortalaması</div></div>
        <div class="sn-tile"><div class="v">${fmt(g.gradeStats.avgNet)}</div><div class="l">Kademe ortalaması · ${signed(c.diffFromGrade)}</div></div>
        <div class="sn-tile"><div class="v">${c.rank ? c.rank + '/' + c.rankOf : '-'}</div><div class="l">Kademedeki şube sırası</div></div>
      </div>`;
    // Ders ders sınıf vs kademe
    const keys = subjKeys(g.gradeStats.subjects);
    const maxAbs = Math.max(1, ...keys.map(k => Math.abs((c.subjects[k] || 0) - (g.gradeStats.subjects[k] || 0))));
    html += `<div class="card mt-2"><div class="card-header"><h3 class="card-title"><span class="card-icon">📚</span> Ders Bazında Sınıf ve Kademe</h3></div>
      <div class="sn-matrix-wrap"><table class="sn-table"><thead><tr><th>Ders</th><th class="num">Soru</th><th class="num">Sınıf</th><th class="num">Kademe</th><th class="num">Fark</th><th class="sn-hide-sm" style="width:30%"></th></tr></thead><tbody>
      ${keys.map(k => {
        const diff = c.subjects[k] != null ? c.subjects[k] - g.gradeStats.subjects[k] : null;
        const w = diff == null ? 0 : Math.abs(diff) / maxAbs * 50;
        const bar = diff == null ? '' : `<div class="sn-bar"><i></i><span style="${diff >= 0 ? `left:50%;width:${w}%;background:var(--success)` : `right:50%;width:${w}%;background:var(--danger)`}"></span></div>`;
        return `<tr class="${k === d.mySubject ? 'sn-focus-row' : ''}"><td>${esc(subjLabel(k, d.grade))}${k === d.mySubject ? ' <small class="sn-mine-tag">dersiniz</small>' : ''}</td><td class="num">${qc[k] || '-'}</td><td class="num"><b>${fmt(c.subjects[k])}</b></td><td class="num">${fmt(g.gradeStats.subjects[k])}</td><td class="num">${signed(diff)}</td><td class="sn-hide-sm">${bar}</td></tr>`;
      }).join('')}
      </tbody></table></div></div>`;
    kazState = { subject: d.mySubject && (d.kazanim || []).some(k => k.subject === d.mySubject) ? d.mySubject : 'ALL', all: false, open: null };
    if ((d.kazanim || []).length) html += `<div class="card mt-2" id="sn-kazanim">${kazanimHtml(d)}</div>`;
    html += `<div class="card mt-2" id="sn-ranking">${rankingHtml(d)}</div>`;
    // Girmeyenler
    html += `<div class="card mt-2"><div class="card-header" style="flex-wrap:wrap;gap:8px"><h3 class="card-title"><span class="card-icon">📋</span> Sınava Girmeyenler (${d.absent.length})</h3>
        ${d.absent.length ? '<div class="sn-actions"><button type="button" class="btn btn-secondary btn-sm" data-sn-detail-absent-csv>⬇️ Excel\'e aktar</button><button type="button" class="btn btn-secondary btn-sm" data-sn-detail-absent-pdf>⬇️ PDF</button></div>' : ''}</div>
      ${d.absent.length ? `<div class="sn-absent-list">${d.absent.map(s => `<span>${s.schoolNumber ? esc(s.schoolNumber) + ' · ' : ''}${esc(s.firstName)} ${esc(s.lastName)}</span>`).join('')}</div>`
        : '<p class="sn-empty">Bu sınıftaki tüm öğrenciler sınava girdi. 🎉</p>'}
      </div>`;
    host.innerHTML = html;
    host._data = d;
  }

  // Kazanım analizi: sınıfın en zayıf kazanımları (kademeyle karşılaştırmalı).
  function kazanimHtml(d) {
    const all = d.kazanim || [];
    const subjects = subjKeys(Object.fromEntries(all.map(k => [k.subject, 1])));
    const list = all.filter(k => kazState.subject === 'ALL' || k.subject === kazState.subject);
    const shown = kazState.all ? list : list.slice(0, 10);
    const pill = (val, label) => `<button type="button" class="filter-pill ${kazState.subject === val ? 'active' : ''}" data-sn-kaz-subject="${esc(val)}">${esc(label)}</button>`;
    const bar = (rate) => `<div class="sn-rate"><span style="width:${Math.max(0, Math.min(100, rate))}%;background:${rate < 40 ? 'var(--danger)' : rate < 60 ? 'var(--warning)' : 'var(--success)'}"></span></div>`;
    return `<div class="card-header" style="flex-wrap:wrap;gap:8px"><h3 class="card-title"><span class="card-icon">🎯</span> Kazanım Analizi <small style="font-weight:600;color:var(--text-muted)">(en zayıftan güçlüye)</small></h3>
        <div class="sn-actions"><button type="button" class="btn btn-secondary btn-sm" data-sn-kaz-csv>⬇️ Excel'e aktar</button><button type="button" class="btn btn-secondary btn-sm" data-sn-kaz-pdf>⬇️ PDF</button></div></div>
      <div class="sn-sort" style="margin-bottom:10px">${pill('ALL', 'Tüm dersler')}${subjects.map(k => pill(k, subjLabel(k, d.grade))).join('')}</div>
      <div class="sn-matrix-wrap"><table class="sn-table"><thead><tr><th class="sn-hide-sm">Ders</th><th>Kazanım</th><th class="num">Soru</th><th class="num">Sınıf</th><th class="sn-hide-sm" style="width:18%"></th><th class="num">Kademe</th><th class="num">Fark</th></tr></thead><tbody>
      ${shown.map(k => {
        const diff = k.gradeRate == null ? null : k.classRate - k.gradeRate;
        const key = kazKey(k), isOpen = kazState.open === key, nMiss = (k.missed || []).length;
        return `<tr class="sn-kaz-row ${k.subject === d.mySubject ? 'sn-focus-row' : ''} ${isOpen ? 'sn-kaz-open' : ''}" data-sn-kaz-row="${esc(key)}" title="Yapamayanları görmek için tıklayın"><td class="sn-hide-sm">${esc(subjLabel(k.subject, d.grade, true))}</td>
          <td style="min-width:220px"><span class="sn-kaz-caret">${isOpen ? '▾' : '▸'}</span> ${esc(k.kazanim)}${nMiss ? ` <span class="sn-kaz-miss-count">${nMiss} öğrenci</span>` : ''}</td><td class="num">${esc(k.questions.join(', '))}</td>
          <td class="num"><b>%${Math.round(k.classRate)}</b></td><td class="sn-hide-sm">${bar(k.classRate)}</td>
          <td class="num">${k.gradeRate == null ? '-' : '%' + Math.round(k.gradeRate)}</td><td class="num">${signed(diff, '')}</td></tr>
          ${isOpen ? `<tr class="sn-kaz-detail"><td colspan="7">${kazMissHtml(d, k)}</td></tr>` : ''}`;
      }).join('')}
      </tbody></table></div>
      ${list.length > 10 ? `<div style="margin-top:8px"><button type="button" class="btn btn-secondary btn-sm" data-sn-kaz-all>${kazState.all ? 'Yalnızca ilk 10' : `Tümünü göster (${list.length})`}</button></div>` : ''}
      <p class="text-muted" style="font-size:12px;margin-top:8px">Başarı: soruyu doğru yapan öğrencilerin oranı. Fark yüzde puan olarak kademeye göredir. Bir kazanıma tıklayınca o kazanımı yapamayan öğrenciler açılır.</p>`;
  }

  // --- Kazanımı yapamayanlar (satıra tıklayınca) ---
  const kazKey = (k) => `${k.subject}::${k.kazanim}`;
  function kazFind(d, key) { return (d.kazanim || []).find(k => kazKey(k) === key); }
  function studentMap(d) {
    if (!d._stMap) {
      d._stMap = {};
      (d.participants || []).forEach(p => { d._stMap[p.id] = p; });
    }
    return d._stMap;
  }
  // Bir kazanımdaki her öğrencinin durumu: Yanlış (en az bir yanlış) / Boş (yalnız boş)
  function kazMissRows(d, k) {
    const st = studentMap(d);
    return (k.missed || []).map(m => {
      const p = st[m.id] || {};
      const parts = [...m.wrong.map(q => `S${q} ✗`), ...m.blank.map(q => `S${q} boş`)];
      return {
        id: m.id, no: p.schoolNumber || '', name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || '-',
        kind: m.wrong.length ? 'Yanlış' : 'Boş', qs: parts.join(', '), score: `${m.correct}/${m.total}`, m,
        // dosyalar için (PDF yazı tipinde ✗ yok)
        qsText: [...m.wrong.map(q => `S${q} yanlış`), ...m.blank.map(q => `S${q} boş`)].join(', '),
      };
    });
  }
  function kazMissHtml(d, k) {
    const rows = kazMissRows(d, k);
    const total = k.classStudents || 0;
    if (!rows.length) return `<div class="sn-kaz-panel"><b>🎉 Sınava giren herkes bu kazanımın sorularını doğru yaptı.</b></div>`;
    const multi = k.questions.length > 1;
    const chip = (r) => `<button type="button" class="sn-kaz-chip" data-open-student data-student-id="${r.id}" data-student-name="${esc(r.name)}">
        ${r.no ? `<small>${esc(r.no)}</small> ` : ''}${esc(r.name)}<span class="sn-kaz-q">${esc(r.qs)}${multi ? ` · ${esc(r.score)} doğru` : ''}</span></button>`;
    const wrong = rows.filter(r => r.kind === 'Yanlış'), blank = rows.filter(r => r.kind === 'Boş');
    return `<div class="sn-kaz-panel">
        <div class="sn-grade-head" style="flex-wrap:wrap;gap:8px"><b>Bu kazanımı yapamayanlar: ${rows.length} / ${total} öğrenci</b>
          <div class="sn-actions"><button type="button" class="btn btn-secondary btn-sm" data-sn-kaz-miss-csv>⬇️ Excel</button><button type="button" class="btn btn-secondary btn-sm" data-sn-kaz-miss-pdf>⬇️ PDF</button></div></div>
        ${wrong.length ? `<div class="sn-kaz-group"><div class="sn-kaz-group-t">❌ Yanlış yapanlar (${wrong.length})</div><div class="sn-kaz-chips">${wrong.map(chip).join('')}</div></div>` : ''}
        ${blank.length ? `<div class="sn-kaz-group"><div class="sn-kaz-group-t">⚪ Boş bırakanlar (${blank.length})</div><div class="sn-kaz-chips">${blank.map(chip).join('')}</div></div>` : ''}
        <p class="text-muted" style="font-size:11.5px;margin:6px 0 0">${multi ? 'Bu kazanımın sorularından en az birini kaçıranlar. ' : ''}İsme tıklayınca öğrencinin detayı açılır.</p>
      </div>`;
  }
  function kazMissNames(d, k) {
    return kazMissRows(d, k).map(r => `${r.name}${r.no ? ' (' + r.no + ')' : ''}`).join(', ');
  }

  // Sınıf içi sıralama: öğretmenin dersi varsa varsayılan o derse göre,
  // "Toplam"a geçilebilir. Sıra, seçilen ölçüte göre (eşitlerde aynı sıra).
  function sortKeyFor(d) {
    if (detailSort === 'total') return 'total';
    if (detailSort) return detailSort;
    return d.mySubject && d.summary.gradeStats.subjects[d.mySubject] != null ? d.mySubject : 'total';
  }
  function sortedParticipants(d, key) {
    const val = (p) => key === 'total' ? p.totalNet : ((p.subjects[key] && p.subjects[key].net) || 0);
    const list = d.participants.slice().sort((a, b) => val(b) - val(a) || b.totalNet - a.totalNet);
    return list.map(p => ({ ...p, sortRank: 1 + list.filter(q => val(q) > val(p)).length, sortVal: val(p) }));
  }
  function rankingHtml(d) {
    const g = d.summary;
    const keys = subjKeys(g.gradeStats.subjects);
    const key = sortKeyFor(d);
    const rows = sortedParticipants(d, key);
    const sortBtns = d.mySubject && g.gradeStats.subjects[d.mySubject] != null ? `
        <div class="sn-sort" role="group" aria-label="Sıralama ölçütü">
          <button type="button" class="filter-pill ${key === d.mySubject ? 'active' : ''}" data-sn-sort="${esc(d.mySubject)}">${esc(subjLabel(d.mySubject, d.grade))}</button>
          <button type="button" class="filter-pill ${key === 'total' ? 'active' : ''}" data-sn-sort="total">Toplam</button>
        </div>` : '';
    return `<div class="card-header" style="flex-wrap:wrap;gap:8px"><h3 class="card-title"><span class="card-icon">🏅</span> ${esc(g.exam.name)} - Sınıf Sıralaması${key !== 'total' ? ` <small style="font-weight:600;color:var(--text-muted)">(${esc(subjLabel(key, d.grade))})</small>` : ''}</h3>
        <div class="sn-actions">${sortBtns}<button type="button" class="btn btn-secondary btn-sm" data-sn-detail-csv>⬇️ Excel'e aktar</button><button type="button" class="btn btn-secondary btn-sm" data-sn-detail-pdf>⬇️ PDF</button></div></div>
      <div class="sn-matrix-wrap"><table class="sn-table"><thead><tr><th class="num">Sıra</th><th class="num">No</th><th>Ad Soyad</th>
        ${keys.map(k => `<th class="num ${k === key ? 'sn-focus-col' : 'sn-hide-sm'}">${esc(subjLabel(k, d.grade, true))}</th>`).join('')}<th class="num ${key === 'total' ? 'sn-focus-col' : ''}">Toplam</th><th class="num" title="Kademedeki ${d.gradeParticipants} katılımcı arasında (toplam nete göre)">Kademe</th></tr></thead><tbody>
      ${rows.map(p => `<tr data-open-student data-student-id="${p.id}" data-student-name="${esc(p.firstName + ' ' + p.lastName)}">
          <td class="num">${p.sortRank}</td><td class="num">${esc(p.schoolNumber || '-')}</td><td>${esc(p.firstName)} ${esc(p.lastName)}</td>
          ${keys.map(k => `<td class="num ${k === key ? 'sn-focus-col' : 'sn-hide-sm'}">${fmt(p.subjects[k] && p.subjects[k].net)}</td>`).join('')}
          <td class="num ${key === 'total' ? 'sn-focus-col' : ''}"><b>${fmt(p.totalNet)}</b></td><td class="num">${p.gradeRank}/${d.gradeParticipants}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---------- Excel (CSV, Türkçe Excel uyumlu) ----------
  function downloadCsv(filename, rows) {
    const body = rows.map(r => r.map(v => {
      const s = v == null ? '' : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const n2 = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));

  // ---------- PDF (sunucu: /api/teacher/table-pdf - optik raporlarla aynı PDF üreticisi) ----------
  async function downloadPdf(filename, payload, btn) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    try {
      const res = await fetch('/api/teacher/table-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = 'PDF oluşturulamadı.';
        try { msg = (await res.json()).error || msg; } catch (_) { /* json değil */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      if (window.UI && UI.toast) UI.toast(err.message, 'error'); else alert(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }
  const n2dot = (v) => (v == null ? '-' : String(Math.round(Number(v) * 100) / 100));

  // ---------- Veri ----------
  async function load() {
    try {
      const res = await fetch('/api/teacher/class-summary');
      summary = await res.json();
      if (!res.ok) throw new Error(summary.error || 'Yüklenemedi');
    } catch (err) {
      summary = null;
      const host = document.getElementById('dash-classes');
      if (host) host.innerHTML = `<div class="card"><p class="sn-empty">Sınıf özeti yüklenemedi: ${esc(err.message)}</p></div>`;
      return;
    }
    renderDashboard();
    renderSchool();
  }

  async function changeGradeExam(grade, examId) {
    const d = await fetch(`/api/teacher/class-summary?grade=${encodeURIComponent(grade)}&exam_id=${examId}`).then(r => r.json());
    if (!d.grades || !d.grades[0] || !summary) return;
    summary.grades = summary.grades.map(g => g.grade === grade ? d.grades[0] : g);
    renderDashboard();
    renderSchool();
  }

  function bindEvents() {
    document.body.addEventListener('click', (e) => {
      const card = e.target.closest('[data-sn-class]');
      if (card) { openClass(card.dataset.snClass, Number(card.dataset.snExam) || null); return; }
      if (e.target.closest('[data-sn-goto-school]')) { showPage('school'); return; }
      if (e.target.closest('[data-sn-back]')) {
        showPage((detailState && detailState.returnPage) || 'dashboard');
        return;
      }
      const openSt = e.target.closest('[data-sn-open-students]');
      if (openSt) { showPage('students'); if (typeof setStudentClass === 'function') setStudentClass(openSt.dataset.snOpenStudents); return; }
      const kazSubj = e.target.closest('[data-sn-kaz-subject]');
      const kazAll = e.target.closest('[data-sn-kaz-all]');
      if (kazSubj || kazAll) {
        if (kazSubj) { kazState.subject = kazSubj.dataset.snKazSubject; kazState.all = false; } else kazState.all = !kazState.all;
        const box = document.getElementById('sn-kazanim');
        const dd = document.getElementById('class-detail-body')._data;
        if (box && dd) box.innerHTML = kazanimHtml(dd);
        return;
      }
      if (e.target.closest('[data-sn-kaz-csv]')) {
        const dd = document.getElementById('class-detail-body')._data;
        if (!dd) return;
        const rows = [['Ders', 'Kazanım', 'Soru', 'Sınıf Başarı %', 'Kademe Başarı %', 'Fark (puan)', 'Yapamayan Sayısı', 'Yapamayanlar']];
        (dd.kazanim || []).forEach(k => rows.push([subjLabel(k.subject, dd.grade), k.kazanim, k.questions.join(', '), n2(k.classRate), n2(k.gradeRate), k.gradeRate == null ? '' : n2(k.classRate - k.gradeRate), (k.missed || []).length, kazMissNames(dd, k)]));
        downloadCsv(`${dd.summary.exam.name} - ${dd.className} kazanım analizi.csv`, rows);
        return;
      }
      const kazPdf = e.target.closest('[data-sn-kaz-pdf]');
      if (kazPdf) {
        const dd = document.getElementById('class-detail-body')._data;
        if (!dd) return;
        const rows = (dd.kazanim || []).map(k => [subjLabel(k.subject, dd.grade, true), k.kazanim, k.questions.join(', '),
          '%' + Math.round(k.classRate), k.gradeRate == null ? '-' : '%' + Math.round(k.gradeRate),
          k.gradeRate == null ? '-' : ((k.classRate - k.gradeRate) > 0 ? '+' : '') + Math.round(k.classRate - k.gradeRate), kazMissNames(dd, k) || '-']);
        downloadPdf(`${dd.summary.exam.name} - ${dd.className} kazanım analizi.pdf`, {
          title: `${dd.className} Kazanım Analizi`,
          subtitle: `${dd.summary.exam.name}${dd.summary.exam.date ? ' · ' + dd.summary.exam.date : ''} · en zayıftan güçlüye`,
          columns: ['Ders', 'Kazanım', 'Soru', 'Sınıf', 'Kademe', 'Fark', 'Yapamayanlar'], rows,
          notes: ['Başarı: soruyu doğru yapan öğrencilerin oranı. Fark: kademeye göre yüzde puan. Yapamayanlar: kazanımın sorularından en az birini yanlış yapan ya da boş bırakan öğrenciler.'],
        }, kazPdf);
        return;
      }
      const kazRow = e.target.closest('[data-sn-kaz-row]');
      if (kazRow) {
        const key = kazRow.dataset.snKazRow;
        kazState.open = kazState.open === key ? null : key;
        const box = document.getElementById('sn-kazanim');
        const dd = document.getElementById('class-detail-body')._data;
        if (box && dd) box.innerHTML = kazanimHtml(dd);
        return;
      }
      const missCsv = e.target.closest('[data-sn-kaz-miss-csv]');
      const missPdf = e.target.closest('[data-sn-kaz-miss-pdf]');
      if (missCsv || missPdf) {
        const dd = document.getElementById('class-detail-body')._data;
        const k = dd && kazFind(dd, kazState.open);
        if (!k) return;
        const rows = kazMissRows(dd, k);
        const base = `${dd.summary.exam.name} - ${dd.className} - ${k.kazanim}`.slice(0, 150);
        if (missCsv) {
          downloadCsv(`${base} yapamayanlar.csv`, [['Okul No', 'Ad Soyad', 'Durum', 'Kaçırılan Sorular', 'Doğru'],
            ...rows.map(r => [r.no, r.name, r.kind, r.qsText, r.score])]);
        } else {
          downloadPdf(`${base} yapamayanlar.pdf`, {
            title: `${dd.className} · Kazanımı Yapamayanlar`,
            subtitle: `${subjLabel(k.subject, dd.grade)} · ${k.kazanim} · ${dd.summary.exam.name} · Soru: ${k.questions.join(', ')} · ${rows.length}/${k.classStudents || 0} öğrenci`,
            columns: ['No', 'Ad Soyad', 'Durum', 'Kaçırılan Sorular', 'Doğru'],
            rows: rows.map(r => [r.no || '-', r.name, r.kind, r.qsText, r.score]),
            notes: ['Soru numaraları A kitapçığına göredir. Doğru: kazanımın sorularından kaçını doğru yaptığı.'],
          }, missPdf);
        }
        return;
      }
      const sortBtn = e.target.closest('[data-sn-sort]');
      if (sortBtn) {
        detailSort = sortBtn.dataset.snSort;
        const box = document.getElementById('sn-ranking');
        const dd = document.getElementById('class-detail-body')._data;
        if (box && dd) box.innerHTML = rankingHtml(dd);
        return;
      }
      const absBtn = e.target.closest('[data-sn-absent-grade]');
      if (absBtn) { showAbsent(absBtn.dataset.snAbsentGrade, absBtn.dataset.snExam, absBtn); return; }
      const absCsv = e.target.closest('[data-sn-absent-csv]');
      if (absCsv) {
        const box = document.getElementById(`sn-absent-${absCsv.dataset.snAbsentCsv}`);
        const d = box && box._data;
        if (!d) return;
        const rows = [['Şube', 'Okul No', 'Ad', 'Soyad']];
        d.classes.forEach(c => c.students.forEach(s => rows.push([c.className, s.schoolNumber, s.firstName, s.lastName])));
        downloadCsv(`${d.exam.name} - ${d.grade}. sınıf girmeyenler.csv`, rows);
        return;
      }
      const absPdf = e.target.closest('[data-sn-absent-pdf]');
      if (absPdf) {
        const box = document.getElementById(`sn-absent-${absPdf.dataset.snAbsentPdf}`);
        const ad = box && box._data;
        if (!ad) return;
        const rows = [];
        ad.classes.forEach(c => c.students.forEach(s => rows.push([c.className, s.schoolNumber || '-', `${s.firstName} ${s.lastName}`])));
        downloadPdf(`${ad.exam.name} - ${ad.grade}. sınıf girmeyenler.pdf`, {
          title: `${ad.grade}. Sınıf · Sınava Girmeyenler`,
          subtitle: `${ad.exam.name}${ad.exam.date ? ' · ' + ad.exam.date : ''} · ${rows.length} öğrenci`,
          columns: ['Şube', 'Okul No', 'Ad Soyad'], rows,
        }, absPdf);
        return;
      }
      const host = document.getElementById('class-detail-body');
      const d = host && host._data;
      if (d && e.target.closest('[data-sn-detail-csv]')) {
        const keys = subjKeys(d.summary.gradeStats.subjects);
        const rows = [['Sıra', 'Okul No', 'Ad', 'Soyad', ...keys.flatMap(k => [subjLabel(k, d.grade) + ' D', subjLabel(k, d.grade) + ' Y', subjLabel(k, d.grade) + ' Net']), 'Toplam Net', 'Kademe Sırası']];
        const sk = sortKeyFor(d);
        sortedParticipants(d, sk).forEach(p => rows.push([p.sortRank, p.schoolNumber, p.firstName, p.lastName,
          ...keys.flatMap(k => { const s = p.subjects[k] || {}; return [s.correct, s.wrong, n2(s.net)]; }), n2(p.totalNet), `${p.gradeRank}/${d.gradeParticipants}`]));
        downloadCsv(`${d.summary.exam.name} - ${d.className} sıralama.csv`, rows);
        return;
      }
      const pdfBtn = d && e.target.closest('[data-sn-detail-pdf]');
      if (pdfBtn) {
        // Ekrandaki sıralamanın aynısı (seçili ölçüt: öğretmenin dersi ya da Toplam)
        const keys = subjKeys(d.summary.gradeStats.subjects);
        const sk = sortKeyFor(d);
        const columns = ['Sıra', 'No', 'Ad Soyad', ...keys.map(k => subjLabel(k, d.grade, true)), 'Toplam Net', 'Kademe Sırası'];
        const rows = sortedParticipants(d, sk).map(p => [p.sortRank, p.schoolNumber || '-', `${p.firstName} ${p.lastName}`,
          ...keys.map(k => { const s = p.subjects[k]; return s ? `${n2dot(s.net)} (${s.correct || 0}/${s.wrong || 0})` : '-'; }),
          n2dot(p.totalNet), `${p.gradeRank} / ${d.gradeParticipants}`]);
        const c = d.summary.classes[0] || {};
        const crit = sk === 'total' ? 'Toplam nete göre' : `${subjLabel(sk, d.grade)} netine göre`;
        downloadPdf(`${d.summary.exam.name} - ${d.className} sıralama.pdf`, {
          title: `${d.className} Sınıf Sıralaması`,
          subtitle: `${d.summary.exam.name}${d.summary.exam.date ? ' · ' + d.summary.exam.date : ''} · ${crit} · Sınava giren ${c.participated != null ? c.participated : rows.length}${c.enrolled != null ? '/' + c.enrolled : ''} · Sınıf ort. ${n2dot(c.avgNet)} · Kademe ort. ${n2dot(d.summary.gradeStats.avgNet)}`,
          columns, rows,
          notes: ['Ders hücreleri: net (doğru/yanlış). Kademe sırası: aynı kademedeki ' + d.gradeParticipants + ' katılımcı arasında toplam nete göre.'],
        }, pdfBtn);
        return;
      }
      const dAbsPdf = d && e.target.closest('[data-sn-detail-absent-pdf]');
      if (dAbsPdf) {
        downloadPdf(`${d.summary.exam.name} - ${d.className} girmeyenler.pdf`, {
          title: `${d.className} · Sınava Girmeyenler`,
          subtitle: `${d.summary.exam.name}${d.summary.exam.date ? ' · ' + d.summary.exam.date : ''} · ${d.absent.length} öğrenci`,
          columns: ['Okul No', 'Ad Soyad'],
          rows: d.absent.map(s => [s.schoolNumber || '-', `${s.firstName} ${s.lastName}`]),
        }, dAbsPdf);
        return;
      }
      if (d && e.target.closest('[data-sn-detail-absent-csv]')) {
        const rows = [['Şube', 'Okul No', 'Ad', 'Soyad']];
        d.absent.forEach(s => rows.push([d.className, s.schoolNumber, s.firstName, s.lastName]));
        downloadCsv(`${d.summary.exam.name} - ${d.className} girmeyenler.csv`, rows);
      }
    });
    document.body.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-sn-grade-select]');
      if (sel) { changeGradeExam(sel.dataset.snGradeSelect, Number(sel.value)); return; }
      const ssel = e.target.closest('[data-sn-subject-select]');
      if (ssel) { loadSubjectReport(ssel.value); return; }
      const sgsel = e.target.closest('[data-sn-subj-grade]');
      if (sgsel) { loadSubjectReport(subjectReport.key, sgsel.dataset.snSubjGrade, Number(sgsel.value)); return; }
      const dsel = e.target.closest('[data-sn-detail-exam]');
      if (dsel && detailState) openClass(detailState.className, Number(dsel.value));
    });
  }

  function init(meData) {
    me = meData || {};
    if (me.isSchoolWideViewer) {
      const nav = document.getElementById('nav-school');
      if (nav) nav.style.display = '';
    }
    bindEvents();
    load();
  }

  return { init, openClass, reload: load, renderSchool };
})();
