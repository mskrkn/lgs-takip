    let currentExamId = null;
    let studentTrendChart = null;
    let studentScoreRadarChart = null;
    let studentSubjectChart = null;
    let classTrendChart = null;
    let classBarChart = null;
    let riskScatterChart = null;
    let sparklineCharts = [];
    let modalSparklineCharts = [];
    let overviewData = null;
    let insightsData = null;

    // Öğrenci Roster Durumu
    let allStudents = [];
    let currentStudentFilter = 'all';
    let currentStudentSort = 'rank-asc';
    let currentStudentSearch = '';
    let currentStudentView = 'table';
    let currentStudentDetailData = null;

    function subjectName(key) {
      return (typeof SUBJECT_LOOKUP !== 'undefined' && SUBJECT_LOOKUP[key]) ? SUBJECT_LOOKUP[key].name : key;
    }

    function escapeHtml(str) {
      return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function getInitials(firstName, lastName) {
      const f = (firstName || '').trim().charAt(0).toUpperCase();
      const l = (lastName || '').trim().charAt(0).toUpperCase();
      return (f + l) || 'Ö';
    }

    function getAvatarGradient(id) {
      const gradients = [
        'linear-gradient(135deg, #14B8A6, #3B82F6)',
        'linear-gradient(135deg, #3b82f6, #06b6d4)',
        'linear-gradient(135deg, #10b981, #14b8a6)',
        'linear-gradient(135deg, #f59e0b, #ea580c)',
        'linear-gradient(135deg, #EF4444, #F59E0B)',
        'linear-gradient(135deg, #0F766E, #2DD4BF)',
      ];
      return gradients[(id || 0) % gradients.length];
    }

    function comingSoon(label) {
      alert(`${label} çok yakında burada olacak! 🚀`);
    }

    // ---- Sayfa Geçişleri ----
    function showPage(page) {
      document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
      });
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
      });
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const section = document.getElementById(`page-${page}`);
      if (section) section.classList.add('active');

      const titles = {
        dashboard: ['Ana Sayfa', 'Kontrol Merkezi'],
        analytics: ['Analizler', 'Sınıf Karşılaştırma & Konu Analizi'],
        students: ['Öğrenciler', 'Sıralı Öğrenci Listesi & Detaylı İnceleme'],
        exams: ['Denemeler', 'Deneme Sonuçları'],
        message: ['Mesaj Gönder', 'Öğrenciye Özel Mesaj'],
        topics: ['Konular', 'Yakında'],
        ai: ['Edu AI', 'Eğitim Asistanın'],
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
      document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => showPage(item.dataset.page));
      });
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => showPage(item.dataset.page));
      });
      const toggle = document.getElementById('menu-toggle');
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.querySelector('.sidebar-overlay');
      if (toggle) toggle.addEventListener('click', () => {
        if (sidebar) sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
      });
      if (overlay) overlay.addEventListener('click', () => {
        if (sidebar) sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });

      // Delege edilmiş öğrenci detay tıklama dinleyicisi
      document.body.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-open-student]');
        if (!trigger) return;
        closeListModal();
        openStudentDetail(Number(trigger.dataset.studentId), trigger.dataset.studentName || '');
      });

      // Öğrenci detay modalındaki sekme butonları da innerHTML ile sonradan
      // eklendiği için aynı delege edilmiş dinleyici yaklaşımı kullanılır.
      document.body.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab-switch]');
        if (!tabBtn) return;
        switchStudentModalTab(tabBtn.dataset.tabSwitch, tabBtn);
      });

      // Tebrik mesajını öğrenciye gönder butonu.
      document.body.addEventListener('click', (e) => {
        const sendBtn = e.target.closest('[data-send-message]');
        if (!sendBtn) return;
        sendMessageToStudent(Number(sendBtn.dataset.studentId), sendBtn.dataset.message, sendBtn);
      });
    }

    async function boot() {
      setupNav();

      const me = await fetch('/api/me').then(r => r.json());
      if (!me.authenticated || me.role !== 'teacher') {
        window.location.href = '/login.html';
        return;
      }

      document.getElementById('header-sub').innerHTML = `<span class="sync-dot"></span><span>${me.displayName || ''}</span>`;
      document.getElementById('settings-name').textContent = me.displayName || '-';
      document.getElementById('settings-class').textContent = me.className || '-';

      const greetingName = me.displayName || 'Öğretmenim';
      document.getElementById('greeting-title').textContent = `👋 Hoş Geldiniz, ${greetingName} öğretmenim! 🧭`;
      document.getElementById('greeting-date').textContent = '📅 ' + new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

      const [overview, insights] = await Promise.all([
        fetch('/api/teacher/overview').then(r => r.json()),
        fetch('/api/teacher/insights').then(r => r.ok ? r.json() : null),
      ]);
      overviewData = overview;
      insightsData = insights;
      allStudents = overview.students || [];
      renderMessagePage(overview.students, overview.className);

      document.getElementById('my-class-name').textContent = overview.className || '-';
      document.getElementById('my-class-name-2').textContent = overview.className || '-';

      const select = document.getElementById('exam-select');
      overview.exams.forEach(exam => {
        const opt = document.createElement('option');
        opt.value = exam.id;
        opt.textContent = `${exam.name} (${exam.date || '-'})`;
        select.appendChild(opt);
      });

      renderClassAverages(overview.classAverages, 'other-class-averages', null);
      renderStudentRosterEnhanced();
      renderDashboardInsights(overview, insights);

      if (!overview.students.length) {
        document.getElementById('my-class-results').innerHTML =
          '<p class="text-muted">Sınıfınıza kayıtlı öğrenci bulunamadı. Admin ile iletişime geçin.</p>';
      }
    }

    function renderClassAverages(list, elId, myClass) {
      const el = document.getElementById(elId);
      if (!list || !list.length) { el.innerHTML = '<p class="text-muted">Henüz veri yok.</p>'; return; }
      let html = '<div class="table-wrapper"><table class="simple-table"><tr><th>Sınıf</th><th>Öğrenci Sayısı</th><th>Ortalama Net</th></tr>';
      list.forEach(c => {
        html += `<tr><td>${escapeHtml(c.className)}${c.className === myClass ? ' (Sizin Sınıfınız)' : ''}</td><td>${c.studentCount}</td><td class="badge-net">${c.avgNet}</td></tr>`;
      });
      html += '</table></div>';
      el.innerHTML = html;
    }

    // ---- Ana Sayfa: EduPusula Öneriyor + Grafik + Isı Haritası + Risk Haritası ----
    function renderDashboardInsights(overview, insights) {
      document.getElementById('stat-student-count').textContent = overview.students.length;

      if (!insights) {
        document.getElementById('priority-cards').innerHTML = '<p class="text-muted">Yeterli veri birikince öneriler burada görünecek.</p>';
        document.getElementById('heatmap-list').innerHTML = '<p class="text-muted">Henüz veri yok.</p>';
        document.getElementById('radar-columns').innerHTML = '<p class="text-muted">Henüz veri yok.</p>';
        const riskCanvas = document.getElementById('risk-scatter-chart');
        if (riskCanvas) riskCanvas.closest('.risk-chart-box').innerHTML = '<p class="text-muted">Yeterli veri birikince burada görünecek.</p>';
        document.getElementById('stat-growth').textContent = '-';
        document.getElementById('stat-attention').textContent = '-';
        return;
      }

      document.getElementById('stat-growth').textContent = insights.trend.growthPct != null ? `${insights.trend.growthPct > 0 ? '+' : ''}${insights.trend.growthPct}%` : '-';
      document.getElementById('stat-attention').textContent = insights.radar.attention.length;

      // ---- Öncelik Kartları ----
      const cards = [];
      if (insights.priority.decline) {
        const d = insights.priority.decline;
        cards.push(`
          <div class="priority-card priority-critical">
            <span class="priority-label">🔴 Öncelikli</span>
            <p>${d.count} öğrencinin ${subjectName(d.subjectKey)} performansı son 3 denemede düşüş gösteriyor.</p>
            <button type="button" class="priority-action" onclick="openDeclineModal()">Öğrencileri Gör →</button>
          </div>`);
      }
      if (insights.priority.belowAvgTopic) {
        const t = insights.priority.belowAvgTopic;
        cards.push(`
          <div class="priority-card priority-warning">
            <span class="priority-label">🟠 Dikkat</span>
            <p>${escapeHtml(overview.className || 'Sınıfınızda')} sınıfında <b>${escapeHtml(t.kazanim)}</b> konusu sınıf ortalamasının altında (%${t.successRate}).</p>
            <button type="button" class="priority-action" onclick="document.getElementById('heatmap-section').scrollIntoView({behavior:'smooth'})">Konu Analizine Git →</button>
          </div>`);
      }
      if (insights.priority.personalRecords.length) {
        cards.push(`
          <div class="priority-card priority-success">
            <span class="priority-label">🟢 Başarı</span>
            <p>${insights.priority.personalRecords.length} öğrenci son denemede kişisel rekorunu kırdı! 🎉</p>
            <button type="button" class="priority-action" onclick="openCongratsModal()">Tebrik Mesajı Oluştur →</button>
          </div>`);
      }
      document.getElementById('priority-cards').innerHTML = cards.length
        ? cards.join('')
        : '<p class="text-muted">Şu an öne çıkan bir durum yok - her şey yolunda görünüyor 🎉</p>';

      // ---- Sınıf Gelişim Grafiği ----
      const trendCanvas = document.getElementById('class-trend-chart');
      if (classTrendChart) { classTrendChart.destroy(); classTrendChart = null; }
      if (trendCanvas && insights.trend.exams.length >= 2) {
        const labels = insights.trend.exams.map(e => e.examName);
        const classAvgData = insights.trend.exams.map(e => e.avgNet);
        const bestMap = {};
        ((insights.trend.bestStudent && insights.trend.bestStudent.data) || []).forEach(d => { bestMap[d.examId] = d.totalNet; });
        const bestData = insights.trend.exams.map(e => bestMap[e.examId] != null ? bestMap[e.examId] : null);

        const datasets = [{
          label: 'Sınıf Ortalaması',
          data: classAvgData,
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59,130,246,0.12)',
          borderWidth: 3, fill: true, tension: 0.4,
          pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: '#3B82F6',
        }];
        if (insights.trend.bestStudent) {
          datasets.push({
            label: `En Başarılı: ${insights.trend.bestStudent.firstName} ${insights.trend.bestStudent.lastName}`,
            data: bestData,
            borderColor: '#0F766E',
            borderWidth: 2, borderDash: [5, 5], tension: 0.4, spanGaps: true,
            pointRadius: 4, pointBackgroundColor: '#0F766E',
          });
        }

        classTrendChart = new Chart(trendCanvas, { type: 'line', data: { labels, datasets }, options: chartDefaults() });

        const capEl = document.getElementById('growth-caption');
        if (insights.trend.growthPct != null) {
          const dir = insights.trend.growthPct >= 0 ? 'gelişim' : 'gerileme';
          capEl.textContent = `📈 Sınıf genelinde son ${insights.trend.exams.length} denemede %${Math.abs(insights.trend.growthPct)} ${dir} gözlemlendi.`;
        } else {
          capEl.textContent = '';
        }
      } else if (trendCanvas) {
        trendCanvas.closest('.chart-box').innerHTML = '<p class="text-muted">Grafik için en az 2 deneme sonucu gerekir.</p>';
      }

      // ---- Konu Başarı Haritası ----
      const heatEl = document.getElementById('heatmap-list');
      if (insights.topicHeatmap && insights.topicHeatmap.length) {
        heatEl.innerHTML = insights.topicHeatmap.map(t => {
          const cls = t.successRate < 50 ? 'hm-red' : t.successRate < 70 ? 'hm-yellow' : 'hm-green';
          const icon = t.successRate < 50 ? '🔴' : t.successRate < 70 ? '🟡' : '🟢';
          return `<div class="heatmap-row"><span class="heatmap-topic">${subjectName(t.subjectKey)} - ${escapeHtml(t.kazanim)}</span><span class="heatmap-score ${cls}">${icon} %${t.successRate}</span></div>`;
        }).join('');
      } else {
        heatEl.innerHTML = '<p class="text-muted">Cevap anahtarlı (optik) bir deneme olmadığı için konu haritası henüz oluşturulamıyor.</p>';
      }
      document.getElementById('ai-comment-text').textContent = insights.aiComment || 'Henüz yeterli veri yok.';

      // ---- Risk Haritası (Başarı Yönü matrisi) ----
      if (riskScatterChart) { riskScatterChart.destroy(); riskScatterChart = null; }
      const scatterCanvas = document.getElementById('risk-scatter-chart');
      const allRadarPoints = [...insights.radar.rising, ...insights.radar.attention, ...insights.radar.fluctuating];
      if (scatterCanvas && allRadarPoints.length) {
        const toPoints = list => list.map(s => ({ x: s.delta, y: s.latestNet, name: `${s.firstName} ${s.lastName}`, id: s.id }));
        riskScatterChart = new Chart(scatterCanvas, {
          type: 'scatter',
          data: {
            datasets: [
              { label: '🚀 Yükselişte', data: toPoints(insights.radar.rising), backgroundColor: '#10b981', pointRadius: 7, pointHoverRadius: 9 },
              { label: '⚠️ Takip Gerekli', data: toPoints(insights.radar.attention), backgroundColor: '#EF4444', pointRadius: 7, pointHoverRadius: 9 },
              { label: '〰️ Dalgalı', data: toPoints(insights.radar.fluctuating), backgroundColor: '#F59E0B', pointRadius: 7, pointHoverRadius: 9 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (evt, elements) => {
              if (!elements.length) return;
              const { datasetIndex, index } = elements[0];
              const point = riskScatterChart.data.datasets[datasetIndex].data[index];
              openStudentDetail(point.id, point.name);
            },
            plugins: {
              legend: { labels: { color: '#cbd5e1', usePointStyle: true, padding: 16 } },
              tooltip: {
                backgroundColor: 'rgba(11, 16, 34, 0.95)', titleColor: '#fff', bodyColor: '#cbd5e1',
                borderColor: 'rgba(139, 92, 246, 0.4)', borderWidth: 1, padding: 12, cornerRadius: 10,
                callbacks: { label: (ctx) => `${ctx.raw.name}: net değişimi ${ctx.raw.x > 0 ? '+' : ''}${ctx.raw.x}, güncel net ${ctx.raw.y}` },
              },
            },
            scales: {
              x: { title: { display: true, text: 'Net Değişimi', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
              y: { title: { display: true, text: 'Güncel Net Seviyesi', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            },
          },
        });
      } else if (scatterCanvas) {
        scatterCanvas.closest('.risk-chart-box').innerHTML = '<p class="text-muted">Yeterli veri birikince burada görünecek.</p>';
      }

      // ---- Öğrenci Radarı ----
      const radarEl = document.getElementById('radar-columns');
      const col = (title, icon, items) => `
        <div class="radar-column">
          <h4>${icon} ${title}</h4>
          ${items.length ? items.map(s => `<button type="button" class="radar-item" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.firstName + ' ' + s.lastName)}">${s.firstName} ${s.lastName}</button>`).join('') : '<p class="text-muted" style="font-size:12.5px">Yok</p>'}
        </div>`;
      radarEl.innerHTML =
        col('Yükselişte', '🚀', insights.radar.rising) +
        col('Takip Gerekli', '⚠️', insights.radar.attention) +
        col('Dalgalı Performans', '〰️', insights.radar.fluctuating);
    }

    function openDeclineModal() {
      if (!insightsData || !insightsData.priority || !insightsData.priority.decline) return;
      const d = insightsData.priority.decline;
      document.getElementById('list-modal-title').textContent = `${subjectName(d.subjectKey)} - Düşüş Gösteren Öğrenciler`;
      document.getElementById('list-modal-body').innerHTML = d.students.map(s => `
        <button type="button" class="radar-item" style="padding:12px" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.firstName + ' ' + s.lastName)}">👤 ${s.firstName} ${s.lastName}</button>
      `).join('');
      document.getElementById('list-modal-overlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function openCongratsModal() {
      if (!insightsData || !insightsData.priority || !insightsData.priority.personalRecords) return;
      document.getElementById('list-modal-title').textContent = 'Tebrik Mesajları';
      document.getElementById('list-modal-body').innerHTML = insightsData.priority.personalRecords.map((s) => {
        const msg = `Tebrikler ${s.firstName}! ${s.examName} denemesinde ${s.totalNet} net ile kişisel rekorunu kırdın. Bu tempoyla devam! 🎉`;
        return `
        <div class="summary-tile" style="margin-bottom:10px">
          <div class="label">${escapeHtml(s.firstName + ' ' + s.lastName)}</div>
          <p style="font-size:13.5px;margin-top:6px">${escapeHtml(msg)}</p>
          <button type="button" class="btn btn-primary btn-sm mt-2" data-send-message data-student-id="${s.id}" data-message="${escapeHtml(msg)}">📨 Öğrenciye Gönder</button>
        </div>`;
      }).join('');
      document.getElementById('list-modal-overlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    async function sendMessageToStudent(studentId, message, btn) {
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor...';
      try {
        const res = await fetch('/api/teacher/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, message }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gönderilemedi.');
        btn.textContent = '✅ Öğrenciye Gönderildi';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '📨 Öğrenciye Gönder';
        alert('Mesaj gönderilemedi: ' + err.message);
      }
    }

    function renderMessagePage(students, className) {
      const classSelect = document.getElementById('message-class-select');
      classSelect.innerHTML = `<option>${escapeHtml(className || '-')}</option>`;

      const studentSelect = document.getElementById('message-student-select');
      const sorted = [...(students || [])].sort((a, b) =>
        (a.first_name + ' ' + a.last_name).localeCompare(b.first_name + ' ' + b.last_name, 'tr'));
      studentSelect.innerHTML = '<option value="">Bir öğrenci seçin...</option>' +
        sorted.map(s => `<option value="${s.id}">${escapeHtml(s.first_name + ' ' + s.last_name)}</option>`).join('');
    }

    async function sendCustomMessage() {
      const studentId = Number(document.getElementById('message-student-select').value);
      const text = document.getElementById('message-text').value.trim();
      const statusEl = document.getElementById('message-send-status');
      if (!studentId) { statusEl.textContent = '❌ Lütfen bir öğrenci seçin.'; return; }
      if (!text) { statusEl.textContent = '❌ Lütfen bir mesaj yazın.'; return; }
      statusEl.textContent = 'Gönderiliyor...';
      try {
        const res = await fetch('/api/teacher/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, message: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gönderilemedi.');
        statusEl.textContent = '✅ Mesaj gönderildi.';
        document.getElementById('message-text').value = '';
      } catch (err) {
        statusEl.textContent = '❌ ' + err.message;
      }
    }

    async function loadExamDetail(examId) {
      if (!examId) return;
      currentExamId = examId;
      const data = await fetch(`/api/teacher/exam/${examId}`).then(r => r.json());
      if (data.error) { alert(data.error); return; }

      if (classBarChart) { classBarChart.destroy(); classBarChart = null; }
      const barBox = document.getElementById('class-bar-chart-box');
      if (data.myClassResults.length) {
        barBox.innerHTML = '<canvas id="class-bar-chart"></canvas>';
        classBarChart = new Chart(document.getElementById('class-bar-chart'), {
          type: 'bar',
          data: {
            labels: data.myClassResults.map(r => r.studentName),
            datasets: [{
              label: 'Toplam Net', data: data.myClassResults.map(r => r.totalNet),
              backgroundColor: data.myClassResults.map(r => r.totalNet >= 0 ? 'rgba(20,184,166,0.7)' : 'rgba(239,68,68,0.7)'),
              borderColor: '#0D9488', borderWidth: 1, borderRadius: 6, maxBarThickness: 40,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (evt, elements) => {
              if (!elements.length) return;
              const r = data.myClassResults[elements[0].index];
              openStudentDetail(r.studentId, r.studentName);
            },
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
              y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            },
          },
        });
      } else {
        barBox.innerHTML = '<p class="text-muted">Bu deneme için sınıfınızda sonuç bulunamadı.</p>';
      }

      let html = '<div class="table-wrapper"><table class="simple-table"><tr><th>Öğrenci</th><th>Okul No</th><th>Sınıf Sırası</th><th>Okul Sırası</th><th>Toplam Net</th><th>Değişim</th></tr>';
      data.myClassResults.forEach(r => {
        let changeHtml = '-';
        if (r.netChange != null) {
          changeHtml = r.netChange === 0 ? 'Değişim yok'
            : r.netChange > 0 ? `<span class="net-up">▲ +${r.netChange}</span>` : `<span class="net-down">▼ ${r.netChange}</span>`;
        }
        html += `<tr><td><button type="button" class="student-link" data-open-student data-student-id="${r.studentId}" data-student-name="${escapeHtml(r.studentName)}">${r.studentName}</button></td><td>${r.schoolNumber || '-'}</td><td>${r.classRank}/${r.classSize}</td><td>${r.schoolRank}/${r.schoolSize}</td><td class="badge-net">${r.totalNet}</td><td>${changeHtml}</td></tr>`;
      });
      html += '</table></div>';
      document.getElementById('my-class-results').innerHTML = data.myClassResults.length ? html :
        '<p class="text-muted">Bu deneme için sınıfınızda sonuç bulunamadı.</p>';

      renderClassAverages(data.otherClassAverages, 'other-class-averages', null);

      const topicCard = document.getElementById('topic-card');
      if (data.topicStats && data.topicStats.length) {
        topicCard.style.display = '';
        let th = '<div class="table-wrapper"><table class="simple-table"><tr><th>Konu</th><th>Başarı %</th><th>D/Y/B</th></tr>';
        data.topicStats.slice(0, 15).forEach(t => {
          th += `<tr><td>${escapeHtml(t.kazanim)}</td><td>${t.successRate}%</td><td>${t.correct}/${t.wrong}/${t.blank}</td></tr>`;
        });
        th += '</table></div>';
        document.getElementById('topic-stats').innerHTML = th;
      } else {
        topicCard.style.display = 'none';
      }
    }

    // ============================================================
    // ÖĞRENCİLER SAYFASI: SIRALI TABLO, FİLTRE, ARAMA, KARTLAR
    // ============================================================

    function setStudentFilter(type, btn) {
      currentStudentFilter = type;
      document.querySelectorAll('#student-filter-pills .filter-pill').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      renderStudentRosterEnhanced();
    }

    function handleStudentSearch(val) {
      currentStudentSearch = (val || '').trim().toLowerCase();
      renderStudentRosterEnhanced();
    }

    function handleStudentSort(val) {
      currentStudentSort = val;
      renderStudentRosterEnhanced();
    }

    function setStudentView(view) {
      currentStudentView = view;
      const tableBtnEl = document.getElementById('btn-view-table');
      const cardsBtnEl = document.getElementById('btn-view-cards');
      if (tableBtnEl) tableBtnEl.classList.toggle('active', view === 'table');
      if (cardsBtnEl) cardsBtnEl.classList.toggle('active', view === 'cards');
      renderStudentRosterEnhanced();
    }

    function renderStudentRosterEnhanced() {
      const container = document.getElementById('student-roster-container');
      if (!container) return;

      if (!allStudents.length) {
        container.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Sınıfınıza kayıtlı öğrenci bulunamadı.</p>';
        return;
      }

      // 1) KPI Kartlarını Güncelle
      const totalCount = allStudents.length;
      const validNets = allStudents.filter(s => s.latestNet != null).map(s => s.latestNet);
      const classAvg = validNets.length ? (validNets.reduce((a, b) => a + b, 0) / validNets.length).toFixed(1) : '-';

      const topStudent = [...allStudents].sort((a, b) => ((b.latestNet || 0) - (a.latestNet || 0)))[0];
      const risingCount = allStudents.filter(s => s.status === 'rising').length;
      const attentionCount = allStudents.filter(s => s.status === 'attention').length;
      const fluctuatingCount = allStudents.filter(s => s.status === 'fluctuating').length;

      document.getElementById('kpi-total-students').textContent = totalCount;
      document.getElementById('kpi-class-avg-net').textContent = classAvg !== '-' ? `${classAvg} Net` : '-';
      document.getElementById('kpi-top-student-net').textContent = topStudent && topStudent.latestNet != null ? `${topStudent.latestNet} Net` : '-';
      document.getElementById('kpi-top-student-name').textContent = topStudent ? `🥇 ${topStudent.first_name} ${topStudent.last_name}` : 'Sınıf Birincisi';
      document.getElementById('kpi-rising-count').textContent = risingCount;
      document.getElementById('kpi-attention-count').textContent = attentionCount;

      // Filtre sayaçları
      document.getElementById('count-filter-all').textContent = totalCount;
      document.getElementById('count-filter-rising').textContent = risingCount;
      document.getElementById('count-filter-attention').textContent = attentionCount;
      document.getElementById('count-filter-fluctuating').textContent = fluctuatingCount;

      // 2) Filtrele
      let filtered = allStudents.filter(s => {
        if (currentStudentFilter === 'rising' && s.status !== 'rising') return false;
        if (currentStudentFilter === 'attention' && s.status !== 'attention') return false;
        if (currentStudentFilter === 'fluctuating' && s.status !== 'fluctuating') return false;
        if (currentStudentSearch) {
          const fullName = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
          const schoolNo = String(s.school_number || '').toLowerCase();
          if (!fullName.includes(currentStudentSearch) && !schoolNo.includes(currentStudentSearch)) {
            return false;
          }
        }
        return true;
      });

      // 3) Sırala
      filtered.sort((a, b) => {
        if (currentStudentSort === 'rank-asc') {
          // latestNet DESC, then avgNet DESC
          if (b.latestNet == null && a.latestNet != null) return -1;
          if (a.latestNet == null && b.latestNet != null) return 1;
          return (b.latestNet || 0) - (a.latestNet || 0) || (b.avgNet || 0) - (a.avgNet || 0);
        } else if (currentStudentSort === 'avg-desc') {
          return (b.avgNet || 0) - (a.avgNet || 0);
        } else if (currentStudentSort === 'name-asc') {
          return (a.first_name || '').localeCompare(b.first_name || '', 'tr');
        } else if (currentStudentSort === 'name-desc') {
          return (b.first_name || '').localeCompare(a.first_name || '', 'tr');
        } else if (currentStudentSort === 'number-asc') {
          const nA = parseInt(a.school_number, 10) || 999999;
          const nB = parseInt(b.school_number, 10) || 999999;
          return nA - nB;
        } else if (currentStudentSort === 'growth-desc') {
          return (b.netChange || -999) - (a.netChange || -999);
        }
        return 0;
      });

      if (!filtered.length) {
        container.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Arama veya filtre kriterinize uyan öğrenci bulunamadı.</p>';
        return;
      }

      // Sparkline grafiklerini temizle
      sparklineCharts.forEach(c => c.destroy());
      sparklineCharts = [];

      // 4) Tablo ya da Kart Görünümü Oluştur
      if (currentStudentView === 'table') {
        let html = `
          <div class="ranked-table-wrapper">
            <table class="ranked-table">
              <thead>
                <tr>
                  <th style="width:60px;text-align:center">Sıra</th>
                  <th>Öğrenci Bilgisi</th>
                  <th style="text-align:center">Son Deneme Neti</th>
                  <th style="text-align:center">Ortalama Net</th>
                  <th style="text-align:center">Son Değişim</th>
                  <th style="text-align:center;width:80px">Trend</th>
                  <th style="text-align:center">Durum</th>
                  <th style="text-align:right">İşlem</th>
                </tr>
              </thead>
              <tbody>
        `;

        filtered.forEach((s, idx) => {
          const rank = s.rank || (idx + 1);
          let rankHtml = `<span class="rank-badge rank-other">${rank}</span>`;
          if (rank === 1) rankHtml = `<span class="rank-badge rank-1" title="Sınıf 1.si">🥇 1</span>`;
          else if (rank === 2) rankHtml = `<span class="rank-badge rank-2" title="Sınıf 2.si">🥈 2</span>`;
          else if (rank === 3) rankHtml = `<span class="rank-badge rank-3" title="Sınıf 3.sü">🥉 3</span>`;

          const initials = getInitials(s.first_name, s.last_name);
          const avatarGradient = getAvatarGradient(s.id);

          let changeHtml = '<span class="net-neutral">➖</span>';
          if (s.netChange != null) {
            if (s.netChange > 0) changeHtml = `<span class="net-up">▲ +${s.netChange}</span>`;
            else if (s.netChange < 0) changeHtml = `<span class="net-down">▼ ${s.netChange}</span>`;
            else changeHtml = `<span class="net-neutral">0.0</span>`;
          }

          let statusHtml = '<span class="status-badge new">✨ Yeni</span>';
          if (s.status === 'rising') statusHtml = '<span class="status-badge rising">🚀 Yükselişte</span>';
          else if (s.status === 'attention') statusHtml = '<span class="status-badge attention">⚠️ Takip</span>';
          else if (s.status === 'fluctuating') statusHtml = '<span class="status-badge fluctuating">〰️ Dalgalı</span>';
          else if (s.status === 'stable') statusHtml = '<span class="status-badge stable">🟢 Dengeli</span>';

          const hasSparkline = s.sparkline && s.sparkline.length >= 2;

          html += `
            <tr data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.first_name + ' ' + s.last_name)}">
              <td style="text-align:center">${rankHtml}</td>
              <td>
                <div class="student-info-cell">
                  <div class="student-avatar" style="background:${avatarGradient}">${initials}</div>
                  <div>
                    <div class="student-name-main">${escapeHtml(s.first_name + ' ' + s.last_name)}</div>
                    <div class="student-no-sub">No: ${s.school_number || '-'} • ${escapeHtml(s.class_name || (overviewData && overviewData.className) || '')}</div>
                  </div>
                </div>
              </td>
              <td style="text-align:center">
                <span class="net-cell-badge">${s.latestNet != null ? s.latestNet : '-'}</span>
              </td>
              <td style="text-align:center">
                <span style="font-weight:600;color:var(--text-secondary)">${s.avgNet != null ? s.avgNet : '-'}</span>
              </td>
              <td style="text-align:center">${changeHtml}</td>
              <td style="text-align:center">
                ${hasSparkline ? `<canvas class="sparkline-item" width="65" height="24" data-spark-id="${s.id}"></canvas>` : '<span class="text-muted" style="font-size:11px">-</span>'}
              </td>
              <td style="text-align:center">${statusHtml}</td>
              <td style="text-align:right">
                <button type="button" class="btn-detail-sm" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.first_name + ' ' + s.last_name)}">Detaylar →</button>
              </td>
            </tr>
          `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

      } else {
        // Kartlar Görünümü
        let html = '<div class="student-cards-grid">';
        filtered.forEach((s, idx) => {
          const rank = s.rank || (idx + 1);
          let rankBadge = `<span class="rank-badge rank-other">#${rank}</span>`;
          if (rank === 1) rankBadge = `<span class="rank-badge rank-1">🥇 #1</span>`;
          else if (rank === 2) rankBadge = `<span class="rank-badge rank-2">🥈 #2</span>`;
          else if (rank === 3) rankBadge = `<span class="rank-badge rank-3">🥉 #3</span>`;

          const initials = getInitials(s.first_name, s.last_name);
          const avatarGradient = getAvatarGradient(s.id);

          let changeHtml = '<span class="net-neutral">➖</span>';
          if (s.netChange != null) {
            if (s.netChange > 0) changeHtml = `<span class="net-up">▲ +${s.netChange}</span>`;
            else if (s.netChange < 0) changeHtml = `<span class="net-down">▼ ${s.netChange}</span>`;
          }

          let statusHtml = '<span class="status-badge new">✨ Yeni</span>';
          if (s.status === 'rising') statusHtml = '<span class="status-badge rising">🚀 Yükselişte</span>';
          else if (s.status === 'attention') statusHtml = '<span class="status-badge attention">⚠️ Takip</span>';
          else if (s.status === 'fluctuating') statusHtml = '<span class="status-badge fluctuating">〰️ Dalgalı</span>';
          else if (s.status === 'stable') statusHtml = '<span class="status-badge stable">🟢 Dengeli</span>';

          const hasSparkline = s.sparkline && s.sparkline.length >= 2;

          html += `
            <div class="student-grid-card" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.first_name + ' ' + s.last_name)}">
              <div class="card-top-row">
                <div class="student-info-cell">
                  <div class="student-avatar" style="background:${avatarGradient}">${initials}</div>
                  <div>
                    <div class="student-name-main">${escapeHtml(s.first_name + ' ' + s.last_name)}</div>
                    <div class="student-no-sub">No: ${s.school_number || '-'}</div>
                  </div>
                </div>
                ${rankBadge}
              </div>

              <div class="card-stats-row">
                <div class="card-stat-item">
                  <div class="label">Son Deneme Neti</div>
                  <div class="val">${s.latestNet != null ? s.latestNet : '-'} <span style="font-size:12px">${changeHtml}</span></div>
                </div>
                <div class="card-stat-item">
                  <div class="label">Ortalama Net</div>
                  <div class="val">${s.avgNet != null ? s.avgNet : '-'}</div>
                </div>
              </div>

              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
                <div>${statusHtml}</div>
                ${hasSparkline ? `<canvas class="sparkline-item" width="70" height="24" data-spark-id="${s.id}"></canvas>` : ''}
              </div>

              <button type="button" class="btn-detail-sm mt-2" style="width:100%;text-align:center;justify-content:center" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.first_name + ' ' + s.last_name)}">
                🔍 Tüm Detayları İncele →
              </button>
            </div>
          `;
        });
        html += '</div>';
        container.innerHTML = html;
      }

      // Sparkline grafiklerini çiz
      container.querySelectorAll('canvas.sparkline-item').forEach(canvas => {
        const studentId = Number(canvas.dataset.sparkId);
        const student = allStudents.find(s => s.id === studentId);
        const nets = student ? student.sparkline : null;
        if (!nets || nets.length < 2) return;
        const rising = nets[nets.length - 1] >= nets[0];
        sparklineCharts.push(new Chart(canvas, {
          type: 'line',
          data: {
            labels: nets.map((_, i) => i),
            datasets: [{
              data: nets,
              borderColor: rising ? '#10b981' : '#EF4444',
              borderWidth: 1.8,
              pointRadius: 0,
              tension: 0.35,
              fill: false,
            }],
          },
          options: {
            responsive: false,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } },
            elements: { point: { radius: 0 } },
          },
        }));
      });
    }

    // ============================================================
    // ÖĞRENCİ TÜM DETAYLARI MODALI & GRAFİKLER & KARNE
    // ============================================================

    function renderCompass(compass) {
      if (!compass) return '<p class="text-muted">Henüz yeterli veri yok.</p>';
      const list = (items, emptyText, mapFn) => items.length
        ? `<ul class="q-tags">${items.map(mapFn).join('')}</ul>`
        : `<p class="text-muted" style="font-size:12px;margin-top:auto">${emptyText}</p>`;
      return `
        <div class="compass-grid">
          <div class="quadrant q-nw" style="--q: var(--ep-sky)">
            <span class="q-dir">KUZEY-BATI</span>
            <h4 class="q-heading">Gelişim Alanları</h4>
            ${list(compass.developing, 'Henüz belirgin bir yükseliş yok', d => `<li>${subjectName(d.subjectKey)} <b>+${d.delta} net</b></li>`)}
          </div>
          <div class="quadrant q-ne" style="--q: var(--ep-success)">
            <span class="q-dir">KUZEY-DOĞU</span>
            <h4 class="q-heading">Güçlü Yönler</h4>
            ${list(compass.strong, 'Optik okuma sonucu geldiğinde burada görünür', s => `<li>${escapeHtml(s.kazanim)} <b>%${s.successRate}</b></li>`)}
          </div>
          <div class="quadrant q-sw" style="--q: var(--ep-rose)">
            <span class="q-dir">GÜNEY-BATI</span>
            <h4 class="q-heading">Öncelikli Çalışma</h4>
            ${list(compass.priority, 'Acil öncelik yok', p => `<li>${escapeHtml(p.kazanim)} <b>%${p.successRate}</b></li>`)}
          </div>
          <div class="quadrant q-se" style="--q: var(--ep-amber)">
            <span class="q-dir">GÜNEY-DOĞU</span>
            <h4 class="q-heading">Dikkat Gerekenler</h4>
            ${list(compass.attention, 'Dikkat gereken konu yok', a => `<li>${escapeHtml(a.kazanim)} <b>%${a.successRate}</b></li>`)}
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

    // Soru sayilari sabit, makul bir oneri - konu secimi gercek veriden gelir.
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

    function renderStudyPlan(plan) {
      return `<div class="table-wrapper"><table class="simple-table">${plan.map(p =>
        `<tr><td style="white-space:nowrap">${p.day}</td><td>${p.icon} ${escapeHtml(p.text)}</td></tr>`
      ).join('')}</table></div>`;
    }

    function askEduAI(type) {
      const el = document.getElementById('ai-answer');
      if (!insightsData) { el.innerHTML = '<p class="text-muted">Henüz yeterli veri yok.</p>'; return; }

      if (type === 'rising') {
        const list = [...insightsData.radar.rising].sort((a, b) => b.delta - a.delta);
        el.innerHTML = `<div class="card"><h4 class="card-title">🚀 En Çok Gelişen Öğrenciler</h4>${list.length ?
          list.map(s => `<button type="button" class="radar-item" style="padding:12px" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.firstName + ' ' + s.lastName)}">${s.firstName} ${s.lastName} — net değişimi +${s.delta}</button>`).join('')
          : '<p class="text-muted">Şu an belirgin şekilde yükselişte öğrenci yok.</p>'}</div>`;
      } else if (type === 'risk') {
        const list = insightsData.radar.attention;
        el.innerHTML = `<div class="card"><h4 class="card-title">⚠️ Risk Altındaki Öğrenciler</h4>${list.length ?
          list.map(s => `<button type="button" class="radar-item" style="padding:12px" data-open-student data-student-id="${s.id}" data-student-name="${escapeHtml(s.firstName + ' ' + s.lastName)}">${s.firstName} ${s.lastName} — net değişimi ${s.delta}</button>`).join('')
          : '<p class="text-muted">Şu an risk altında görünen öğrenci yok 🎉</p>'}</div>`;
      } else if (type === 'topic') {
        const t = insightsData.topicHeatmap && insightsData.topicHeatmap[0];
        el.innerHTML = `<div class="card"><h4 class="card-title">🎯 Önerilen Tekrar Konusu</h4>${t
          ? `<p>${subjectName(t.subjectKey)} - <b>${escapeHtml(t.kazanim)}</b> (%${t.successRate} başarı)</p>`
          : '<p class="text-muted">Konu haritası için cevap anahtarlı (optik) bir deneme gerekir.</p>'}</div>`;
      } else if (type === 'plan') {
        const plan = generateStudyPlan(insightsData.topicHeatmap);
        el.innerHTML = `<div class="card"><h4 class="card-title">📅 Bu Haftaki Sınıf Rotası</h4>${renderStudyPlan(plan)}</div>`;
      }
    }

    function destroyStudentCharts() {
      if (studentTrendChart) { studentTrendChart.destroy(); studentTrendChart = null; }
      if (studentSubjectChart) { studentSubjectChart.destroy(); studentSubjectChart = null; }
      if (studentScoreRadarChart) { studentScoreRadarChart.destroy(); studentScoreRadarChart = null; }
    }

    function switchStudentModalTab(tabKey, btn) {
      document.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.detail-tab-pane').forEach(p => p.classList.remove('active'));

      if (btn) btn.classList.add('active');
      const pane = document.getElementById(`tab-pane-${tabKey}`);
      if (pane) pane.classList.add('active');

      // Sekme değiştiğinde Chart boyutlarını yeniden ayarla
      setTimeout(() => {
        if (studentTrendChart) studentTrendChart.resize();
        if (studentSubjectChart) studentSubjectChart.resize();
        if (studentScoreRadarChart) studentScoreRadarChart.resize();
      }, 50);
    }

    async function openStudentDetail(studentId, studentName) {
      document.getElementById('student-modal-title').textContent = studentName || 'Öğrenci Detayı';
      document.getElementById('student-modal-body').innerHTML = '<p class="text-muted" style="padding:40px;text-align:center">Öğrenci detayları yükleniyor...</p>';
      document.getElementById('student-modal-overlay').classList.add('active');
      document.body.style.overflow = 'hidden';

      const data = await fetch(`/api/teacher/student/${studentId}`).then(r => r.json());
      const body = document.getElementById('student-modal-body');
      if (data.error) {
        body.innerHTML = `<div class="card" style="padding:20px;text-align:center"><p class="text-muted">${escapeHtml(data.error)}</p></div>`;
        return;
      }

      currentStudentDetailData = data;
      const s = data.student;
      const results = data.results || [];
      const last = results[0];
      const prev = results[1];

      let changeHtml = '<span class="net-neutral">➖</span>';
      if (last && prev) {
        const diff = Math.round((last.totalNet - prev.totalNet) * 100) / 100;
        changeHtml = diff === 0 ? 'Değişim yok'
          : diff > 0 ? `<span class="net-up">▲ +${diff} net</span>` : `<span class="net-down">▼ ${diff} net</span>`;
      }

      const initials = getInitials(s.firstName, s.lastName);
      const avatarGradient = getAvatarGradient(s.id);

      // Hero Kartı
      let rankText = data.classRank ? `🏆 Sınıf ${data.classRank.rank}.sı (${data.classRank.classSize} Öğrenci Arasında)` : 'Kayıtlı Öğrenci';

      let html = `
        <!-- Öğrenci Üst Profil Bannerı -->
        <div class="modal-student-hero">
          <div class="hero-profile">
            <div class="hero-avatar" style="background:${avatarGradient}">${initials}</div>
            <div class="hero-info">
              <h2>${escapeHtml(s.firstName + ' ' + s.lastName)}</h2>
              <div class="hero-meta">
                <span class="hero-badge-pill">No: ${s.schoolNumber || '-'}</span>
                <span>${escapeHtml(s.className || (overviewData && overviewData.className) || '')}</span>
                <span>•</span>
                <span style="color:#fbbf24;font-weight:700">${rankText}</span>
              </div>
            </div>
          </div>

          <div class="hero-metrics">
            <div class="hero-metric-tile">
              <div class="label">Son Deneme Neti</div>
              <div class="value" style="color:#2dd4bf">${last ? last.totalNet : '-'}</div>
            </div>
            <div class="hero-metric-tile">
              <div class="label">Ortalama Net</div>
              <div class="value">${data.averageNet != null ? data.averageNet : '-'}</div>
            </div>
            <div class="hero-metric-tile">
              <div class="label">En Yüksek Net</div>
              <div class="value" style="color:#34d399">${data.bestNet != null ? data.bestNet : '-'}</div>
            </div>
            <div class="hero-metric-tile">
              <div class="label">Pusula Skoru</div>
              <div class="value" style="color:#c084fc">${(data.scoreBreakdown && data.scoreBreakdown.overall != null) ? data.scoreBreakdown.overall + '/100' : '-'}</div>
            </div>
          </div>
        </div>

        <!-- Sekme Çubuğu -->
        <div class="detail-tabs-bar">
          <button type="button" class="detail-tab-btn active" data-tab-switch="overview">📊 1. Genel Bakış & Pusula</button>
          <button type="button" class="detail-tab-btn" data-tab-switch="growth">📈 2. Gelişim & Karşılaştırma</button>
          <button type="button" class="detail-tab-btn" data-tab-switch="exams">📝 3. Tüm Deneme Geçmişi (${results.length})</button>
          <button type="button" class="detail-tab-btn" data-tab-switch="topics">🎯 4. Konu & Kazanım Analizi</button>
          <button type="button" class="detail-tab-btn" data-tab-switch="coaching">🧠 5. Hata Hafızası & Koç</button>
        </div>

        <!-- ============ SEKME 1: GENEL BAKIŞ & PUSULA ============ -->
        <div class="detail-tab-pane active" id="tab-pane-overview">
          <div class="summary-tile-grid">
            <div class="summary-tile"><div class="label">Son Deneme Neti</div><div class="value">${last ? last.totalNet : '-'}</div></div>
            <div class="summary-tile"><div class="label">Son Değişim</div><div class="value">${changeHtml}</div></div>
            <div class="summary-tile"><div class="label">En Güçlü Ders</div><div class="value" style="color:#34d399">${data.strongestSubject ? subjectName(data.strongestSubject) : '-'}</div></div>
            <div class="summary-tile"><div class="label">Geliştirilmesi Gereken Ders</div><div class="value" style="color:#fb7185">${data.weakestSubject ? subjectName(data.weakestSubject) : '-'}</div></div>
          </div>

          <div class="card mt-2">
            <div class="card-header"><h4 class="card-title">🎯 Genel Başarı Skoru (Pusula Puanı)</h4></div>
            <div class="score-hero">
              <span class="score-number">${(data.scoreBreakdown && data.scoreBreakdown.overall != null) ? data.scoreBreakdown.overall : '-'}</span>
              <span class="score-sub">/ 100</span>
              ${(data.scoreBreakdown && data.scoreBreakdown.growthDelta != null) ? `<span class="score-growth ${data.scoreBreakdown.growthDelta >= 0 ? 'up' : 'down'}">${data.scoreBreakdown.growthDelta === 0 ? 'Değişim yok' : (data.scoreBreakdown.growthDelta > 0 ? '▲ +' : '▼ ') + data.scoreBreakdown.growthDelta + ' puan gelişim'}</span>` : ''}
            </div>
            <div class="chart-box" style="height:230px"><canvas id="student-score-radar-chart"></canvas></div>
            <div class="badges-row" style="margin-top:14px">
              ${data.badges && data.badges.length ? data.badges.map(b => `<div class="badge-pill">${b.icon} ${b.label}</div>`).join('') : '<p class="text-muted" style="font-size:12.5px">Henüz kazanılan rozet yok.</p>'}
            </div>
          </div>

          <div class="card mt-2">
            <div class="card-header"><h4 class="card-title">🧭 Başarı Pusulası (4 Kadran)</h4></div>
            ${renderCompass(data.compass)}
          </div>
        </div>

        <!-- ============ SEKME 2: GELİŞİM & KARŞILAŞTIRMA ============ -->
        <div class="detail-tab-pane" id="tab-pane-growth">
          <div class="card">
            <div class="card-header"><h4 class="card-title">📈 Toplam Net Gelişim Grafiği (Deneme Deneme)</h4></div>
            <div class="chart-box" style="height:260px"><canvas id="student-trend-chart"></canvas></div>
          </div>

          ${last ? `
          <div class="card mt-2">
            <div class="card-header"><h4 class="card-title">📊 Son Deneme: Ders Bazlı Netler & Sınıf Karşılaştırması (${last.examName})</h4></div>
            <div class="chart-box" style="height:260px"><canvas id="student-subject-chart"></canvas></div>
          </div>` : ''}

          ${data.subjectDetails && Object.keys(data.subjectDetails).length ? `
          <div class="card mt-2">
            <div class="card-header"><h4 class="card-title">📚 Tüm Denemelerin Ders Bazlı Genel Özeti</h4></div>
            <div class="table-wrapper">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th>Ders</th>
                    <th>Ortalama Net</th>
                    <th>Son Deneme Neti</th>
                    <th>Toplam Doğru</th>
                    <th>Toplam Yanlış</th>
                    <th>Toplam Boş</th>
                    <th>Doğruluk Oranı</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(data.subjectDetails).map(([k, stat]) => `
                    <tr>
                      <td style="font-weight:700">${subjectName(k)}</td>
                      <td class="badge-net">${stat.avgNet}</td>
                      <td style="font-weight:700;color:#fff">${stat.latestNet}</td>
                      <td style="color:#4ade80">${stat.totalCorrect}</td>
                      <td style="color:#fb7185">${stat.totalWrong}</td>
                      <td style="color:var(--text-muted)">${stat.totalBlank}</td>
                      <td>
                        <div style="display:flex;align-items:center;gap:8px">
                          <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
                            <div style="width:${stat.accuracyRate}%;height:100%;background:${stat.accuracyRate >= 70 ? '#10b981' : stat.accuracyRate >= 50 ? '#f59e0b' : '#ef4444'};border-radius:3px"></div>
                          </div>
                          <span style="font-size:12px;font-weight:700">%${stat.accuracyRate}</span>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>` : ''}
        </div>

        <!-- ============ SEKME 3: TÜM DENEME GEÇMİŞİ ============ -->
        <div class="detail-tab-pane" id="tab-pane-exams">
          <div class="card">
            <div class="card-header"><h4 class="card-title">📝 Katıldığı Tüm Denemeler ve Ders Dökümleri</h4></div>
            ${results.length ? `
            <div class="table-wrapper" style="margin-top:10px">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th>Deneme Adı</th>
                    <th>Tarih</th>
                    <th>Türkçe (D/Y/N)</th>
                    <th>Matematik (D/Y/N)</th>
                    <th>Fen (D/Y/N)</th>
                    <th>İnkılap (D/Y/N)</th>
                    <th>Din (D/Y/N)</th>
                    <th>İngilizce (D/Y/N)</th>
                    <th style="text-align:right">Toplam Net</th>
                  </tr>
                </thead>
                <tbody>
                  ${results.map(r => {
                    const sub = r.subjects || {};
                    const sCell = (k) => {
                      const d = sub[k];
                      if (!d) return '<span class="text-muted">-</span>';
                      return `${d.correct || 0}/${d.wrong || 0} <b>(${d.net || 0})</b>`;
                    };
                    return `
                      <tr>
                        <td style="font-weight:700">${escapeHtml(r.examName)}</td>
                        <td style="color:var(--text-muted);font-size:12px">${r.examDate || '-'}</td>
                        <td>${sCell('turkce')}</td>
                        <td>${sCell('matematik')}</td>
                        <td>${sCell('fen')}</td>
                        <td>${sCell('inkilap')}</td>
                        <td>${sCell('din')}</td>
                        <td>${sCell('ingilizce')}</td>
                        <td style="text-align:right"><span class="badge-net" style="font-size:15px">${r.totalNet}</span></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>` : '<p class="text-muted" style="padding:20px">Henüz girilmiş bir deneme sonucu bulunmuyor.</p>'}
          </div>
        </div>

        <!-- ============ SEKME 4: KONU & KAZANIM ANALİZİ ============ -->
        <div class="detail-tab-pane" id="tab-pane-topics">
          <div class="card">
            <div class="card-header"><h4 class="card-title">🎯 Son Denemedeki Kazanım ve Konu Başarıları</h4></div>
            ${data.latestExamTopicStats && data.latestExamTopicStats.length ? `
            <div class="table-wrapper" style="margin-top:10px">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th>Ders</th>
                    <th>Kazanım / Konu</th>
                    <th>Başarı Durumu</th>
                    <th>D / Y / B</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.latestExamTopicStats.map(t => {
                    const cls = t.successRate >= 80 ? 'net-up' : t.successRate >= 50 ? 'text-muted' : 'net-down';
                    const barColor = t.successRate >= 80 ? '#10b981' : t.successRate >= 50 ? '#f59e0b' : '#ef4444';
                    return `
                      <tr>
                        <td style="font-weight:700">${subjectName(t.subjectKey)}</td>
                        <td>${escapeHtml(t.kazanim)}</td>
                        <td>
                          <div style="display:flex;align-items:center;gap:10px">
                            <div style="width:100px;height:7px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">
                              <div style="width:${t.successRate}%;height:100%;background:${barColor};border-radius:4px"></div>
                            </div>
                            <span class="${cls}" style="font-weight:700">%${t.successRate}</span>
                          </div>
                        </td>
                        <td>${t.correct} Doğru / ${t.wrong} Yanlış / ${t.blank} Boş</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>` : '<p class="text-muted" style="padding:20px">Optik okuma / konu kazanım bilgisi içeren deneme bulunamadı.</p>'}
          </div>
        </div>

        <!-- ============ SEKME 5: HATA HAFIZASI & KOÇ ============ -->
        <div class="detail-tab-pane" id="tab-pane-coaching">
          ${data.errorMemory ? `
          <div class="card">
            <div class="card-header"><h4 class="card-title">🧠 Hata Hafızası ve Yanlış Analizi</h4></div>
            <p class="text-muted" style="font-size:13px">Son denemedeki yanlışlar, öğrencinin bu konulardaki geçmiş başarı oranlarına göre sınıflandırılmıştır.</p>
            <div class="summary-tile-grid" style="margin-top:12px">
              <div class="summary-tile"><div class="label">🥇 Dikkat Hataları</div><div class="value" style="color:#f59e0b">${data.errorMemory.counts['Dikkat Hataları']} Adet</div></div>
              <div class="summary-tile"><div class="label">🥈 İşlem Hataları</div><div class="value" style="color:#3b82f6">${data.errorMemory.counts['İşlem Hataları']} Adet</div></div>
              <div class="summary-tile"><div class="label">🥉 Konu Eksikliği</div><div class="value" style="color:#ef4444">${data.errorMemory.counts['Konu Eksikliği']} Adet</div></div>
            </div>
            <div class="ai-comment-box mt-2">
              <span class="ai-comment-label">🤖 Edu AI Öğretmen Tavsiyesi</span>
              <span style="font-size:13.5px;color:var(--text-primary)">${data.errorMemory.aiComment || 'Henüz yeterli hata verisi oluşmadı.'}</span>
            </div>
          </div>` : ''}

          <div class="card mt-2">
            <div class="card-header"><h4 class="card-title">📅 Öğrenciye Özel Haftalık Ders Çalışma Rotası</h4></div>
            <p class="text-muted" style="font-size:13px">Öğrencinin en çok zorlandığı alanlara göre otomatik hazırlanan haftalık çalışma önerisi:</p>
            <div style="margin-top:10px">
              ${renderStudyPlan(generateStudyPlan(data.latestExamTopicStats))}
            </div>
          </div>
        </div>
      `;

      body.innerHTML = html;
      destroyStudentCharts();

      // Chart 1: Pusula Skoru Radarı
      const scoreRadarCanvas = document.getElementById('student-score-radar-chart');
      if (scoreRadarCanvas && data.scoreBreakdown) {
        const axes = data.scoreBreakdown.axes || {};
        studentScoreRadarChart = new Chart(scoreRadarCanvas, {
          type: 'radar',
          data: {
            labels: ['📚 Akademik', '🔥 Motivasyon', '🎯 Hedef', '🧩 Düzenlilik'],
            datasets: [{
              label: 'Skor',
              data: [axes.academic, axes.motivation, axes.hedef, axes.regularity].map(v => (v === null || v === undefined) ? 0 : v),
              borderColor: '#0F766E',
              backgroundColor: 'rgba(15,118,110,0.25)',
              borderWidth: 2.5,
              pointBackgroundColor: '#0F766E',
              pointRadius: 4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              r: {
                min: 0, max: 100,
                angleLines: { color: 'rgba(255,255,255,0.08)' },
                grid: { color: 'rgba(255,255,255,0.08)' },
                pointLabels: { color: '#cbd5e1', font: { size: 12, weight: '700' } },
                ticks: { color: '#64748b', backdropColor: 'transparent', stepSize: 25 },
              },
            },
          },
        });
      }

      // Chart 2: Net Trendi (Öğrenci Trendi vs Sınıf Ortalaması)
      const trendCanvas = document.getElementById('student-trend-chart');
      if (trendCanvas && data.netTrend && data.netTrend.length) {
        const labels = data.netTrend.map(t => t.examName);
        const studentData = data.netTrend.map(t => t.totalNet);

        // Sınıf ortalaması verisini de çizgi olarak ekle
        const classTrendMap = {};
        ((insightsData && insightsData.trend && insightsData.trend.exams) || []).forEach(e => { classTrendMap[e.examName] = e.avgNet; });
        const classLineData = labels.map(name => classTrendMap[name] != null ? classTrendMap[name] : null);

        const datasets = [{
          label: `${s.firstName} ${s.lastName} (Net)`,
          data: studentData,
          borderColor: '#0D9488',
          backgroundColor: 'rgba(20,184,166, 0.15)',
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#0D9488',
        }];

        if (classLineData.some(v => v != null)) {
          datasets.push({
            label: 'Sınıf Ortalaması',
            data: classLineData,
            borderColor: '#38bdf8',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.35,
            spanGaps: true,
            pointRadius: 3,
            pointBackgroundColor: '#38bdf8',
          });
        }

        studentTrendChart = new Chart(trendCanvas, {
          type: 'line',
          data: { labels, datasets },
          options: chartDefaults(),
        });
      } else if (trendCanvas) {
        trendCanvas.closest('.chart-box').innerHTML = '<p class="text-muted" style="padding:20px;text-align:center">Grafik için en az 1 deneme sonucu gerekir.</p>';
      }

      // Chart 3: Son Deneme - Ders Bazlı Net Karşılaştırması
      const subjectCanvas = document.getElementById('student-subject-chart');
      if (subjectCanvas && last) {
        const keys = Object.keys(last.subjects || {});
        const studentNets = keys.map(k => (last.subjects[k] && last.subjects[k].net) || 0);
        const classAvgNets = keys.map(k => (data.classSubjectAverages && data.classSubjectAverages[k]) || 0);

        studentSubjectChart = new Chart(subjectCanvas, {
          type: 'bar',
          data: {
            labels: keys.map(k => subjectName(k)),
            datasets: [
              {
                label: 'Öğrenci Neti',
                data: studentNets,
                backgroundColor: 'rgba(20,184,166, 0.85)',
                borderColor: '#0D9488',
                borderWidth: 1,
                borderRadius: 6,
                maxBarThickness: 35,
              },
              {
                label: 'Sınıf Ortalaması',
                data: classAvgNets,
                backgroundColor: 'rgba(56, 189, 248, 0.35)',
                borderColor: '#38bdf8',
                borderWidth: 1,
                borderRadius: 6,
                maxBarThickness: 35,
              },
            ],
          },
          options: {
            ...chartDefaults(),
            plugins: {
              ...chartDefaults().plugins,
              legend: { display: true, labels: { color: '#cbd5e1', usePointStyle: true } },
            },
          },
        });
      }
    }

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

    function closeStudentModal() {
      document.getElementById('student-modal-overlay').classList.remove('active');
      document.body.style.overflow = '';
      destroyStudentCharts();
    }

    function closeListModal() {
      const overlay = document.getElementById('list-modal-overlay');
      if (overlay) overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    document.getElementById('student-modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeStudentModal(); });
    document.getElementById('list-modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeListModal(); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { closeStudentModal(); closeListModal(); }
    });

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
