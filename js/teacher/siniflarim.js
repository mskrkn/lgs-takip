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
  let detailState = null;           // { className, examId }

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
        ${noData ? '<div class="sn-empty">Bu denemeye bu sınıftan katılım yok.</div>' : `
        <div class="sn-row"><span class="k">Sınıf ortalaması</span><span class="sn-big">${fmt(c.avgNet)}</span></div>
        <div class="sn-row"><span class="k">Kademe ort. ${fmt(g.gradeStats.avgNet)}</span><span>${signed(c.diffFromGrade, ' net')}</span></div>
        ${c.changeFromPrev != null ? `<div class="sn-row"><span class="k">Önceki denemeye göre</span><span>${signed(c.changeFromPrev)}</span></div>` : ''}
        <div class="sn-subjects">${subj}</div>`}
      </button>`;
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
    let html = `<div class="sn-legend">
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
            <button type="button" class="btn btn-secondary btn-sm" data-sn-absent-csv="${esc(grade)}">⬇️ Excel'e aktar</button></div>
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
        return `<tr><td>${esc(subjLabel(k, d.grade))}</td><td class="num">${qc[k] || '-'}</td><td class="num"><b>${fmt(c.subjects[k])}</b></td><td class="num">${fmt(g.gradeStats.subjects[k])}</td><td class="num">${signed(diff)}</td><td class="sn-hide-sm">${bar}</td></tr>`;
      }).join('')}
      </tbody></table></div></div>`;
    // Sınıf içi sıralama
    const pKeys = keys;
    html += `<div class="card mt-2"><div class="card-header" style="flex-wrap:wrap;gap:8px"><h3 class="card-title"><span class="card-icon">🏅</span> ${esc(g.exam.name)} - Sınıf Sıralaması</h3>
        <button type="button" class="btn btn-secondary btn-sm" data-sn-detail-csv>⬇️ Excel'e aktar</button></div>
      <div class="sn-matrix-wrap"><table class="sn-table"><thead><tr><th class="num">Sıra</th><th class="num">No</th><th>Ad Soyad</th>
        ${pKeys.map(k => `<th class="num sn-hide-sm">${esc(subjLabel(k, d.grade, true))}</th>`).join('')}<th class="num">Toplam</th><th class="num" title="Kademedeki ${d.gradeParticipants} katılımcı arasında">Kademe</th></tr></thead><tbody>
      ${d.participants.map(p => `<tr data-open-student data-student-id="${p.id}" data-student-name="${esc(p.firstName + ' ' + p.lastName)}">
          <td class="num">${p.classRank}</td><td class="num">${esc(p.schoolNumber || '-')}</td><td>${esc(p.firstName)} ${esc(p.lastName)}</td>
          ${pKeys.map(k => `<td class="num sn-hide-sm">${fmt(p.subjects[k] && p.subjects[k].net)}</td>`).join('')}
          <td class="num"><b>${fmt(p.totalNet)}</b></td><td class="num">${p.gradeRank}/${d.gradeParticipants}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    // Girmeyenler
    html += `<div class="card mt-2"><div class="card-header" style="flex-wrap:wrap;gap:8px"><h3 class="card-title"><span class="card-icon">📋</span> Sınava Girmeyenler (${d.absent.length})</h3>
        ${d.absent.length ? '<button type="button" class="btn btn-secondary btn-sm" data-sn-detail-absent-csv>⬇️ Excel\'e aktar</button>' : ''}</div>
      ${d.absent.length ? `<div class="sn-absent-list">${d.absent.map(s => `<span>${s.schoolNumber ? esc(s.schoolNumber) + ' · ' : ''}${esc(s.firstName)} ${esc(s.lastName)}</span>`).join('')}</div>`
        : '<p class="sn-empty">Bu sınıftaki tüm öğrenciler sınava girdi. 🎉</p>'}
      </div>`;
    host.innerHTML = html;
    host._data = d;
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
      const host = document.getElementById('class-detail-body');
      const d = host && host._data;
      if (d && e.target.closest('[data-sn-detail-csv]')) {
        const keys = subjKeys(d.summary.gradeStats.subjects);
        const rows = [['Sıra', 'Okul No', 'Ad', 'Soyad', ...keys.flatMap(k => [subjLabel(k, d.grade) + ' D', subjLabel(k, d.grade) + ' Y', subjLabel(k, d.grade) + ' Net']), 'Toplam Net', 'Kademe Sırası']];
        d.participants.forEach(p => rows.push([p.classRank, p.schoolNumber, p.firstName, p.lastName,
          ...keys.flatMap(k => { const s = p.subjects[k] || {}; return [s.correct, s.wrong, n2(s.net)]; }), n2(p.totalNet), `${p.gradeRank}/${d.gradeParticipants}`]));
        downloadCsv(`${d.summary.exam.name} - ${d.className} sıralama.csv`, rows);
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
