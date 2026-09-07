// ============================================
// LGS Deneme Takip - Süper Admin: Okul (Organization) Yönetimi
// Okul listeleme, yeni okul (+ ilk yönetici hesabı) oluşturma, mevcut bir
// okulun ad/iletişim bilgilerini düzenleme ve aktif/pasif (soft archive)
// yapma. Her okulun admini kendi tarayıcısından bugünküyle birebir aynı
// şekilde çalışır (bkz. js/adminUsers.js) - burası sadece o hesapları açan
// panel + organizations tablosunun kendi metadata/durum yönetimi.
// ============================================

// js/adminUsers.js (bu dosyanin komsusu) kullanici verisini escape'lemeden
// basiyor - onunla ayni riski tekrarlamamak icin burada kendi kucuk
// yardimcimizi tutuyoruz (global bir escapeHtml sadece ogrenci/ogretmen
// panellerinde tanimli, admin kabugunda yuklu degil).
function _schoolsEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

// admin-panel-prompt.md bölüm 2 (Aktivite/Log Akışı) - denetim kaydı ham
// action kodlarını ("ORGANIZATION_CREATED") okunabilir bir cümleye çevirir.
// Kapsamadığı bir action için ham kodu döner (asla boş bırakmaz).
function _dashboardActivityLabel(row) {
  const org = row.organizationName ? `"${row.organizationName}" okulu` : 'Bir okul';
  const who = row.actorDisplayName || 'Bir kullanıcı';
  const map = {
    ORGANIZATION_CREATED: `${org} oluşturuldu`,
    ORGANIZATION_UPDATED: `${org} bilgileri güncellendi`,
    ORGANIZATION_STATUS_CHANGED: `${org} durumu değiştirildi`,
    ORGANIZATION_TRIAL_EXPIRING_SOON: `${org} trial süresi yakında doluyor`,
    ORGANIZATION_TRIAL_EXPIRED: `${org} trial süresini doldurdu, pasife alındı`,
    ORGANIZATION_TRIAL_EXTENDED: `${org} trial süresi uzatıldı`,
    ADMIN_CREATED: `${who} yeni bir admin hesabı oluşturdu`,
    ADMIN_UPDATED: `${who} bir admin hesabını güncelledi`,
    ADMIN_STATUS_CHANGED: `${who} bir admin hesabının durumunu değiştirdi`,
    USER_CREATED: `${org} yeni bir kullanıcı ekledi`,
    USER_DELETED: `${org} bir kullanıcıyı sildi`,
    USER_STATUS_CHANGED: `${org} bir kullanıcının durumunu değiştirdi`,
    DELEGATE_GRANTED: `${org} bir öğretmene yetki devretti`,
    DELEGATE_REVOKED: `${org} bir öğretmenin yetkisini geri aldı`,
    DATA_SYNCED: `${org} verilerini senkronize etti`,
    TEACHER_SELF_REGISTERED: `${org} - davet koduyla yeni bir öğretmen kaydoldu`,
    STUDENT_SELF_REGISTERED: `${org} - davet linkiyle yeni bir öğrenci kaydoldu`,
    PARENT_SELF_REGISTERED: `${org} - davet linkiyle yeni bir veli kaydoldu`,
  };
  return map[row.action] || `${org}: ${row.action}`;
}

