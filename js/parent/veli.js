    let children = [];
    let activeChildId = null;

    function subjectName(key) {
      return (typeof SUBJECT_LOOKUP !== 'undefined' && SUBJECT_LOOKUP[key]) ? SUBJECT_LOOKUP[key].name : key;
    }

    function comingSoon(label) { alert(`${label} çok yakında burada olacak! 🚀`); }

    function chartDefaults() {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#cbd5e1', font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' }, padding: 16, usePointStyle: true, boxWidth: 8 } },
          tooltip: { backgroundColor: 'rgba(11, 16, 34, 0.95)', titleColor: '#fff', bodyColor: '#cbd5e1', borderColor: 'rgba(139, 92, 246, 0.4)', borderWidth: 1, padding: 14, cornerRadius: 12 },
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      };
    }

    let radarChart = null, areaChart = null, scoreRadarChart = null;

    function renderScoreHero(scoreBreakdown) {
      const numEl = document.getElementById('score-number');
      const growthEl = document.getElementById('score-growth');
      if (!scoreBreakdown || scoreBreakdown.overall == null) { numEl.textContent = '-'; growthEl.textContent = ''; return; }
      numEl.textContent = scoreBreakdown.overall;
      if (scoreBreakdown.growthDelta != null) {
        const d = scoreBreakdown.growthDelta;
        growthEl.className = 'score-growth ' + (d >= 0 ? 'up' : 'down');
        growthEl.textContent = d === 0 ? 'Değişim yok' : `${d > 0 ? '▲ +' : '▼ '}${d} puan gelişim`;
      } else {
        growthEl.textContent = '';
      }
    }

    function renderScoreRadar(scoreBreakdown) {
      const canvas = document.getElementById('score-radar-chart');
      if (!canvas) return;
      if (scoreRadarChart) { scoreRadarChart.destroy(); scoreRadarChart = null; }
      canvas.closest('.chart-box').innerHTML = '<canvas id="score-radar-chart"></canvas>';
      const freshCanvas = document.getElementById('score-radar-chart');
      if (!scoreBreakdown) {
        freshCanvas.closest('.chart-box').innerHTML = '<p class="text-muted">Henüz yeterli veri yok.</p>';
        return;
      }
      const axes = scoreBreakdown.axes;
      scoreRadarChart = new Chart(freshCanvas, {
        type: 'radar',
        data: {
          labels: ['📚 Akademik', '🔥 Motivasyon', '🎯 Hedef', '🧩 Düzenlilik'],
          datasets: [{
            label: 'Skor', data: [axes.academic, axes.motivation, axes.hedef, axes.regularity].map(v => (v === null || v === undefined) ? 0 : v),
            borderColor: '#0F766E', backgroundColor: 'rgba(15,118,110,0.2)', borderWidth: 2, pointBackgroundColor: '#0F766E', pointRadius: 4,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { r: { min: 0, max: 100, angleLines: { color: 'rgba(255,255,255,0.08)' }, grid: { color: 'rgba(255,255,255,0.08)' }, pointLabels: { color: '#cbd5e1', font: { size: 12, weight: '600' } }, ticks: { color: '#64748b', backdropColor: 'transparent', stepSize: 25 } } },
        },
      });
    }

    function renderBadges(badges) {
      const el = document.getElementById('badges-row');
      if (!badges || !badges.length) { el.innerHTML = '<p class="text-muted" style="font-size:12.5px">Henüz rozet kazanılmadı.</p>'; return; }
      el.innerHTML = badges.map(b => `<div class="badge-pill">${b.icon} ${b.label}</div>`).join('');
    }

    function generateStudyPlan(topicStats) {
      const weak = (topicStats || []).slice(0, 2);
      const t1 = (weak[0] && weak[0].kazanim) || 'Genel Tekrar';
      const t2 = (weak[1] && weak[1].kazanim) || (weak[0] && weak[0].kazanim) || 'Genel Tekrar';
      return [
        { day: 'Pazartesi', icon: '📚', text: `${t1} — 25 Soru` },
        { day: 'Salı', icon: '📐', text: `${t2} — Konu Tekrarı` },
        { day: 'Çarşamba', icon: '🧮', text: `${t1} — 25 Soru` },
        { day: 'Perşembe', icon: '📝', text: 'Deneme Analizi' },
        { day: 'Cuma', icon: '🔁', text: 'Yanlışların Tekrarı' },
      ];
    }

    function renderStudyPlanCard(topicStats) {
      const card = document.getElementById('study-plan-card');
      if (!topicStats || !topicStats.length) { card.style.display = 'none'; return; }
      card.style.display = '';
      const plan = generateStudyPlan(topicStats);
      document.getElementById('study-plan').innerHTML = `<div class="table-wrapper"><table class="simple-table">${plan.map(p =>
        `<tr><td style="white-space:nowrap">${p.day}</td><td>${p.icon} ${p.text}</td></tr>`
      ).join('')}</table></div>`;
    }

    function renderErrorMemory(errorMemory) {
      const card = document.getElementById('error-memory-card');
      if (!errorMemory) { card.style.display = 'none'; return; }
      card.style.display = '';
      document.getElementById('error-memory-list').innerHTML = `
        <div class="summary-tile-grid">
          <div class="summary-tile"><div class="label">🥇 Dikkat Hataları</div><div class="value">${errorMemory.counts['Dikkat Hataları']}</div></div>
          <div class="summary-tile"><div class="label">🥈 İşlem Hataları</div><div class="value">${errorMemory.counts['İşlem Hataları']}</div></div>
          <div class="summary-tile"><div class="label">🥉 Konu Eksikliği</div><div class="value">${errorMemory.counts['Konu Eksikliği']}</div></div>
        </div>
      `;
      document.getElementById('error-memory-comment').textContent = errorMemory.aiComment || 'Henüz yeterli veri yok.';
    }

    function renderScorecards(last, diffVal, classRank) {
      document.getElementById('scorecards').innerHTML = `
        <div class="stat-card">
          <div class="stat-icon purple">🎯</div>
          <div class="stat-value">${last ? last.totalNet : '-'}</div>
          <div class="stat-label">Toplam Net</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon ${diffVal == null ? 'blue' : diffVal >= 0 ? 'green' : 'orange'}">${diffVal == null ? '➖' : diffVal >= 0 ? '📈' : '📉'}</div>
          <div class="stat-value">${diffVal == null ? '-' : (diffVal > 0 ? '+' : '') + diffVal}</div>
          <div class="stat-label">Son Deneme Artışı</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">🏆</div>
          <div class="stat-value">${classRank ? `${classRank.rank}/${classRank.classSize}` : '-'}</div>
          <div class="stat-label">Sınıf İçi Sıralama</div>
        </div>
      `;
    }

    function renderSubjectRadar(last, classAverages) {
      const canvas = document.getElementById('subject-radar-chart');
      if (!canvas) return;
      if (radarChart) { radarChart.destroy(); radarChart = null; }
      canvas.closest('.chart-box').innerHTML = '<canvas id="subject-radar-chart"></canvas>';
      const freshCanvas = document.getElementById('subject-radar-chart');
      if (!last || !last.subjects || Object.keys(last.subjects).length === 0) {
        freshCanvas.closest('.chart-box').innerHTML = '<p class="text-muted">Grafik için deneme sonucu gerekir.</p>';
        return;
      }
      const keys = Object.keys(last.subjects);
      radarChart = new Chart(freshCanvas, {
        type: 'radar',
        data: {
          labels: keys.map(k => subjectName(k)),
          datasets: [
            { label: 'Netleri', data: keys.map(k => (last.subjects[k] && last.subjects[k].net) || 0), borderColor: '#0D9488', backgroundColor: 'rgba(20,184,166,0.2)', borderWidth: 2, pointBackgroundColor: '#0D9488', pointRadius: 4 },
            { label: 'Sınıf Ortalaması', data: keys.map(k => (classAverages && classAverages[k] != null) ? classAverages[k] : 0), borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 2, borderDash: [5, 5], pointBackgroundColor: '#F59E0B', pointRadius: 3 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8', usePointStyle: true, padding: 16 } } },
          scales: { r: { angleLines: { color: 'rgba(255,255,255,0.08)' }, grid: { color: 'rgba(255,255,255,0.08)' }, pointLabels: { color: '#94a3b8', font: { size: 11 } }, ticks: { color: '#64748b', backdropColor: 'transparent' }, suggestedMin: 0 } },
        },
      });
    }

    function renderNetAreaChart(netTrend) {
      const canvas = document.getElementById('net-area-chart');
      if (!canvas) return;
      if (areaChart) { areaChart.destroy(); areaChart = null; }
      canvas.closest('.chart-box').innerHTML = '<canvas id="net-area-chart"></canvas>';
      const freshCanvas = document.getElementById('net-area-chart');
      if (!netTrend || netTrend.length < 2) {
        freshCanvas.closest('.chart-box').innerHTML = '<p class="text-muted">Grafik için en az 2 deneme sonucu gerekir.</p>';
        return;
      }
      const ctx = freshCanvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 260);
      gradient.addColorStop(0, 'rgba(20,184,166,0.4)');
      gradient.addColorStop(1, 'rgba(20,184,166,0.02)');
      areaChart = new Chart(freshCanvas, {
        type: 'line',
        data: {
          labels: netTrend.map(t => t.examName),
          datasets: [{
            label: 'Toplam Net', data: netTrend.map(t => t.totalNet),
            borderColor: '#0D9488', backgroundColor: gradient, borderWidth: 3, fill: true, tension: 0.4,
            pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#0D9488',
          }],
        },
        options: chartDefaults(),
      });
    }

    function renderSubjectProgress(last) {
      const el = document.getElementById('subject-progress');
      if (!last || !last.subjects || Object.keys(last.subjects).length === 0) {
        el.innerHTML = '<p class="text-muted">Henüz veri yok.</p>';
        return;
      }
      el.innerHTML = Object.entries(last.subjects).map(([key, s]) => {
        const q = (typeof SUBJECT_LOOKUP !== 'undefined' && SUBJECT_LOOKUP[key] && SUBJECT_LOOKUP[key].questions) || 20;
        const pct = Math.max(0, Math.min(100, Math.round(((s.net || 0) / q) * 100)));
        const color = pct < 50 ? '#EF4444' : pct < 70 ? '#F59E0B' : '#10b981';
        return `<div class="subject-progress-row">
          <span class="sp-name">${subjectName(key)}</span>
          <div class="sp-track"><div class="sp-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="sp-value">%${pct}</span>
        </div>`;
      }).join('');
    }

    function showPage(page) {
      document.querySelectorAll('.nav-item[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const pageSectionEl = document.getElementById(`page-${page}`);
      if (pageSectionEl) pageSectionEl.classList.add('active');
      const titles = {
        dashboard: ['Ana Sayfa', 'Kontrol Merkezi'],
        analytics: ['Analizler', 'Konu Analizi & Sınıf Ortalamaları'],
        exams: ['Denemeler', 'Deneme Sonuçları'],
        settings: ['Ayarlar', 'Hesap & Güvenlik'],
      };
      const [title, subtitle] = titles[page] || [page, ''];
      document.getElementById('page-title').firstChild.textContent = title + ' ';
      document.getElementById('page-subtitle').textContent = subtitle;
      const sidebarEl = document.querySelector('.sidebar');
      const overlayEl = document.querySelector('.sidebar-overlay');
      if (sidebarEl) sidebarEl.classList.remove('open');
      if (overlayEl) overlayEl.classList.remove('active');
    }

    function setupNav() {
      document.querySelectorAll('.nav-item[data-page]').forEach(item => item.addEventListener('click', () => showPage(item.dataset.page)));
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => item.addEventListener('click', () => showPage(item.dataset.page)));
      const toggle = document.getElementById('menu-toggle');
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.querySelector('.sidebar-overlay');
      if (toggle) toggle.addEventListener('click', () => { if (sidebar) sidebar.classList.toggle('open'); if (overlay) overlay.classList.toggle('active'); });
      if (overlay) overlay.addEventListener('click', () => { if (sidebar) sidebar.classList.remove('open'); overlay.classList.remove('active'); });

      // Çocuk sekmeleri innerHTML ile sonradan eklendiği için inline onclick
      // yerine delege edilmiş dinleyici kullanılır - bazı yönetilen/okul
      // tabletlerinin tarayıcısı, sonradan eklenen HTML'e gömülü onclick
      // niteliklerini güvenlik amacıyla sessizce çalıştırmıyor.
      document.body.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-child-id]');
        if (!trigger) return;
        loadChild(Number(trigger.dataset.childId));
      });
    }

    function renderCompass(compass) {
      const el = document.getElementById('compass');
      if (!compass) { el.innerHTML = '<p class="text-muted">Henüz yeterli veri yok.</p>'; return; }
      const list = (items, emptyText, mapFn) => items.length
        ? `<ul class="q-tags">${items.map(mapFn).join('')}</ul>`
        : `<p class="text-muted" style="font-size:12px;margin-top:auto">${emptyText}</p>`;
      el.innerHTML = `
        <div class="compass-grid">
          <div class="quadrant q-nw" style="--q: var(--ep-sky)">
            <span class="q-dir">KUZEY-BATI</span>
            <h4 class="q-heading">Gelişim Alanları</h4>
            ${list(compass.developing, 'Henüz belirgin bir yükseliş yok', d => `<li>${subjectName(d.subjectKey)} <b>+${d.delta} net</b></li>`)}
          </div>
          <div class="quadrant q-ne" style="--q: var(--ep-success)">
            <span class="q-dir">KUZEY-DOĞU</span>
            <h4 class="q-heading">Güçlü Yönler</h4>
            ${list(compass.strong, 'Optik okuma sonucu geldiğinde burada görünür', s => `<li>${s.kazanim} <b>%${s.successRate}</b></li>`)}
          </div>
          <div class="quadrant q-sw" style="--q: var(--ep-rose)">
            <span class="q-dir">GÜNEY-BATI</span>
            <h4 class="q-heading">Öncelikli Çalışma</h4>
            ${list(compass.priority, 'Acil öncelik yok', p => `<li>${p.kazanim} <b>%${p.successRate}</b></li>`)}
          </div>
          <div class="quadrant q-se" style="--q: var(--ep-amber)">
            <span class="q-dir">GÜNEY-DOĞU</span>
            <h4 class="q-heading">Dikkat Gerekenler</h4>
            ${list(compass.attention, 'Dikkat gereken konu yok', a => `<li>${a.kazanim} <b>%${a.successRate}</b></li>`)}
          </div>
          <div class="compass-pivot" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9.5" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
              <path d="M12 4 L14 12 L12 20 L10 12 Z" fill="var(--ep-teal)"/>
            </svg>
          </div>
        </div>
      `;
    }

    async function boot() {
      setupNav();
      const me = await fetch('/api/me').then(r => r.json());
      if (!me.authenticated || me.role !== 'parent') {
        window.location.href = '/login.html';
        return;
      }
      document.getElementById('header-sub').innerHTML = `<span class="sync-dot"></span><span>${me.displayName || ''}</span>`;
      document.getElementById('greeting-title').textContent = `👋 Hoş Geldiniz, ${me.displayName || 'Veli'}! 🧭`;
      document.getElementById('greeting-date').textContent = '📅 ' + new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

      const overview = await fetch('/api/parent/overview').then(r => r.json());
      if (overview.error && !(overview.children && overview.children.length)) {
        document.getElementById('greeting-title').textContent = overview.error;
        return;
      }

      children = overview.children;
      if (children.length > 1) {
        document.getElementById('children-card').style.display = '';
        renderChildTabs();
      }
      await loadChild(children[0].id);
    }

    function renderChildTabs() {
      const el = document.getElementById('child-tabs');
      el.innerHTML = children.map(c =>
        `<button class="child-tab${c.id === activeChildId ? ' active' : ''}" data-child-id="${c.id}">${c.firstName} ${c.lastName}</button>`
      ).join('');
    }

    async function loadChild(studentId) {
      activeChildId = studentId;
      if (children.length > 1) renderChildTabs();

      const data = await fetch(`/api/parent/child/${studentId}`).then(r => r.json());
      if (data.error) {
        document.getElementById('greeting-title').textContent = data.error;
        return;
      }

      const s = data.student;
      const last = data.results[0];
      const prev = data.results[1];
      const diffVal = (last && prev) ? Math.round((last.totalNet - prev.totalNet) * 100) / 100 : null;
      renderScorecards(last, diffVal, data.classRank);

      document.getElementById('summary').innerHTML = `
        <div class="summary-tile"><div class="label">Ad Soyad</div><div class="value">${s.firstName} ${s.lastName}</div></div>
        <div class="summary-tile"><div class="label">Sınıf</div><div class="value">${s.className || '-'}</div></div>
        <div class="summary-tile"><div class="label">En Güçlü Ders</div><div class="value">${data.strongestSubject ? subjectName(data.strongestSubject) : '-'}</div></div>
        <div class="summary-tile"><div class="label">Geliştirilmesi Gereken Ders</div><div class="value">${data.weakestSubject ? subjectName(data.weakestSubject) : '-'}</div></div>
      `;

      renderCompass(data.compass);
      renderScoreHero(data.scoreBreakdown);
      renderScoreRadar(data.scoreBreakdown);
      renderBadges(data.badges);
      renderSubjectRadar(last, data.classSubjectAverages);
      renderNetAreaChart(data.netTrend);
      renderSubjectProgress(last);
      renderErrorMemory(data.errorMemory);
      renderStudyPlanCard(data.latestExamTopicStats);

      if (!data.results.length) {
        document.getElementById('exam-results').innerHTML = '<p class="text-muted">Henüz deneme sonucu bulunmuyor.</p>';
      } else {
        let html = '<div class="table-wrapper"><table class="simple-table"><tr><th>Deneme</th><th>Tarih</th><th>Toplam Net</th></tr>';
        data.results.forEach(r => {
          html += `<tr><td>${r.examName}</td><td>${r.examDate || '-'}</td><td class="badge-net">${r.totalNet}</td></tr>`;
        });
        html += '</table></div>';
        document.getElementById('exam-results').innerHTML = html;
      }

      const topicCard = document.getElementById('topic-card');
      if (data.latestExamTopicStats && data.latestExamTopicStats.length) {
        topicCard.style.display = '';
        let th = '<div class="table-wrapper"><table class="simple-table"><tr><th>Konu</th><th>Başarı %</th><th>D/Y/B</th></tr>';
        data.latestExamTopicStats.slice(0, 10).forEach(t => {
          th += `<tr><td>${t.kazanim}</td><td>${t.successRate}%</td><td>${t.correct}/${t.wrong}/${t.blank}</td></tr>`;
        });
        th += '</table></div>';
        document.getElementById('topic-stats').innerHTML = th;
      } else {
        topicCard.style.display = 'none';
      }

      let cHtml = '<div class="table-wrapper"><table class="simple-table"><tr><th>Sınıf</th><th>Öğrenci Sayısı</th><th>Ortalama Net</th></tr>';
      data.classAverages.forEach(c => {
        cHtml += `<tr><td>${c.className}${c.className === s.className ? ' (Öğrencinizin Sınıfı)' : ''}</td><td>${c.studentCount}</td><td class="badge-net">${c.avgNet}</td></tr>`;
      });
      cHtml += '</table></div>';
      document.getElementById('class-averages').innerHTML = cHtml;
    }

    async function changePassword() {
      const current = document.getElementById('pw-current').value;
      const newPw = document.getElementById('pw-new').value;
      const status = document.getElementById('pw-status');
      status.textContent = 'Gönderiliyor...';
      try {
        const res = await fetch('/api/me/password', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Değiştirilemedi.');
        status.textContent = '✅ Şifreniz değiştirildi.';
        document.getElementById('pw-current').value = '';
        document.getElementById('pw-new').value = '';
      } catch (err) {
        status.textContent = '❌ ' + err.message;
      }
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    }

    boot();
