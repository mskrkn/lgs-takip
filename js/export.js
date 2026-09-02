// ============================================
// LGS Deneme Takip - Export Module (PDF Report & Share)
// ============================================

const ExportModule = {
  // ---- Generate Student PDF Report ----
  async generateStudentReport(studentId) {
    const student = await db.getStudent(studentId);
    if (!student) {
      UI.toast('Öğrenci bulunamadı', 'danger');
      return;
    }

    const trend = await db.getStudentTrend(studentId);
    const alerts = await db.getStudentAlerts(studentId);

    // Create PDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Title
    doc.setFillColor(20, 184, 166);
    doc.rect(0, 0, pageWidth, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('LGS Deneme Takip Raporu', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`${student.firstName} ${student.lastName} - ${student.schoolNumber}`, pageWidth / 2, 24, { align: 'center' });
    doc.setFontSize(9);
    doc.text(`Oluşturulma Tarihi: ${new Date().toLocaleDateString('tr-TR')}`, pageWidth / 2, 31, { align: 'center' });

    y = 45;
    doc.setTextColor(0, 0, 0);

    // Student Info
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Öğrenci Bilgileri', 15, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Ad Soyad: ${student.firstName} ${student.lastName}`, 15, y);
    y += 5;
    doc.text(`Okul No: ${student.schoolNumber}`, 15, y);
    y += 5;
    doc.text(`Sınıf: ${student.className || '-'}`, 15, y);
    y += 5;
    doc.text(`Toplam Deneme: ${trend.length}`, 15, y);
    y += 10;

    // Alerts
    if (alerts.length > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Uyarılar', 15, y);
      y += 7;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');

      alerts.forEach(alert => {
        const icon = alert.type === 'critical' ? '⚠' : alert.type === 'warning' ? '!' : '✓';
        const text = `${icon} ${alert.subject.name}: ${alert.diff > 0 ? '+' : ''}${alert.diff.toFixed(2)} net (${alert.prevNet.toFixed(2)} → ${alert.currNet.toFixed(2)})`;
        if (alert.type === 'critical') doc.setTextColor(220, 38, 38);
        else if (alert.type === 'warning') doc.setTextColor(245, 158, 11);
        else doc.setTextColor(16, 185, 129);
        doc.text(text, 15, y);
        y += 5;
      });
      doc.setTextColor(0, 0, 0);
      y += 5;
    }

    // Exam results table(s) — farklı sınav türleri (LGS/TYT/AYT...) farklı ders
    // setleri taşıdığı için tek tabloda birleştirilmez, her tür kendi tablosunda
    // basılır (bkz. App.buildProfileAllExamsTable ile aynı mantık).
    if (trend.length > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Deneme Sonuçları', 15, y);
      y += 8;

      const groups = new Map();
      trend.forEach(entry => {
        const type = entry.exam.examType || 'LGS';
        if (!groups.has(type)) groups.set(type, []);
        groups.get(type).push(entry);
      });

      for (const [type, groupEntries] of groups.entries()) {
        if (y > 260) { doc.addPage(); y = 20; }

        const subjects = getSubjectsForExam(type);
        if (groups.size > 1) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text(`${EXAM_TYPE_LABELS[type] || type} Denemeleri`, 15, y);
          y += 6;
        }

        // Table header
        const cols = ['Deneme', ...subjects.map(s => s.name.substring(0, 6)), 'Toplam', 'Sıra'];
        const fixedWidth = 30 + 18 + 18; // Deneme + Toplam + Sıra
        const availableWidth = pageWidth - 24 - fixedWidth;
        const subColWidth = Math.max(12, availableWidth / subjects.length);
        const colWidths = [30, ...subjects.map(() => subColWidth), 18, 18];

        doc.setFillColor(240, 240, 255);
        doc.rect(12, y - 4, pageWidth - 24, 7, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        let x = 15;
        cols.forEach((col, i) => {
          doc.text(col, x, y);
          x += colWidths[i];
        });
        y += 6;

        // Data rows
        doc.setFont('helvetica', 'normal');
        for (const entry of groupEntries) {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }

          // Get ranking
          const rankings = await db.getExamRankings(entry.examId);
          const myRank = rankings.find(r => r.studentId === studentId);

          x = 15;
          doc.setFontSize(7);
          doc.text(entry.exam.name.substring(0, 15), x, y);
          x += colWidths[0];

          subjects.forEach((sub, i) => {
            const net = entry.subjects?.[sub.key]?.net || 0;
            doc.text(net.toFixed(1), x, y);
            x += colWidths[i + 1];
          });

          doc.text(entry.totalNet.toFixed(1), x, y);
          x += colWidths[cols.length - 2];
          doc.text(myRank ? `${myRank.rank}/${myRank.totalStudents}` : '-', x, y);

          y += 5;
        }
        y += 6;
      }
    }

    // Save
    const filename = `${student.firstName}_${student.lastName}_Rapor_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    UI.toast('PDF rapor indirildi!', 'success');
  },

  // ---- Generate Exam Summary Report ----
  async generateExamReport(examId) {
    const exam = await db.getExam(examId);
    if (!exam) return;

    const rankings = await db.getExamRankings(examId);
    const averages = await db.getExamAverages(examId);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 15;

    // Title
    doc.setFillColor(20, 184, 166);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`${exam.name} - Sonuç Raporu`, pageWidth / 2, 13, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Tarih: ${UI.formatDate(exam.date)} | Öğrenci Sayısı: ${rankings.length} | Ort. Net: ${averages?.totalNet?.toFixed(2) || '-'}`, pageWidth / 2, 23, { align: 'center' });

    y = 40;
    doc.setTextColor(0, 0, 0);

    // Table
    const subjects = getSubjectsForExam(exam);
    const cols = ['Sıra', 'Okul No', 'Ad Soyad', 'Sınıf', ...subjects.map(s => `${s.name.substring(0, 8)} Net`), 'Toplam Net'];
    const fixedWidth = 12 + 22 + 40 + 15 + 22; // Sıra + Okul No + Ad Soyad + Sınıf + Toplam Net
    const subColWidth = Math.max(14, (pageWidth - 16 - fixedWidth) / subjects.length);
    const colWidths = [12, 22, 40, 15, ...subjects.map(() => subColWidth), 22];

    // Header
    doc.setFillColor(240, 240, 255);
    doc.rect(8, y - 4, pageWidth - 16, 7, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    let x = 10;
    cols.forEach((col, i) => {
      doc.text(col, x, y);
      x += colWidths[i];
    });
    y += 6;

    // Rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    for (const entry of rankings) {
      if (y > 190) {
        doc.addPage();
        y = 20;
      }

      x = 10;
      doc.text(String(entry.rank), x, y);
      x += colWidths[0];
      doc.text(entry.student?.schoolNumber || '-', x, y);
      x += colWidths[1];
      doc.text(`${entry.student?.firstName || ''} ${entry.student?.lastName || ''}`.substring(0, 25), x, y);
      x += colWidths[2];
      doc.text(entry.student?.className || '-', x, y);
      x += colWidths[3];

      subjects.forEach((sub, i) => {
        const net = entry.subjects?.[sub.key]?.net || 0;
        doc.text(net.toFixed(1), x, y);
        x += colWidths[4 + i];
      });

      doc.text(entry.totalNet.toFixed(1), x, y);
      y += 4.5;
    }

    const filename = `${exam.name}_Rapor_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    UI.toast('Deneme raporu indirildi!', 'success');
  },

  // ---- Export All Data as JSON ----
  async exportAllData() {
    const data = await db.exportData();
    const json = JSON.stringify(data, null, 2);
    UI.downloadFile(json, `lgs_denemetakip_yedek_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    UI.toast('Tüm veriler JSON olarak dışa aktarıldı', 'success');
  },

  // ---- Import Data from JSON ----
  async importFromJSON(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await db.importData(data);
      UI.toast('Veriler başarıyla içe aktarıldı', 'success');
      if (typeof App !== 'undefined') App.refreshCurrentPage();
    } catch (err) {
      UI.toast('JSON dosyası okunamadı: ' + err.message, 'danger');
    }
  },

  // ---- Generate Shareable Link (Base64 encoded data in URL) ----
  async generateShareableLink(studentId) {
    const student = await db.getStudent(studentId);
    const trend = await db.getStudentTrend(studentId);

    const shareData = {
      student: { firstName: student.firstName, lastName: student.lastName, schoolNumber: student.schoolNumber, className: student.className },
      results: trend.map(t => ({
        examName: t.exam.name,
        examDate: t.exam.date,
        examType: t.exam.examType || 'LGS',
        subjects: t.subjects,
        totalNet: t.totalNet,
      })),
    };

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareData))));
    const url = `${window.location.origin}${window.location.pathname}?share=${encoded}`;

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      UI.toast('Paylaşım linki panoya kopyalandı!', 'success');
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      UI.toast('Paylaşım linki panoya kopyalandı!', 'success');
    }

    return url;
  },

  // ---- Render Shared Data ----
  renderSharedView(data) {
    const student = data.student;
    const results = data.results;

    // Farklı sınav türleri karışmasın diye (bkz. App.buildProfileAllExamsTable),
    // her tür kendi tablosunda gösterilir. Bu görünüm db'ye erişemediği için
    // (paylaşılan bir bağlantıdan tek başına açılabilir) tür bilgisi doğrudan
    // her sonucun içine gömülü gelir (generateShareableLink).
    const groups = new Map();
    results.forEach(r => {
      const type = r.examType || 'LGS';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(r);
    });

    const tablesHtml = [...groups.entries()].map(([type, rows]) => {
      const subjects = getSubjectsForExam(type);
      return `
        <div class="card mt-2">
          <div class="card-header">
            <h3 class="card-title"><span class="card-icon">📊</span> ${groups.size > 1 ? `${EXAM_TYPE_LABELS[type] || type} ` : ''}Deneme Sonuçları</h3>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Deneme</th>
                  ${subjects.map(s => `<th style="text-align:center">${s.name}</th>`).join('')}
                  <th style="text-align:center">Toplam</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td><strong>${r.examName}</strong><br><small class="text-muted">${UI.formatDate(r.examDate)}</small></td>
                    ${subjects.map(s => `<td style="text-align:center">${UI.formatNet(r.subjects?.[s.key]?.net)}</td>`).join('')}
                    <td style="text-align:center"><strong>${UI.formatNet(r.totalNet)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="max-width:900px;margin:0 auto;padding:32px 20px;">
        <div class="card">
          <div class="profile-header">
            <div class="profile-avatar">${UI.avatar()}</div>
            <div class="profile-info">
              <h2>${student.firstName} ${student.lastName}</h2>
              <p>Okul No: ${student.schoolNumber} ${student.className ? `• Sınıf: ${student.className}` : ''}</p>
            </div>
          </div>
        </div>
        ${tablesHtml}
      </div>
    `;
  },
};
