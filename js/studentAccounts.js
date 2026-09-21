// Öğrenci hesaplarını toplu açma (kullanıcı adı = okul kodu + numara, geçici
// şifre = 4 haneli numara, ilk girişte zorunlu değiştirme) - Kullanıcılar
// sayfasındaki kart. Sunucu uçları: /api/admin/student-accounts*
const StudentAccounts = {
  _sheet: [],

  _q() {
    return (typeof AdminUsers !== 'undefined' && AdminUsers._schoolQuery) ? AdminUsers._schoolQuery() : '';
  },

  _esc(t) {
    return String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  },

  cardHtml() {
    return `
      <div class="card mt-2" id="student-accounts-card">
        <div class="card-header">
          <h3 class="card-title"><span class="card-icon">🎓</span> Öğrenci Hesaplarını Toplu Aç</h3>
        </div>
        <p class="text-muted mb-2" style="font-size:14px;line-height:1.6">
          Sunucuya senkronize edilmiş öğrenci listesindeki herkese hesap açar. Görünen isim = ad soyad,
          kullanıcı adı = <b>okul kodu + okul numarası</b> (örn. <b>dho59</b>), geçici şifre = numaranın 4 haneli hali
          (örn. <b>0059</b>). Öğrenci <b>ilk girişte şifresini değiştirmek zorundadır</b>, isterse kullanıcı adını da değiştirir.
          Zaten hesabı olanlara dokunulmaz; tekrar çalıştırmak güvenlidir.
          <br>⚠️ Hesaplar açıldıktan sonra öğrenci şifresini değiştirene kadar geçici şifre geçerlidir — listeyi dağıtmadan hemen önce açın.
        </p>
        <div id="sa-summary" class="text-muted" style="font-size:13px;margin-bottom:10px">Yükleniyor...</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label class="form-label" style="margin:0">Okul kodu:</label>
          <input type="text" id="sa-prefix" class="form-control" value="dho" maxlength="10" style="width:110px">
          <button class="btn btn-secondary" onclick="StudentAccounts.preview()">🔍 Ön İzleme</button>
          <button class="btn btn-primary" id="sa-run-btn" onclick="StudentAccounts.run()">🎓 Hesapları Oluştur</button>
        </div>
        <div id="sa-progress" style="margin-top:10px"></div>
        <div id="sa-result" style="margin-top:10px"></div>
        <hr style="margin:16px 0;border-color:rgba(255,255,255,0.08)">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="StudentAccounts.downloadSheet()">📥 Giriş Listesi (CSV) — henüz şifresini değiştirmemiş hesaplar</button>
          <input type="text" id="sa-reset-class" class="form-control" placeholder="Sınıf (örn: 8/A)" style="width:140px">
          <button class="btn btn-secondary" onclick="StudentAccounts.resetClass()">🔑 Sınıfın şifrelerini numaraya döndür</button>
        </div>
      </div>`;
  },

  async mount() {
    await this.refreshSummary();
  },

  async refreshSummary() {
    const el = document.getElementById('sa-summary');
    if (!el) return;
    try {
      const d = await fetch(`/api/admin/student-accounts${this._q()}`).then(r => r.json());
      if (d.error) { el.textContent = d.error; return; }
      this._sheet = d.sheet || [];
      el.innerHTML = `Sunucudaki öğrenci: <b>${d.totalStudents}</b> · Öğrenci hesabı: <b>${d.accounts}</b> · ` +
        `Şifresini henüz değiştirmemiş (hiç giriş yapmamış/geçici şifreli): <b>${d.pendingFirstLogin}</b>` +
        (d.totalStudents === 0 ? '<br>⚠️ Sunucuda öğrenci yok — önce Ayarlar\'dan bulut senkronizasyonunu çalıştırın.' : '');
    } catch (e) { el.textContent = 'Özet alınamadı.'; }
  },

  _warnings(d) {
    const e = (t) => this._esc(t);
    let html = '';
    if (d.noValidNumber?.length) {
      html += `<p style="margin:8px 0 2px">⚠️ <b>${d.noValidNumber.length}</b> öğrencinin okul numarası yok/rakam değil — hesap açılmadı:</p><div class="text-muted" style="font-size:12.5px">` +
        d.noValidNumber.slice(0, 15).map(s => `${e(s.name)} (${e(s.className || '-')}, no: ${e(s.schoolNumber || '-')})`).join(' · ') +
        (d.noValidNumber.length > 15 ? ' …' : '') + '</div>';
    }
    if (d.usernameConflicts?.length) {
      html += `<p style="margin:8px 0 2px">⚠️ <b>${d.usernameConflicts.length}</b> öğrenci için kullanıcı adı zaten başka bir hesapta kullanılıyor — açılmadı:</p><div class="text-muted" style="font-size:12.5px">` +
        d.usernameConflicts.slice(0, 15).map(s => `${e(s.name)} → ${e(s.username)}`).join(' · ') + '</div>';
    }
    if (d.sameNameGroups?.length) {
      html += `<p style="margin:8px 0 2px">ℹ️ Aynı ad soyadlı öğrenciler var (farklı kişi olduklarından emin olun):</p><div class="text-muted" style="font-size:12.5px">` +
        d.sameNameGroups.slice(0, 10).map(g => g.map(s => `${e(s.name)} (${e(s.className || '-')}, ${e(s.schoolNumber || '-')})`).join(' ↔ ')).join('<br>') + '</div>';
    }
    return html;
  },

  _prefix() {
    return (document.getElementById('sa-prefix')?.value || '').trim().toLowerCase();
  },

  async preview() {
    const res = document.getElementById('sa-result');
    const r = await fetch(`/api/admin/student-accounts/generate${this._q()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: this._prefix(), dryRun: true }),
    });
    const d = await r.json();
    if (!r.ok) { UI.toast(d.error || 'Ön izleme alınamadı', 'danger'); return; }
    res.innerHTML = `<p><b>${d.willCreate}</b> yeni hesap açılacak · ${d.alreadyHaveAccount} öğrencinin hesabı zaten var.</p>` + this._warnings(d);
  },

  async run() {
    const prefix = this._prefix();
    const btn = document.getElementById('sa-run-btn');
    const prog = document.getElementById('sa-progress');
    const res = document.getElementById('sa-result');
    const pre = await fetch(`/api/admin/student-accounts/generate${this._q()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, dryRun: true }),
    });
    const pd = await pre.json();
    if (!pre.ok) { UI.toast(pd.error || 'Hata', 'danger'); return; }
    if (!pd.willCreate) { UI.toast('Açılacak yeni hesap yok.', 'info'); res.innerHTML = this._warnings(pd); return; }
    const ok = await UI.confirm(`${pd.willCreate} öğrenci hesabı açılacak (kullanıcı adı: ${prefix}<numara>, geçici şifre: 4 haneli numara). Devam edilsin mi?`);
    if (!ok) return;

    btn.disabled = true;
    let created = 0;
    try {
      for (;;) {
        const r = await fetch(`/api/admin/student-accounts/generate${this._q()}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix, limit: 100 }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Hesap oluşturulamadı');
        created += d.createdCount;
        prog.innerHTML = `Oluşturuluyor... <b>${created}</b> / ${pd.willCreate}`;
        if (!d.remaining || !d.createdCount) break;
      }
      prog.innerHTML = '';
      res.innerHTML = `<p>✅ <b>${created}</b> hesap oluşturuldu. Aşağıdaki "Giriş Listesi"ni indirip sınıf öğretmenlerine dağıtabilirsiniz.</p>` + this._warnings(pd);
      UI.toast(`${created} öğrenci hesabı oluşturuldu`, 'success');
    } catch (e) {
      UI.toast(e.message, 'danger');
    } finally {
      btn.disabled = false;
      await this.refreshSummary();
    }
  },

  async downloadSheet() {
    await this.refreshSummary();
    if (!this._sheet.length) { UI.toast('Şifresini değiştirmemiş hesap yok.', 'info'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Sınıf', 'Ad Soyad', 'Kullanıcı Adı', 'Geçici Şifre'], ...this._sheet.map(s => [s.className, s.name, s.username, s.tempPassword])];
    const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\n');
    UI.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'ogrenci-giris-listesi.csv');
  },

  async resetClass() {
    const className = (document.getElementById('sa-reset-class')?.value || '').trim();
    if (!className) { UI.toast('Sınıf adını yazın (örn: 8/A)', 'warning'); return; }
    const ok = await UI.confirm(`${className} sınıfındaki TÜM öğrencilerin şifresi 4 haneli okul numarasına döndürülecek ve ilk girişte tekrar değiştirmeleri istenecek. Emin misiniz?`);
    if (!ok) return;
    const r = await fetch(`/api/admin/student-accounts/reset${this._q()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ className }),
    });
    const d = await r.json();
    if (!r.ok) { UI.toast(d.error || 'Hata', 'danger'); return; }
    UI.toast(`${d.reset} öğrencinin şifresi sıfırlandı${d.skipped ? ` (${d.skipped} atlandı: numara yok)` : ''}`, 'success');
    await this.refreshSummary();
  },
};
