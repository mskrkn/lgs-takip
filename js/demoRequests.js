// ============================================
// LGS Deneme Takip - EduPusula Demo Talepleri
// marketing/index.html'deki "Demo Talep Et" formundan gelen kayıtları listeler.
// EduPusula marka renkleriyle (teal aksan, pusula rozeti) stilize edilmiştir -
// bkz. marketing/tailwind.config.js için aynı palet.
// ============================================

const DemoRequests = {
  _colors: {
    ink: '#0F172A',
    teal: '#14B8A6',
    tealStrong: '#0F766E',
    success: '#22C55E',
    sky: '#3B82F6',
    amber: '#F59E0B',
  },

  async render() {
    const container = document.getElementById('page-demo-talepleri');
    if (!container) return;

    container.innerHTML = `<p class="text-muted">Yükleniyor...</p>`;

    let requests = [];
    try {
      const res = await fetch('/api/admin/demo-talepleri');
      if (!res.ok) throw new Error('Talepler yüklenemedi.');
      requests = await res.json();
    } catch (err) {
      container.innerHTML = `<div class="card"><p class="text-muted">❌ ${err.message}</p></div>`;
      return;
    }

    const c = this._colors;
    const thisWeek = requests.filter(r => this._isWithinDays(r.created_at, 7)).length;

    container.innerHTML = `
      <style>
        #edupusula-demo-wrap {
          --ep-ink: ${c.ink}; --ep-teal: ${c.teal}; --ep-teal-strong: ${c.tealStrong};
          --ep-success: ${c.success}; --ep-sky: ${c.sky}; --ep-amber: ${c.amber};
        }
        #edupusula-demo-wrap .ep-card {
          background: linear-gradient(160deg, rgba(20,184,166,0.10), rgba(20,184,166,0.02) 55%),
                      var(--bg-glass, rgba(255,255,255,0.03));
          border: 1px solid rgba(20,184,166,0.28);
          border-radius: 18px;
          padding: 22px 24px;
        }
        #edupusula-demo-wrap .ep-eyebrow {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px; font-weight: 600; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--ep-teal);
          display: flex; align-items: center; gap: 8px;
        }
        #edupusula-demo-wrap .ep-title { font-size: 19px; font-weight: 800; margin-top: 6px; color: var(--text-primary); }
        #edupusula-demo-wrap .ep-stats {
          display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px;
        }
        #edupusula-demo-wrap .ep-stat {
          flex: 1; min-width: 140px;
          background: rgba(20,184,166,0.08);
          border: 1px solid rgba(20,184,166,0.2);
          border-radius: 12px; padding: 12px 14px;
        }
        #edupusula-demo-wrap .ep-stat .num { font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: var(--ep-teal); }
        #edupusula-demo-wrap .ep-stat .label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        #edupusula-demo-wrap .ep-refresh {
          background: var(--ep-teal-strong); color: #fff; border: none;
          padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        #edupusula-demo-wrap .ep-refresh:hover { background: var(--ep-teal); }
        #edupusula-demo-wrap table { width: 100%; border-collapse: collapse; min-width: 680px; }
        #edupusula-demo-wrap th {
          text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--ep-teal); padding: 10px 10px; border-bottom: 1px solid rgba(20,184,166,0.25);
        }
        #edupusula-demo-wrap td { padding: 12px 10px; font-size: 13.5px; border-bottom: 1px solid var(--bg-glass-border); }
        #edupusula-demo-wrap tr:hover td { background: rgba(20,184,166,0.05); }
        #edupusula-demo-wrap a { color: var(--ep-teal); }
        #edupusula-demo-wrap .ep-pill {
          display: inline-block; font-size: 11.5px; font-weight: 600; padding: 3px 10px;
          border-radius: 999px; background: rgba(59,130,246,0.14); color: var(--ep-sky);
          font-family: 'JetBrains Mono', monospace;
        }
      </style>

      <div id="edupusula-demo-wrap">
        <div class="ep-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
            <div>
              <div class="ep-eyebrow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/><path d="M12 5.5 L13.6 12 L12 18.5 L10.4 12 Z" fill="currentColor" transform="rotate(35 12 12)"/></svg>
                EduPusula
              </div>
              <div class="ep-title">Demo Talepleri</div>
              <p class="text-muted mt-1" style="font-size:13px">Tanıtım sayfasındaki "Demo Talep Et" formundan gelen kayıtlar.</p>
            </div>
            <button class="ep-refresh" onclick="DemoRequests.render()">🔄 Yenile</button>
          </div>

          <div class="ep-stats">
            <div class="ep-stat"><div class="num">${requests.length}</div><div class="label">Toplam talep</div></div>
            <div class="ep-stat"><div class="num">${thisWeek}</div><div class="label">Son 7 gün</div></div>
          </div>

          <div id="demo-requests-list" style="margin-top:20px;overflow-x:auto">${this._renderTable(requests)}</div>
        </div>
      </div>
    `;
  },

  _renderTable(requests) {
    if (!requests.length) {
      return '<p class="text-muted">Henüz bir demo talebi gelmedi.</p>';
    }
    let html = `<table>
      <tr>
        <th>Okul / Kurum</th>
        <th>Yetkili</th>
        <th>E-posta</th>
        <th>Telefon</th>
        <th>Öğrenci Sayısı</th>
        <th>Tarih</th>
      </tr>`;
    requests.forEach(r => {
      html += `<tr>
        <td><b>${this._escape(r.okul)}</b></td>
        <td>${this._escape(r.yetkili_ad)}</td>
        <td><a href="mailto:${this._escape(r.eposta)}">${this._escape(r.eposta)}</a></td>
        <td>${this._escape(r.telefon) || '-'}</td>
        <td>${r.ogrenci_sayisi ? `<span class="ep-pill">${this._escape(r.ogrenci_sayisi)}</span>` : '-'}</td>
        <td class="text-muted">${this._formatDate(r.created_at)}</td>
      </tr>`;
    });
    html += '</table>';
    return html;
  },

  _isWithinDays(iso, days) {
    if (!iso) return false;
    const d = new Date(iso);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) <= days * 24 * 60 * 60 * 1000;
  },

  _formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  _escape(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },
};
