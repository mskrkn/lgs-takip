// ============================================
// LGS Deneme Takip - UI Utilities
// ============================================

const UI = {
  // ---- Toast Notifications ----
  toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: '✅',
      warning: '⚠️',
      danger: '❌',
      info: 'ℹ️',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type]}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ---- Modal ----
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  },

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.classList.remove('active');
    });
    document.body.style.overflow = '';
  },

  // ---- Confirm Dialog ----
  async confirm(message, title = 'Onay') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div class="modal" style="max-width: 420px;">
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="modal-close" data-action="cancel">✕</button>
          </div>
          <div class="modal-body">
            <p style="font-size: 15px; color: var(--text-secondary);">${message}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-action="cancel">İptal</button>
            <button class="btn btn-danger" data-action="confirm">Onayla</button>
          </div>
        </div>
      `;

      overlay.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'confirm') {
          overlay.remove();
          resolve(true);
        } else if (action === 'cancel' || e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });

      document.body.appendChild(overlay);
    });
  },

  // ---- Formatters ----
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  formatNet(net) {
    if (net == null) return '-';
    const val = parseFloat(net);
    const cls = val >= 15 ? 'high' : val >= 8 ? 'medium' : 'low';
    return `<span class="net-value ${cls}">${val.toFixed(2)}</span>`;
  },

  formatTrend(diff) {
    if (diff == null || diff === 0) return '<span class="trend-arrow stable">— 0</span>';
    if (diff > 0) return `<span class="trend-arrow up">↑ +${diff.toFixed(2)}</span>`;
    return `<span class="trend-arrow down">↓ ${diff.toFixed(2)}</span>`;
  },

  formatRank(rank, total) {
    if (!rank || !total) return '-';
    if (rank === 1) return `<span class="rank-badge rank-1">🥇 1 / ${total}</span>`;
    if (rank === 2) return `<span class="rank-badge rank-2">🥈 2 / ${total}</span>`;
    if (rank === 3) return `<span class="rank-badge rank-3">🥉 3 / ${total}</span>`;
    return `<span class="rank-badge">${rank} / ${total}</span>`;
  },

  getInitials(firstName, lastName) {
    return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase();
  },

  getSubjectClass(key) {
    return key;
  },

  // ---- Table Builder ----
  buildTable(columns, rows, options = {}) {
    let html = '<div class="table-wrapper"><table>';

    // Header
    html += '<thead><tr>';
    columns.forEach(col => {
      html += `<th style="${col.align === 'center' ? 'text-align:center' : col.align === 'right' ? 'text-align:right' : ''}">${col.label}</th>`;
    });
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    if (rows.length === 0) {
      html += `<tr><td colspan="${columns.length}" class="text-center text-muted" style="padding:40px">Veri bulunamadı</td></tr>`;
    } else {
      rows.forEach((row, idx) => {
        const rowClass = options.rowClass ? options.rowClass(row, idx) : '';
        html += `<tr class="${rowClass}" ${options.rowClick ? `onclick="${options.rowClick}(${row._id || idx})" style="cursor:pointer"` : ''}>`;
        columns.forEach(col => {
          const val = col.render ? col.render(row, idx) : (row[col.key] ?? '-');
          html += `<td style="${col.align === 'center' ? 'text-align:center' : col.align === 'right' ? 'text-align:right' : ''}">${val}</td>`;
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';

    return html;
  },

  // ---- Loading State ----
  showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:60px"><div class="loading-spinner" style="width:40px;height:40px;border-width:3px;margin:0 auto"></div><p class="text-muted mt-2">Yükleniyor...</p></div>';
  },

  // ---- Empty State ----
  showEmpty(containerId, icon, title, message, actionBtn = '') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <h3>${title}</h3>
        <p>${message}</p>
        ${actionBtn}
      </div>
    `;
  },

  // ---- Pagination helper ----
  paginate(items, page, perPage = 20) {
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return {
      items: items.slice(start, end),
      total: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  },

  // ---- Subject badge ----
  subjectBadge(key) {
    const sub = SUBJECT_LOOKUP[key];
    if (!sub) return '';
    return `<span class="subject-tag" style="background:${sub.color}29;color:${sub.color};border-color:${sub.color}4d">${sub.name}</span>`;
  },

  // ---- Alert badge ----
  alertBadge(type) {
    const map = {
      critical: { icon: '🔴', cls: 'badge-danger', text: 'Kritik Düşüş' },
      warning: { icon: '🟠', cls: 'badge-warning', text: 'Hafif Düşüş' },
      success: { icon: '🟢', cls: 'badge-success', text: 'Artış' },
      info: { icon: '🔵', cls: 'badge-info', text: 'Stabil' },
    };
    const m = map[type] || map.info;
    return `<span class="badge ${m.cls}">${m.icon} ${m.text}</span>`;
  },

  // ---- Download helper ----
  downloadFile(content, filename, mime = 'text/csv') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
