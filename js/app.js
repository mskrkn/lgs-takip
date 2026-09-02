// ============================================
// LGS Deneme Takip - Main Application
// ============================================

const App = {
  currentPage: 'dashboard',
  currentStudentId: null,
  deferredPwaPrompt: null,
  currentUser: null,
  _currentPageData: {},
  _navHistory: [], // { page, data } yığını - bkz. navigateTo/goBack

  // ---- Initialize ----
  async init() {
    // Background self-healing for student-exam matches and duplicates
    db.repairAndLinkStudents().catch(console.error);

    // Karşılama başlığı için giriş yapan admin bilgisi (bkz. renderDashboard)
    try {
      this.currentUser = await fetch('/api/me').then(r => r.json());
    } catch (e) {
      this.currentUser = null;
    }

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

  async navigateTo(page, data = {}, _isBack = false) {
    // "Geri" ile gelinmiyorsa ve gerçekten farklı bir sayfaya geçiliyorsa,
    // ayrıldığımız sayfayı (ve verisini) geçmiş yığınına ekle - bkz. goBack().
    // Aynı sayfa içi veri değişiklikleri (ör. refreshCurrentPage) geçmişe
    // eklenmez, yalnızca sayfa geçişleri izlenir.
    if (!_isBack && this.currentPage && this.currentPage !== page) {
      this._navHistory.push({ page: this.currentPage, data: this._currentPageData || {} });
    }
    this._currentPageData = data;

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
      'question-bank': ['Soru Girişi', 'PDF Yükle & Havuza Ekle'],
      reports: ['Raporlar', 'Dışa Aktarma & Paylaşım'],
      settings: ['Ayarlar', 'Veri Yönetimi'],
      users: ['Kullanıcılar', 'Öğretmen & Veli Hesapları'],
      'demo-talepleri': ['Demo Talepleri', 'EduPusula Tanıtım Sayfası'],
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
      case 'question-bank':
        await this.renderQuestionBank();
        break;
      case 'reports':
        await this.renderReports();
        break;
      case 'settings':
        await this.renderSettings();
        break;
      case 'users':
        await AdminUsers.render();
        break;
      case 'demo-talepleri':
        await DemoRequests.render();
        break;
    }

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('active');

    this._updateBackButton();
  },

  // Geçmiş yığınındaki bir önceki sayfaya döner (bkz. navigateTo)
  goBack() {
    const prev = this._navHistory.pop();
    if (!prev) return;
    this.navigateTo(prev.page, prev.data, true);
  },

  _updateBackButton() {
    const btn = document.getElementById('nav-back-btn');
    if (btn) btn.style.display = this._navHistory.length > 0 ? '' : 'none';
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
  // Öğretmen panelindeki /api/teacher/insights ile aynı mantık, burada
  // Dexie üzerinden okul geneli (tüm sınıflar) için istemci tarafında
  // hesaplanır - ayrı bir sunucu uç noktasına ihtiyaç yok.
  async buildDashboardInsights() {
    const [students, exams, allResults] = await Promise.all([
      db.getAllStudents(),
      db.getAllExams(),
      db.db.results.toArray(),
    ]);
    if (students.length === 0 || exams.length === 0) return null;

    const examMap = {};
    exams.forEach(e => { examMap[e.id] = e; });
    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    const byStudent = {};
    allResults.forEach(r => {
      const exam = examMap[r.examId];
      if (!exam) return;
      (byStudent[r.studentId] = byStudent[r.studentId] || []).push({
        examId: r.examId, examName: exam.name, examDate: exam.date,
        totalNet: db.calcTotalNet(r), subjects: r.subjects || {},
      });
    });
    Object.values(byStudent).forEach(list => list.sort((a, b) => new Date(a.examDate) - new Date(b.examDate)));

    // ---- 1) Son 3 denemede düşüşe geçen ders ----
    const declineCounts = {};
    Object.entries(byStudent).forEach(([sid, results]) => {
      if (results.length < 3) return;
      const last3 = results.slice(-3);
      const keys = new Set();
      last3.forEach(r => Object.keys(r.subjects).forEach(k => keys.add(k)));
      keys.forEach(key => {
        const nets = last3.map(r => r.subjects[key]?.net);
        if (nets.some(n => n == null)) return;
        if (nets[0] > nets[1] && nets[1] > nets[2]) {
          (declineCounts[key] = declineCounts[key] || []).push(Number(sid));
        }
      });
    });
    let decline = null;
    const declineEntries = Object.entries(declineCounts).sort((a, b) => b[1].length - a[1].length);
    if (declineEntries.length) {
      const [key, ids] = declineEntries[0];
      decline = { subjectKey: key, count: ids.length, students: ids.map(id => ({ id, firstName: studentMap[id].firstName, lastName: studentMap[id].lastName })) };
    }

    // ---- 2) Kişisel rekor kıran öğrenciler ----
    const personalRecords = [];
    Object.entries(byStudent).forEach(([sid, results]) => {
      if (results.length < 2) return;
      const nets = results.map(r => r.totalNet);
      const last = nets[nets.length - 1];
      const prevMax = Math.max(...nets.slice(0, -1));
      if (last >= prevMax && last > nets[nets.length - 2]) {
        const s = studentMap[sid];
        personalRecords.push({ id: Number(sid), firstName: s.firstName, lastName: s.lastName, totalNet: last, examName: results[results.length - 1].examName });
      }
    });

    // ---- 3) Okul geneli net trendi (son 10 deneme) ----
    const sortedExams = [...exams].sort((a, b) => new Date(a.date) - new Date(b.date));
    const averagesMap = await db.getAllExamsAverages();
    const trendExams = sortedExams
      .filter(e => averagesMap[e.id])
      .slice(-10)
      .map(e => ({ examId: e.id, examName: e.name, avgNet: averagesMap[e.id].totalNet }));
    let growthPct = null;
    if (trendExams.length >= 2 && trendExams[0].avgNet) {
      growthPct = Math.round((trendExams[trendExams.length - 1].avgNet - trendExams[0].avgNet) / trendExams[0].avgNet * 1000) / 10;
    }

    // ---- 4) Konu başarı haritası: cevap anahtarlı en güncel deneme ----
    let topicHeatmap = null, aiComment = null, belowAvgTopic = null;
    for (let i = sortedExams.length - 1; i >= 0; i--) {
      const analysis = await db.getExamTopicAnalysis(sortedExams[i].id);
      if (analysis && analysis.hasData) {
        topicHeatmap = analysis.topicStats.slice(0, 8);
        break;
      }
    }
    if (topicHeatmap && topicHeatmap.length) {
      const weakest = topicHeatmap[0];
      aiComment = `Öğrencilerin en çok zorlandığı alan ${weakest.kazanim} (%${weakest.successRate} başarı). Önümüzdeki hafta kısa bir tekrar yapılması öneriliyor.`;
      const overallAvg = topicHeatmap.reduce((s, t) => s + t.successRate, 0) / topicHeatmap.length;
      const weak = topicHeatmap.filter(t => t.successRate < overallAvg);
      if (weak.length) belowAvgTopic = weak.reduce((min, t) => t.successRate < min.successRate ? t : min, weak[0]);
    }

    // ---- 5) Öğrenci radarı ----
    const rising = [], attention = [], fluctuating = [];
    Object.entries(byStudent).forEach(([sid, results]) => {
      if (results.length < 2) return;
      const window = results.length >= 3 ? results.slice(-3) : results.slice(-2);
      const nets = window.map(r => r.totalNet);
      const s = studentMap[sid];
      const info = { id: Number(sid), firstName: s.firstName, lastName: s.lastName };
      let increasing = true, decreasing = true;
      for (let i = 0; i < nets.length - 1; i++) {
        if (!(nets[i] < nets[i + 1])) increasing = false;
        if (!(nets[i] > nets[i + 1])) decreasing = false;
      }
      if (increasing) rising.push(info);
      else if (decreasing) attention.push(info);
      else fluctuating.push(info);
    });

    return {
      priority: { decline, belowAvgTopic, personalRecords },
      trend: { exams: trendExams, growthPct },
      topicHeatmap, aiComment,
      radar: { rising, attention, fluctuating },
    };
  },

  openDeclineModal() {
    if (!this._insights?.priority?.decline) return;
    const d = this._insights.priority.decline;
    this._openInsightListModal(`${SUBJECT_LOOKUP[d.subjectKey]?.name || d.subjectKey} - Düşüş Gösteren Öğrenciler`,
      d.students.map(s => ({ ...s, onClick: () => this.navigateTo('student-profile', { studentId: s.id }) })));
  },

  _openInsightListModal(title, items) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h2>${title}</h2><button class="modal-close" data-close>✕</button></div>
        <div class="modal-body" id="insight-list-modal-body"></div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    const body = overlay.querySelector('#insight-list-modal-body');
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'radar-item';
      btn.style.padding = '12px';
      btn.textContent = `👤 ${item.firstName} ${item.lastName}`;
      btn.onclick = () => { close(); item.onClick(); };
      body.appendChild(btn);
    });
    if (!items.length) body.innerHTML = '<p class="text-muted">Kayıt bulunamadı.</p>';
  },

  openCongratsModal() {
    const records = (this._insights && this._insights.priority && this._insights.priority.personalRecords) || [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h2>Tebrik Mesajları</h2><button class="modal-close" data-close>✕</button></div>
        <div class="modal-body">${records.length ? records.map((s, i) => {
          const msg = `Tebrikler ${s.firstName}! ${s.examName} denemesinde ${s.totalNet} net ile kişisel rekorunu kırdın. Bu tempoyla devam! 🎉`;
          return `<div class="summary-tile" style="margin-bottom:10px">
            <div class="stat-label">${s.firstName} ${s.lastName}</div>
            <p style="font-size:13.5px;margin-top:6px">${msg}</p>
            <button type="button" class="btn btn-primary btn-sm mt-2" data-send-congrats data-student-id="${s.id}" data-message="${msg.replace(/"/g, '&quot;')}">📨 Öğrenciye Gönder</button>
          </div>`;
        }).join('') : '<p class="text-muted">Henüz kişisel rekor kıran öğrenci yok.</p>'}</div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) { close(); return; }
      const sendBtn = e.target.closest('[data-send-congrats]');
      if (sendBtn) App.sendCongratsMessage(Number(sendBtn.dataset.studentId), sendBtn.dataset.message, sendBtn);
    });
  },

  async sendCongratsMessage(studentId, message, btn) {
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
      UI.toast('Mesaj öğrenciye gönderildi.', 'success');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '📨 Öğrenciye Gönder';
      UI.toast('Mesaj gönderilemedi: ' + err.message, 'danger');
    }
  },

  renderInsightSections(insights) {
    const priorityEl = document.getElementById('priority-cards');
    const heatEl = document.getElementById('heatmap-list');
    const aiEl = document.getElementById('ai-comment-text');
    const radarEl = document.getElementById('radar-columns');
    const growthEl = document.getElementById('dashboard-growth-caption');
    if (!priorityEl) return;

    if (!insights) {
      priorityEl.innerHTML = '<p class="text-muted">Yeterli veri birikince öneriler burada görünecek.</p>';
      heatEl.innerHTML = '<p class="text-muted">Henüz veri yok.</p>';
      radarEl.innerHTML = '<p class="text-muted">Henüz veri yok.</p>';
      return;
    }
    this._insights = insights;

    const cards = [];
    if (insights.priority.decline) {
      const d = insights.priority.decline;
      cards.push(`<div class="priority-card priority-critical">
        <span class="priority-label">🔴 Öncelikli</span>
        <p>${d.count} öğrencinin ${SUBJECT_LOOKUP[d.subjectKey]?.name || d.subjectKey} performansı son 3 denemede düşüş gösteriyor.</p>
        <button class="priority-action" onclick="App.openDeclineModal()">Öğrencileri Gör →</button>
      </div>`);
    }
    if (insights.priority.belowAvgTopic) {
      const t = insights.priority.belowAvgTopic;
      cards.push(`<div class="priority-card priority-warning">
        <span class="priority-label">🟠 Dikkat</span>
        <p>Okul genelinde <b>${t.kazanim}</b> konusu ortalamanın altında (%${t.successRate}).</p>
        <button class="priority-action" onclick="document.getElementById('dashboard-heatmap-card').scrollIntoView({behavior:'smooth'})">Konu Analizine Git →</button>
      </div>`);
    }
    if (insights.priority.personalRecords.length) {
      cards.push(`<div class="priority-card priority-success">
        <span class="priority-label">🟢 Başarı</span>
        <p>${insights.priority.personalRecords.length} öğrenci son denemede kişisel rekorunu kırdı! 🎉</p>
        <button class="priority-action" onclick="App.openCongratsModal()">Tebrik Mesajı Oluştur →</button>
      </div>`);
    }
    priorityEl.innerHTML = cards.length ? cards.join('') : '<p class="text-muted">Şu an öne çıkan bir durum yok - her şey yolunda görünüyor 🎉</p>';

    if (insights.topicHeatmap && insights.topicHeatmap.length) {
      heatEl.innerHTML = insights.topicHeatmap.map(t => {
        const cls = t.successRate < 50 ? 'hm-red' : t.successRate < 70 ? 'hm-yellow' : 'hm-green';
        const icon = t.successRate < 50 ? '🔴' : t.successRate < 70 ? '🟡' : '🟢';
        return `<div class="heatmap-row"><span class="heatmap-topic">${t.subjectName ? t.subjectName + ' - ' : ''}${t.kazanim}</span><span class="heatmap-score ${cls}">${icon} %${t.successRate}</span></div>`;
      }).join('');
    } else {
      heatEl.innerHTML = '<p class="text-muted">Cevap anahtarlı (optik) bir deneme olmadığı için konu haritası henüz oluşturulamıyor.</p>';
    }
    if (aiEl) aiEl.textContent = insights.aiComment || 'Henüz yeterli veri yok.';

    const col = (title, icon, items) => `
      <div class="radar-column">
        <h4>${icon} ${title}</h4>
        ${items.length ? items.map(s => `<button type="button" class="radar-item" onclick="App.navigateTo('student-profile', {studentId: ${s.id}})">${s.firstName} ${s.lastName}</button>`).join('') : '<p class="text-muted" style="font-size:12.5px">Yok</p>'}
      </div>`;
    radarEl.innerHTML = col('Yükselişte', '🚀', insights.radar.rising) + col('Takip Gerekli', '⚠️', insights.radar.attention) + col('Dalgalı Performans', '〰️', insights.radar.fluctuating);

    if (growthEl) {
      if (insights.trend.growthPct != null) {
        const dir = insights.trend.growthPct >= 0 ? 'gelişim' : 'gerileme';
        growthEl.textContent = `📈 Okul genelinde son ${insights.trend.exams.length} denemede %${Math.abs(insights.trend.growthPct)} ${dir} gözlemlendi.`;
      } else {
        growthEl.textContent = '';
      }
    }
  },

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

    const greetingName = this.currentUser?.displayName || 'Yöneticim';
    const todayStr = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    container.innerHTML = `
      <div class="greeting-header">
        <div>
          <div class="greeting-title">👋 Hoş Geldiniz, ${greetingName}! 🧭</div>
          <p class="greeting-sub">Okulunuzun gelişimini takip edin, sorunları erken fark edin ve doğru yönlendirmeler yapın.</p>
        </div>
        <div class="greeting-date">📅 ${todayStr}</div>
      </div>

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

      <!-- EduPusula Öneriyor -->
      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">🧭</span> EduPusula Öneriyor</h3></div>
        <div id="priority-cards" class="priority-cards"><p class="text-muted">Yükleniyor...</p></div>
      </div>

      <!-- Büyük Öğrenci Arama -->
      <div class="card dashboard-search-card mt-2">
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
          <p class="text-muted" id="dashboard-growth-caption" style="margin-top:6px;font-size:13px"></p>
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

      <!-- Konu Başarı Haritası -->
      <div class="card mt-2" id="dashboard-heatmap-card">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">🔥</span> Konu Başarı Haritası</h3></div>
        <div class="heatmap-grid">
          <div id="heatmap-list"><p class="text-muted">Yükleniyor...</p></div>
          <div class="ai-comment-box">
            <span class="ai-comment-label">🤖 Edu AI</span>
            <span id="ai-comment-text">Henüz yeterli veri yok.</span>
          </div>
        </div>
      </div>

      <!-- Öğrenci Radarı -->
      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">🎯</span> Öğrenci Durumları</h3></div>
        <div id="radar-columns" class="radar-columns"><p class="text-muted">Yükleniyor...</p></div>
      </div>
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

    // EduPusula Öneriyor / Konu Haritası / Öğrenci Radarı
    this.buildDashboardInsights().then(insights => this.renderInsightSections(insights));
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
          borderColor: '#0D9488',
          backgroundColor: 'rgba(20,184,166, 0.12)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#0D9488',
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

    this._allStudentsCache = students;

    const grades = [...new Set(students.map(s => this.parseClassName(s.className).grade).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));
    const branches = [...new Set(students.map(s => this.parseClassName(s.className).branch).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="card">
        <div class="student-search-hero">
          <div class="student-search-hero-icon">🧭</div>
          <h2>Öğrenci Ara</h2>
          <p>İsim veya okul numarasıyla arayın, ya da sınıf kademesi ve şubeye göre daraltın.</p>
          <div class="student-search-box">
            <span class="search-icon-inline">🔍</span>
            <input type="text" class="form-input" id="students-filter" placeholder="İsim veya okul no ile ara..." oninput="App.filterStudentsManual()">
          </div>
          <div class="student-search-manual">
            <select class="filter-select" id="students-grade-filter" onchange="App.filterStudentsManual()">
              <option value="">Sınıf Kademesi</option>
              ${grades.map(g => `<option value="${g}">${g}. Sınıf</option>`).join('')}
            </select>
            <select class="filter-select" id="students-branch-filter" onchange="App.filterStudentsManual()">
              <option value="">Şube</option>
              ${branches.map(b => `<option value="${b}">${b} Şubesi</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="controls-bar" style="border-top:1px solid var(--bg-glass-border);padding-top:16px;margin-top:4px">
          <div class="controls-left">
            <span class="text-muted">${students.length} öğrenci</span>
          </div>
          <div class="controls-right">
            <button class="btn btn-secondary btn-sm" onclick="App.showAddStudentModal()">➕ Öğrenci Ekle</button>
            <button class="btn btn-danger btn-sm" onclick="App.clearAllStudents()" title="Tüm kayıtlı öğrencileri ve sonuçlarını sil">🗑️ Tümünü Sil</button>
          </div>
        </div>

        <div id="students-table-container">
          <p class="text-muted" style="text-align:center;padding:20px 0">Yukarıdan aramaya başlayın ya da sınıf kademesi / şube seçin.</p>
        </div>
      </div>
    `;
  },

  // '5/A', '8-C' gibi sınıf adlarını kademe ('5','8') ve şube ('A','C') olarak ayırır.
  parseClassName(className) {
    const m = String(className || '').trim().match(/^(\d+)\s*[\/\-]\s*(.+)$/);
    if (!m) return { grade: null, branch: null };
    return { grade: m[1], branch: m[2].trim().toLocaleUpperCase('tr-TR') };
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

  // Serbest metin arama + sınıf kademesi + şube filtrelerini birlikte
  // uygular, sonuçları isim sırasına göre listeler.
  async filterStudentsManual() {
    const query = (document.getElementById('students-filter')?.value || '').trim();
    const grade = document.getElementById('students-grade-filter')?.value || '';
    const branch = document.getElementById('students-branch-filter')?.value || '';
    const container = document.getElementById('students-table-container');

    if (!query && !grade && !branch) {
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px 0">Yukarıdan aramaya başlayın ya da sınıf kademesi / şube seçin.</p>';
      return;
    }

    let students = query ? await db.searchStudents(query) : (this._allStudentsCache || await db.getAllStudents());
    if (grade || branch) {
      students = students.filter(s => {
        const p = this.parseClassName(s.className);
        return (!grade || p.grade === grade) && (!branch || p.branch === branch);
      });
    }
    students = [...students].sort((a, b) =>
      (a.firstName + ' ' + a.lastName).localeCompare(b.firstName + ' ' + b.lastName, 'tr'));

    const exams = await db.getAllExams();
    const latestExam = exams[0];
    let rankings = [];
    if (latestExam) rankings = await db.getExamRankings(latestExam.id);
    const rankMap = {};
    rankings.forEach(r => { rankMap[r.studentId] = r; });

    container.innerHTML = students.length
      ? this.buildStudentsTable(students, rankMap, latestExam)
      : '<p class="text-muted" style="text-align:center;padding:20px 0">Eşleşen öğrenci bulunamadı.</p>';
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
      <div class="card mt-2" style="background:linear-gradient(135deg, rgba(20,184,166,0.08), rgba(15,118,110,0.04));border:1px solid rgba(20,184,166,0.25);padding:32px 24px;text-align:center;">
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
      <div id="profile-topic-analysis-container"></div>
    `;

    // Update radar chart
    chartContainer.innerHTML = '<div class="chart-container" style="height:300px"><canvas id="profile-radar-chart"></canvas></div>';
    Analysis.renderRadarChart('profile-radar-chart', result, averages, selectedExam.examType);

    // Konu analizi: bu denemenin cevap anahtarı Excel'den yüklenmişse
    // (bkz. db.getStudentTopicAnalysis), öğrencinin bu denemede zayıf olduğu
    // konuları gösterir - haritası yoksa hiçbir şey gösterilmez.
    const studentTopicAnalysis = await db.getStudentTopicAnalysis(studentId, examId);
    const topicContainer = document.getElementById('profile-topic-analysis-container');
    if (topicContainer && studentTopicAnalysis?.hasData) {
      const weakTopics = studentTopicAnalysis.topicStats.filter(t => t.wrong + t.blank > 0).slice(0, 8);
      topicContainer.innerHTML = weakTopics.length > 0 ? `
        <div class="mt-2">
          <h4 style="font-size:13px;margin-bottom:8px;font-weight:700">🎯 Bu Denemede Zayıf Olduğu Konular</h4>
          ${this.renderTopicStatsTable(weakTopics)}
        </div>
      ` : `<p class="text-muted mt-2" style="font-size:13px">🎉 Bu öğrenci, konu haritası tanımlı sorularda hiç yanlış/boş yapmamış.</p>`;
    }
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

          <div style="margin-top:16px;padding:14px 18px;background:rgba(20,184,166,0.08);border-radius:12px;border:1px solid rgba(20,184,166,0.2);display:flex;align-items:center;justify-content:space-between">
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
              <input type="text" class="form-input font-mono" id="modal-sub-${sub.key}-net" value="${Number(n).toFixed(2)}" readonly style="background:rgba(20,184,166,0.08);color:var(--accent-primary-light);font-weight:600">
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
          <p class="text-muted" style="font-size:11px;margin:-4px 0 8px">Bir derse tıklayarak o dersin Soru & Konu Analizi'ni popup olarak görebilirsin.</p>
          <div id="exam-subject-stats-container"></div>
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

      <!-- Soru & Konu (Kazanım) Analizi -->
      <div id="exam-topic-analysis-container"></div>
    `;

    // Render chart
    if (averages) {
      Analysis.renderExamSubjectBarsChart('exam-subject-chart', averages, exam.examType);
    }

    // Soru/konu analizi: sadece cevap anahtarı Excel'den yüklenip bir konu
    // haritası (topicMap) kaydedilmişse gösterilir - bkz. ImportOptical.loadAnswerKeyExcel
    const topicAnalysis = await db.getExamTopicAnalysis(examId);
    this._examTopicAnalysisCache = { examId, exam, averages, topicAnalysis };
    const statsContainer = document.getElementById('exam-subject-stats-container');
    if (statsContainer) statsContainer.innerHTML = this.buildSubjectStatsTable(exam, averages);

    const topicContainer = document.getElementById('exam-topic-analysis-container');
    if (topicContainer) topicContainer.innerHTML = this.buildTopicAnalysisCard(topicAnalysis);
  },

  // "Ders Bazlı İstatistik" tablosu - bir derse tıklamak o dersin Soru & Konu
  // Analizi'ni doğrudan bir modal (popup) içinde açar (bkz. showSubjectTopicModal)
  buildSubjectStatsTable(exam, averages) {
    return `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>Ders</th><th style="text-align:center">Ort. Net</th><th style="text-align:center">Soru</th></tr>
          </thead>
          <tbody>
            ${getSubjectsForExam(exam).map(sub => `
              <tr style="cursor:pointer" onclick="App.showSubjectTopicModal(${exam.id}, '${sub.key}')" title="${sub.name} için Soru & Konu Analizi'ni göster">
                <td>${UI.subjectBadge(sub.key)}</td>
                <td style="text-align:center">${UI.formatNet(averages?.[sub.key])}</td>
                <td style="text-align:center" class="text-muted">${sub.questions}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // Ders Bazlı İstatistik'te bir derse tıklandığında çağrılır - sayfada aşağı
  // kaydırmak yerine o dersin soru/konu analizini doğrudan bir popup'ta açar.
  // _examTopicAnalysisCache üzerinden çalışır, DB'ye tekrar gitmez.
  showSubjectTopicModal(examId, subjectKey) {
    const cache = this._examTopicAnalysisCache;
    const sub = SUBJECT_LOOKUP[subjectKey];
    if (!cache || cache.examId !== examId || !sub) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h2>${sub.name} — Soru & Konu Analizi</h2>
          <button class="modal-close" data-action="close">✕</button>
        </div>
        <div class="modal-body">
          ${this.buildTopicAnalysisBody(cache.topicAnalysis, subjectKey)}
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.dataset.action === 'close') {
        overlay.remove();
        document.body.style.overflow = '';
      }
    });
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  },

  // Soru & Konu Analizi içeriği (başlıksız). subjectKey verilirse (bkz.
  // showSubjectTopicModal) sadece o derse filtrelenir, yoksa sınıf/deneme
  // genelinde en çok zorlanılan ilk 10 soru/8 konu gösterilir.
  buildTopicAnalysisBody(topicAnalysis, subjectKey) {
    if (!topicAnalysis) {
      return `<p class="text-muted" style="font-size:13px">Bu deneme için henüz bir konu (kazanım) haritası yüklenmemiş. Optik/TXT sekmesinde "Cevap Anahtarını Excel'den Yükle" ile yükleyip yeniden değerlendirirsen bu analiz burada görünür.</p>`;
    }
    if (!topicAnalysis.hasData) {
      return `<p class="text-muted" style="font-size:13px">Bu deneme için konu (kazanım) haritası yüklü, ancak henüz soru bazlı sonuç bulunmuyor. Bu analiz yalnızca Optik/TXT sekmesinden, cevap anahtarı Excel dosyasıyla birlikte değerlendirilen sonuçlarda oluşur.</p>`;
    }

    const sub = subjectKey ? SUBJECT_LOOKUP[subjectKey] : null;
    const questionStats = sub ? topicAnalysis.questionStats.filter(q => q.subjectKey === subjectKey) : topicAnalysis.questionStats;
    const topicStats = sub ? topicAnalysis.topicStats.filter(t => t.subjectKey === subjectKey) : topicAnalysis.topicStats;

    if (sub && questionStats.length === 0) {
      return `<p class="text-muted" style="font-size:13px">${sub.name} dersi için konu (kazanım) haritasında veri bulunamadı.</p>`;
    }

    // Sınıf geneli görünümde en zorlanılan ilk 10 soru/8 konu gösterilir;
    // bir ders seçiliyken (modal) zaten az sayıda soru kaldığından tamamı gösterilir.
    const worstQuestions = sub ? questionStats : questionStats.slice(0, 10);
    const worstTopics = sub ? topicStats : topicStats.slice(0, 8);
    const introText = sub
      ? `Bu dersin tüm sorularının ve konularının başarı analizi.`
      : `Cevap anahtarı Excel'inden yüklenen konu (kazanım) haritasına göre, sınıf genelinde en çok zorlanılan sorular ve konular. Belirli bir dersi görmek için "Ders Bazlı İstatistik" tablosundan bir derse tıkla.`;

    return `
      <p class="text-muted" style="font-size:13px;margin-bottom:14px">${introText}</p>
      <h4 style="font-size:13px;margin:4px 0 8px;font-weight:700">📉 En Çok Yanlış/Boş Yapılan Sorular</h4>
      ${this.renderQuestionStatsTable(worstQuestions)}
      <h4 style="font-size:13px;margin:20px 0 8px;font-weight:700">📚 Konu Bazlı Başarı (en zayıftan güçlüye)</h4>
      ${this.renderTopicStatsTable(worstTopics)}
    `;
  },

  // Deneme geneli "Soru & Konu Analizi" kartı (sınıfın tamamı, ilk 10 soru/8
  // konu). topicAnalysis null ise bu deneme için hiç konu haritası
  // yüklenmemiştir (Optik/TXT sekmesinde cevap anahtarı Excel'den yüklenmedi)
  // - kart hiç gösterilmez.
  buildTopicAnalysisCard(topicAnalysis) {
    if (!topicAnalysis) return '';
    return `
      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">🎯</span> Soru & Konu Analizi</h3></div>
        ${this.buildTopicAnalysisBody(topicAnalysis, null)}
      </div>
    `;
  },

  // Başarı oranına göre renk/etiket - hem soru hem konu tablolarında kullanılır
  _topicSuccessLabel(rate) {
    if (rate < 40) return { color: '#ef4444', text: '🔴 Zayıf' };
    if (rate < 65) return { color: '#f59e0b', text: '🟡 Orta' };
    return { color: '#10b981', text: '🟢 İyi' };
  },

  renderQuestionStatsTable(questionStats) {
    return `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Ders</th><th style="text-align:center">Soru No</th><th>Konu (Kazanım)</th><th style="text-align:center">D/Y/B</th><th style="text-align:center">Başarı</th></tr></thead>
          <tbody>
            ${questionStats.map(q => {
              const label = this._topicSuccessLabel(q.successRate);
              return `
                <tr>
                  <td>${UI.subjectBadge(q.subjectKey)}</td>
                  <td style="text-align:center" class="font-mono">${q.dizilim}</td>
                  <td style="font-size:13px">${q.kazanim}</td>
                  <td style="text-align:center" class="font-mono"><span class="text-success">${q.correct}</span>/<span class="text-danger">${q.wrong}</span>/<span class="text-muted">${q.blank}</span></td>
                  <td style="text-align:center;font-weight:700;color:${label.color}">${q.successRate}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderTopicStatsTable(topicStats) {
    return `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Ders</th><th>Konu (Kazanım)</th><th style="text-align:center">Soru</th><th style="text-align:center">D/Y/B</th><th style="text-align:center">Başarı</th><th>Durum</th></tr></thead>
          <tbody>
            ${topicStats.map(t => {
              const label = this._topicSuccessLabel(t.successRate);
              return `
                <tr>
                  <td>${UI.subjectBadge(t.subjectKey)}</td>
                  <td style="font-size:13px">${t.kazanim}</td>
                  <td style="text-align:center" class="text-muted">${t.questionCount}</td>
                  <td style="text-align:center" class="font-mono"><span class="text-success">${t.correct}</span>/<span class="text-danger">${t.wrong}</span>/<span class="text-muted">${t.blank}</span></td>
                  <td style="text-align:center;font-weight:700">${t.successRate}%</td>
                  <td style="color:${label.color};font-weight:600">${label.text}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
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

  // ---- Soru Girişi (Soru Havuzu - PDF yükleme & otomatik kırpma tespiti) ----
  // PDF -> /api/admin/question-bank/upload -> pdf_question_extractor otomatik
  // sınırları tespit eder -> her soru question_bank'e "pending_review"
  // durumuyla kırpılmış görüntüsüyle yazılır. Buradaki ızgaradan bir soruya
  // tıklayınca _qbOpenReview açılır: tam boyut önizleme + elle kırpma
  // düzeltme + konu/kazanım/zorluk girme + onayla/hariç tut.
  async renderQuestionBank() {
    const container = document.getElementById('page-question-bank');
    const subjectOptionsHtml = Object.keys(SUBJECT_SETS).map(examType => {
      const opts = SUBJECT_SETS[examType]
        .map(s => `<option value="${s.key}">${s.name}</option>`).join('');
      return `<optgroup label="${EXAM_TYPE_LABELS[examType] || examType}">${opts}</optgroup>`;
    }).join('');

    container.innerHTML = `
      <div class="card" style="margin-top:0">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📝</span> Soru Havuzu — PDF'den Soru Girişi</h3>
        </div>
        <p class="text-muted" style="margin-bottom:16px">
          Bir test PDF'i yükleyin; sistem soruları otomatik olarak sınırlarına göre keser
          ve havuza "onay bekliyor" durumunda ekler. Yüklendikten sonra her soruya tıklayıp
          tam boyutta inceleyebilir, gerekirse kırpma sınırını elle düzeltip konu/kazanım/
          zorluk/doğru cevap girerek onaylayabilirsiniz.
        </p>
        <div class="form-group" style="max-width:320px;margin-bottom:16px">
          <label class="form-label">Ders</label>
          <select class="form-select" id="qb-subject-select">${subjectOptionsHtml}</select>
        </div>
        <div class="drop-zone" id="qb-drop-zone">
          <div class="drop-icon">📄</div>
          <h3>Test PDF'ini sürükleyip bırakın</h3>
          <p>veya dosya seçmek için tıklayın (.pdf)</p>
          <input type="file" id="qb-file-input" accept=".pdf" style="display:none">
        </div>
        <div id="qb-status" style="margin-top:14px"></div>
        <div id="qb-results"></div>
      </div>
      <div class="card mt-2">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🗂️</span> Yüklenen Setler</h3>
        </div>
        <div id="qb-batch-list"><p class="text-muted">Yükleniyor...</p></div>
      </div>`;

    ImportModule.setupDropZone('qb-drop-zone', 'qb-file-input', (file) => this.uploadQuestionBankPdf(file));
    this.loadQuestionBankBatches();
  },

  async loadQuestionBankBatches() {
    const listEl = document.getElementById('qb-batch-list');
    if (!listEl) return;
    try {
      const res = await fetch('/api/admin/question-bank/batches');
      const data = await res.json();
      if (!data.batches || !data.batches.length) {
        listEl.innerHTML = `<p class="text-muted">Henüz PDF yüklenmemiş.</p>`;
        return;
      }
      listEl.innerHTML = data.batches.map(b => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--bg-glass-border)">
          <div>
            <div style="font-weight:700">${b.source_filename}</div>
            <div class="text-muted" style="font-size:12.5px">
              ${b.question_count} soru • ${UI.formatDate(b.created_at)}
              ${b.pending_count > 0 ? ` • <span style="color:var(--warning)">${b.pending_count} onay bekliyor</span>` : ' • tümü incelendi'}
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App.openBatchReview(${b.id})">🔍 İncele</button>
        </div>`).join('');
    } catch (err) {
      listEl.innerHTML = `<p style="color:var(--danger)">Set listesi yüklenemedi: ${err.message}</p>`;
    }
  },

  async uploadQuestionBankPdf(file) {
    const statusEl = document.getElementById('qb-status');
    const resultsEl = document.getElementById('qb-results');
    resultsEl.innerHTML = '';

    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      statusEl.innerHTML = `<p style="color:var(--danger)">Lütfen bir PDF dosyası seçin.</p>`;
      return;
    }
    const subjectCode = document.getElementById('qb-subject-select').value;
    statusEl.innerHTML = `<p class="text-muted">⏳ PDF işleniyor, soru sınırları tespit ediliyor... (birkaç saniye sürebilir)</p>`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('subject_code', subjectCode);

    try {
      const res = await fetch('/api/admin/question-bank/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Yükleme başarısız.');

      statusEl.innerHTML = `<p style="color:var(--success)">✅ ${data.questionCount} soru tespit edildi
        (${data.pageCount} sayfa)${data.answerKeyFound ? ', cevap anahtarı da bulundu' : ''}.
        Hepsi <b>onay bekliyor</b> durumunda havuza eklendi. Aşağıdan tıklayarak inceleyin.</p>`;

      resultsEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px">
          ${data.questions.map((q, i) => `
            <div class="card qb-thumb" style="padding:8px;text-align:center;margin-top:0;cursor:pointer" onclick="App.openBatchReview(${data.batchId}, ${i})">
              <div style="width:100%;height:150px;border-radius:8px;border:1px solid var(--bg-glass-border);background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;overflow:hidden">
                <img src="${q.imageUrl}" alt="Soru ${q.number}" loading="lazy" style="max-width:100%;max-height:100%;object-fit:contain">
              </div>
              <div style="margin-top:6px;font-weight:700;font-size:13px">Soru ${q.number}</div>
              ${q.correctAnswer ? `<div style="font-size:11.5px;color:var(--text-muted)">Cevap: ${q.correctAnswer}</div>` : ''}
            </div>`).join('')}
        </div>`;

      this.loadQuestionBankBatches();
    } catch (err) {
      statusEl.innerHTML = `<p style="color:var(--danger)">❌ ${err.message}</p>`;
    }
  },

  // ==== Soru İnceleme Modalı ====
  // Tek bir global _qbState nesnesinde tutulur (aynı anda tek inceleme
  // oturumu olur) - modal HTML'i her açılışta document.body'e eklenir,
  // kapatılınca kaldırılır (bkz. UI.confirm ile aynı yaklaşım).
  _qbState: null,

  async openBatchReview(batchId, startIndex = 0) {
    try {
      const res = await fetch(`/api/admin/question-bank/batches/${batchId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Set yüklenemedi.');
      if (!data.questions.length) {
        UI.toast('Bu sette soru bulunamadı.', 'warning');
        return;
      }
      this._qbState = {
        batchId, questions: data.questions, index: Math.min(startIndex, data.questions.length - 1),
        contextUrl: null, pageWidthPt: 0, pageHeightPt: 0, cropRect: null, cropDrag: null,
        topicsCache: {}, outcomesCache: {},
      };
      this._qbMount();
      await this._qbShowCurrent();
    } catch (err) {
      UI.toast('İnceleme açılamadı: ' + err.message, 'danger');
    }
  },

  _qbMount() {
    if (document.getElementById('qb-review-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'qb-review-overlay';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal modal-lg" style="max-width:1180px">
        <div class="modal-header">
          <h2 id="qbr-title">Soru İnceleme</h2>
          <button class="modal-close" onclick="App._qbClose()">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,1fr);gap:20px">
            <div>
              <div id="qbr-image-wrap" style="position:relative;width:100%;background:#000;border-radius:10px;overflow:hidden;user-select:none">
                <img id="qbr-page-img" style="display:block;width:100%;height:auto" draggable="false">
                <div id="qbr-crop-box" style="position:absolute;border:2px solid #14b8a6;background:rgba(20,184,166,0.15);cursor:move">
                  <div class="qbr-handle" data-mode="nw" style="position:absolute;left:-6px;top:-6px;width:14px;height:14px;background:#14b8a6;border-radius:3px;cursor:nwse-resize"></div>
                  <div class="qbr-handle" data-mode="ne" style="position:absolute;right:-6px;top:-6px;width:14px;height:14px;background:#14b8a6;border-radius:3px;cursor:nesw-resize"></div>
                  <div class="qbr-handle" data-mode="sw" style="position:absolute;left:-6px;bottom:-6px;width:14px;height:14px;background:#14b8a6;border-radius:3px;cursor:nesw-resize"></div>
                  <div class="qbr-handle" data-mode="se" style="position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;background:#14b8a6;border-radius:3px;cursor:nwse-resize"></div>
                </div>
              </div>
              <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="App._qbResetCrop()">↺ Kırpmayı Sıfırla</button>
                <button class="btn btn-primary btn-sm" onclick="App._qbSaveCrop()">✂️ Kırpmayı Kaydet</button>
                <span class="text-muted" style="font-size:12px;align-self:center">Köşelerden sürükleyip yeniden boyutlandırın, içinden sürükleyip taşıyın.</span>
              </div>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <span id="qbr-counter" class="text-muted" style="font-size:13px"></span>
                <span id="qbr-status-badge"></span>
              </div>
              <div class="form-group">
                <label class="form-label">Konu</label>
                <div style="display:flex;gap:6px">
                  <select class="form-select" id="qbr-topic-select" style="flex:1"></select>
                  <button class="btn btn-secondary btn-sm" onclick="App._qbAddTopic()" title="Yeni konu ekle">➕</button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Kazanım</label>
                <div style="display:flex;gap:6px">
                  <select class="form-select" id="qbr-outcome-select" style="flex:1"></select>
                  <button class="btn btn-secondary btn-sm" onclick="App._qbAddOutcome()" title="Yeni kazanım ekle">➕</button>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div class="form-group">
                  <label class="form-label">Zorluk</label>
                  <select class="form-select" id="qbr-difficulty-select">
                    <option value="">—</option>
                    <option value="1">1 - Çok Kolay</option>
                    <option value="2">2 - Kolay</option>
                    <option value="3">3 - Orta</option>
                    <option value="4">4 - Zor</option>
                    <option value="5">5 - Çok Zor</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Doğru Cevap</label>
                  <select class="form-select" id="qbr-answer-select">
                    ${['', 'A', 'B', 'C', 'D', 'E'].map(a => `<option value="${a}">${a || '—'}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Soru Tipi</label>
                <select class="form-select" id="qbr-type-select">
                  <option value="">—</option>
                  <option value="multiple_choice">Çoktan Seçmeli</option>
                  <option value="true_false">Doğru / Yanlış</option>
                  <option value="open_ended">Açık Uçlu</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Açıklama / Çözüm (opsiyonel)</label>
                <textarea class="form-control" id="qbr-explanation" rows="3"></textarea>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="App._qbNav(-1)">⟵ Önceki</button>
            <button class="btn btn-ghost btn-sm" onclick="App._qbNav(1)">Sonraki ⟶</button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="App._qbSaveFields()">💾 Kaydet</button>
            <button class="btn btn-danger" onclick="App._qbSaveFields('excluded')">🚫 Hariç Tut</button>
            <button class="btn btn-primary" onclick="App._qbSaveFields('approved')">✅ Onayla</button>
          </div>
        </div>
      </div>`;
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this._qbClose();
    });
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    this._qbKeyHandler = this._qbKeyHandler.bind(this);
    document.addEventListener('keydown', this._qbKeyHandler);
    this._qbRenderCropOverlay = this._qbRenderCropOverlay.bind(this);
    window.addEventListener('resize', this._qbRenderCropOverlay);

    const box = document.getElementById('qbr-crop-box');
    box.addEventListener('mousedown', (e) => {
      if (e.target.closest('.qbr-handle')) return;
      this._qbStartDrag(e, 'move');
    });
    box.querySelectorAll('.qbr-handle').forEach(h => {
      h.addEventListener('mousedown', (e) => this._qbStartDrag(e, h.dataset.mode));
    });
  },

  _qbClose() {
    const overlay = document.getElementById('qb-review-overlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this._qbKeyHandler);
    window.removeEventListener('resize', this._qbRenderCropOverlay);
    if (this._qbState && this._qbState.contextUrl) URL.revokeObjectURL(this._qbState.contextUrl);
    this._qbState = null;
    this.loadQuestionBankBatches();
  },

  _qbKeyHandler(e) {
    if (!this._qbState) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.key === 'Escape') this._qbClose();
    else if (e.key === 'ArrowLeft') this._qbNav(-1);
    else if (e.key === 'ArrowRight') this._qbNav(1);
  },

  _qbNav(delta) {
    const s = this._qbState;
    if (!s) return;
    const next = s.index + delta;
    if (next < 0 || next >= s.questions.length) return;
    s.index = next;
    this._qbShowCurrent();
  },

  get _qbCurrentQuestion() {
    const s = this._qbState;
    return s ? s.questions[s.index] : null;
  },

  async _qbShowCurrent() {
    const s = this._qbState;
    const q = this._qbCurrentQuestion;
    if (!s || !q) return;

    document.getElementById('qbr-title').textContent = `Soru ${q.question_number ?? ''}`.trim() || 'Soru İnceleme';
    document.getElementById('qbr-counter').textContent = `${s.index + 1} / ${s.questions.length}`;
    const statusLabels = {
      pending_review: ['⏳ Onay Bekliyor', 'var(--warning)'],
      reviewed: ['👁️ İncelendi', 'var(--text-muted)'],
      approved: ['✅ Onaylandı', 'var(--success)'],
      excluded: ['🚫 Hariç Tutuldu', 'var(--danger)'],
    };
    const [label, color] = statusLabels[q.status] || statusLabels.pending_review;
    document.getElementById('qbr-status-badge').innerHTML = `<span style="color:${color};font-weight:700;font-size:12.5px">${label}</span>`;

    document.getElementById('qbr-difficulty-select').value = q.difficulty_level || '';
    document.getElementById('qbr-answer-select').value = q.correct_answer || '';
    document.getElementById('qbr-type-select').value = q.question_type || '';
    document.getElementById('qbr-explanation').value = q.explanation || '';

    await this._qbLoadTopics(q.subject_id, q.topic_id);
    await this._qbLoadOutcomes(q.topic_id, q.learning_outcome_id);
    document.getElementById('qbr-topic-select').onchange = (e) => {
      this._qbLoadOutcomes(parseInt(e.target.value) || null, null);
    };

    s.cropRect = { x: q.crop_x, y: q.crop_y, width: q.crop_width, height: q.crop_height };
    await this._qbLoadContextImage(q.id);
  },

  async _qbLoadContextImage(questionId) {
    const s = this._qbState;
    const img = document.getElementById('qbr-page-img');
    if (s.contextUrl) URL.revokeObjectURL(s.contextUrl);
    img.style.opacity = '0.3';
    try {
      const res = await fetch(`/api/admin/question-bank/questions/${questionId}/context-image`);
      if (!res.ok) throw new Error((await res.json()).error || 'Sayfa görüntüsü yüklenemedi.');
      s.pageWidthPt = parseFloat(res.headers.get('X-Page-Width-Pt'));
      s.pageHeightPt = parseFloat(res.headers.get('X-Page-Height-Pt'));
      const blob = await res.blob();
      s.contextUrl = URL.createObjectURL(blob);
      img.onload = () => { img.style.opacity = '1'; this._qbRenderCropOverlay(); };
      img.src = s.contextUrl;
    } catch (err) {
      img.style.opacity = '1';
      UI.toast(err.message, 'danger');
    }
  },

  _qbRenderCropOverlay() {
    const s = this._qbState;
    const img = document.getElementById('qbr-page-img');
    const box = document.getElementById('qbr-crop-box');
    if (!s || !s.cropRect || !img.clientWidth || !s.pageWidthPt) return;
    const scale = img.clientWidth / s.pageWidthPt;
    box.style.left = (s.cropRect.x * scale) + 'px';
    box.style.top = (s.cropRect.y * scale) + 'px';
    box.style.width = (s.cropRect.width * scale) + 'px';
    box.style.height = (s.cropRect.height * scale) + 'px';
  },

  _qbStartDrag(e, mode) {
    e.preventDefault();
    const s = this._qbState;
    if (!s) return;
    s.cropDrag = { mode, startClientX: e.clientX, startClientY: e.clientY, startRect: { ...s.cropRect } };
    this._qbOnDrag = this._qbOnDrag.bind(this);
    this._qbEndDrag = this._qbEndDrag.bind(this);
    document.addEventListener('mousemove', this._qbOnDrag);
    document.addEventListener('mouseup', this._qbEndDrag);
  },

  _qbOnDrag(e) {
    const s = this._qbState;
    const drag = s && s.cropDrag;
    if (!drag) return;
    const img = document.getElementById('qbr-page-img');
    const scale = img.clientWidth / s.pageWidthPt;
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;
    let { x, y, width, height } = drag.startRect;

    if (drag.mode === 'move') {
      x += dx; y += dy;
    } else {
      if (drag.mode.includes('w')) { x += dx; width -= dx; }
      if (drag.mode.includes('e')) { width += dx; }
      if (drag.mode.includes('n')) { y += dy; height -= dy; }
      if (drag.mode.includes('s')) { height += dy; }
    }
    width = Math.max(15, width);
    height = Math.max(15, height);
    x = Math.max(0, Math.min(x, s.pageWidthPt - width));
    y = Math.max(0, Math.min(y, s.pageHeightPt - height));

    s.cropRect = { x, y, width, height };
    this._qbRenderCropOverlay();
  },

  _qbEndDrag() {
    document.removeEventListener('mousemove', this._qbOnDrag);
    document.removeEventListener('mouseup', this._qbEndDrag);
    if (this._qbState) this._qbState.cropDrag = null;
  },

  _qbResetCrop() {
    const q = this._qbCurrentQuestion;
    if (!q || !this._qbState) return;
    this._qbState.cropRect = { x: q.crop_x, y: q.crop_y, width: q.crop_width, height: q.crop_height };
    this._qbRenderCropOverlay();
  },

  async _qbSaveCrop() {
    const s = this._qbState;
    const q = this._qbCurrentQuestion;
    if (!s || !q) return;
    try {
      const res = await fetch(`/api/admin/question-bank/questions/${q.id}/recrop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s.cropRect),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kırpma kaydedilemedi.');
      q.crop_x = data.cropX; q.crop_y = data.cropY; q.crop_width = data.cropWidth; q.crop_height = data.cropHeight;
      UI.toast('Kırpma güncellendi.', 'success');
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async _qbLoadTopics(subjectId, selectedId) {
    const s = this._qbState;
    const select = document.getElementById('qbr-topic-select');
    if (!s.topicsCache[subjectId]) {
      const res = await fetch(`/api/admin/question-bank/topics?subject_id=${subjectId}`);
      const data = await res.json();
      s.topicsCache[subjectId] = data.topics || [];
    }
    const topics = s.topicsCache[subjectId];
    select.innerHTML = `<option value="">— Konu seçilmedi —</option>` +
      topics.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    select.value = selectedId || '';
  },

  async _qbAddTopic() {
    const q = this._qbCurrentQuestion;
    const s = this._qbState;
    if (!q) return;
    const name = prompt('Yeni konu adı:');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch('/api/admin/question-bank/topics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId: q.subject_id, name: name.trim() }),
      });
      const topic = await res.json();
      if (!res.ok) throw new Error(topic.error || 'Konu eklenemedi.');
      delete s.topicsCache[q.subject_id];
      await this._qbLoadTopics(q.subject_id, topic.id);
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async _qbLoadOutcomes(topicId, selectedId) {
    const s = this._qbState;
    const select = document.getElementById('qbr-outcome-select');
    if (!topicId) {
      select.innerHTML = `<option value="">— Önce konu seçin —</option>`;
      return;
    }
    if (!s.outcomesCache[topicId]) {
      const res = await fetch(`/api/admin/question-bank/learning-outcomes?topic_id=${topicId}`);
      const data = await res.json();
      s.outcomesCache[topicId] = data.learningOutcomes || [];
    }
    const outcomes = s.outcomesCache[topicId];
    select.innerHTML = `<option value="">— Kazanım seçilmedi —</option>` +
      outcomes.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    select.value = selectedId || '';
  },

  async _qbAddOutcome() {
    const s = this._qbState;
    const topicId = parseInt(document.getElementById('qbr-topic-select').value);
    if (!topicId) { UI.toast('Önce bir konu seçin.', 'warning'); return; }
    const name = prompt('Yeni kazanım adı:');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch('/api/admin/question-bank/learning-outcomes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId, name: name.trim() }),
      });
      const outcome = await res.json();
      if (!res.ok) throw new Error(outcome.error || 'Kazanım eklenemedi.');
      delete s.outcomesCache[topicId];
      await this._qbLoadOutcomes(topicId, outcome.id);
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async _qbSaveFields(status) {
    const s = this._qbState;
    const q = this._qbCurrentQuestion;
    if (!s || !q) return;

    const payload = {
      topicId: parseInt(document.getElementById('qbr-topic-select').value) || null,
      learningOutcomeId: parseInt(document.getElementById('qbr-outcome-select').value) || null,
      difficultyLevel: parseInt(document.getElementById('qbr-difficulty-select').value) || null,
      questionType: document.getElementById('qbr-type-select').value || null,
      correctAnswer: document.getElementById('qbr-answer-select').value || null,
      explanation: document.getElementById('qbr-explanation').value || null,
    };
    if (status) payload.status = status;

    try {
      const res = await fetch(`/api/admin/question-bank/questions/${q.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi.');

      Object.assign(q, {
        topic_id: payload.topicId, learning_outcome_id: payload.learningOutcomeId,
        difficulty_level: payload.difficultyLevel, question_type: payload.questionType,
        correct_answer: payload.correctAnswer, explanation: payload.explanation,
      });
      if (status) q.status = status;

      UI.toast(status === 'approved' ? 'Soru onaylandı ✅' : status === 'excluded' ? 'Soru hariç tutuldu' : 'Kaydedildi 💾', 'success');

      if (status && s.index < s.questions.length - 1) {
        this._qbNav(1);
      } else if (status) {
        this._qbShowCurrent();
      }
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
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
      <!-- Yetkilendirme / Kullanıcı Yönetimi Kısayolu -->
      <div class="card" style="border: 1px solid rgba(16,185,129,0.3);background:rgba(15,23,42,0.75)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🔐</span> Öğretmen & Veli Erişimi</h3>
        </div>
        <p class="text-muted mb-2">
          Öğretmen ve veliler kendi hesaplarıyla giriş yaparak yalnızca yetkili oldukları verileri
          görebilir (öğretmen kendi sınıfını, veli kendi çocuğunu + genel ortalamaları).
          Hesap oluşturmak ve veriyi sunucuya göndermek için Kullanıcılar sayfasına gidin.
        </p>
        <button class="btn btn-primary" onclick="App.navigateTo('users')">🔐 Kullanıcılar Sayfasına Git</button>
      </div>

      <!-- Cloud Synchronization & Multi-Device Card -->
      <div class="card mt-2" style="border: 1px solid rgba(20,184,166,0.3);background:rgba(15,23,42,0.75)">
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
              <input type="checkbox" id="setting-auto-sync" style="width:20px;height:20px;accent-color:#0D9488;cursor:pointer" ${autoSync ? 'checked' : ''} onchange="SyncModule.setAutoSync(this.checked)">
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
          <div style="padding:14px;background:rgba(20,184,166,0.06);border-radius:10px">
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
          <div style="padding:16px;background:rgba(20,184,166,0.05);border-radius:12px;text-align:center">
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
      UI.toast('Lütfen Firebase yapılandırma metnini girin.', 'warning');
      return;
    }

    try {
      const config = this._parseFirebaseConfig(raw);
      const res = await SyncModule.connectFirebase(config, true);
      if (res.success) {
        SyncModule.setAutoSync(true);
        await SyncModule.pushLocalToCloud(true);
        this.renderSettings();
      }
    } catch (e) {
      UI.toast('Yapılandırma metni okunamadı! Firebase konsolundan kopyaladığınız "firebaseConfig" bloğunun tamamını yapıştırdığınızdan emin olun.', 'danger');
    }
  },

  // Firebase konsolu "const firebaseConfig = { apiKey: '...', ... };" şeklinde
  // saf JSON olmayan bir JS nesnesi verir (tırnaksız anahtarlar, başında
  // değişken tanımı, sonunda noktalı virgül). Kullanıcının bunu olduğu gibi
  // kopyalayıp yapıştırabilmesi için önce JSON olarak, olmazsa JS nesne
  // literali olarak ayrıştırmayı dener.
  _parseFirebaseConfig(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      const objectLiteral = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      // eslint-disable-next-line no-new-func
      return new Function('"use strict"; return (' + objectLiteral + ');')();
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
