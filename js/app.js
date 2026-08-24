// ============================================
// LGS Deneme Takip - Main Application
// ============================================

const App = {
  currentPage: 'dashboard',
  currentStudentId: null,
  deferredPwaPrompt: null,

  // ---- Initialize ----
  async init() {
    // Background self-healing for student-exam matches and duplicates
    db.repairAndLinkStudents().catch(console.error);

    // Initialize Cloud Sync Module
    if (typeof SyncModule !== 'undefined') {
      await SyncModule.init();
      SyncModule.updateStatus();
    }

    // PWA Install Prompt Listener
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPwaPrompt = e;
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPwaPrompt = null;
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.style.display = 'none';
      if (typeof UI !== 'undefined') UI.toast('Uygulama başarıyla yüklendi!', 'success');
    });

    // Check for shared view
    const params = new URLSearchParams(window.location.search);
    const shareData = params.get('share');
    if (shareData) {
      try {
        const data = JSON.parse(decodeURIComponent(escape(atob(shareData))));
        document.getElementById('app-layout').innerHTML = ExportModule.renderSharedView(data);
        return;
      } catch (e) {
        console.error('Invalid share data');
      }
    }

    this.setupNavigation();
    this.setupSidebar();
    await this.navigateTo('dashboard');
  },

  // Trigger PWA installation dialog
  async triggerPwaInstall() {
    if (this.deferredPwaPrompt) {
      this.deferredPwaPrompt.prompt();
      const choiceResult = await this.deferredPwaPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) installBtn.style.display = 'none';
      }
      this.deferredPwaPrompt = null;
    } else {
      UI.toast('Tarayıcı menüsünden "Ana Ekrana Ekle" veya "Uygulamayı Yükle" seçeneğini kullanabilirsiniz.', 'info');
    }
  },

  // ---- Navigation ----
  setupNavigation() {
    // Sidebar items
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.navigateTo(page);
      });
    });

    // Mobile bottom navigation items
    document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.navigateTo(page);
      });
    });
  },

  async navigateTo(page, data = {}) {
    // Update active nav in sidebar and mobile bottom nav
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    document.querySelectorAll('.mobile-nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Hide all sections, show target
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(`page-${page}`);
    if (section) {
      section.classList.add('active');
    }

    // Update header title
    const titles = {
      dashboard: ['Anasayfa', 'Genel Bakış'],
      students: ['Öğrenciler', 'Tüm Öğrenciler'],
      'student-profile': ['Öğrenci Profili', ''],
      exams: ['Denemeler', 'Tüm Denemeler'],
      'exam-detail': ['Deneme Detayı', ''],
      'class-detail': [data.className ? `${data.className} Sınıfı` : 'Sınıf Detayı', ''],
      import: ['Veri Girişi', 'Manuel & Dosya İle'],
      reports: ['Raporlar', 'Dışa Aktarma & Paylaşım'],
      settings: ['Ayarlar', 'Veri Yönetimi'],
    };

    const [title, subtitle] = titles[page] || [page, ''];
    document.getElementById('page-title').innerHTML = `${title} <span>${subtitle}</span>`;

    this.currentPage = page;
    Analysis.destroyAllCharts();

    // Render page content
    switch (page) {
      case 'dashboard':
        await this.renderDashboard();
        break;
      case 'students':
        await this.renderStudents();
        break;
      case 'student-profile':
        await this.renderStudentProfile(data.studentId);
        break;
      case 'exams':
        await this.renderExams();
        break;
      case 'exam-detail':
        await this.renderExamDetail(data.examId);
        break;
      case 'class-detail':
        await this.renderClassDetail(data.className, data.examId);
        break;
      case 'import':
        await this.renderImport();
        break;
      case 'reports':
        await this.renderReports();
        break;
      case 'settings':
        await this.renderSettings();
        break;
    }

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('active');
  },

  refreshCurrentPage() {
    this.navigateTo(this.currentPage, { studentId: this.currentStudentId });
  },

  // ---- Mobile Sidebar ----
  setupSidebar() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (toggle) {
      toggle.addEventListener('click', () => {
        sidebar?.classList.toggle('open');
        overlay?.classList.toggle('active');
      });
    }

    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
      });
    }
  },

  // ========================================
  // PAGE RENDERERS
  // ========================================

  // ---- Dashboard ----
  async renderDashboard() {
    const container = document.getElementById('page-dashboard');
    const studentCount = await db.getStudentCount();
    const examCount = await db.getExamCount();
    const resultCount = await db.getResultCount();

    // Get latest exam info
    const exams = await db.getAllExams();
    let latestExam = exams[0];
    let latestAvg = latestExam ? await db.getExamAverages(latestExam.id) : null;

    // Get alerts
    const alerts = await db.getAllAlerts();
    const criticalAlerts = alerts.filter(a => a.type === 'critical');
    const warningAlerts = alerts.filter(a => a.type === 'warning');

    container.innerHTML = `
      <!-- Stats (küçük/sıkışık) -->
      <div class="stats-grid stats-grid-compact">
        <div class="stat-card">
          <div class="stat-icon purple">👥</div>
          <div class="stat-value">${studentCount}</div>
          <div class="stat-label">Toplam Öğrenci</div>
        </div>
        <div class="stat-card stat-card-link" onclick="App.navigateTo('exams')" title="Denemeler sayfasına git">
          <div class="stat-icon blue">📝</div>
          <div class="stat-value">${examCount}</div>
          <div class="stat-label">Toplam Deneme</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">📊</div>
          <div class="stat-value">${latestAvg ? latestAvg.totalNet.toFixed(1) : '-'}</div>
          <div class="stat-label">Son Deneme Ort. Net</div>
          ${latestExam ? `<div class="stat-change up">${latestExam.name}</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="stat-icon orange">⚠️</div>
          <div class="stat-value">${criticalAlerts.length + warningAlerts.length}</div>
          <div class="stat-label">Dikkat Gerektiren</div>
          ${criticalAlerts.length > 0 ? `<div class="stat-change down">${criticalAlerts.length} kritik</div>` : ''}
        </div>
      </div>

      <!-- Büyük Öğrenci Arama -->
      <div class="card dashboard-search-card">
        <h3>🔍 Öğrenci Bul</h3>
        <p class="text-muted">İsim veya okul numarası yazarak bir öğrencinin profiline anında ulaşın</p>
        <div class="dashboard-search-wrap">
          <span class="dashboard-search-icon">🔍</span>
          <input type="text" id="dashboard-student-search" class="dashboard-search-input" placeholder="Öğrenci adı veya okul numarası yazın...">
        </div>
        <div id="dashboard-search-results" class="dashboard-search-results"></div>
      </div>

      <!-- Sınıf Karşılaştırma -->
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🏫</span> Sınıf Karşılaştırma</h3>
        </div>
        <div class="class-compare-filters">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Deneme</label>
            <select class="form-select" id="dash-class-exam-select" onchange="App.onDashboardClassExamChange()">
              ${exams.map(e => `<option value="${e.id}">[${EXAM_TYPE_LABELS[e.examType] || 'LGS'}] ${e.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Kademe</label>
            <select class="form-select" id="dash-class-grade-select" onchange="App.onDashboardClassGradeChange()"></select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Şube</label>
            <select class="form-select" id="dash-class-section-select" onchange="App.onDashboardClassSectionSelected()"></select>
          </div>
        </div>
        <div id="dash-class-comparison-body"></div>
      </div>

      <div class="grid-2 mt-2">
        <!-- School Average Trend -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📈</span> Okul Ortalama Trendi</h3>
          </div>
          <div class="chart-container" style="height:300px">
            <canvas id="dashboard-school-trend"></canvas>
          </div>
        </div>

        <!-- Alerts -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">🔔</span> Uyarılar</h3>
            <span class="badge badge-danger">${alerts.length}</span>
          </div>
          <div id="dashboard-alerts" style="max-height:300px;overflow-y:auto">
            ${alerts.length === 0 ? '<div class="empty-state" style="padding:30px"><p class="text-muted">Henüz uyarı yok. En az 2 deneme sonucu girdikten sonra uyarılar burada görünecek.</p></div>' : ''}
            ${alerts.slice(0, 15).map(alert => `
              <div class="alert-card alert-${alert.type === 'critical' ? 'critical' : alert.type === 'warning' ? 'warning' : 'success'}"
                   onclick="App.navigateTo('student-profile', { studentId: ${alert.student.id} })" style="cursor:pointer">
                <div class="alert-icon">${alert.type === 'critical' ? '🔴' : alert.type === 'warning' ? '🟠' : '🟢'}</div>
                <div class="alert-content">
                  <h4>${alert.student.firstName} ${alert.student.lastName}</h4>
                  <p>${alert.subject.name}: ${alert.diff > 0 ? '+' : ''}${alert.diff.toFixed(2)} net (${alert.examName})</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Latest Exam Subject Averages -->
      ${latestExam && latestAvg ? `
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📊</span> ${latestExam.name} - Ders Ortalamaları</h3>
          <button class="btn btn-secondary btn-sm" onclick="App.navigateTo('exam-detail', { examId: ${latestExam.id} })">Detay →</button>
        </div>
        <div class="chart-container" style="height:250px">
          <canvas id="dashboard-latest-subjects"></canvas>
        </div>
      </div>
      ` : ''}
    `;

    // Render charts
    if (examCount > 0) {
      await Analysis.renderSchoolAverageTrendChart('dashboard-school-trend');
    }
    if (latestExam && latestAvg) {
      Analysis.renderExamSubjectBarsChart('dashboard-latest-subjects', latestAvg, latestExam.examType);
    }

    this.setupDashboardSearch();
    if (exams.length > 0) {
      await this.onDashboardClassGradeChange(true);
    } else {
      document.getElementById('dash-class-comparison-body').innerHTML =
        '<div class="empty-state" style="padding:24px"><p class="text-muted">Karşılaştırma için önce bir deneme ve sonuç girilmeli.</p></div>';
    }
  },

  // ---- Anasayfa: Büyük Öğrenci Arama ----
  setupDashboardSearch() {
    const input = document.getElementById('dashboard-student-search');
    const results = document.getElementById('dashboard-search-results');
    if (!input || !results) return;

    let timeout;
    input.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const query = input.value.trim();
        if (query.length < 1) {
          results.innerHTML = '';
          return;
        }
        const students = await db.searchStudents(query);
        if (students.length === 0) {
          results.innerHTML = '<div class="search-result-item"><p class="text-muted">Sonuç bulunamadı</p></div>';
          return;
        }
        results.innerHTML = students.map(s => `
          <div class="search-result-item" onclick="App.navigateTo('student-profile', { studentId: ${s.id} })">
            <div class="result-avatar">${UI.avatar()}</div>
            <div class="result-info">
              <h4>${s.firstName} ${s.lastName}</h4>
              <p>${s.schoolNumber} • ${s.className || '-'}</p>
            </div>
          </div>
        `).join('');
      }, 250);
    });
  },

  // ---- Anasayfa: Sınıf Karşılaştırma ----
  // "5/A", "7/C" gibi normalize edilmiş sınıf adını { grade: '5', section: 'A' } olarak ayırır.
  parseClassName(className) {
    if (!className) return { grade: null, section: null };
    const parts = String(className).split('/');
    if (parts.length === 2 && parts[0] && parts[1]) return { grade: parts[0], section: parts[1] };
    return { grade: null, section: null };
  },

  async onDashboardClassExamChange() {
    await this.onDashboardClassGradeChange(true);
  },

  // Deneme değiştiğinde (veya ilk yüklemede) kademe listesini o denemedeki
  // sonuçlardan yeniden kurar; keepSelection=true iken mevcut kademe seçimi
  // (varsa) korunmaya çalışılır.
  async onDashboardClassGradeChange(rebuildGrades = false) {
    const examId = parseInt(document.getElementById('dash-class-exam-select')?.value);
    const gradeSelect = document.getElementById('dash-class-grade-select');
    if (!examId || !gradeSelect) return;

    if (rebuildGrades) {
      const rankings = await db.getExamRankings(examId);
      const grades = new Set();
      rankings.forEach(r => {
        const { grade } = this.parseClassName(r.student?.className);
        if (grade) grades.add(grade);
      });
      const sortedGrades = [...grades].sort((a, b) => parseFloat(a) - parseFloat(b));
      const prevValue = gradeSelect.value;
      gradeSelect.innerHTML =
        `<option value="">Tüm Kademeler</option>` +
        sortedGrades.map(g => `<option value="${g}">${g}. Sınıflar</option>`).join('');
      if (sortedGrades.includes(prevValue)) gradeSelect.value = prevValue;
    }

    await this.refreshDashboardSectionOptions();
  },

  async refreshDashboardSectionOptions() {
    const examId = parseInt(document.getElementById('dash-class-exam-select')?.value);
    const grade = document.getElementById('dash-class-grade-select')?.value || '';
    const sectionSelect = document.getElementById('dash-class-section-select');
    if (!examId || !sectionSelect) return;

    const rankings = await db.getExamRankings(examId);
    const sections = new Set();
    rankings.forEach(r => {
      const parsed = this.parseClassName(r.student?.className);
      if (!parsed.grade) return;
      if (grade && parsed.grade !== grade) return;
      sections.add(`${parsed.grade}/${parsed.section}`);
    });
    const sortedSections = [...sections].sort();
    sectionSelect.innerHTML =
      `<option value="">Bir şube seçin (sınıf sayfasına gider)</option>` +
      sortedSections.map(s => `<option value="${s}">${s} Şubesi</option>`).join('');

    await this.renderDashboardClassComparison();
  },

  // Şube açılır menüsünden bir şube seçilince doğrudan o sınıfın kendi
  // sayfasına gidilir (öğrenci bazlı karşılaştırma artık orada).
  onDashboardClassSectionSelected() {
    const section = document.getElementById('dash-class-section-select')?.value;
    const examId = parseInt(document.getElementById('dash-class-exam-select')?.value);
    if (section) {
      this.navigateTo('class-detail', { className: section, examId });
    }
  },

  async renderDashboardClassComparison() {
    const body = document.getElementById('dash-class-comparison-body');
    const examId = parseInt(document.getElementById('dash-class-exam-select')?.value);
    const grade = document.getElementById('dash-class-grade-select')?.value || '';
    if (!body || !examId) return;

    const rankings = await db.getExamRankings(examId);

    // Şubeler her zaman sadece ORTALAMA net ile karşılaştırılır — başka
    // şubeler sadece ORTALAMA net ile karşılaştırılır — başka sınıfların
    // öğrenci bazlı verisi gösterilmez.
    const byClass = {};
    rankings.forEach(r => {
      const parsed = this.parseClassName(r.student?.className);
      if (!parsed.grade) return;
      if (grade && parsed.grade !== grade) return;
      const key = `${parsed.grade}/${parsed.section}`;
      if (!byClass[key]) byClass[key] = [];
      byClass[key].push(r.totalNet);
    });

    const classAverages = Object.entries(byClass)
      .map(([cls, nets]) => ({ cls, avg: nets.reduce((a, b) => a + b, 0) / nets.length, count: nets.length }))
      .sort((a, b) => b.avg - a.avg);

    if (classAverages.length === 0) {
      body.innerHTML = '<div class="empty-state" style="padding:20px"><p class="text-muted">Seçilen kademede sınıf bilgisi girilmiş sonuç bulunamadı</p></div>';
      return;
    }

    const maxAvg = classAverages[0].avg || 1;
    body.innerHTML = `
      <h4 style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--text-muted)">${grade ? grade + '. Sınıflar Arası' : 'Tüm Kademeler'} Ortalama Net Karşılaştırması</h4>
      ${classAverages.map((c, i) => `
        <div class="class-compare-row" onclick="App.navigateTo('class-detail', { className: '${c.cls}', examId: ${examId} })">
          <div class="rank-badge">${i + 1}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13.5px">${c.cls} <span class="text-muted" style="font-weight:400;font-size:12px">(${c.count} öğrenci)</span></div>
            <div class="class-compare-bar-track" style="margin-top:4px"><div class="class-compare-bar-fill" style="width:${Math.max(4, (c.avg / maxAvg) * 100)}%"></div></div>
          </div>
          <div class="font-mono font-bold" style="min-width:52px;text-align:right">${UI.formatNet(c.avg)}</div>
        </div>
      `).join('')}
      <p class="text-muted" style="font-size:12px;margin-top:8px">💡 Bir satıra tıklayarak o şubenin kendi sayfasına gidebilirsiniz.</p>
    `;
  },

  // ---- Sınıf Detay Sayfası ----
  // Anasayfa'daki sınıf karşılaştırmasından bir şube seçilince buraya gelinir.
  // Sol: sınıfın sıralaması. Sağ: sadece bu sınıfa ait dikkat edilmesi
  // gereken öğrenciler. Alt: seçili denemeye göre ders bazlı ortalamalar ve
  // tüm denemelerdeki sınıf net trendi. Anasayfa'ya dönüş sol menüdeki
  // "Anasayfa" öğesiyle yapılır.
  async renderClassDetail(className, examId) {
    const container = document.getElementById('page-class-detail');
    if (!className) {
      container.innerHTML = '<div class="card"><div class="empty-state"><h3>Sınıf seçilmedi</h3><p class="text-muted">Anasayfa\'daki Sınıf Karşılaştırma bölümünden bir şube seçin.</p></div></div>';
      return;
    }

    const allExams = await db.getAllExams();
    const selectedExamId = (examId && allExams.some(e => e.id === examId)) ? examId : (allExams[0]?.id || null);

    container.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h3 class="card-title"><span class="card-icon">🏫</span> ${className} Sınıfı</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <label class="form-label" style="margin:0;white-space:nowrap">Deneme:</label>
            <select class="form-select" id="class-detail-exam-select" style="width:auto" onchange="App.onClassDetailExamChange('${className}')">
              ${allExams.map(e => `<option value="${e.id}" ${selectedExamId === e.id ? 'selected' : ''}>[${EXAM_TYPE_LABELS[e.examType] || 'LGS'}] ${e.name}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="grid-2 mt-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📋</span> Sınıf Sıralaması</h3></div>
          <div id="class-detail-ranking"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">🔔</span> Dikkat Edilmesi Gerekenler</h3></div>
          <div id="class-detail-alerts"></div>
        </div>
      </div>

      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">📊</span> Ders Bazlı Ortalamalar <span class="text-muted" style="font-weight:400;font-size:12px">(seçili deneme)</span></h3></div>
        <div class="chart-container" style="height:280px"><canvas id="class-detail-subject-chart"></canvas></div>
      </div>

      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">📈</span> Sınıf Net Trendi <span class="text-muted" style="font-weight:400;font-size:12px">(tüm denemeler)</span></h3></div>
        <div class="chart-container" style="height:280px"><canvas id="class-detail-trend-chart"></canvas></div>
      </div>
    `;

    if (!selectedExamId) {
      document.getElementById('class-detail-ranking').innerHTML = '<div class="empty-state" style="padding:24px"><p class="text-muted">Henüz deneme sonucu yok</p></div>';
      return;
    }
    await this.renderClassDetailBody(className, selectedExamId);
  },

  async onClassDetailExamChange(className) {
    const examId = parseInt(document.getElementById('class-detail-exam-select')?.value);
    await this.renderClassDetailBody(className, examId);
  },

  async renderClassDetailBody(className, examId) {
    const rankingEl = document.getElementById('class-detail-ranking');
    const alertsEl = document.getElementById('class-detail-alerts');
    if (!rankingEl || !alertsEl || !examId) return;

    const [rankings, exam, allAlerts] = await Promise.all([
      db.getExamRankings(examId),
      db.getExam(examId),
      db.getAllAlerts(),
    ]);

    const classRows = rankings
      .filter(r => r.student?.className === className)
      .sort((a, b) => b.totalNet - a.totalNet);

    // ---- Sol: sınıf sıralaması ----
    if (classRows.length === 0) {
      rankingEl.innerHTML = '<div class="empty-state" style="padding:24px"><p class="text-muted">Bu sınıfın seçilen denemede sonucu yok</p></div>';
    } else {
      const maxNet = classRows[0].totalNet || 1;
      rankingEl.innerHTML = classRows.map((r, i) => `
        <div class="class-compare-row" onclick="App.navigateTo('student-profile', { studentId: ${r.studentId} })">
          <div class="rank-badge">${i + 1}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.student?.firstName || ''} ${r.student?.lastName || ''}</div>
            <div class="class-compare-bar-track" style="margin-top:4px"><div class="class-compare-bar-fill" style="width:${Math.max(4, (r.totalNet / maxNet) * 100)}%"></div></div>
          </div>
          <div class="font-mono font-bold" style="min-width:52px;text-align:right">${UI.formatNet(r.totalNet)}</div>
        </div>
      `).join('');
    }

    // ---- Sağ: sadece bu sınıfa ait uyarılar ----
    const classAlerts = allAlerts.filter(a => a.student?.className === className);
    if (classAlerts.length === 0) {
      alertsEl.innerHTML = '<div class="empty-state" style="padding:24px"><p class="text-muted">Bu sınıfta dikkat edilmesi gereken bir durum yok</p></div>';
    } else {
      alertsEl.innerHTML = classAlerts.slice(0, 15).map(alert => `
        <div class="alert-card alert-${alert.type === 'critical' ? 'critical' : alert.type === 'warning' ? 'warning' : 'success'}"
             onclick="App.navigateTo('student-profile', { studentId: ${alert.student.id} })" style="cursor:pointer">
          <div class="alert-icon">${alert.type === 'critical' ? '🔴' : alert.type === 'warning' ? '🟠' : '🟢'}</div>
          <div class="alert-content">
            <h4>${alert.student.firstName} ${alert.student.lastName}</h4>
            <p>${alert.subject.name}: ${alert.diff > 0 ? '+' : ''}${alert.diff.toFixed(2)} net (${alert.examName})</p>
          </div>
        </div>
      `).join('');
    }

    // ---- Alt: seçili denemeye göre ders bazlı sınıf ortalamaları ----
    Analysis.destroyChart('class-detail-subject-chart');
    const subjectCanvas = document.getElementById('class-detail-subject-chart');
    if (subjectCanvas && classRows.length > 0) {
      const subjects = getSubjectsForExam(exam);
      const averages = {};
      subjects.forEach(sub => {
        const vals = classRows.map(r => r.subjects?.[sub.key]?.net).filter(v => v != null);
        averages[sub.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      Analysis.renderExamSubjectBarsChart('class-detail-subject-chart', averages, exam.examType);
    }

    // ---- Alt: tüm denemelerde (aynı türden) sınıf net trendi ----
    await this.renderClassTrendChart(className, exam?.examType || 'LGS');
  },

  async renderClassTrendChart(className, examType) {
    Analysis.destroyChart('class-detail-trend-chart');
    const canvas = document.getElementById('class-detail-trend-chart');
    if (!canvas) return;

    const allExams = await db.getAllExams();
    const matchingExams = [...allExams]
      .filter(e => (e.examType || 'LGS') === examType)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const points = [];
    for (const e of matchingExams) {
      const rankings = await db.getExamRankings(e.id);
      const classRows = rankings.filter(r => r.student?.className === className);
      if (classRows.length > 0) {
        const avg = classRows.reduce((s, r) => s + r.totalNet, 0) / classRows.length;
        points.push({ name: e.name, avg: parseFloat(avg.toFixed(2)) });
      }
    }

    if (points.length === 0) {
      canvas.closest('.chart-container').innerHTML = '<div class="empty-state" style="padding:24px"><p class="text-muted">Bu sınıf için yeterli veri yok</p></div>';
      return;
    }

    Analysis.chartInstances['class-detail-trend-chart'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map(p => p.name),
        datasets: [{
          label: `${className} Ortalama Net`,
          data: points.map(p => p.avg),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.12)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#6366f1',
        }],
      },
      options: Analysis.getChartDefaults(),
    });
  },

  // ---- Students List ----
  async renderStudents() {
    const container = document.getElementById('page-students');
    const students = await db.getAllStudents();

    if (students.length === 0) {
      container.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon">👥</div>
            <h3>Henüz öğrenci eklenmedi</h3>
            <p>Veri girişi sayfasından öğrenci ekleyebilir veya Excel/PDF dosyası yükleyebilirsiniz.</p>
            <button class="btn btn-primary" onclick="App.navigateTo('import')">➕ Veri Girişi</button>
          </div>
        </div>
      `;
      return;
    }

    // Get latest exam results for each student
    const exams = await db.getAllExams();
    const latestExam = exams[0];
    let rankings = [];
    if (latestExam) {
      rankings = await db.getExamRankings(latestExam.id);
    }
    const rankMap = {};
    rankings.forEach(r => { rankMap[r.studentId] = r; });

    container.innerHTML = `
      <div class="card">
        <div class="controls-bar">
          <div class="controls-left">
            <input type="text" class="form-input" id="students-filter" placeholder="Ara..." style="width:250px" oninput="App.filterStudents(this.value)">
            <select class="filter-select" id="students-class-filter" onchange="App.filterStudentsByClass(this.value)">
              <option value="">Tüm Sınıflar</option>
              ${[...new Set(students.map(s => s.className).filter(Boolean))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="controls-right">
            <span class="text-muted">${students.length} öğrenci</span>
            <button class="btn btn-secondary btn-sm" onclick="App.showAddStudentModal()">➕ Öğrenci Ekle</button>
            <button class="btn btn-danger btn-sm" onclick="App.clearAllStudents()" title="Tüm kayıtlı öğrencileri ve sonuçlarını sil">🗑️ Tümünü Sil</button>
          </div>
        </div>

        <div id="students-table-container">
          ${this.buildStudentsTable(students, rankMap, latestExam)}
        </div>
      </div>
    `;
  },

  buildStudentsTable(students, rankMap, latestExam) {
    const columns = [
      { label: '#', render: (row, idx) => idx + 1, align: 'center' },
      { label: 'Okul No', key: 'schoolNumber' },
      { label: 'Ad Soyad', render: (row) => `
        <div style="display:flex;align-items:center;gap:10px">
          <div class="result-avatar" style="width:32px;height:32px;font-size:11px;border-radius:8px">${UI.avatar()}</div>
          <span style="font-weight:600">${row.firstName} ${row.lastName}</span>
        </div>
      `},
      { label: 'Sınıf', key: 'className' },
    ];

    if (latestExam) {
      columns.push(
        { label: `${latestExam.name} Net`, align: 'center', render: (row) => {
          const r = rankMap[row.id];
          return r ? UI.formatNet(r.totalNet) : '<span class="text-muted" style="font-size:12px">Sonuç yok</span>';
        }},
        { label: 'Sıralama', align: 'center', render: (row) => {
          const r = rankMap[row.id];
          return r ? UI.formatRank(r.rank, r.totalStudents) : '-';
        }},
      );
    }

    columns.push({
      label: 'İşlemler', align: 'center', render: (row) => `
        <div style="display:flex;gap:4px;justify-content:center;align-items:center">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); App.showAddStudentResultModal(${row.id})" title="Bu öğrenciye deneme sonucu gir">➕ Sonuç Gir</button>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); App.navigateTo('student-profile', { studentId: ${row.id} })">Profil</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); App.deleteStudent(${row.id})" title="Öğrenciyi Sil">🗑</button>
        </div>
      `
    });

    return UI.buildTable(columns, students.map(s => ({ ...s, _id: s.id })), {
      rowClick: 'App.goToStudentProfile',
    });
  },

  async filterStudents(query) {
    const students = query ? await db.searchStudents(query) : await db.getAllStudents();
    const exams = await db.getAllExams();
    const latestExam = exams[0];
    let rankings = [];
    if (latestExam) rankings = await db.getExamRankings(latestExam.id);
    const rankMap = {};
    rankings.forEach(r => { rankMap[r.studentId] = r; });

    const classFilter = document.getElementById('students-class-filter')?.value;
    const filtered = classFilter ? students.filter(s => s.className === classFilter) : students;

    document.getElementById('students-table-container').innerHTML = this.buildStudentsTable(filtered, rankMap, latestExam);
  },

  async filterStudentsByClass(className) {
    const query = document.getElementById('students-filter')?.value || '';
    let students = query ? await db.searchStudents(query) : await db.getAllStudents();
    if (className) students = students.filter(s => s.className === className);

    const exams = await db.getAllExams();
    const latestExam = exams[0];
    let rankings = [];
    if (latestExam) rankings = await db.getExamRankings(latestExam.id);
    const rankMap = {};
    rankings.forEach(r => { rankMap[r.studentId] = r; });

    document.getElementById('students-table-container').innerHTML = this.buildStudentsTable(students, rankMap, latestExam);
  },

  goToStudentProfile(studentId) {
    App.navigateTo('student-profile', { studentId });
  },

  async deleteStudent(id) {
    const ok = await UI.confirm('Bu öğrenciyi ve tüm sonuçlarını silmek istediğinize emin misiniz?');
    if (!ok) return;
    await db.deleteStudent(id);
    UI.toast('Öğrenci silindi', 'success');
    this.renderStudents();
  },

  showAddStudentModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'add-student-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>➕ Yeni Öğrenci Ekle</h2>
          <button class="modal-close" onclick="UI.closeAllModals(); document.getElementById('add-student-modal')?.remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Okul No <span style="color:var(--danger)">*</span></label>
              <input type="text" class="form-input" id="new-student-number" placeholder="Örn: 1001">
            </div>
            <div class="form-group">
              <label class="form-label">Sınıf</label>
              <input type="text" class="form-input" id="new-student-class" placeholder="Örn: 8/A">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Ad <span style="color:var(--danger)">*</span></label>
              <input type="text" class="form-input" id="new-student-firstname" placeholder="Ad">
            </div>
            <div class="form-group">
              <label class="form-label">Soyad <span style="color:var(--danger)">*</span></label>
              <input type="text" class="form-input" id="new-student-lastname" placeholder="Soyad">
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center">
          <button class="btn btn-ghost" onclick="document.getElementById('add-student-modal')?.remove()">İptal</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="App.addNewStudent(false)">Kaydet</button>
            <button class="btn btn-primary" onclick="App.addNewStudent(true)">Kaydet ve Sonuç Gir 🚀</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  async addNewStudent(enterResultAfter = false) {
    const schoolNumber = document.getElementById('new-student-number')?.value?.trim();
    const firstName = document.getElementById('new-student-firstname')?.value?.trim();
    const lastName = document.getElementById('new-student-lastname')?.value?.trim();
    const className = document.getElementById('new-student-class')?.value?.trim();

    if (!schoolNumber || !firstName || !lastName) {
      UI.toast('Okul no, ad ve soyad zorunludur', 'warning');
      return;
    }

    const studentId = await db.addStudent({ schoolNumber, firstName, lastName, className });
    UI.toast('Öğrenci eklendi!', 'success');
    document.getElementById('add-student-modal')?.remove();
    await this.renderStudents();

    if (enterResultAfter && studentId) {
      this.showAddStudentResultModal(studentId);
    }
  },

  // ---- Student Profile ----
  async renderStudentProfile(studentId) {
    const container = document.getElementById('page-student-profile');
    this.currentStudentId = Number(studentId);

    if (!studentId) {
      container.innerHTML = '<div class="card"><div class="empty-state"><h3>Öğrenci seçilmedi</h3></div></div>';
      return;
    }

    const student = await db.getStudent(studentId);
    if (!student) {
      container.innerHTML = '<div class="card"><div class="empty-state"><h3>Öğrenci bulunamadı</h3></div></div>';
      return;
    }

    const trend = await db.getStudentTrend(studentId);
    const alerts = await db.getStudentAlerts(studentId);
    const exams = await db.getAllExams();

    // Update page title
    document.getElementById('page-title').innerHTML = `Öğrenci Profili <span>${student.firstName} ${student.lastName}</span>`;

    const hasResults = trend && trend.length > 0;

    container.innerHTML = `
      <!-- Profile Header -->
      <div class="card">
        <div class="profile-header">
          <div class="profile-avatar">${UI.avatar()}</div>
          <div class="profile-info">
            <h2>${student.firstName} ${student.lastName}</h2>
            <p>Okul No: ${student.schoolNumber}</p>
            <div class="profile-meta">
              <div class="meta-item">📚 Sınıf: <strong>${student.className || '-'}</strong></div>
              <div class="meta-item">📝 Toplam: <strong>${trend.length} Deneme</strong></div>
              ${hasResults ? `<div class="meta-item">📊 Son Net: <strong>${trend[trend.length - 1].totalNet.toFixed(2)}</strong></div>` : ''}
            </div>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-primary" onclick="App.showAddStudentResultModal(${studentId})">➕ Deneme Sonucu Ekle</button>
            <button class="btn btn-secondary btn-sm" onclick="ExportModule.generateStudentReport(${studentId})">📄 PDF İndir</button>
            <button class="btn btn-secondary btn-sm" onclick="ExportModule.generateShareableLink(${studentId})">🔗 Paylaş</button>
          </div>
        </div>
      </div>

      <!-- No Results Notice (if empty) -->
      ${!hasResults ? `
      <div class="card mt-2" style="background:linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.04));border:1px solid rgba(99,102,241,0.25);padding:32px 24px;text-align:center;">
        <div style="font-size:40px;margin-bottom:12px">📊</div>
        <h3 style="font-size:18px;font-weight:700;margin-bottom:8px">Bu Öğrenci İçin Henüz Deneme Sonucu Bulunmuyor</h3>
        <p class="text-muted" style="max-width:540px;margin:0 auto 20px;font-size:14px;line-height:1.6">
          Öğrenci kaydı başarıyla oluşturuldu. Netleri, ders analizi, genel sıralaması ve başarı grafiklerinin görünmesi için hemen bir deneme sınavı sonucu ekleyin.
        </p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-lg" onclick="App.showAddStudentResultModal(${studentId})">➕ Bu Öğrenciye İlk Deneme Sonucunu Ekle</button>
          <button class="btn btn-secondary btn-lg" onclick="App.navigateTo('import')">📥 Excel / PDF İle Toplu Yükle</button>
        </div>
      </div>
      ` : ''}

      <!-- Alerts -->
      ${alerts.length > 0 ? `
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🔔</span> Uyarılar & Gelişim Bildirimleri</h3>
        </div>
        ${alerts.map(alert => `
          <div class="alert-card alert-${alert.type === 'critical' ? 'critical' : alert.type === 'warning' ? 'warning' : 'success'}">
            <div class="alert-icon">${alert.type === 'critical' ? '🔴' : alert.type === 'warning' ? '🟠' : '🟢'}</div>
            <div class="alert-content">
              <h4>${alert.subject.name}</h4>
              <p>${alert.diff > 0 ? '+' : ''}${alert.diff.toFixed(2)} net değişim (${alert.prevNet.toFixed(2)} → ${alert.currNet.toFixed(2)}) - ${alert.examName}</p>
            </div>
            ${UI.alertBadge(alert.type)}
          </div>
        `).join('')}
      </div>
      ` : ''}

      <!-- Exam Selector & Results -->
      <div class="grid-2 mt-2">
        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <h3 class="card-title"><span class="card-icon">📝</span> Deneme Sonuçları</h3>
            <button class="btn btn-primary btn-sm" onclick="App.showAddStudentResultModal(${studentId})">➕ Sonuç Gir</button>
          </div>
          <div class="form-group">
            <label class="form-label">Deneme Seçin</label>
            <select class="form-select" id="profile-exam-select" onchange="App.onProfileExamChange(${studentId})">
              <option value="">-- Tüm Denemelerin Özeti --</option>
              ${exams.map(e => `<option value="${e.id}">[${EXAM_TYPE_LABELS[e.examType] || 'LGS'}] ${e.name} (${UI.formatDate(e.date)})</option>`).join('')}
            </select>
          </div>
          <div id="profile-exam-detail">
            ${this.buildProfileAllExamsTable(trend)}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📊</span> Performans Grafiği</h3>
          </div>
          <div id="profile-chart-container">
            ${hasResults ? `
              <div class="chart-container" style="height:300px">
                <canvas id="profile-radar-chart"></canvas>
              </div>
            ` : '<div class="empty-state" style="padding:40px"><div style="font-size:32px;margin-bottom:8px">📈</div><p class="text-muted">Grafik için en az 1 deneme sonucu gereklidir.</p></div>'}
          </div>
        </div>
      </div>

      <!-- Subject Trend -->
      ${hasResults ? `
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📈</span> Ders Bazlı Trend Analizi</h3>
          <select class="filter-select" id="profile-subject-select" onchange="App.onProfileSubjectChange(${studentId})">
            <option value="all">Tüm Dersler</option>
            ${getSubjectsForExam(trend[trend.length - 1].exam).map(s => `<option value="${s.key}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="chart-container" style="height:350px">
          <canvas id="profile-subject-trend"></canvas>
        </div>
        ${trend.length >= 2 ? this.buildSubjectComparisonTable(trend) : ''}
      </div>
      ` : ''}
    `;

    // Render charts
    if (hasResults) {
      const lastResult = trend[trend.length - 1];
      const lastExamAvg = await db.getExamAverages(lastResult.examId);
      Analysis.renderRadarChart('profile-radar-chart', lastResult, lastExamAvg, lastResult.exam.examType);
      Analysis.renderAllSubjectsTrendChart('profile-subject-trend', trend);
    }
  },

  buildProfileAllExamsTable(trend) {
    if (!trend || trend.length === 0) return '<div class="empty-state" style="padding:30px"><p class="text-muted">Henüz kayıtlı deneme sonucu yok</p></div>';

    // Farklı sınav türlerinin (LGS/TYT/AYT...) ders setleri karşılaştırılamaz
    // ölçeklerde olduğu için tek tabloda birleştirilmez; her tür kendi mini
    // tablosunda, en son deneme en üstte olacak şekilde gösterilir.
    const groups = new Map(); // examType -> rows
    trend.forEach(row => {
      const type = row.exam.examType || 'LGS';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(row);
    });

    // Grupları, o türdeki en son denemenin tarihine göre en yeniden en eskiye sırala
    const orderedTypes = [...groups.keys()].sort((a, b) => {
      const lastA = groups.get(a)[groups.get(a).length - 1];
      const lastB = groups.get(b)[groups.get(b).length - 1];
      return new Date(lastB.exam.date) - new Date(lastA.exam.date);
    });

    return orderedTypes.map(type => {
      const rows = groups.get(type);
      const subjects = getSubjectsForExam(type);
      const columns = [
        { label: 'Deneme', render: (row) => `<strong>${row.exam.name}</strong>` },
        ...subjects.map(sub => ({
          label: sub.name.substring(0, 6),
          align: 'center',
          render: (row) => UI.formatNet(row.subjects?.[sub.key]?.net),
        })),
        { label: 'Toplam', align: 'center', render: (row) => `<strong>${UI.formatNet(row.totalNet)}</strong>` },
        { label: 'İşlem', align: 'center', render: (row) => `
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); App.showAddStudentResultModal(${row.studentId}, ${row.examId})" title="Sonucu Düzenle">✏️</button>
        `}
      ];
      return `
        ${groups.size > 1 ? `<h4 style="font-size:13px;font-weight:700;margin:14px 0 8px;color:var(--text-muted)">${EXAM_TYPE_LABELS[type] || type} Denemeleri (${rows.length})</h4>` : ''}
        ${UI.buildTable(columns, [...rows].reverse())}
      `;
    }).join('');
  },

  buildSubjectComparisonTable(trend) {
    if (trend.length < 2) return '';

    const latest = trend[trend.length - 1];
    // Aynı sınav türünden en yakın önceki sonucu bul (ör. LGS'yi TYT ile karşılaştırma)
    const prev = [...trend].reverse().slice(1).find(t => (t.exam.examType || 'LGS') === (latest.exam.examType || 'LGS'));
    if (!prev) {
      return `
        <div class="mt-2">
          <h4 style="font-size:14px;font-weight:600;margin-bottom:12px">Son İki Deneme Karşılaştırma</h4>
          <div class="empty-state" style="padding:20px"><p class="text-muted">Bu sınav türü (${EXAM_TYPE_LABELS[latest.exam.examType] || 'LGS'}) için karşılaştırmalı yeterli veri yok</p></div>
        </div>
      `;
    }

    let rows = getSubjectsForExam(latest.exam).map(sub => {
      const currNet = latest.subjects?.[sub.key]?.net || 0;
      const prevNet = prev.subjects?.[sub.key]?.net || 0;
      const diff = currNet - prevNet;
      return { subject: sub, currNet, prevNet, diff };
    });

    const columns = [
      { label: 'Ders', render: (row) => UI.subjectBadge(row.subject.key) },
      { label: 'Önceki Net', align: 'center', render: (row) => UI.formatNet(row.prevNet) },
      { label: 'Son Net', align: 'center', render: (row) => UI.formatNet(row.currNet) },
      { label: 'Değişim', align: 'center', render: (row) => UI.formatTrend(row.diff) },
      { label: 'Durum', align: 'center', render: (row) => {
        if (row.diff <= -3) return UI.alertBadge('critical');
        if (row.diff < -1) return UI.alertBadge('warning');
        if (row.diff >= 2) return UI.alertBadge('success');
        return UI.alertBadge('info');
      }},
    ];

    return `
      <div class="mt-2">
        <h4 style="font-size:14px;font-weight:600;margin-bottom:12px">Son İki Deneme Karşılaştırma</h4>
        ${UI.buildTable(columns, rows)}
      </div>
    `;
  },

  async onProfileExamChange(studentId) {
    const examId = parseInt(document.getElementById('profile-exam-select')?.value);
    const detailContainer = document.getElementById('profile-exam-detail');
    const chartContainer = document.getElementById('profile-chart-container');

    if (!examId) {
      // Show all exams
      const trend = await db.getStudentTrend(studentId);
      detailContainer.innerHTML = this.buildProfileAllExamsTable(trend);
      if (trend.length > 0) {
        const lastResult = trend[trend.length - 1];
        const lastExamAvg = await db.getExamAverages(lastResult.examId);
        chartContainer.innerHTML = '<div class="chart-container" style="height:300px"><canvas id="profile-radar-chart"></canvas></div>';
        Analysis.renderRadarChart('profile-radar-chart', lastResult, lastExamAvg, lastResult.exam.examType);
      } else {
        chartContainer.innerHTML = '<div class="empty-state" style="padding:40px"><div style="font-size:32px;margin-bottom:8px">📈</div><p class="text-muted">Grafik için en az 1 deneme sonucu gereklidir.</p></div>';
      }
      return;
    }

    const result = await db.getResult(studentId, examId);
    const selectedExam = await db.getExam(examId);
    const examName = selectedExam ? selectedExam.name : 'Bu Deneme';

    if (!result) {
      detailContainer.innerHTML = `
        <div style="padding:24px;text-align:center;background:rgba(255,255,255,0.02);border-radius:12px;border:1px dashed var(--bg-glass-border);margin-top:8px">
          <p class="text-muted" style="margin-bottom:12px;font-size:14px">Öğrencinin <strong>${examName}</strong> için kayıtlı sonucu bulunmuyor.</p>
          <button class="btn btn-primary btn-sm" onclick="App.showAddStudentResultModal(${studentId}, ${examId})">➕ ${examName} Sonucunu Gir</button>
        </div>
      `;
      chartContainer.innerHTML = `<div class="empty-state" style="padding:40px"><p class="text-muted">${examName} için sonuç bulunamadı.</p></div>`;
      return;
    }

    const rankings = await db.getExamRankings(examId);
    const myRank = rankings.find(r => r.studentId === studentId);
    const averages = await db.getExamAverages(examId);

    // Build detail table
    const columns = [
      { label: 'Ders', render: (row) => UI.subjectBadge(row.key) },
      { label: 'Doğru', align: 'center', render: (row) => `<span class="text-success font-mono">${row.correct}</span>` },
      { label: 'Yanlış', align: 'center', render: (row) => `<span class="text-danger font-mono">${row.wrong}</span>` },
      { label: 'Boş', align: 'center', render: (row) => `<span class="text-muted font-mono">${row.blank}</span>` },
      { label: 'Net', align: 'center', render: (row) => UI.formatNet(row.net) },
      { label: 'Ort.', align: 'center', render: (row) => `<span class="text-muted font-mono">${(averages?.[row.key] || 0).toFixed(2)}</span>` },
    ];

    const rows = getSubjectsForExam(selectedExam).map(sub => ({
      key: sub.key,
      ...result.subjects[sub.key],
    }));

    detailContainer.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div class="badge badge-purple" style="font-size:14px;padding:8px 14px">
            🏆 Sıralama: <strong>${myRank ? `${myRank.rank} / ${myRank.totalStudents}` : '-'}</strong>
          </div>
          <div class="badge badge-info" style="font-size:14px;padding:8px 14px">
            📊 Toplam Net: <strong>${UI.formatNet(db.calcTotalNet(result))}</strong>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="App.showAddStudentResultModal(${studentId}, ${examId})">✏️ Düzenle</button>
          <button class="btn btn-danger btn-sm" onclick="App.deleteStudentResult(${studentId}, ${examId})">🗑️ Sil</button>
        </div>
      </div>
      ${UI.buildTable(columns, rows)}
    `;

    // Update radar chart
    chartContainer.innerHTML = '<div class="chart-container" style="height:300px"><canvas id="profile-radar-chart"></canvas></div>';
    Analysis.renderRadarChart('profile-radar-chart', result, averages, selectedExam.examType);
  },

  async deleteStudentResult(studentId, examId) {
    const ok = await UI.confirm('Bu deneme sonucunu silmek istediğinize emin misiniz?');
    if (!ok) return;
    await db.deleteResultByStudentAndExam(studentId, examId);
    UI.toast('Deneme sonucu silindi', 'success');
    this.renderStudentProfile(studentId);
  },

  // ---- Modal for Entering/Editing Student Result ----
  async showAddStudentResultModal(studentId, defaultExamId = null) {
    const student = await db.getStudent(studentId);
    if (!student) {
      UI.toast('Öğrenci bulunamadı', 'danger');
      return;
    }

    const exams = await db.getAllExams();
    let selectedExamId = defaultExamId || (exams.length > 0 ? exams[0].id : null);
    let existingResult = selectedExamId ? await db.getResult(studentId, selectedExamId) : null;
    const selectedExam = selectedExamId ? exams.find(e => e.id === selectedExamId) : null;
    this._modalActiveExamType = selectedExam?.examType || 'LGS';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'add-student-result-modal';

    const subjectInputsHtml = this.buildModalSubjectInputsHtml(this._modalActiveExamType, existingResult);

    overlay.innerHTML = `
      <div class="modal" style="max-width:740px;max-height:90vh;overflow-y:auto">
        <div class="modal-header">
          <div>
            <h2 style="font-size:18px">📝 Deneme Sonucu Girişi</h2>
            <p class="text-muted" style="font-size:13px;margin-top:2px">
              Öğrenci: <strong style="color:var(--text-primary)">${student.firstName} ${student.lastName}</strong> (${student.schoolNumber} • ${student.className || '-'})
            </p>
          </div>
          <button class="modal-close" onclick="document.getElementById('add-student-result-modal')?.remove()">✕</button>
        </div>
        <div class="modal-body" style="padding-top:10px">
          <div class="form-row" style="margin-bottom:16px">
            <div class="form-group" style="flex:2">
              <label class="form-label">Deneme Sınavı <span style="color:var(--danger)">*</span></label>
              <select class="form-select" id="modal-result-exam-select" onchange="App.onModalExamSelectChange(${studentId})">
                <option value="">-- Deneme Seçin --</option>
                ${exams.map(e => `<option value="${e.id}" ${selectedExamId === e.id ? 'selected' : ''}>${e.name} (${UI.formatDate(e.date)})</option>`).join('')}
                <option value="__new__">➕ + Yeni Deneme Sınavı Oluştur...</option>
              </select>
            </div>
            <div class="form-group" id="modal-new-exam-group" style="flex:2;display:none">
              <label class="form-label">Yeni Deneme Adı <span style="color:var(--danger)">*</span></label>
              <input type="text" class="form-input" id="modal-new-exam-name" placeholder="Örn: 1. Deneme">
            </div>
          </div>
          <div class="form-row" id="modal-new-exam-type-row" style="margin-bottom:16px;display:none">
            <div class="form-group" style="flex:2">
              <label class="form-label">Yeni Denemenin Sınav Türü</label>
              <select class="form-select" id="modal-new-exam-type" onchange="App.onModalNewExamTypeChange(${studentId})">
                ${Object.keys(EXAM_TYPE_LABELS).map(t => `<option value="${t}">${EXAM_TYPE_LABELS[t]}</option>`).join('')}
              </select>
            </div>
          </div>

          <div id="modal-subject-inputs-container" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
            ${subjectInputsHtml}
          </div>

          <div style="margin-top:16px;padding:14px 18px;background:rgba(99,102,241,0.08);border-radius:12px;border:1px solid rgba(99,102,241,0.2);display:flex;align-items:center;justify-content:space-between">
            <span style="font-weight:600;font-size:14px">Toplam Net:</span>
            <span class="font-mono font-bold" id="modal-result-total-net" style="font-size:22px;color:var(--accent-primary-light)">0.00</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('add-student-result-modal')?.remove()">İptal</button>
          <button class="btn btn-primary btn-lg" onclick="App.saveStudentResultFromModal(${studentId})">💾 Sonucu Kaydet</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.calcModalResultNets();
  },

  // Ders kartlarını (Doğru/Yanlış/Net giriş grupları) verilen sınav türü ve
  // (varsa) mevcut sonuca göre üretir. Sonuç ekleme/düzenleme modalı, exam
  // seçimi değiştiğinde bu HTML'i komple yeniden oluşturur (değer doldurmak
  // yerine), çünkü farklı türlerin ders sayısı/isimleri tamamen farklıdır.
  buildModalSubjectInputsHtml(examType, existingResult) {
    return getSubjectsForExam(examType).map(sub => {
      const subRes = existingResult?.subjects?.[sub.key] || {};
      const c = subRes.correct ?? 0;
      const w = subRes.wrong ?? 0;
      const n = subRes.net ?? 0;
      return `
        <div class="card" style="padding:14px;background:rgba(255,255,255,0.03);margin-bottom:0;border:1px solid var(--bg-glass-border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            ${UI.subjectBadge(sub.key)}
            <span class="text-muted" style="font-size:11px">${sub.questions} Soru</span>
          </div>
          <div class="form-row" style="grid-template-columns:1fr 1fr 1fr;gap:8px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label" style="font-size:12px">Doğru</label>
              <input type="number" class="form-input modal-sub-correct" id="modal-sub-${sub.key}-correct" min="0" max="${sub.questions}" value="${c}" oninput="App.calcModalResultNets()">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label" style="font-size:12px">Yanlış</label>
              <input type="number" class="form-input modal-sub-wrong" id="modal-sub-${sub.key}-wrong" min="0" max="${sub.questions}" value="${w}" oninput="App.calcModalResultNets()">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label" style="font-size:12px">Net</label>
              <input type="text" class="form-input font-mono" id="modal-sub-${sub.key}-net" value="${Number(n).toFixed(2)}" readonly style="background:rgba(99,102,241,0.08);color:var(--accent-primary-light);font-weight:600">
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  async onModalExamSelectChange(studentId) {
    const sel = document.getElementById('modal-result-exam-select');
    const newGroup = document.getElementById('modal-new-exam-group');
    const newTypeRow = document.getElementById('modal-new-exam-type-row');
    const inputsContainer = document.getElementById('modal-subject-inputs-container');
    if (!sel) return;

    if (sel.value === '__new__') {
      if (newGroup) newGroup.style.display = '';
      if (newTypeRow) newTypeRow.style.display = '';
      this._modalActiveExamType = document.getElementById('modal-new-exam-type')?.value || 'LGS';
      if (inputsContainer) inputsContainer.innerHTML = this.buildModalSubjectInputsHtml(this._modalActiveExamType, null);
      this.calcModalResultNets();
      return;
    }
    if (newGroup) newGroup.style.display = 'none';
    if (newTypeRow) newTypeRow.style.display = 'none';

    const examId = parseInt(sel.value);
    if (examId) {
      const [existing, exam] = await Promise.all([
        db.getResult(studentId, examId),
        db.getExam(examId),
      ]);
      this._modalActiveExamType = exam?.examType || 'LGS';
      if (inputsContainer) inputsContainer.innerHTML = this.buildModalSubjectInputsHtml(this._modalActiveExamType, existing);
      this.calcModalResultNets();
    }
  },

  // Yeni deneme oluşturma akışında kullanıcı tür seçimini değiştirdiğinde
  // ders kartlarını o türe göre yeniden oluşturur.
  onModalNewExamTypeChange() {
    this._modalActiveExamType = document.getElementById('modal-new-exam-type')?.value || 'LGS';
    const inputsContainer = document.getElementById('modal-subject-inputs-container');
    if (inputsContainer) inputsContainer.innerHTML = this.buildModalSubjectInputsHtml(this._modalActiveExamType, null);
    this.calcModalResultNets();
  },

  calcModalResultNets() {
    let totalNet = 0;
    getSubjectsForExam(this._modalActiveExamType).forEach(sub => {
      const c = parseInt(document.getElementById(`modal-sub-${sub.key}-correct`)?.value) || 0;
      const w = parseInt(document.getElementById(`modal-sub-${sub.key}-wrong`)?.value) || 0;
      const net = c - w / 3;
      const netEl = document.getElementById(`modal-sub-${sub.key}-net`);
      if (netEl) netEl.value = net.toFixed(2);
      totalNet += net;
    });
    const totalEl = document.getElementById('modal-result-total-net');
    if (totalEl) totalEl.textContent = totalNet.toFixed(2);
  },

  async saveStudentResultFromModal(studentId) {
    const sel = document.getElementById('modal-result-exam-select');
    if (!sel) return;

    let examId = sel.value;
    if (!examId) {
      UI.toast('Lütfen bir deneme seçin veya oluşturun', 'warning');
      return;
    }

    if (examId === '__new__') {
      const newName = document.getElementById('modal-new-exam-name')?.value?.trim();
      if (!newName) {
        UI.toast('Lütfen yeni deneme adını girin', 'warning');
        return;
      }
      const examType = document.getElementById('modal-new-exam-type')?.value || 'LGS';
      examId = await db.addExam({
        name: newName,
        date: new Date().toISOString().split('T')[0],
        examType,
      });
    }

    const subjects = {};
    getSubjectsForExam(this._modalActiveExamType).forEach(sub => {
      subjects[sub.key] = {
        correct: parseInt(document.getElementById(`modal-sub-${sub.key}-correct`)?.value) || 0,
        wrong: parseInt(document.getElementById(`modal-sub-${sub.key}-wrong`)?.value) || 0,
      };
    });

    await db.addResult({
      studentId: Number(studentId),
      examId: Number(examId),
      subjects,
    });

    UI.toast('Deneme sonucu başarıyla kaydedildi!', 'success');
    document.getElementById('add-student-result-modal')?.remove();

    if (this.currentPage === 'student-profile') {
      await this.renderStudentProfile(studentId);
    } else if (this.currentPage === 'students') {
      await this.renderStudents();
    } else {
      this.refreshCurrentPage();
    }
  },

  async onProfileSubjectChange(studentId) {
    const subjectKey = document.getElementById('profile-subject-select')?.value;
    const trend = await db.getStudentTrend(studentId);

    Analysis.destroyChart('profile-subject-trend');

    if (subjectKey === 'all') {
      Analysis.renderAllSubjectsTrendChart('profile-subject-trend', trend);
    } else {
      // Sadece bu dersin gerçekten var olduğu (aynı sınav türünden) denemeleri çiz
      const sameSubjectTrend = trend.filter(t => t.subjects && Object.prototype.hasOwnProperty.call(t.subjects, subjectKey));
      Analysis.renderSubjectTrendChart('profile-subject-trend', sameSubjectTrend, subjectKey);
    }
  },

  // ---- Exams List ----
  async renderExams() {
    const container = document.getElementById('page-exams');
    const [exams, averagesMap] = await Promise.all([
      db.getAllExams(),
      db.getAllExamsAverages()
    ]);

    if (exams.length === 0) {
      container.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon">📝</div>
            <h3>Henüz deneme eklenmedi</h3>
            <p>Veri girişi sayfasından deneme ekleyebilirsiniz.</p>
            <button class="btn btn-primary" onclick="App.navigateTo('import')">➕ Veri Girişi</button>
          </div>
        </div>
      `;
      return;
    }

    let examsHtml = '';
    for (const exam of exams) {
      const avg = averagesMap[exam.id];
      examsHtml += `
        <div class="stat-card" style="cursor:pointer" onclick="App.navigateTo('exam-detail', { examId: ${exam.id} })">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div>
              <h3 style="font-size:16px;font-weight:700">${exam.name}</h3>
              <p class="text-muted" style="font-size:13px">${UI.formatDate(exam.date)} · <span class="badge badge-info" style="font-size:10px;padding:1px 6px">${EXAM_TYPE_LABELS[exam.examType] || 'LGS'}</span></p>
            </div>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); App.deleteExam(${exam.id})" title="Sil">🗑</button>
          </div>
          ${avg ? `
            <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap">
              <div>
                <span class="text-muted" style="font-size:11px">Öğrenci</span>
                <div style="font-size:18px;font-weight:700">${avg.studentCount}</div>
              </div>
              <div>
                <span class="text-muted" style="font-size:11px">Ort. Net</span>
                <div style="font-size:18px;font-weight:700">${avg.totalNet.toFixed(1)}</div>
              </div>
            </div>
          ` : '<p class="text-muted mt-1" style="font-size:12px">Sonuç yok</p>'}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="controls-bar">
        <h3 style="font-size:16px;font-weight:600">Tüm Denemeler</h3>
        <button class="btn btn-primary btn-sm" onclick="App.showAddExamModal()">➕ Yeni Deneme</button>
      </div>
      <div class="stats-grid">
        ${examsHtml}
      </div>
    `;
  },

  async deleteExam(id) {
    const ok = await UI.confirm('Bu denemeyi ve tüm sonuçlarını silmek istediğinize emin misiniz?');
    if (!ok) return;
    await db.deleteExam(id);
    UI.toast('Deneme silindi', 'success');
    this.renderExams();
  },

  showAddExamModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'add-exam-modal';
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2>📝 Yeni Deneme Oluştur</h2>
          <button class="modal-close" onclick="document.getElementById('add-exam-modal')?.remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Deneme Adı <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-input" id="new-exam-name" placeholder="Örn: 1. Deneme">
          </div>
          <div class="form-group">
            <label class="form-label">Sınav Türü</label>
            <select class="form-select" id="new-exam-type">
              ${Object.keys(EXAM_TYPE_LABELS).map(t => `<option value="${t}">${EXAM_TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tarih</label>
            <input type="date" class="form-input" id="new-exam-date" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Açıklama (Opsiyonel)</label>
            <input type="text" class="form-input" id="new-exam-desc" placeholder="Açıklama...">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('add-exam-modal')?.remove()">İptal</button>
          <button class="btn btn-primary" onclick="App.addNewExam()">Oluştur</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  async addNewExam() {
    const name = document.getElementById('new-exam-name')?.value?.trim();
    const date = document.getElementById('new-exam-date')?.value;
    const description = document.getElementById('new-exam-desc')?.value?.trim();
    const examType = document.getElementById('new-exam-type')?.value || 'LGS';

    if (!name) {
      UI.toast('Deneme adı zorunludur', 'warning');
      return;
    }

    await db.addExam({ name, date: date || new Date().toISOString().split('T')[0], description, examType });
    UI.toast('Deneme oluşturuldu!', 'success');
    document.getElementById('add-exam-modal')?.remove();
    this.renderExams();
  },

  // ---- Exam Detail ----
  async renderExamDetail(examId) {
    const container = document.getElementById('page-exam-detail');

    if (!examId) {
      container.innerHTML = '<div class="card"><div class="empty-state"><h3>Deneme seçilmedi</h3></div></div>';
      return;
    }

    const exam = await db.getExam(examId);
    if (!exam) {
      container.innerHTML = '<div class="card"><div class="empty-state"><h3>Deneme bulunamadı</h3></div></div>';
      return;
    }

    const rankings = await db.getExamRankings(examId);
    const averages = await db.getExamAverages(examId);

    document.getElementById('page-title').innerHTML = `Deneme Detayı <span>${exam.name}</span>`;

    container.innerHTML = `
      <!-- Exam Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon purple">📝</div>
          <div class="stat-value">${rankings.length}</div>
          <div class="stat-label">Öğrenci Sayısı</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">📊</div>
          <div class="stat-value">${averages ? averages.totalNet.toFixed(1) : '-'}</div>
          <div class="stat-label">Ortalama Net</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">🏆</div>
          <div class="stat-value">${rankings.length > 0 ? rankings[0].totalNet.toFixed(1) : '-'}</div>
          <div class="stat-label">En Yüksek Net</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange">📅</div>
          <div class="stat-value" style="font-size:20px">${UI.formatDate(exam.date)}</div>
          <div class="stat-label">Deneme Tarihi</div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Subject Averages Chart -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📊</span> Ders Ortalamaları</h3>
          </div>
          <div class="chart-container" style="height:280px">
            <canvas id="exam-subject-chart"></canvas>
          </div>
        </div>

        <!-- Subject Stats -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📋</span> Ders Bazlı İstatistik</h3>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Ders</th><th style="text-align:center">Ort. Net</th><th style="text-align:center">Soru</th></tr>
              </thead>
              <tbody>
                ${getSubjectsForExam(exam).map(sub => `
                  <tr>
                    <td>${UI.subjectBadge(sub.key)}</td>
                    <td style="text-align:center">${UI.formatNet(averages?.[sub.key])}</td>
                    <td style="text-align:center" class="text-muted">${sub.questions}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Rankings Table -->
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🏆</span> Sıralama</h3>
          <button class="btn btn-secondary btn-sm" onclick="ExportModule.generateExamReport(${examId})">📄 PDF İndir</button>
        </div>
        ${this.buildExamRankingsTable(rankings, exam)}
      </div>
    `;

    // Render chart
    if (averages) {
      Analysis.renderExamSubjectBarsChart('exam-subject-chart', averages, exam.examType);
    }
  },

  buildExamRankingsTable(rankings, exam) {
    const columns = [
      { label: 'Sıra', align: 'center', render: (row) => {
        const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : '';
        return `${medal} ${row.rank}`;
      }},
      { label: 'Okul No', render: (row) => row.student?.schoolNumber || '-' },
      { label: 'Ad Soyad', render: (row) => `
        <div style="display:flex;align-items:center;gap:8px">
          <div class="result-avatar" style="width:28px;height:28px;font-size:10px;border-radius:6px">${UI.avatar()}</div>
          <strong>${row.student?.firstName || ''} ${row.student?.lastName || ''}</strong>
        </div>
      `},
      { label: 'Sınıf', render: (row) => row.student?.className || '-' },
      ...getSubjectsForExam(exam).map(sub => ({
        label: sub.name.substring(0, 6),
        align: 'center',
        render: (row) => UI.formatNet(row.subjects?.[sub.key]?.net),
      })),
      { label: 'Toplam', align: 'center', render: (row) => `<strong>${UI.formatNet(row.totalNet)}</strong>` },
      { label: '', align: 'center', render: (row) => `
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); App.navigateTo('student-profile', { studentId: ${row.studentId} })">Profil</button>
      `},
    ];

    return UI.buildTable(columns, rankings);
  },

  // ---- Import Page ----
  async renderImport() {
    const container = document.getElementById('page-import');
    container.innerHTML = ImportModule.render();
    ImportModule.init();
  },

  // ---- Reports Page ----
  async renderReports() {
    const container = document.getElementById('page-reports');
    const exams = await db.getAllExams();
    const students = await db.getAllStudents();

    container.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📄</span> Öğrenci Raporu</h3>
          </div>
          <p class="text-muted mb-2" style="font-size:13px">Bir öğrenci seçerek detaylı PDF rapor oluşturabilirsiniz.</p>
          <div class="form-group">
            <label class="form-label">Öğrenci Ara</label>
            <input type="text" class="form-input" id="report-student-search" placeholder="Ad, soyad veya okul no...">
          </div>
          <div id="report-student-results"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📊</span> Deneme Raporu</h3>
          </div>
          <p class="text-muted mb-2" style="font-size:13px">Bir deneme seçerek sınıf geneli sonuç raporunu PDF olarak indirebilirsiniz.</p>
          <div class="form-group">
            <label class="form-label">Deneme Seçin</label>
            <select class="form-select" id="report-exam-select">
              <option value="">-- Seçin --</option>
              ${exams.map(e => `<option value="${e.id}">${e.name} (${UI.formatDate(e.date)})</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary mt-1" onclick="App.downloadExamReport()">📄 PDF İndir</button>
        </div>
      </div>

      <div class="grid-2 mt-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">💾</span> Veri Yedekleme</h3>
          </div>
          <p class="text-muted mb-2" style="font-size:13px">Tüm verilerinizi JSON formatında dışa aktararak yedekleyin.</p>
          <button class="btn btn-secondary" onclick="ExportModule.exportAllData()">📥 JSON Olarak İndir</button>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📤</span> Veri Geri Yükleme</h3>
          </div>
          <p class="text-muted mb-2" style="font-size:13px">Daha önce dışa aktardığınız JSON dosyasından verileri geri yükleyin.</p>
          <input type="file" id="import-json-input" accept=".json" style="display:none" onchange="App.importJSONFile(event)">
          <button class="btn btn-secondary" onclick="document.getElementById('import-json-input').click()">📤 JSON Dosyası Yükle</button>
        </div>
      </div>
    `;

    // Student report search
    const searchInput = document.getElementById('report-student-search');
    if (searchInput) {
      let timeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          const query = searchInput.value.trim();
          const resultsDiv = document.getElementById('report-student-results');
          if (query.length < 1) { resultsDiv.innerHTML = ''; return; }

          const found = await db.searchStudents(query);
          resultsDiv.innerHTML = found.map(s => `
            <div class="search-result-item" onclick="ExportModule.generateStudentReport(${s.id})" style="border-radius:8px;margin-bottom:4px;border:1px solid var(--bg-glass-border);cursor:pointer">
              <div class="result-avatar">${UI.avatar()}</div>
              <div class="result-info">
                <h4>${s.firstName} ${s.lastName}</h4>
                <p>${s.schoolNumber}</p>
              </div>
              <span class="btn btn-secondary btn-sm">📄 PDF</span>
            </div>
          `).join('');
        }, 300);
      });
    }
  },

  async downloadExamReport() {
    const examId = parseInt(document.getElementById('report-exam-select')?.value);
    if (!examId) { UI.toast('Lütfen bir deneme seçin', 'warning'); return; }
    await ExportModule.generateExamReport(examId);
  },

  async importJSONFile(event) {
    const file = event.target.files[0];
    if (file) await ExportModule.importFromJSON(file);
  },

  // ---- Settings Page ----
  async renderSettings() {
    const container = document.getElementById('page-settings');
    const studentCount = await db.getStudentCount();
    const examCount = await db.getExamCount();
    const resultCount = await db.getResultCount();

    const isConnected = typeof SyncModule !== 'undefined' && SyncModule.isConnected();
    const autoSync = typeof SyncModule !== 'undefined' && SyncModule.autoSync;
    const syncKey = typeof SyncModule !== 'undefined' ? (SyncModule.syncKey || '') : '';
    const lastSync = typeof SyncModule !== 'undefined' ? (SyncModule.lastSyncTime || 'Henüz yapılmadı') : '-';
    const hasConfig = !!localStorage.getItem('lgs_firebase_config');

    container.innerHTML = `
      <!-- Cloud Synchronization & Multi-Device Card -->
      <div class="card" style="border: 1px solid rgba(99,102,241,0.3);background:rgba(15,23,42,0.75)">
        <div class="card-header flex justify-between items-center">
          <h3 class="card-title"><span class="card-icon">☁️</span> Bulut Senkronizasyonu & Çoklu Cihaz</h3>
          <span class="sync-status-pill ${isConnected ? 'sync-connected' : 'sync-offline'}">
            <span class="sync-dot"></span>
            <span>${isConnected ? '🟢 Buluta Bağlı' : '⚪ Çevrimdışı (Yerel)'}</span>
          </span>
        </div>

        <p class="text-muted mb-2">
          Verilerinizi telefonunuz, evdeki veya okuldaki diğer bilgisayarlarınız arasında anında eşitleyin. 
          Bir cihazda girdiğiniz deneme diğer tüm cihazlarınızda otomatik olarak görünür.
        </p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px;margin-bottom:16px">
          <!-- Sync Key & Actions -->
          <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:12px;border:1px solid var(--bg-glass-border)">
            <label class="form-label" style="font-weight:700">🔑 Ortak Senkronizasyon Anahtarı / Oda Adı</label>
            <div style="display:flex;gap:8px;margin-top:6px">
              <input type="text" id="setting-sync-key" class="form-control" value="${syncKey}" placeholder="Örn: okulum-lgs-2026" onchange="SyncModule.setSyncKey(this.value)">
              <button class="btn btn-secondary btn-sm" onclick="App.saveSyncKey()" title="Kaydet">💾</button>
            </div>
            <small class="text-muted" style="display:block;margin-top:6px">
              💡 Tüm telefon ve bilgisayarlarınıza <b>aynı anahtarı</b> girerek verilerinizi eşleştirin.
            </small>
          </div>

          <!-- Auto-Sync & Status -->
          <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:12px;border:1px solid var(--bg-glass-border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <label class="form-label" style="font-weight:700;margin:0">⚡ Otomatik Canlı Eşitleme</label>
              <input type="checkbox" id="setting-auto-sync" style="width:20px;height:20px;accent-color:#6366f1;cursor:pointer" ${autoSync ? 'checked' : ''} onchange="SyncModule.setAutoSync(this.checked)">
            </div>
            <div style="font-size:13px;color:var(--text-muted)">
              <div>Son Eşitlenme: <b style="color:var(--text-primary)">${lastSync}</b></div>
              <div style="margin-top:4px">Durum: <b style="color:${isConnected ? '#34d399' : '#94a3b8'}">${isConnected ? 'Otomatik senkronizasyon devrede' : 'Bulut yapılandırması bekleniyor'}</b></div>
            </div>
          </div>
        </div>

        <!-- Manual Push & Pull Buttons -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <button class="btn btn-primary" onclick="App.syncPush()">📤 Verileri Buluta Yükle (Gönder)</button>
          <button class="btn btn-secondary" onclick="App.syncPull()">📥 Buluttan Verileri Çek (İndir)</button>
          <button class="btn btn-secondary" onclick="App.toggleFirebaseConfigModal()">⚙️ Firebase / Bulut Ayarları</button>
        </div>

        <!-- Firebase Config Details (Collapsible) -->
        <div id="firebase-config-box" style="display:${hasConfig ? 'none' : 'block'};background:rgba(0,0,0,0.25);padding:16px;border-radius:12px;border:1px solid var(--bg-glass-border);margin-top:12px">
          <h4 style="font-size:14px;font-weight:700;margin-bottom:8px">🔥 Firebase Firestore Yapılandırması</h4>
          <p class="text-muted" style="font-size:12px;margin-bottom:8px">
            Ücretsiz Google Firebase (Firestore) projenizin yapılandırma nesnesini yapıştırın:
          </p>
          <textarea id="setting-firebase-config" class="form-control font-mono" rows="4" placeholder='{\n  "apiKey": "AIzaSy...",\n  "authDomain": "proje.firebaseapp.com",\n  "projectId": "proje-id"\n}'>${localStorage.getItem('lgs_firebase_config') || ''}</textarea>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn btn-primary btn-sm" onclick="App.saveFirebaseConfig()">💾 Bağlantıyı Kaydet & Başlat</button>
            ${hasConfig ? '<button class="btn btn-danger btn-sm" onclick="App.disconnectFirebase()">❌ Bağlantıyı Sıfırla</button>' : ''}
          </div>
        </div>
      </div>

      <!-- Mobile & Another PC Usage Guide -->
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📱</span> Mobil & Başka PC'de Kullanım Kılavuzu</h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px">
          <div style="padding:14px;background:rgba(99,102,241,0.06);border-radius:10px">
            <h4 style="font-weight:700;font-size:14px;margin-bottom:6px">1. Cep Telefonuna Yükleme (PWA)</h4>
            <p class="text-muted" style="font-size:13px">
              Telefonunuzun tarayıcısında (Safari / Chrome) siteyi açtığınızda <b>"Paylaş > Ana Ekrana Ekle"</b> veya <b>"Uygulamayı Yükle"</b> diyerek tıpkı App Store / Play Store'dan yüklenmiş bir mobil uygulama gibi kullanabilirsiniz.
            </p>
          </div>
          <div style="padding:14px;background:rgba(16,185,129,0.06);border-radius:10px">
            <h4 style="font-weight:700;font-size:14px;margin-bottom:6px">2. Aynı Wi-Fi Ağında Açma</h4>
            <p class="text-muted" style="font-size:13px">
              Bilgisayarınızdaki <code>baslat.bat</code> dosyasını çalıştırarak evdeki veya okuldaki telefon ve bilgisayarlardan yerel IP adresiyle anında bağlanabilirsiniz.
            </p>
          </div>
          <div style="padding:14px;background:rgba(59,130,246,0.06);border-radius:10px">
            <h4 style="font-weight:700;font-size:14px;margin-bottom:6px">3. Çoklu PC Senkronizasyonu</h4>
            <p class="text-muted" style="font-size:13px">
              Yukarıdaki <b>Ortak Senkronizasyon Anahtarını</b> diğer bilgisayarınızda da Ayarlar sayfasına girin. İki bilgisayar birbiriyle otomatik eşitlensin.
            </p>
          </div>
        </div>
      </div>

      <!-- Database Stats Card -->
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📊</span> Veritabanı Durumu</h3>
        </div>
        <div class="stats-grid" style="margin-bottom:0">
          <div style="padding:16px;background:rgba(99,102,241,0.05);border-radius:12px;text-align:center">
            <div style="font-size:24px;font-weight:800">${studentCount}</div>
            <div class="text-muted" style="font-size:13px">Öğrenci</div>
          </div>
          <div style="padding:16px;background:rgba(59,130,246,0.05);border-radius:12px;text-align:center">
            <div style="font-size:24px;font-weight:800">${examCount}</div>
            <div class="text-muted" style="font-size:13px">Deneme</div>
          </div>
          <div style="padding:16px;background:rgba(16,185,129,0.05);border-radius:12px;text-align:center">
            <div style="font-size:24px;font-weight:800">${resultCount}</div>
            <div class="text-muted" style="font-size:13px">Sonuç Kaydı</div>
          </div>
        </div>
      </div>

      <!-- Maintenance -->
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🛠️</span> Veri Bakımı & Eşleştirme</h3>
        </div>
        <p class="text-muted mb-2">Öğrenci isimlerindeki mükerrer kayıtları temizler, girilen tüm deneme sonuçlarını doğru öğrencilerle otomatik olarak yeniden eşleştirir.</p>
        <button class="btn btn-primary" onclick="App.repairDatabase()">🔄 Öğrenci & Deneme Eşleştirmelerini Onar</button>
      </div>

      <!-- Danger Zone -->
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title" style="color:var(--danger-light)"><span class="card-icon">⚠️</span> Veri Temizleme & Sıfırlama</h3>
        </div>
        <p class="text-muted mb-2">Aşağıdaki seçeneklerle yalnızca öğrencileri silebilir veya tüm sistemi tamamen sıfırlayabilirsiniz.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <button class="btn btn-danger" onclick="App.clearAllStudents()">🗑️ Yalnızca Tüm Öğrencileri Sil</button>
          <button class="btn btn-danger" style="background:rgba(239,68,68,0.25);border:1px solid var(--danger)" onclick="App.clearAllData()">💥 Tüm Veritabanını Sıfırla (Her Şeyi Sil)</button>
        </div>
      </div>
    `;
  },

  saveSyncKey() {
    const key = document.getElementById('setting-sync-key')?.value;
    SyncModule.setSyncKey(key);
    UI.toast('Senkronizasyon anahtarı kaydedildi: ' + (key || 'Varsayılan'), 'success');
  },

  async syncPush() {
    await SyncModule.pushLocalToCloud(false);
    this.renderSettings();
  },

  async syncPull() {
    await SyncModule.pullCloudToLocal(false);
    this.renderSettings();
  },

  toggleFirebaseConfigModal() {
    const box = document.getElementById('firebase-config-box');
    if (box) {
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }
  },

  async saveFirebaseConfig() {
    const raw = document.getElementById('setting-firebase-config')?.value.trim();
    if (!raw) {
      UI.toast('Lütfen Firebase yapılandırma JSON metnini girin.', 'warning');
      return;
    }

    try {
      let config = JSON.parse(raw);
      const res = await SyncModule.connectFirebase(config, true);
      if (res.success) {
        SyncModule.setAutoSync(true);
        await SyncModule.pushLocalToCloud(true);
        this.renderSettings();
      }
    } catch (e) {
      UI.toast('Geçersiz JSON formatı! Lütfen kontrol edin.', 'danger');
    }
  },

  disconnectFirebase() {
    SyncModule.disconnect();
    this.renderSettings();
  },

  async repairDatabase() {
    const res = await db.repairAndLinkStudents();
    UI.toast(`Onarım tamamlandı! (${res.mergedCount} mükerrer kayıt birleştirildi, ${res.fixedNamesCount} isim düzeltildi)`, 'success');
    this.renderSettings();
  },

  async clearAllStudents() {
    const ok = await UI.confirm('Kayıtlı TÜM ÖĞRENCİLER ve onlara ait tüm deneme sonuçları silinecek. Emin misiniz?', '⚠️ Öğrencileri Sil');
    if (!ok) return;
    const ok2 = await UI.confirm('Son kez onaylayın: Tüm öğrenci profilleri kalıcı olarak silinecektir.', '⚠️ Son Onay');
    if (!ok2) return;

    await db.clearAllStudents();
    UI.toast('Tüm öğrenciler ve sonuçları silindi', 'success');
    if (this.currentPage === 'students') {
      await this.renderStudents();
    } else {
      this.refreshCurrentPage();
    }
  },

  async clearAllData() {
    const ok = await UI.confirm('TÜM VERİLER SİLİNECEK! Bu işlem geri alınamaz. Emin misiniz?', '⚠️ Uyarı');
    if (!ok) return;
    const ok2 = await UI.confirm('Son kez onaylayın: Tüm öğrenciler, denemeler ve sonuçlar kalıcı olarak silinecek.', '⚠️ Son Onay');
    if (!ok2) return;

    await db.clearAllData();
    UI.toast('Tüm veriler silindi', 'success');
    this.navigateTo('dashboard');
  },
};

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