const Schools = {

  // containerId: Faz I - Platform Sahibi/Admin Yardımcısı için bu içerik
  // artık "Anasayfa" (page-dashboard) olarak da render edilebiliyor (bkz.
  // js/app.js navigateTo 'dashboard' case) - kullanıcının kendi okulunun
  // öğrenci/sınıf detaylı ESKİ Anasayfa'sı yerine platform kontrol paneli
  // görmek istemesi üzerine. Varsayılan (parametre verilmezse) hâlâ
  // 'page-schools' - saf platform hesapları için değişmedi.
  async render(containerId = 'page-schools') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<p class="text-muted">Yükleniyor...</p>`;

    let schools = [], dashboard = null, attentionItems = [], rankings = null, pusiInsights = [], systemHealth = null;
    try {
      const [schoolsRes, dashRes, attnRes, rankRes, pusiRes, healthRes] = await Promise.all([
        fetch('/api/superadmin/organizations'),
        fetch('/api/superadmin/dashboard'),
        fetch('/api/superadmin/attention-items'),
        fetch('/api/superadmin/school-rankings'),
        fetch('/api/superadmin/pusi-insights'),
        fetch('/api/superadmin/system-health'),
      ]);
      if (!schoolsRes.ok) throw new Error((await schoolsRes.json()).error || 'Okullar yüklenemedi.');
      schools = await schoolsRes.json();
      dashboard = dashRes.ok ? await dashRes.json() : null;
      attentionItems = attnRes.ok ? await attnRes.json() : [];
      rankings = rankRes.ok ? await rankRes.json() : null;
      pusiInsights = pusiRes.ok ? await pusiRes.json() : [];
      systemHealth = healthRes.ok ? await healthRes.json() : null;
    } catch (err) {
      container.innerHTML = `<p class="text-muted">❌ ${err.message}</p>`;
      return;
    }
    this._schools = schools; // Duzenle formunun mevcut degerlerle doldurulmasi icin

    container.innerHTML = `
      ${this._renderAttentionPanel(attentionItems)}
      ${this._renderQuickActions()}
      ${this._renderPusiPanel(pusiInsights)}
      ${this._renderSystemHealthPanel(systemHealth)}
      ${dashboard ? this._renderDashboardSection(dashboard) : ''}
      ${rankings ? this._renderRankings(rankings) : ''}

      <div class="card mt-2" style="border:1px solid rgba(20,184,166,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🏫</span> Okullar</h3>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <input type="text" id="schools-search" class="form-control" style="max-width:260px" placeholder="Okul adı veya adres ara..." oninput="Schools._applyFilter()">
          <select id="schools-status-filter" class="form-control" style="max-width:160px" onchange="Schools._applyFilter()">
            <option value="">Tüm Durumlar</option>
            <option value="active">Aktif</option>
            <option value="trial">Trial</option>
            <option value="inactive">Pasif</option>
          </select>
        </div>
        <div id="schools-table-wrap">${this._renderSchoolsTable(schools)}</div>
      </div>

      <div class="card mt-2" id="edit-school-card" style="display:none"></div>

      <div class="card mt-2" id="new-school-card">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">➕</span> Yeni Okul Ekle</h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
          <div>
            <label class="form-label">Okul Adı</label>
            <input type="text" id="new-school-name" class="form-control" placeholder="Örn: Atatürk Ortaokulu">
          </div>
          <div>
            <label class="form-label">E-posta (opsiyonel)</label>
            <input type="text" id="new-school-email" class="form-control" placeholder="okul@ornek.com">
          </div>
          <div>
            <label class="form-label">Telefon (opsiyonel)</label>
            <input type="text" id="new-school-phone" class="form-control" placeholder="0xxx xxx xx xx">
          </div>
          <div>
            <label class="form-label">Adres (opsiyonel)</label>
            <input type="text" id="new-school-address" class="form-control" placeholder="Adres">
          </div>
          <div>
            <label class="form-label">Kullanıcı Limiti (opsiyonel)</label>
            <input type="number" min="1" id="new-school-limit" class="form-control" placeholder="Boş = sınırsız">
          </div>
          <div>
            <label class="form-label">Trial Bitiş Tarihi (opsiyonel)</label>
            <input type="date" id="new-school-trial-end" class="form-control">
          </div>
        </div>
        <p class="text-muted mt-2" style="font-size:13px">İlk Yönetici Hesabı</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
          <div>
            <label class="form-label">Görünen İsim</label>
            <input type="text" id="new-school-admin-displayname" class="form-control" placeholder="Örn: Okul Yöneticisi">
          </div>
          <div>
            <label class="form-label">Kullanıcı Adı</label>
            <input type="text" id="new-school-admin-username" class="form-control" placeholder="Örn: atakurt.admin">
          </div>
          <div>
            <label class="form-label">Şifre</label>
            <input type="text" id="new-school-admin-password" class="form-control" placeholder="En az 4 karakter">
          </div>
        </div>
        <button class="btn btn-primary mt-2" onclick="Schools.createSchool()">Okulu Oluştur</button>
        <div id="new-school-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
      </div>
    `;

    if (dashboard) this._renderExamChart(dashboard.examChart);
  },

  // Komuta Merkezi (Ana Sayfa Geliştirme Önerileri madde 2): "şu an
  // ilgilenmem gereken ne var" - dashboard KPI'larından ÖNCE, en üstte
  // gösterilir çünkü asıl cevaplanması gereken soru bu.
  _renderAttentionPanel(items) {
    if (!items.length) {
      return `<div class="card" style="border:1px solid rgba(74,222,128,0.3)">
        <p style="margin:0;color:#4ade80">✅ Şu an dikkat gerektiren bir durum yok.</p>
      </div>`;
    }
    const severityColor = { critical: '#fb7185', warning: '#fbbf24', info: '#60a5fa' };
    return `
      <div class="card" style="border:1px solid rgba(251,113,133,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🚨</span> Dikkat Gerekenler</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items.map(it => `
            <div onclick="App.navigateTo('${it.page}')" style="cursor:pointer;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border-left:3px solid ${severityColor[it.severity] || '#60a5fa'};display:flex;justify-content:space-between;align-items:center" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
              <span style="font-size:13px">${it.icon} ${_schoolsEscapeHtml(it.text)}</span>
              <span style="color:var(--text-muted);font-size:12px">→</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // Madde 10: Hızlı İşlemler - rol bazlı (Süper Admin/Admin Yardımcısı bu
  // sayfayı görür; admin oluşturma butonu SADECE canManageAdmins'te çıkar,
  // bkz. server.py ASSIGNABLE_ADMIN_SUBROLES ile aynı ayrım).
  _renderQuickActions() {
    const canManageAdmins = App.currentUser?.canManageAdmins;
    return `
      <div class="card mt-2">
        <div class="card-header"><h3 class="card-title"><span class="card-icon">⚡</span> Hızlı İşlemler</h3></div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          <button class="btn btn-secondary btn-sm" onclick="Schools._scrollToNewSchoolForm()">➕ Yeni Okul Ekle</button>
          ${canManageAdmins ? `<button class="btn btn-secondary btn-sm" onclick="App.navigateTo('admins')">🔐 Admin Ekle</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="App.navigateTo('system-logs')">📜 Sistem Logları</button>
        </div>
      </div>
    `;
  },

  _scrollToNewSchoolForm() {
    const card = document.getElementById('new-school-card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('new-school-name')?.focus();
  },

  // Madde 5: "Pusi'nin Günlük Analizi" - kural tabanlı (LLM değil, mevcut
  // AI-stub'larla aynı yaklaşım), Faz A-D verisinin basit bir özeti.
  _renderPusiPanel(insights) {
    if (!insights || !insights.length) return '';
    return `
      <div class="card mt-2" style="border:1px solid rgba(139,92,246,0.3);background:rgba(139,92,246,0.04)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🧭</span> Pusi'nin Günlük Analizi</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${insights.map(text => `<p style="margin:0;font-size:13px">${_schoolsEscapeHtml(text)}</p>`).join('')}
        </div>
      </div>
    `;
  },

  // Faz H: "Sistem Sağlığı" - basitleştirilmiş sinyal (gerçek CPU/RAM/ağ
  // izleme DEĞİL, server.py'deki /api/superadmin/system-health'in DB
  // gecikmesi + dosya boyutu + son 24s başarısız içe aktarma üzerinden
  // hesapladığı 3 sinyal).
  _renderSystemHealthPanel(health) {
    if (!health) return '';
    const statusMeta = {
      ok: { color: '#22C55E', label: 'İyi', icon: '🟢' },
      warning: { color: '#F59E0B', label: 'Dikkat', icon: '🟡' },
      critical: { color: '#EF4444', label: 'Kritik', icon: '🔴' },
    };
    const meta = statusMeta[health.status] || statusMeta.ok;
    return `
      <div class="card mt-2">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <h3 class="card-title"><span class="card-icon">🩺</span> Sistem Sağlığı</h3>
          <span style="font-size:12px;font-weight:700;color:${meta.color}">${meta.icon} ${meta.label}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:14px;font-size:13px">
          <div><div class="text-muted">Veritabanı Gecikmesi</div><div style="font-weight:700">${health.dbLatencyMs} ms</div></div>
          <div><div class="text-muted">Veritabanı Boyutu</div><div style="font-weight:700">${health.dbSizeMb} MB</div></div>
          <div><div class="text-muted">Son 24s Başarısız İçe Aktarma</div><div style="font-weight:700">${health.failedImportsLast24h}</div></div>
          <div><div class="text-muted">Çalışma Süresi</div><div style="font-weight:700">${this._formatUptime(health.uptimeSeconds)}</div></div>
        </div>
      </div>
    `;
  },

  _formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}g ${h}s`;
    if (h > 0) return `${h}s ${m}dk`;
    return `${m}dk`;
  },

  // Madde 6+7: "En Aktif Okullar" (haftalık liderlik tablosu) + "Aktivitesi
  // Düşen Okullar" (churn risk monitoring - bu hafta vs geçen hafta).
  _renderRankings(r) {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const topActiveHtml = r.topActive.length
      ? r.topActive.map((s, i) => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
            <span>${medals[i] || '•'} ${_schoolsEscapeHtml(s.name)}</span>
            <span style="color:var(--text-muted)">${s.examCount} deneme</span>
          </div>`).join('')
      : '<p class="text-muted" style="font-size:13px">Bu hafta henüz deneme yapılmadı.</p>';
    const decliningHtml = r.declining.length
      ? r.declining.map(s => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
            <span>${_schoolsEscapeHtml(s.name)}</span>
            <span style="color:#fb7185">↓ %${s.dropPercent} (${s.lastWeek}→${s.thisWeek})</span>
          </div>`).join('')
      : '<p class="text-muted" style="font-size:13px">Belirgin bir aktivite düşüşü yok.</p>';
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">🏆</span> Bu Haftanın En Aktif Okulları</h3></div>
          ${topActiveHtml}
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📉</span> Aktivitesi Düşen Okullar</h3></div>
          ${decliningHtml}
        </div>
      </div>
    `;
  },

  _renderDashboardSection(d) {
    const sc = d.schoolCounts;
    const rb = d.userRoleBreakdown || {};
    const roleTooltip = `Öğrenci: ${rb.students ?? 0} · Öğretmen: ${rb.teachers ?? 0} · Okul Yöneticisi: ${rb.schoolAdmins ?? 0} · Platform Admin: ${rb.platformAdmins ?? 0}`;
    return `
      <div class="stats-grid stats-grid-compact">
        <div class="stat-card">
          <div class="stat-icon purple">🏫</div>
          <div class="stat-value">${sc.total}</div>
          <div class="stat-label">Toplam Okul</div>
          <div class="stat-change" style="color:var(--text-muted)">✅ ${sc.active} Aktif · 🔵 ${sc.trial} Trial · ⏸️ ${sc.inactive} Pasif</div>
          ${d.schoolsAdded30d ? `<div class="stat-change" style="color:#4ade80">↑ Son 30 günde +${d.schoolsAdded30d} okul</div>` : ''}
        </div>
        <div class="stat-card" title="${_schoolsEscapeHtml(roleTooltip)}" style="cursor:help">
          <div class="stat-icon blue">👥</div>
          <div class="stat-value">${d.totalStudents}</div>
          <div class="stat-label">Toplam Öğrenci (Tüm Okullar)</div>
          <div class="stat-change" style="color:var(--text-muted)">👨‍🏫 ${rb.teachers ?? 0} öğretmen · 🏫 ${rb.schoolAdmins ?? 0} yönetici</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">📝</div>
          <div class="stat-value">${d.examsToday}</div>
          <div class="stat-label">Bugün Yapılan Deneme</div>
          <div class="stat-change" style="color:var(--text-muted)">Bu hafta: ${d.examsThisWeek}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange">⚠️</div>
          <div class="stat-value">${d.schoolsNearLimit}</div>
          <div class="stat-label">Limite Yaklaşan/Dolu Okul</div>
        </div>
      </div>

      <div class="card mt-2">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h3 class="card-title"><span class="card-icon">📈</span> Platform Büyümesi</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <select id="growth-chart-metric" class="form-control" style="width:auto;padding:6px 10px;font-size:12px" onchange="Schools._reloadGrowthChart()">
              <option value="exams">Deneme Sayısı</option>
              <option value="activeStudents">Aktif Öğrenci</option>
              <option value="newUsers">Yeni Kullanıcı</option>
            </select>
            <select id="growth-chart-range" class="form-control" style="width:auto;padding:6px 10px;font-size:12px" onchange="Schools._reloadGrowthChart()">
              <option value="7d">Son 7 Gün</option>
              <option value="30d" selected>Son 30 Gün</option>
              <option value="3m">Son 3 Ay</option>
              <option value="1y">Son 1 Yıl</option>
            </select>
          </div>
        </div>
        <div class="chart-container" style="height:220px">
          <canvas id="schools-exam-chart"></canvas>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px" class="mt-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">📝</span> Son Denemeler</h3></div>
          ${this._renderRecentExams(d.recentExams)}
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title"><span class="card-icon">🕒</span> Aktivite Akışı</h3></div>
          ${this._renderActivityFeed(d.recentActivity)}
        </div>
      </div>
    `;
  },

  _renderRecentExams(exams) {
    if (!exams || !exams.length) return '<p class="text-muted">Henüz deneme yok.</p>';
    return `<div style="display:flex;flex-direction:column;gap:8px">${exams.map(e => `
      <div style="display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid var(--bg-glass-border);padding-bottom:6px">
        <div>
          <div>${_schoolsEscapeHtml(e.name)}</div>
          <div style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml(e.organizationName || '-')} · ${_schoolsEscapeHtml((e.date || '').slice(0, 10))}</div>
        </div>
        <div style="color:var(--text-muted)">${e.participantCount} katılımcı</div>
      </div>
    `).join('')}</div>`;
  },

  _renderActivityFeed(rows) {
    if (!rows || !rows.length) return '<p class="text-muted">Henüz aktivite yok.</p>';
    return `<div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto">${rows.map(r => `
      <div style="font-size:13px;border-bottom:1px solid var(--bg-glass-border);padding-bottom:6px">
        <div>${_schoolsEscapeHtml(_dashboardActivityLabel(r))}</div>
        <div style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml((r.createdAt || '').replace('T', ' ').slice(0, 16))}</div>
      </div>
    `).join('')}</div>`;
  },

  _renderExamChart(points, label) {
    const canvas = document.getElementById('schools-exam-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (typeof Analysis !== 'undefined') Analysis.destroyChart('schools-exam-chart');
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: (points || []).map(p => p.date.slice(5)),
        datasets: [{
          label: label || 'Deneme Sayısı',
          data: (points || []).map(p => p.value ?? p.count ?? 0),
          borderColor: '#14B8A6',
          backgroundColor: 'rgba(20,184,166,0.12)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
        }],
      },
      options: (typeof Analysis !== 'undefined' && Analysis.getChartDefaults) ? Analysis.getChartDefaults() : { responsive: true, maintainAspectRatio: false },
    });
    if (typeof Analysis !== 'undefined') Analysis.chartInstances['schools-exam-chart'] = chart;
  },

  // Madde 4: tek grafik, metrik/zaman-araligi secicileriyle farkli
  // amaclarla kullanilabilsin diye - filtre degisince SADECE bu ucu tekrar
  // cagirir, tum dashboard'u yeniden cekmez.
  async _reloadGrowthChart() {
    const metric = document.getElementById('growth-chart-metric')?.value || 'exams';
    const range = document.getElementById('growth-chart-range')?.value || '30d';
    const labels = { exams: 'Deneme Sayısı', activeStudents: 'Aktif Öğrenci', newUsers: 'Yeni Kullanıcı' };
    try {
      const points = await fetch(`/api/superadmin/growth-chart?metric=${metric}&range=${range}`).then(r => r.json());
      this._renderExamChart(points, labels[metric]);
    } catch (e) {
      UI.toast('Grafik yüklenemedi.', 'danger');
    }
  },

  _applyFilter() {
    const q = (document.getElementById('schools-search')?.value || '').toLocaleLowerCase('tr-TR').trim();
    const status = document.getElementById('schools-status-filter')?.value || '';
    const filtered = (this._schools || []).filter(s => {
      const matchesQ = !q || s.name.toLocaleLowerCase('tr-TR').includes(q) || (s.address || '').toLocaleLowerCase('tr-TR').includes(q);
      const matchesStatus = !status || s.status === status;
      return matchesQ && matchesStatus;
    });
    document.getElementById('schools-table-wrap').innerHTML = this._renderSchoolsTable(filtered);
  },

  _renderSchoolsTable(schools) {
    if (!schools.length) return '<p class="text-muted">Henüz okul oluşturulmadı.</p>';
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Okul</th><th style="padding:8px">Öğrenci</th>
        <th style="padding:8px">Yönetici</th><th style="padding:8px">Durum</th>
        <th style="padding:8px">Son Aktivite</th><th style="padding:8px">Sistem Sağlığı</th>
        <th style="padding:8px"></th>
      </tr>`;
    schools.forEach(s => {
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px">${_schoolsEscapeHtml(s.name)}<br><span style="color:var(--text-muted);font-size:11px">${_schoolsEscapeHtml(s.slug)}</span></td>
        <td style="padding:8px">${this._studentCountCell(s)}</td>
        <td style="padding:8px">${s.adminCount}</td>
        <td style="padding:8px">${this._statusCell(s)}</td>
        <td style="padding:8px">${this._lastActivityCell(s.lastActivity)}</td>
        <td style="padding:8px">${this._healthCell(s.health)}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-sm" data-school-id="${s.id}" data-school-name="${_schoolsEscapeHtml(s.name).replace(/"/g, '&quot;')}" onclick="Schools.enterSchool(this)">🚪 Okula Gir</button>
          <button class="btn btn-secondary btn-sm" onclick="Schools.editSchool(${s.id})">✏️ Düzenle</button>
          <button class="btn btn-secondary btn-sm" onclick="Schools.toggleStatus(${s.id})">${s.status === 'inactive' ? '▶️ Aktifleştir' : '⏸️ Pasifleştir'}</button>
          <button class="btn btn-secondary btn-sm" onclick="Schools.promptExtendTrial(${s.id})">⏳ Trial Ayarla</button>
        </td>
      </tr>`;
    });
    html += '</table></div>';
    return html;
  },

  // %80'e kadar noral, %80-95 sari, %95+ kirmizi (bkz. admin-panel-prompt.md
  // bolum 3 "limite %80-90 yaklastiginda uyari rengi").
  _limitColor(count, limit) {
    if (!limit) return 'var(--text-primary)';
    const ratio = count / limit;
    if (ratio >= 0.95) return '#fb7185';
    if (ratio >= 0.8) return '#fbbf24';
    return 'var(--text-primary)';
  },

  _lastActivityCell(lastActivity) {
    if (!lastActivity) return '<span style="color:var(--text-muted)">—</span>';
    const days = Math.floor((new Date() - new Date(lastActivity)) / 86400000);
    if (days <= 0) return '<span style="color:#4ade80">Bugün</span>';
    if (days === 1) return '<span style="color:#4ade80">Dün</span>';
    if (days <= 7) return `<span style="color:#4ade80">${days} gün önce</span>`;
    if (days <= 30) return `<span style="color:#fbbf24">${days} gün önce</span>`;
    return `<span style="color:#fb7185">${days} gün önce</span>`;
  },

  _healthCell(health) {
    if (!health) return '—';
    const colors = { healthy: '#4ade80', warning: '#fbbf24', risky: '#fb7185' };
    const icons = { healthy: '🟢', warning: '🟡', risky: '🔴' };
    return `<span title="Giriş:${health.breakdown.loginRecency} Deneme:${health.breakdown.examActivity} Öğretmen:${health.breakdown.teacherActivity} Öğrenci:${health.breakdown.studentActivity} Veri:${health.breakdown.dataQuality}" style="cursor:help;color:${colors[health.band]}">${icons[health.band]} ${health.score}</span>`;
  },

  _studentCountCell(s) {
    if (!s.userLimit) return `${s.studentCount}`;
    return `<span style="color:${this._limitColor(s.studentCount, s.userLimit)}">${s.studentCount} / ${s.userLimit}</span>`;
  },

  _statusCell(s) {
    if (s.status === 'trial') {
      const daysLeft = s.trialEndsAt ? Math.ceil((new Date(s.trialEndsAt) - new Date()) / 86400000) : null;
      const label = daysLeft != null ? `${daysLeft >= 0 ? daysLeft : 0} gün kaldı` : '';
      return `<span style="color:#60a5fa">● Trial</span>${label ? `<br><span style="color:var(--text-muted);font-size:11px">${label}</span>` : ''}`;
    }
    if (s.status === 'active') return '<span style="color:#4ade80">● Aktif</span>';
    return '<span style="color:#fb7185">● Pasif</span>';
  },

  promptExtendTrial(schoolId) {
    const school = (this._schools || []).find(s => s.id === schoolId);
    if (!school) return;
    const current = school.trialEndsAt ? school.trialEndsAt.slice(0, 10) : '';
    const input = prompt(
      `"${school.name}" için trial bitiş tarihi (YYYY-AA-GG). Bugünden ileri bir tarih girin - okul Trial durumuna geçer/trial süresi uzar.`,
      current
    );
    if (!input) return;
    const trialEndsAt = `${input.trim()}T23:59:59`;
    this.extendTrial(schoolId, trialEndsAt);
  },

  async extendTrial(schoolId, trialEndsAt) {
    try {
      const res = await fetch(`/api/superadmin/organizations/${schoolId}/extend-trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trialEndsAt }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'İşlem başarısız.');
      UI.toast('Trial süresi güncellendi.', 'success');
      await this.render();
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  // Bu okulu super_admin adina "acar": Kullanicilar (hesap yonetimi,
  // js/adminUsers.js) VE Ogrenciler/Denemeler (salt okunur, sunucu
  // uzerinden - js/schoolView.js) sayfalari gorunur hale gelir. Ogrenci/
  // deneme EKLEME/DUZENLEME/SILME hala YOK - o hala o okulun kendi
  // tarayicisindaki yerel (IndexedDB) veri, super_admin'in tarayicisinda
  // o veri hic yok. data-* attribute'lardan okunuyor (JS string olarak
  // gomulseydi okul adindaki bir tirnak isareti HTML'i bozardi).
  enterSchool(btn) {
    const schoolId = Number(btn.dataset.schoolId);
    // Platform sahibi admin kendi okuluna "girerse" (Okullar listesinde
    // kendi okulu da gorunur) - salt-okunur SchoolView yerine normal (tam
    // yetkili) admin paneline dondur, actingSchool'i set ETME. Faz I'den
    // ONCE bu 'dashboard'a yonlendirirdi (o zaman kendi okulunun tam
    // yetkili paneliydi) - artik 'dashboard' Komuta Merkezi oldugu icin
    // dogrudan 'students'e (nav'da zaten gorunur, actingSchool null iken
    // normal/tam yetkili render eder) yonlendiriyoruz.
    if (App.currentUser?.organizationId && schoolId === App.currentUser.organizationId) {
      App.actingSchool = null;
      UI.toast('Bu zaten sizin okulunuz - normal panelden yönetebilirsiniz.', 'info');
      App.navigateTo('students');
      return;
    }
    App.actingSchool = { id: schoolId, name: btn.dataset.schoolName };
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.style.display = ['users', 'students', 'exams'].includes(item.dataset.page) ? '' : 'none';
    });
    App.navigateTo('users');
  },

  editSchool(schoolId) {
    const school = (this._schools || []).find(s => s.id === schoolId);
    if (!school) return;
    const card = document.getElementById('edit-school-card');
    card.style.display = '';
    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title"><span class="card-icon">✏️</span> "${_schoolsEscapeHtml(school.name)}" Okulunu Düzenle</h3>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
        <div>
          <label class="form-label">Okul Adı</label>
          <input type="text" id="edit-school-name" class="form-control" value="${_schoolsEscapeHtml(school.name)}">
        </div>
        <div>
          <label class="form-label">E-posta (opsiyonel)</label>
          <input type="text" id="edit-school-email" class="form-control" value="${_schoolsEscapeHtml(school.email || '')}">
        </div>
        <div>
          <label class="form-label">Telefon (opsiyonel)</label>
          <input type="text" id="edit-school-phone" class="form-control" value="${_schoolsEscapeHtml(school.phone || '')}">
        </div>
        <div>
          <label class="form-label">Adres (opsiyonel)</label>
          <input type="text" id="edit-school-address" class="form-control" value="${_schoolsEscapeHtml(school.address || '')}">
        </div>
        <div>
          <label class="form-label">Kullanıcı Limiti (opsiyonel)</label>
          <input type="number" min="1" id="edit-school-limit" class="form-control" value="${school.userLimit != null ? school.userLimit : ''}" placeholder="Boş = sınırsız">
        </div>
      </div>
      <div class="mt-2">
        <button class="btn btn-primary" onclick="Schools.saveSchoolEdit(${school.id})">Kaydet</button>
        <button class="btn btn-secondary" onclick="Schools.cancelSchoolEdit()">İptal</button>
      </div>
      <div id="edit-school-status" class="text-muted" style="margin-top:10px;font-size:13px"></div>
    `;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  cancelSchoolEdit() {
    const card = document.getElementById('edit-school-card');
    card.style.display = 'none';
    card.innerHTML = '';
  },

  async saveSchoolEdit(schoolId) {
    const name = document.getElementById('edit-school-name').value.trim();
    const email = document.getElementById('edit-school-email').value.trim();
    const phone = document.getElementById('edit-school-phone').value.trim();
    const address = document.getElementById('edit-school-address').value.trim();
    const userLimit = document.getElementById('edit-school-limit').value.trim() || null;
    const statusEl = document.getElementById('edit-school-status');
    statusEl.textContent = 'Kaydediliyor...';
    try {
      const res = await fetch(`/api/superadmin/organizations/${schoolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, address, userLimit }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Güncellenemedi.');
      UI.toast('Okul bilgileri güncellendi.', 'success');
      await this.render();
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      UI.toast(err.message, 'danger');
    }
  },

  async toggleStatus(schoolId) {
    try {
      const res = await fetch(`/api/superadmin/organizations/${schoolId}/toggle-status`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'İşlem başarısız.');
      UI.toast(result.status === 'active' ? 'Okul aktifleştirildi.' : 'Okul pasifleştirildi - bu okulun kullanıcıları artık giriş yapamaz.', 'info');
      await this.render();
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async createSchool() {
    const name = document.getElementById('new-school-name').value.trim();
    const email = document.getElementById('new-school-email').value.trim();
    const phone = document.getElementById('new-school-phone').value.trim();
    const address = document.getElementById('new-school-address').value.trim();
    const userLimit = document.getElementById('new-school-limit').value.trim() || null;
    const trialEndDate = document.getElementById('new-school-trial-end').value;
    const trialEndsAt = trialEndDate ? `${trialEndDate}T23:59:59` : null;
    const adminDisplayName = document.getElementById('new-school-admin-displayname').value.trim();
    const adminUsername = document.getElementById('new-school-admin-username').value.trim();
    const adminPassword = document.getElementById('new-school-admin-password').value;

    const statusEl = document.getElementById('new-school-status');
    statusEl.textContent = 'Oluşturuluyor...';
    try {
      const res = await fetch('/api/superadmin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone, address, userLimit, trialEndsAt,
          adminDisplayName, adminUsername, adminPassword,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Okul oluşturulamadı.');
      UI.toast(`"${result.organization.name}" okulu ve yöneticisi oluşturuldu.`, 'success');
      await this.render();
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      UI.toast(err.message, 'danger');
    }
  },
};
