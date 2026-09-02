// ============================================
// LGS Deneme Takip - Analysis & Charts Module
// ============================================

const Analysis = {
  chartInstances: {},

  // Destroy an existing chart
  destroyChart(id) {
    if (this.chartInstances[id]) {
      this.chartInstances[id].destroy();
      delete this.chartInstances[id];
    }
  },

  // Destroy all charts
  destroyAllCharts() {
    Object.keys(this.chartInstances).forEach(id => this.destroyChart(id));
  },

  // ---- Chart.js Global Config ----
  getChartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#cbd5e1',
            font: { family: "'Plus Jakarta Sans', 'Inter', sans-serif", size: 12, weight: '600' },
            padding: 16,
            usePointStyle: true,
            boxWidth: 8,
          }
        },
        tooltip: {
          backgroundColor: 'rgba(11, 16, 34, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(15,118,110, 0.4)',
          borderWidth: 1,
          padding: 14,
          cornerRadius: 12,
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          titleFont: { family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '700', size: 13 },
          bodyFont: { family: "'Plus Jakarta Sans', 'Inter', sans-serif", size: 12 },
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { family: "'Plus Jakarta Sans', 'Inter', sans-serif", size: 11, weight: '500' } },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: { color: '#94a3b8', font: { family: "'Plus Jakarta Sans', 'Inter', sans-serif", size: 11, weight: '500' } },
          grid: { color: 'rgba(255,255,255,0.05)' },
        }
      }
    };
  },

  // ---- Render Radar Chart (Student exam performance across subjects) ----
  renderRadarChart(canvasId, result, averages, examType) {
    this.destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const subjects = getSubjectsForExam(examType);
    const labels = subjects.map(s => s.name);
    const studentNets = subjects.map(s => result.subjects?.[s.key]?.net || 0);
    const avgNets = subjects.map(s => averages?.[s.key] || 0);
    const maxNets = subjects.map(s => s.questions);

    this.chartInstances[canvasId] = new Chart(canvas, {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: 'Öğrenci Net',
            data: studentNets,
            borderColor: '#0D9488',
            backgroundColor: 'rgba(20,184,166, 0.15)',
            borderWidth: 2,
            pointBackgroundColor: '#0D9488',
            pointRadius: 4,
          },
          {
            label: 'Okul Ortalaması',
            data: avgNets,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointBackgroundColor: '#f59e0b',
            pointRadius: 3,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 }, usePointStyle: true, padding: 16 }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
          }
        },
        scales: {
          r: {
            angleLines: { color: 'rgba(255,255,255,0.06)' },
            grid: { color: 'rgba(255,255,255,0.06)' },
            pointLabels: { color: '#94a3b8', font: { family: 'Inter', size: 12, weight: '500' } },
            ticks: { color: '#64748b', backdropColor: 'transparent', font: { size: 10 } },
            suggestedMin: 0,
          }
        }
      }
    });
  },

  // ---- Render Line Chart (Subject trend across exams) ----
  renderSubjectTrendChart(canvasId, trendData, subjectKey) {
    this.destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const sub = SUBJECT_LOOKUP[subjectKey];
    if (!sub) return;

    const labels = trendData.map(t => t.exam.name);
    const correctData = trendData.map(t => t.subjects?.[subjectKey]?.correct || 0);
    const wrongData = trendData.map(t => t.subjects?.[subjectKey]?.wrong || 0);
    const netData = trendData.map(t => t.subjects?.[subjectKey]?.net || 0);

    this.chartInstances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Net',
            data: netData,
            borderColor: sub.color,
            backgroundColor: sub.color + '20',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: sub.color,
          },
          {
            label: 'Doğru',
            data: correctData,
            borderColor: '#10b981',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#10b981',
          },
          {
            label: 'Yanlış',
            data: wrongData,
            borderColor: '#ef4444',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#ef4444',
          },
        ]
      },
      options: {
        ...this.getChartDefaults(),
        plugins: {
          ...this.getChartDefaults().plugins,
          title: {
            display: true,
            text: `${sub.name} - Deneme Bazlı Trend`,
            color: '#f1f5f9',
            font: { family: 'Inter', size: 14, weight: '600' },
            padding: { bottom: 16 },
          }
        }
      }
    });
  },

  // ---- Render Total Net Trend Chart ----
  renderTotalNetTrendChart(canvasId, trendData) {
    this.destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const labels = trendData.map(t => t.exam.name);
    const totalNets = trendData.map(t => t.totalNet);

    this.chartInstances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Toplam Net',
          data: totalNets,
          borderColor: '#0D9488',
          backgroundColor: 'rgba(20,184,166, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: '#0D9488',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        }]
      },
      options: {
        ...this.getChartDefaults(),
        plugins: {
          ...this.getChartDefaults().plugins,
          title: {
            display: true,
            text: 'Toplam Net Trend',
            color: '#f1f5f9',
            font: { family: 'Inter', size: 14, weight: '600' },
            padding: { bottom: 16 },
          }
        }
      }
    });
  },

  // ---- Render All Subjects Trend Chart ----
  renderAllSubjectsTrendChart(canvasId, trendData) {
    this.destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!trendData || trendData.length === 0) return;

    // Farklı sınav türleri farklı ölçeklerde ders netleri taşıdığı için tek
    // grafikte karıştırılmaz: en son denemenin türüyle sınırlanır.
    const latestType = trendData[trendData.length - 1].exam.examType || 'LGS';
    const filtered = trendData.filter(t => (t.exam.examType || 'LGS') === latestType);

    const labels = filtered.map(t => t.exam.name);
    const subjects = getSubjectsForExam(latestType);

    const datasets = subjects.map(sub => ({
      label: sub.name,
      data: filtered.map(t => t.subjects?.[sub.key]?.net || 0),
      borderColor: sub.color,
      backgroundColor: sub.color + '15',
      borderWidth: 2,
      tension: 0.4,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: sub.color,
    }));

    this.chartInstances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...this.getChartDefaults(),
        plugins: {
          ...this.getChartDefaults().plugins,
          title: {
            display: true,
            text: `Tüm Dersler - Net Trend (${EXAM_TYPE_LABELS[latestType] || latestType})`,
            color: '#f1f5f9',
            font: { family: 'Inter', size: 14, weight: '600' },
            padding: { bottom: 16 },
          }
        }
      }
    });
  },

  // ---- Render School Average Trend Chart ----
  async renderSchoolAverageTrendChart(canvasId) {
    this.destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const [exams, averagesMap] = await Promise.all([
      db.getAllExams(),
      db.getAllExamsAverages()
    ]);
    if (exams.length === 0) return;

    // Sort by date ascending
    const sorted = [...exams].sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels = [];
    const avgNets = [];

    for (const exam of sorted) {
      const avg = averagesMap[exam.id];
      if (avg) {
        labels.push(exam.name);
        avgNets.push(avg.totalNet);
      }
    }

    this.chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Okul Ortalama Net',
          data: avgNets,
          backgroundColor: avgNets.map((_, i) => {
            const colors = ['rgba(20,184,166,0.6)', 'rgba(59,130,246,0.6)', 'rgba(245,158,11,0.6)', 'rgba(16,185,129,0.6)'];
            return colors[i % colors.length];
          }),
          borderColor: avgNets.map((_, i) => {
            const colors = ['#14B8A6', '#3B82F6', '#F59E0B', '#10b981'];
            return colors[i % colors.length];
          }),
          borderWidth: 2,
          borderRadius: 8,
          maxBarThickness: 60,
        }]
      },
      options: {
        ...this.getChartDefaults(),
        plugins: {
          ...this.getChartDefaults().plugins,
          title: {
            display: true,
            text: 'Okul Genel Ortalama Net Trendi',
            color: '#f1f5f9',
            font: { family: 'Inter', size: 14, weight: '600' },
            padding: { bottom: 16 },
          },
          legend: { display: false }
        }
      }
    });
  },

  // ---- Render Bar Chart for Exam Results Comparison ----
  renderExamSubjectBarsChart(canvasId, averages, examType) {
    this.destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const subjects = getSubjectsForExam(examType);
    const labels = subjects.map(s => s.name);
    const data = subjects.map(s => averages?.[s.key] || 0);
    const colors = subjects.map(s => s.color);

    this.chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Ortalama Net',
          data,
          backgroundColor: colors.map(c => c + '80'),
          borderColor: colors,
          borderWidth: 2,
          borderRadius: 8,
          maxBarThickness: 50,
        }]
      },
      options: {
        ...this.getChartDefaults(),
        indexAxis: 'y',
        plugins: {
          ...this.getChartDefaults().plugins,
          legend: { display: false },
        }
      }
    });
  },
};
