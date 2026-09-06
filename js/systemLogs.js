// ============================================
// LGS Deneme Takip - Platform Sahibi: Sistem Logları (Audit Log Görüntüleyici)
// Salt okunur - audit_logs tablosunu sayfalı gösterir. Sadece
// "organization.manage" iznine sahip (super_admin / platform sahibi admin)
// kullanıcılara açık (bkz. server.py api_superadmin_audit_logs,
// permission="system.logs").
// ============================================

function _logsEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

const SystemLogs = {
  _rows: [],
  _loading: false,

  async render() {
    const container = document.getElementById('page-system-logs');
    if (!container) return;
    this._rows = [];
    container.innerHTML = `
      <div class="card" style="border:1px solid rgba(20,184,166,0.3)">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">📜</span> Sistem Logları</h3>
        </div>
        <p class="text-muted" style="font-size:13px">Kritik işlemlerin (kullanıcı/okul oluşturma, düzenleme, pasifleştirme, veri aktarımı) kaydı - en yeniden eskiye.</p>
        <div id="system-logs-table"></div>
        <div style="text-align:center;margin-top:12px">
          <button class="btn btn-secondary btn-sm" id="system-logs-more" onclick="SystemLogs.loadMore()">Daha Fazla Yükle</button>
        </div>
      </div>
    `;
    await this.loadMore();
  },

  async loadMore() {
    if (this._loading) return;
    this._loading = true;
    const moreBtn = document.getElementById('system-logs-more');
    if (moreBtn) moreBtn.textContent = 'Yükleniyor...';
    try {
      const lastId = this._rows.length ? this._rows[this._rows.length - 1].id : null;
      const q = lastId ? `?before_id=${lastId}` : '';
      const res = await fetch(`/api/superadmin/audit-logs${q}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Loglar yüklenemedi.');
      const batch = await res.json();
      this._rows = this._rows.concat(batch);
      document.getElementById('system-logs-table').innerHTML = this._renderTable(this._rows);
      if (moreBtn) {
        moreBtn.textContent = 'Daha Fazla Yükle';
        moreBtn.style.display = batch.length < 50 ? 'none' : '';
      }
    } catch (err) {
      UI.toast(err.message, 'danger');
    } finally {
      this._loading = false;
    }
  },

  _renderTable(rows) {
    if (!rows.length) return '<p class="text-muted">Henüz kayıt yok.</p>';
    let html = `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse">
      <tr style="text-align:left;color:var(--text-muted);font-size:13px">
        <th style="padding:8px">Zaman</th><th style="padding:8px">İşlem</th>
        <th style="padding:8px">Yapan</th><th style="padding:8px">Kaynak</th><th style="padding:8px">IP</th>
      </tr>`;
    rows.forEach(r => {
      html += `<tr style="border-top:1px solid var(--bg-glass-border);font-size:13px">
        <td style="padding:8px;white-space:nowrap">${_logsEscapeHtml((r.createdAt || '').replace('T', ' ').slice(0, 19))}</td>
        <td style="padding:8px">${_logsEscapeHtml(r.action)}</td>
        <td style="padding:8px">${_logsEscapeHtml(r.actorDisplayName || r.actorUsername || '-')}</td>
        <td style="padding:8px">${_logsEscapeHtml(r.resourceType || '-')}${r.resourceId != null ? ' #' + _logsEscapeHtml(r.resourceId) : ''}</td>
        <td style="padding:8px">${_logsEscapeHtml(r.ipAddress || '-')}</td>
      </tr>`;
    });
    html += '</table></div>';
    return html;
  },
};
