    /* ===============================================
       EduPusula Öğrenci Paneli — JavaScript Mantığı
       Tüm orijinal fonksiyonlar korundu + yeni UI
       =============================================== */

    // ----- Yardımcı: konu/ders adı ve ikonu -----
    function subjectName(key) {
      return (typeof SUBJECT_LOOKUP !== 'undefined' && SUBJECT_LOOKUP[key]) ? SUBJECT_LOOKUP[key].name : key;
    }
    function subjectIcon(key) {
      const k = (key || '').toLowerCase();
      if (k.includes('mat')) return '🧮';
      if (k.includes('turkce') || k.includes('edebiyat')) return '📖';
      if (k.includes('fen') || k.includes('fizik') || k.includes('kimya') || k.includes('biyo')) return '🔬';
      if (k.includes('ingilizce') || (k.includes('dil') && !k.includes('edebiyat'))) return '🌍';
      if (k.includes('inkilap') || k.includes('inkılap') || k.includes('tarih') || k.includes('sosyal') || k.includes('cografya') || k.includes('coğrafya')) return '🏛️';
      if (k.includes('din')) return '🕌';
      if (k.includes('felsefe')) return '🧠';
      return '📘';
    }
    function subjectColor(key) {
      const k = (key || '').toLowerCase();
      if (k.includes('mat'))      return '#3b82f6';
      if (k.includes('turkce') || k.includes('edebiyat')) return '#f43f5e';
      if (k.includes('fen'))      return '#10b981';
      if (k.includes('inkilap') || k.includes('inkılap') || k.includes('tarih')) return '#f59e0b';
      if (k.includes('din'))      return '#8b5cf6';
      if (k.includes('ingilizce')) return '#f97316';
      return '#0D9488';
    }

    function comingSoon(label) { alert(`${label} çok yakında burada olacak! 🚀`); }
    function escapeHtml(str) {
      return String(str === null || str === undefined ? '' : str)
        .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function chartDefaults() {
      return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#cbd5e1', font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' }, padding: 16, usePointStyle: true, boxWidth: 8 } },
          tooltip: { backgroundColor: 'rgba(11,16,34,0.95)', titleColor:'#fff', bodyColor:'#cbd5e1', borderColor:'rgba(20,184,166,0.4)', borderWidth:1, padding:14, cornerRadius:12 },
        },
        scales: {
          x: { ticks: { color:'#94a3b8', font:{size:11} }, grid: { color:'rgba(255,255,255,0.05)' } },
          y: { ticks: { color:'#94a3b8', font:{size:11} }, grid: { color:'rgba(255,255,255,0.05)' } },
        },
      };
    }

    let radarChart = null, areaChart = null, scoreRadarChart = null;
    let studentData = null;      // /api/student/overview yaniti - Pusula AI hizli sorulari icin
    let netTrendWindow = 'all';  // 'last5' | 'last10' | 'all' - Gelisim Yolculugun filtresi
    let activeExamTab = 'GENERAL'; // 'GENERAL' | 'MASTERY' - bkz. renderExamResultsList
    let lastExamResults = [];
    let lastMasteryTrend = [];
    let masteryTrendChart = null;
    let activeMasteryKazanim = null;
    let activeMasterySubject = 'ALL'; // Kazanım Denemeleri ders filtresi

    // Genel Deneme / Kazanım Denemesi (Optik Okuma/OMR) ayrımı - "asla
    // karışmaz" ilkesi (bkz. Faz 1 planı). examType==='optik_kamera' TEK
    // güvenilir ayrım işareti (server.py _is_mastery_exam_type ile aynı).
    function isMasteryExam(exam) {
      return exam && exam.examType === 'optik_kamera';
    }

    // Kazanım Denemesinin ders adı (sunucu: results[].subjectName /
    // masteryTrend[].subjectName) - tanımsız ders "Diğer" altında toplanır.
    function masterySubject(x) {
      return (x && x.subjectName && x.subjectName !== '-') ? x.subjectName : 'Diğer';
    }

    // Ders filtresine uyan Kazanım Gelişimi grupları
    function visibleMasteryTrend() {
      return activeMasterySubject === 'ALL' ? lastMasteryTrend : lastMasteryTrend.filter(g => masterySubject(g) === activeMasterySubject);
    }

    function renderExamResultsList(results, masteryTrend) {
      lastExamResults = results || [];
      if (masteryTrend !== undefined) lastMasteryTrend = masteryTrend || [];
      let filtered = lastExamResults.filter(r => activeExamTab === 'MASTERY' ? isMasteryExam(r) : !isMasteryExam(r));
      const tabsHtml = `
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <button class="btn btn-sm ${activeExamTab === 'GENERAL' ? 'btn-primary' : 'btn-secondary'}" onclick="window._ogrSetExamTab('GENERAL')">📘 Genel Denemeler</button>
          <button class="btn btn-sm ${activeExamTab === 'MASTERY' ? 'btn-primary' : 'btn-secondary'}" onclick="window._ogrSetExamTab('MASTERY')">🎯 Kazanım Denemeleri</button>
        </div>
        ${activeExamTab === 'MASTERY' ? `<button type="button" class="km-link" onclick="window._ogrOpenDashView('mastery')">📚 Ders ders, konu konu detaylı analiz →</button>` : ''}`;
      // Ders seçici - Kazanım Denemeleri sekmesinde, birden fazla ders varsa.
      // Hem deneme tablosunu hem Kazanım Gelişimi grafiğini filtreler.
      let subjectFilterHtml = '';
      if (activeExamTab === 'MASTERY') {
        const subjects = [...new Set(filtered.map(masterySubject).concat(lastMasteryTrend.map(masterySubject)))].sort((a, b) => a.localeCompare(b, 'tr'));
        if (activeMasterySubject !== 'ALL' && !subjects.includes(activeMasterySubject)) activeMasterySubject = 'ALL';
        if (subjects.length > 1) {
          subjectFilterHtml = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <label for="mastery-subject-select" style="font-weight:600">Ders:</label>
              <select id="mastery-subject-select" class="form-control" style="max-width:220px" onchange="window._ogrSetMasterySubject(this.value)">
                <option value="ALL"${activeMasterySubject === 'ALL' ? ' selected' : ''}>Tüm Dersler</option>
                ${subjects.map(s => `<option value="${escapeHtml(s)}"${s === activeMasterySubject ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}
              </select>
            </div>`;
        }
        if (activeMasterySubject !== 'ALL') filtered = filtered.filter(r => masterySubject(r) === activeMasterySubject);
      }
      const trend = visibleMasteryTrend();
      // Kazanım Gelişimi grafiği (Faz 3) - sadece Kazanım Denemeleri
      // sekmesinde, kazanım koduna göre gruplanmış zaman-içi başarı yüzdesi.
      const masteryChartHtml = (activeExamTab === 'MASTERY' && trend.length) ? `
        <div class="ep-empty" style="text-align:left;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <h4 style="margin:0">🎯 Kazanım Gelişimi</h4>
            ${trend.length > 1 ? `
              <select id="mastery-kazanim-select" class="form-control" style="max-width:260px" onchange="window._ogrSetMasteryKazanim(this.value)">
                ${trend.map(g => `<option value="${escapeHtml(g.kazanimKodu)}"${g.kazanimKodu === activeMasteryKazanim ? ' selected' : ''}>${activeMasterySubject === 'ALL' ? escapeHtml(g.subjectName) + ' - ' : ''}${escapeHtml(g.kazanimAdi)}</option>`).join('')}
              </select>` : ''}
          </div>
          <div style="height:220px;margin-top:10px"><canvas id="mastery-trend-chart"></canvas></div>
        </div>` : '';
      if (!filtered.length) {
        document.getElementById('exam-results').innerHTML = tabsHtml + subjectFilterHtml + masteryChartHtml + '<div class="ep-empty"><div class="ep-empty-icon">📝</div>Bu kategoride henüz deneme sonucu bulunmuyor.</div>';
        if (masteryChartHtml) renderMasteryTrendChart();
        return;
      }
      const isMastery = activeExamTab === 'MASTERY';
      document.getElementById('exam-results').innerHTML = tabsHtml + subjectFilterHtml + masteryChartHtml + `
        <div style="overflow-x:auto"><table class="ep-exams-table">
          <tr><th>Deneme</th>${isMastery ? '<th>Ders</th>' : ''}<th>Tarih</th><th>Toplam Net</th></tr>
          ${filtered.map(r => `<tr><td>${escapeHtml(r.examName)}</td>${isMastery ? `<td>${escapeHtml(masterySubject(r))}</td>` : ''}<td>${escapeHtml(r.examDate)||'—'}</td><td class="ep-net-badge">${r.totalNet}</td></tr>`).join('')}
        </table></div>`;
      if (masteryChartHtml) renderMasteryTrendChart();
    }

    function renderMasteryTrendChart() {
      const canvas = document.getElementById('mastery-trend-chart');
      const trend = visibleMasteryTrend();
      if (!canvas || !trend.length) return;
      const group = trend.find(g => g.kazanimKodu === activeMasteryKazanim) || trend[0];
      activeMasteryKazanim = group.kazanimKodu;
      if (masteryTrendChart) { masteryTrendChart.destroy(); masteryTrendChart = null; }
      masteryTrendChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: group.points.map(p => p.date || p.examName),
          datasets: [{
            label: `${group.subjectName} - ${group.kazanimAdi}`,
            data: group.points.map(p => p.successRate),
            borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.15)',
            borderWidth: 3, fill: true, tension: 0.3, pointRadius: 4,
          }],
        },
        options: { ...chartDefaults(), scales: { y: { min: 0, max: 100, ticks: { color: '#64748b', callback: v => v + '%' } } } },
      });
    }

    window._ogrSetMasteryKazanim = function (kazanimKodu) {
      activeMasteryKazanim = kazanimKodu;
      renderMasteryTrendChart();
    };

    window._ogrSetMasterySubject = function (subject) {
      activeMasterySubject = subject;
      renderExamResultsList(lastExamResults);
    };

    window._ogrSetExamTab = function (tab) {
      activeExamTab = tab;
      renderExamResultsList(lastExamResults);
    };

    // ----- YÖN: Bugünün Pusulası -----
    function renderDirectionStatus(netTrend) {
      const el = document.getElementById('direction-status');
      if (!netTrend || netTrend.length < 2) {
        el.innerHTML = `<span class="dir-icon">🧭</span><span>Yolculuğun daha yeni başlıyor — birkaç deneme sonucun birikince gidişatını burada göreceksin.</span>`;
        return;
      }
      const win = netTrend.slice(-3);
      const delta = Math.round((win[win.length-1].totalNet - win[0].totalNet)*100)/100;
      let icon = '🔵', text = `Son ${win.length} denemede net'in dengede — istikrarını koruyorsun.`;
      if (delta > 0.5)  { icon = '🟢'; text = `Son ${win.length} denemede net'in ${delta>0?'+':''}${delta} arttı. Doğru yöndesin!`; }
      if (delta < -0.5) { icon = '🟠'; text = `Son ${win.length} denemede net'in ${delta} değişti. Birlikte toparlayabiliriz, moralini bozma!`; }
      el.innerHTML = `<span class="dir-icon">${icon}</span><span>${text}</span>`;
    }

    // ----- YÜKSELİŞ SERİSİ -----
    function computeRiseStreak(netTrend) {
      if (!netTrend || netTrend.length < 2) return 0;
      let streak = 0;
      for (let i = netTrend.length-1; i > 0; i--) {
        if (netTrend[i].totalNet > netTrend[i-1].totalNet) streak++;
        else break;
      }
      return streak;
    }

    function renderStreakCard(riseStreak, netTrend) {
      document.getElementById('streak-count').textContent = riseStreak > 0 ? riseStreak : '0';
      // Show last 7 exam points as dots
      const dotsEl = document.getElementById('streak-dots');
      const days = ['Pt','Sa','Çr','Pr','Cu','Ct','Pz'];
      if (!netTrend || !netTrend.length) {
        dotsEl.innerHTML = days.map(d => `<div class="ep-streak-dot empty">${d}</div>`).join('');
        return;
      }
      const last7 = netTrend.slice(-7);
      // fill with empty if < 7
      const dots = [];
      for (let i = 0; i < 7; i++) {
        const entry = last7[i];
        if (!entry) { dots.push({ label: days[i], state: 'empty' }); continue; }
        const prev = last7[i-1];
        const state = prev ? (entry.totalNet > prev.totalNet ? 'done' : 'empty') : 'done';
        dots.push({ label: entry.examName.substring(0,2), state });
      }
      // last one = active
      if (dots.length) dots[dots.length-1].state = riseStreak > 0 ? 'active' : 'empty';
      dotsEl.innerHTML = dots.map(d => `<div class="ep-streak-dot ${d.state}" title="${escapeHtml(d.label)}">${escapeHtml(d.label)}</div>`).join('');
    }

    // ----- KPI ŞERIDI -----
    function renderScorecards(last, diffVal, classRank, riseStreak) {
      const icons = [
        { icon:'🎯', iconCls:'purple', val: last ? last.totalNet : '—', label:'Toplam Net', delta: null },
        { icon: diffVal==null?'➖':diffVal>=0?'📈':'📉', iconCls: diffVal==null?'blue':diffVal>=0?'green':'amber',
          val: diffVal==null?'—':(diffVal>0?'+':'')+diffVal, label:'Son Değişim', delta: diffVal==null?null:diffVal },
        { icon:'🏆', iconCls:'blue', val: classRank?`${classRank.rank}/${classRank.classSize}`:'—', label:'Sınıf Sıralaması', delta: null },
        { icon:'🔥', iconCls:'amber', val: riseStreak>0?riseStreak:'—', label:'Yükseliş Serisi', delta: null },
      ];
      document.getElementById('scorecards').innerHTML = icons.map(it => {
        let deltaHtml = '';
        if (it.delta !== null) {
          const cls = it.delta > 0 ? 'up' : it.delta < 0 ? 'down' : 'neu';
          const txt = it.delta > 0 ? `▲ +${it.delta}` : it.delta < 0 ? `▼ ${it.delta}` : '➖ Değişim yok';
          deltaHtml = `<span class="ep-kpi-delta ${cls}">${txt}</span>`;
        }
        return `
          <div class="ep-kpi">
            <div class="ep-kpi-icon ${it.iconCls}">${it.icon}</div>
            <div class="ep-kpi-value">${it.val}</div>
            <div class="ep-kpi-label">${it.label}</div>
            ${deltaHtml}
          </div>`;
      }).join('');
    }

    // ----- BUGÜNKÜ GÖREV -----
    function computeTodayTask(topicStats, weakestSubject) {
      const dow = new Date().getDay();
      const weak = (topicStats || []).slice(0, 2);
      if (!weak.length) {
        if (!weakestSubject) return null;
        return { priority:'orta', title:`${subjectName(weakestSubject)} — Genel Tekrar`, detail:'Henüz optik değerlendirmeli deneme sonucun olmadığından konu bazlı öneri veremiyoruz; bu dersten genel tekrar yapman iyi olur.', questions:20 };
      }
      const t1 = weak[0], t2 = weak[1] || weak[0];
      const rate = t1.successRate;
      const priority = rate < 50 ? 'yuksek' : rate < 70 ? 'orta' : 'dusuk';
      if (dow === 0 || dow === 6) {
        return { priority, title:'Hafta Sonu Genel Tekrarı', detail:`${t1.kazanim} ve ${t2.kazanim} konularını tekrar et.`, questions:30 };
      }
      const dayPlans = [
        { title:t1.kazanim, detail:`${subjectName(t1.subjectKey)} — konu tekrarı ve soru çözümü`, questions:25 },
        { title:t2.kazanim, detail:`${subjectName(t2.subjectKey)} — konu tekrarı`, questions:20 },
        { title:t1.kazanim, detail:`${subjectName(t1.subjectKey)} — pekiştirme soruları`, questions:25 },
        { title:'Deneme Analizi', detail:'Son denemendeki yanlışlarını gözden geçir.', questions:null },
        { title:'Yanlışların Tekrarı', detail:'Bu haftaki yanlışlarını tekrar çöz.', questions:15 },
      ];
      return { priority, ...(dayPlans[dow-1] || dayPlans[0]) };
    }

    function renderTodayTask(topicStats, weakestSubject) {
      const el = document.getElementById('today-task');
      const card = el.closest('.ep-task-card');
      const t = computeTodayTask(topicStats, weakestSubject);
      card.classList.remove('prio-yuksek','prio-orta','prio-dusuk');
      if (!t) { el.innerHTML = '<p style="color:var(--text-muted)">Görev önerisi için en az bir deneme sonucun gerekiyor.</p>'; return; }
      const prioMap = { yuksek:{label:'🔴 Yüksek Öncelik'}, orta:{label:'🟠 Orta Öncelik'}, dusuk:{label:'🟢 Pekiştirme'} };
      const p = prioMap[t.priority] || prioMap.orta;
      card.classList.add('prio-' + t.priority);
      el.innerHTML = `
        <span class="ep-task-card-tag">${p.label}</span>
        <div class="ep-task-title">${escapeHtml(t.title)}</div>
        <p class="ep-task-detail">${escapeHtml(t.detail)}</p>
        <div class="ep-task-meta">
          ${t.questions ? `<span>📝 ${t.questions} Soru</span>` : ''}
          <span>⏱️ Tahmini ${t.questions ? '30' : '20'} dk</span>
        </div>`;
    }

    // ----- ROADMAP -----
    function renderTargetRoadmap(scoreBreakdown, last) {
      const el = document.getElementById('target-roadmap');
      const hedef = (scoreBreakdown && scoreBreakdown.axes) ? scoreBreakdown.axes.hedef : null;
      if (hedef == null || !last) {
        el.innerHTML = '<p style="color:var(--text-muted)">Hedefe yakınlığını gösterebilmemiz için en az bir deneme sonucun ve sınıf arkadaşlarının sonuçları gerekiyor.</p>';
        return;
      }
      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Şu Anki Sevin</div>
            <div style="font-size:22px;font-weight:900;color:#fff">${last.totalNet} <span style="font-size:14px;color:var(--text-muted);font-weight:500">net</span></div>
          </div>
          <div class="ep-roadmap-pct">${hedef}%</div>
          <div style="text-align:right">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Hedefe Yakınlık</div>
            <div style="font-size:14px;font-weight:700;color:#34d399">🏆 Sınıfının Zirvesi</div>
          </div>
        </div>
        <div class="ep-roadmap-stations">
          <div class="ep-roadmap-flag">🏁</div>
          <div class="ep-roadmap-track" style="margin:0 8px">
            <div class="ep-roadmap-fill" style="width:${hedef}%"></div>
          </div>
          <div class="ep-roadmap-flag end">🏆</div>
        </div>
        <p class="ep-roadmap-caption">
          ${hedef >= 90 ? '🎉 Harika! Hedefe çok yakınsın, son adımları da at!' :
            hedef >= 60 ? '🚀 Güzel gidiyorsun, devam et!' :
            '💪 Hâlâ yolun var — birlikte çalışarak ulaşabiliriz!'}
        </p>
        <div class="ep-compass-footer">
          <div class="ep-compass-readout">Sıradaki adım: <b class="up">Bugünkü Görevin</b> — az yukarıda seni bekliyor</div>
          <button class="ep-compass-cta" onclick="askPusi('plan'); document.getElementById('pusi-answer').scrollIntoView({behavior:'smooth',block:'center'})">🤖 Plan İste</button>
        </div>`;
    }

    // ----- PUSİ YORUMU -----
    // errorMemory.aiComment varsa (optik/konu bazlı analiz) en özgül kaynak odur.
    // Yoksa sırayla: aktif yükseliş serisi > pusuladaki öncelikli konu > genel net trendi.
    function renderPusi(errorMemory, netTrend, compass, riseStreak) {
      const el = document.getElementById('pusi-message');
      if (errorMemory && errorMemory.aiComment) { el.textContent = errorMemory.aiComment; return; }

      if (riseStreak >= 2) {
        el.textContent = `Üst üste ${riseStreak} denemedir net'in yükseliyor — bu ciddi bir istikrar işareti! Bu tempoyu bozmadan devam edersen hedefine çok daha hızlı ulaşırsın. 🔥`;
        return;
      }
      const topPriority = compass && compass.priority && compass.priority[0];
      if (topPriority) {
        el.innerHTML = `Şu an dikkatini en çok <b>${subjectName(topPriority.subjectKey)} - ${escapeHtml(topPriority.kazanim)}</b> konusuna vermelisin (başarı oranın %${topPriority.successRate}) — burayı toparlarsan genel skorun belirgin şekilde yükselir. 🎯`;
        return;
      }
      if (!netTrend || netTrend.length < 2) {
        el.textContent = 'Şu an sana özel bir yorum yapabilmem için yeterli deneme verin yok — ilk deneme sonuçların geldiğinde burada seni bekliyor olacağım. 🧭';
        return;
      }
      const win = netTrend.slice(-5);
      const delta = Math.round((win[win.length-1].totalNet - win[0].totalNet)*100)/100;
      const dir = delta > 0 ? 'güzel bir yükseliş' : delta < 0 ? 'küçük bir düşüş' : 'sabit bir seyir';
      el.textContent = `Son ${win.length} denemende ${dir} var (${delta>0?'+':''}${delta} net). ${delta >= 0 ? 'Bu tempoyu koru, harika gidiyorsun! 🔥' : 'Birlikte toparlayabiliriz — pes etme! 💪'}`;
    }

    // ----- PUSULA AI HIZLI SORULAR -----
    // Gerçek bir LLM çağrısı yok - hepsi öğrencinin kendi verisinden (server.py
    // tarafından zaten hesaplanmış scoreBreakdown/compass/latestExamTopicStats)
    // türetilen, şeffaf kurallı bir öneri motoru. Veri yoksa uydurma cevap
    // vermek yerine "yeterli veri yok" durumunu gösterir.
    function askPusi(type) {
      const answerEl = document.getElementById('pusi-answer');
      if (!answerEl) return;
      if (!studentData) { answerEl.style.display = ''; answerEl.textContent = 'Yükleniyor...'; return; }
      const d = studentData;
      let html = '';

      if (type === 'performance') {
        const sb = d.scoreBreakdown;
        if (!sb || sb.overall == null) {
          html = 'Performansını analiz edebilmem için en az bir deneme sonucun gerekiyor.';
        } else {
          const growthTxt = sb.growthDelta == null ? ''
            : sb.growthDelta === 0 ? ' Son dönemde değişim yok, istikrarlısın.'
            : ` Son dönemde ${sb.growthDelta > 0 ? 'bir yükseliş' : 'bir düşüş'} var (${sb.growthDelta > 0 ? '+' : ''}${sb.growthDelta} puan).`;
          const strongTxt = d.strongestSubject ? ` En güçlü dersin <b>${subjectName(d.strongestSubject)}</b>.` : '';
          const weakTxt = d.weakestSubject ? ` En çok gelişebileceğin ders <b>${subjectName(d.weakestSubject)}</b>.` : '';
          html = `Genel Başarı Skorun <b>${sb.overall}/100</b>.${growthTxt}${strongTxt}${weakTxt}`;
        }
      } else if (type === 'plan') {
        if (!d.latestExamTopicStats || !d.latestExamTopicStats.length) {
          html = 'Haftalık bir çalışma rotası hazırlayabilmem için cevap anahtarlı (optik) bir deneme sonucun gerekiyor.';
        } else {
          const planCard = document.getElementById('study-plan-card');
          html = 'Senin için hazırladığım rota aşağıda "📅 Bu Haftaki Eğitim Rotası" kartında — hemen bakabilirsin! 👇';
          if (planCard) setTimeout(() => planCard.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        }
      } else if (type === 'focus') {
        const fromCompass = d.compass && d.compass.priority && d.compass.priority[0];
        const fromTopics = d.latestExamTopicStats && d.latestExamTopicStats[0];
        const t = fromCompass || fromTopics;
        html = t
          ? `Şu an en çok <b>${subjectName(t.subjectKey)} - ${escapeHtml(t.kazanim)}</b> konusuna odaklanmalısın (başarı oranın %${t.successRate}).`
          : (d.weakestSubject
            ? `Konu bazlı bir öneri için cevap anahtarlı deneme gerekiyor, ama genel olarak <b>${subjectName(d.weakestSubject)}</b> dersine biraz daha zaman ayırman iyi olur.`
            : 'Şu an acil bir öncelik görünmüyor — harika gidiyorsun, genel tekrar yapabilirsin! 🎉');
      } else if (type === 'motivate') {
        if (d.badges && d.badges.length) {
          const b = d.badges[d.badges.length - 1];
          html = `${b.icon} <b>${b.label}</b> — ${BADGE_DESC[b.label] || 'harika bir başarı!'} Bu tempoyla devam edersen çok daha fazlasını başaracaksın! 🚀`;
        } else if (d.netTrend && d.netTrend.length >= 2) {
          const delta = Math.round((d.netTrend[d.netTrend.length - 1].totalNet - d.netTrend[0].totalNet) * 100) / 100;
          html = delta >= 0
            ? `İlk denemenden bu yana net'in ${delta > 0 ? `<b>+${delta}</b> arttı` : 'sabit kaldı'}. Bu, emeğinin karşılığını aldığını gösteriyor — devam et! 💪`
            : `Şu an bir düşüş dönemindesin ama her deneme yeni bir fırsat. Küçük, düzenli adımlarla toparlanabilirsin. 🧭`;
        } else {
          html = 'Yolculuğun daha yeni başlıyor! İlk deneme sonucun geldiğinde burada seni bekleyen bir başarı hikayesi olacak. 🌱';
        }
      } else if (type === 'rank') {
        const cr = d.classRank;
        if (!cr) {
          html = 'Sınıf sıralamanı gösterebilmem için en az bir deneme sonucun ve sınıf arkadaşlarının sonuçları gerekiyor.';
        } else {
          const top = cr.rank === 1;
          const topQuarter = cr.rank <= Math.ceil(cr.classSize * 0.25);
          const posTxt = top
            ? 'Sınıfının <b>zirvesindesin</b> 🏆'
            : topQuarter
              ? 'Sınıfının <b>ilk çeyreğindesin</b> — zirveye çok yakınsın'
              : `Sınıfında <b>${cr.rank}. sıradasın</b> (${cr.classSize} kişi arasında)`;
          const hedef = d.scoreBreakdown && d.scoreBreakdown.axes ? d.scoreBreakdown.axes.hedef : null;
          const hedefTxt = (hedef != null && hedef < 100)
            ? ` Sınıfının en yüksek netine göre şu an <b>%${hedef}</b> yakınlıktasın — üzerine gitmeye devam et.`
            : '';
          html = `${posTxt}.${hedefTxt}`;
        }
      }

      answerEl.innerHTML = html;
      answerEl.style.display = '';
    }

    // ----- ÖĞRETMEN MESAJLARI -----
    function renderTeacherMessages(messages) {
      const card = document.getElementById('teacher-messages-card');
      // Okunmuş mesajlar bu bölümden kalkar - sadece okunmamışlar görünür,
      // öğrenci mesajı bir kez okuyunca ana sayfa sadeleşir.
      const unread = (messages || []).filter(m => !m.isRead);
      if (!unread.length) { card.style.display='none'; return; }
      card.style.display='';
      document.getElementById('teacher-messages').innerHTML = unread.map(m => {
        const d = m.createdAt ? new Date(m.createdAt) : null;
        const dateStr = d ? d.toLocaleDateString('tr-TR',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}) : '';
        return `
          <div class="ep-msg unread">
            <div class="ep-msg-meta">🔴 👩‍🏫 ${escapeHtml(m.teacherName||'Öğretmenin')} — ${dateStr}</div>
            <div class="ep-msg-text">${escapeHtml(m.message)}</div>
          </div>`;
      }).join('');
    }

    function renderMailBadge(count) {
      const badge = document.getElementById('mail-badge');
      if (!badge) return;
      if (count > 0) { badge.textContent = count>9?'9+':String(count); badge.style.display='flex'; }
      else { badge.style.display='none'; }
    }

    async function markMessagesRead() {
      try {
        await fetch('/api/student/messages/mark-read', {method:'POST'});
        renderMailBadge(0);
        // Okunan mesajlar artik anasayfadaki karttan kalkar.
        const card = document.getElementById('teacher-messages-card');
        if (card) card.style.display = 'none';
      } catch (err) { console.warn('Mesajlar işaretlenemedi:', err.message); }
    }

    // ----- SKOR HERO -----
    function renderScoreHero(scoreBreakdown) {
      const numEl  = document.getElementById('score-number');
      const numEl2 = document.getElementById('score-number-detail');
      const growEl = document.getElementById('score-growth');
      if (!scoreBreakdown || scoreBreakdown.overall == null) {
        if(numEl) numEl.textContent='—'; if(numEl2) numEl2.textContent='—'; if(growEl) growEl.textContent=''; return;
      }
      if(numEl)  numEl.textContent  = scoreBreakdown.overall;
      if(numEl2) numEl2.textContent = scoreBreakdown.overall;
      if (scoreBreakdown.growthDelta != null && growEl) {
        const d = scoreBreakdown.growthDelta;
        growEl.className = 'ep-score-delta ' + (d >= 0 ? 'up' : 'down');
        growEl.textContent = d === 0 ? 'Değişim yok' : `${d>0?'▲ +':'▼ '}${d} puan`;
      } else if(growEl) { growEl.textContent=''; }

      // Radar eksenlerini kartlara döndür
      if (scoreBreakdown.axes) {
        const a = scoreBreakdown.axes;
        const axDefs = [
          { icon:'📚', label:'Akademik Başarı', val: a.academic,    color:'#3b82f6' },
          { icon:'🔥', label:'Motivasyon',       val: a.motivation, color:'#f59e0b' },
          { icon:'🎯', label:'Hedefe Yakınlık',  val: a.hedef,      color:'#10b981' },
          { icon:'🧩', label:'Düzenlilik',        val: a.regularity, color:'#0D9488' },
        ];
        document.getElementById('radar-axes').innerHTML = axDefs.map(ax => {
          const v = ax.val == null ? 0 : ax.val;
          return `
            <div class="ep-radar-ax">
              <span class="ep-radar-ax-icon">${ax.icon}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:11.5px;font-weight:700;color:var(--text-muted);margin-bottom:5px">${ax.label}</div>
                <div class="ep-radar-ax-bar-wrap">
                  <div class="ep-radar-ax-bar" style="width:${v}%;background:${ax.color}"></div>
                </div>
              </div>
              <span class="ep-radar-ax-val">${v}</span>
            </div>`;
        }).join('');
      }
    }

    function renderScoreRadar(scoreBreakdown) {
      const canvas = document.getElementById('score-radar-chart');
      if (!canvas) return;
      if (scoreRadarChart) { scoreRadarChart.destroy(); scoreRadarChart = null; }
      if (!scoreBreakdown) {
        canvas.closest('.chart-box').innerHTML = '<p style="color:var(--text-muted)">Henüz yeterli veri yok.</p>'; return;
      }
      const axes = scoreBreakdown.axes;
      scoreRadarChart = new Chart(canvas, {
        type:'radar',
        data:{
          labels:['📚 Akademik','🔥 Motivasyon','🎯 Hedef','🧩 Düzenlilik'],
          datasets:[{ label:'Başarı Skoru',
            data:[axes.academic,axes.motivation,axes.hedef,axes.regularity].map(v=>v==null?0:v),
            borderColor:'#2DD4BF', backgroundColor:'rgba(45,212,191,0.2)', borderWidth:2,
            pointBackgroundColor:'#2DD4BF', pointRadius:5,
          }],
        },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false} },
          scales:{ r:{ min:0,max:100,
            angleLines:{color:'rgba(255,255,255,0.08)'}, grid:{color:'rgba(255,255,255,0.08)'},
            pointLabels:{color:'#cbd5e1', font:{size:12,weight:'600'}},
            ticks:{color:'#64748b', backdropColor:'transparent', stepSize:25},
          }},
        },
      });
    }

    // ----- BAŞARILAR -----
    const BADGE_DESC = {
      'Kişisel Rekor':'En yüksek toplam netine ulaştın!',
      '3 Deneme Üst Üste Yükseliş':'Son 3 denemede kesintisiz yükseliş gösterdin.',
      'İlk Büyük Gelişim':'Bir denemede netini 5+ artırdın!',
      'Hedefe Yaklaşıyor':'Sınıfının zirvesine çok yaklaştın.',
      'Düzenli Çalışan':'Tüm denemelere düzenli katıldın.',
    };
    function renderAchievements(badges) {
      const el = document.getElementById('achievements');
      if (!badges || !badges.length) {
        el.innerHTML = `<div class="ep-empty"><div class="ep-empty-icon">🏅</div>Henüz bir başarı rozeti kazanılmadı — ilk deneme sonucun geldiğinde burası dolmaya başlayacak.</div>`;
        return;
      }
      el.innerHTML = badges.map(b => `
        <div class="ep-achievement">
          <div class="ep-ach-icon">${b.icon}</div>
          <div>
            <div class="ep-ach-label">${b.label}</div>
            <div class="ep-ach-desc">${BADGE_DESC[b.label] || ''}</div>
          </div>
        </div>`).join('');
    }

    // ----- GÜÇLÜ YÖNLER -----
    function renderStrengthSummary(compass, strongestSubject) {
      const el = document.getElementById('strength-summary');
      const medals = ['🥇','🥈','🥉'];
      const strongList  = ((compass && compass.strong)    || []).slice(0,3);
      const workSource  = ((compass && compass.priority) && compass.priority.length) ? compass.priority : ((compass && compass.attention) || []);
      const workList    = workSource.slice(0,3);

      const strongHtml = strongList.length
        ? strongList.map((s,i) => `
            <li class="ep-strength-item">
              <span>${medals[i]||'⭐'} ${escapeHtml(s.kazanim)}</span>
              <b>%${s.successRate}</b>
            </li>`).join('')
        : `<li class="ep-strength-item" style="color:var(--text-muted)">${strongestSubject ? `En güçlü dersin: ${subjectName(strongestSubject)}` : 'Henüz yeterli veri yok'}</li>`;

      const workHtml = workList.length
        ? workList.map(s => `
            <li class="ep-strength-item">
              <span>🎯 ${escapeHtml(s.kazanim)}</span>
              <b>%${s.successRate}</b>
            </li>`).join('')
        : `<li class="ep-strength-item" style="color:var(--text-muted)">Şu an acil bir öncelik yok — harika gidiyorsun!</li>`;

      el.innerHTML = `
        <div class="ep-strength-col">
          <div class="ep-strength-head">💪 Güçlü Yönlerin</div>
          <ul class="ep-strength-list">${strongHtml}</ul>
        </div>
        <div class="ep-strength-col">
          <div class="ep-strength-head">🎯 Bir Sonraki Gelişim Noktan</div>
          <ul class="ep-strength-list">${workHtml}</ul>
        </div>`;
    }

    // ----- BAŞARI PUSULASI (4 KADRAN) -----
    function compassDirectionReadout(netTrend) {
      if (!netTrend || netTrend.length < 2) {
        return { cls: 'flat', label: 'Henüz belirsiz →', sub: 'birkaç deneme sonucu birikince netleşecek' };
      }
      const win = netTrend.slice(-3);
      const delta = Math.round((win[win.length-1].totalNet - win[0].totalNet)*100)/100;
      if (delta > 0.5)  return { cls: 'up',   label: 'Yükseliş ↗', sub: `son ${win.length} denemede ${delta>0?'+':''}${delta} net` };
      if (delta < -0.5) return { cls: 'down', label: 'Düşüş ↘',    sub: `son ${win.length} denemede ${delta} net` };
      return { cls: 'flat', label: 'Stabil →', sub: `son ${win.length} denemede net dengede` };
    }

    function renderCompass(compass, netTrend) {
      const el = document.getElementById('compass');
      if (!compass) { el.innerHTML = '<p style="color:var(--text-muted)">Henüz yeterli veri yok.</p>'; return; }
      const list = (items, emptyText, mapFn) => items.length
        ? `<ul class="ep-q-list">${items.map(mapFn).join('')}</ul>`
        : `<p style="font-size:12px;color:var(--text-muted);margin-top:auto">${emptyText}</p>`;
      const dir = compassDirectionReadout(netTrend);
      el.innerHTML = `
        <div class="ep-compass-grid" style="position:relative">
          <div class="ep-quadrant" style="--q-clr:#3b82f6;border-top-left-radius:18px">
            <span class="ep-q-dir">Gelişim Alanların</span>
            <h4 class="ep-q-head">📈 Yükselen Dersler</h4>
            ${list(compass.developing,'Henüz belirgin yükseliş yok', d=>`<li>${subjectName(d.subjectKey)}<b>+${d.delta} net</b></li>`)}
          </div>
          <div class="ep-quadrant" style="--q-clr:#10b981;border-top-right-radius:18px">
            <span class="ep-q-dir">Güçlü Yönlerin</span>
            <h4 class="ep-q-head">🏆 En İyi Konular</h4>
            ${list(compass.strong,'Optik okuma sonucu gelince görünür', s=>`<li>${escapeHtml(s.kazanim)}<b>%${s.successRate}</b></li>`)}
          </div>
          <div class="ep-quadrant" style="--q-clr:#ef4444;border-bottom-left-radius:18px">
            <span class="ep-q-dir">Öncelikli Çalışma</span>
            <h4 class="ep-q-head">🎯 Odaklanılacaklar</h4>
            ${list(compass.priority,'Acil öncelik yok', p=>`<li>${escapeHtml(p.kazanim)}<b>%${p.successRate}</b></li>`)}
          </div>
          <div class="ep-quadrant" style="--q-clr:#f59e0b;border-bottom-right-radius:18px;background:color-mix(in srgb,#f59e0b 12%,rgba(255,255,255,0.025))">
            <span class="ep-q-dir">Dikkat Gerektiren</span>
            <h4 class="ep-q-head">👀 Gözden Geçir</h4>
            ${list(compass.attention,'Dikkat gereken konu yok', a=>`<li>${escapeHtml(a.kazanim)}<b>%${a.successRate}</b></li>`)}
          </div>
          <div class="ep-compass-center" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9.5" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
              <path d="M12 4 L14 12 L12 20 L10 12 Z" fill="#14B8A6"/>
            </svg>
          </div>
        </div>
        <div class="ep-compass-footer">
          <div class="ep-compass-readout">Genel yön: <b class="${dir.cls}">${dir.label}</b> — ${dir.sub}</div>
          <button class="ep-compass-cta" onclick="askPusi('focus'); document.getElementById('pusi-answer').scrollIntoView({behavior:'smooth',block:'center'})">🤖 Pusi'ye Sor</button>
        </div>`;
    }

    // ----- DERS ENERJİ KARTLARI -----
    function renderSubjectEnergy(last, prev) {
      const el = document.getElementById('subject-energy');
      if (!last || !last.subjects || Object.keys(last.subjects).length === 0) {
        el.innerHTML = '<div class="ep-empty"><div class="ep-empty-icon">⚡</div>Henüz deneme sonucu yok.</div>'; return;
      }
      el.innerHTML = Object.entries(last.subjects).map(([key, sub]) => {
        const net = (sub && sub.net) || 0;
        const q   = (typeof SUBJECT_LOOKUP !== 'undefined' && SUBJECT_LOOKUP[key] && SUBJECT_LOOKUP[key].questions) || 20;
        const pct = Math.max(0, Math.min(100, Math.round((net/q)*100)));
        const prevNet = (prev && prev.subjects && prev.subjects[key]) ? prev.subjects[key].net : null;
        const delta   = prevNet != null ? Math.round((net-prevNet)*100)/100 : null;
        const color = subjectColor(key);
        let statusIcon='🆕', statusLabel='Yeni Başlangıç';
        if (delta !== null) {
          if (delta > 0.5)  { statusIcon='🟢'; statusLabel='Yükselişte!'; }
          else if (delta < -0.5) { statusIcon='🟡'; statusLabel='Biraz Daha Çalışalım'; }
          else               { statusIcon='🔵'; statusLabel='Stabil Devam'; }
        }
        const deltaLabel = delta !== null ? `${delta>0?'📈 +':delta<0?'📉 ':'➖ '}${delta} net` : `${net} net`;
        return `
          <div class="ep-subject-card">
            <div class="ep-subject-head">
              <div class="ep-subject-icon-wrap" style="background:${color}22">${subjectIcon(key)}</div>
              <span class="ep-subject-name">${subjectName(key)}</span>
            </div>
            <div class="ep-subject-net">${net}<span>/${q} soru</span></div>
            <div class="ep-subject-bar-wrap">
              <div class="ep-subject-bar" style="width:${pct}%;background:${color}"></div>
            </div>
            <div class="ep-subject-status" style="color:${color}">${statusIcon} ${statusLabel} <span style="margin-left:auto;font-size:13px;color:var(--text-muted)">${deltaLabel}</span></div>
          </div>`;
      }).join('');
    }

    // ----- DERS YETKİNLİK RADARI -----
    function renderSubjectRadar(last, classAverages) {
      const canvas = document.getElementById('subject-radar-chart');
      if (!canvas) return;
      if (radarChart) { radarChart.destroy(); radarChart = null; }
      if (!last || !last.subjects || Object.keys(last.subjects).length === 0) {
        canvas.closest('.chart-box').innerHTML = '<p style="color:var(--text-muted)">Grafik için deneme sonucu gerekir.</p>'; return;
      }
      const keys = Object.keys(last.subjects);
      radarChart = new Chart(canvas, {
        type:'radar',
        data:{
          labels: keys.map(k => subjectName(k)),
          datasets:[
            { label:'Benim Netlerim',
              data: keys.map(k => (last.subjects[k]&&last.subjects[k].net)||0),
              borderColor:'#2DD4BF', backgroundColor:'rgba(45,212,191,0.2)', borderWidth:2, pointBackgroundColor:'#2DD4BF', pointRadius:5 },
            { label:'Sınıf Ortalaması',
              data: keys.map(k => (classAverages&&classAverages[k]!=null)?classAverages[k]:0),
              borderColor:'#F59E0B', backgroundColor:'rgba(245,158,11,0.08)', borderWidth:2, borderDash:[5,5], pointBackgroundColor:'#F59E0B', pointRadius:4 },
          ],
        },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{labels:{color:'#94a3b8',usePointStyle:true,padding:16}} },
          scales:{ r:{ angleLines:{color:'rgba(255,255,255,0.08)'}, grid:{color:'rgba(255,255,255,0.08)'},
            pointLabels:{color:'#94a3b8',font:{size:11}}, ticks:{color:'#64748b',backdropColor:'transparent'}, suggestedMin:0 } },
        },
      });
    }

    // ----- GELİŞİM EĞRİSİ -----
    // ----- GELİŞİM EĞRİSİ FİLTRESİ (Son 5 / Son 10 / Tümü) -----
    function applyTrendWindow(netTrend) {
      if (!netTrend) return netTrend;
      if (netTrendWindow === 'last5') return netTrend.slice(-5);
      if (netTrendWindow === 'last10') return netTrend.slice(-10);
      return netTrend;
    }

    function setTrendWindow(win) {
      netTrendWindow = win;
      if (studentData) {
        renderTrendFilters(studentData.netTrend);
        renderNetAreaChart(applyTrendWindow(studentData.netTrend));
        renderNetTrendTable(applyTrendWindow(studentData.netTrend));
      }
    }

    function renderNetTrendTable(netTrend) {
      const el = document.getElementById('net-trend');
      if (!netTrend || !netTrend.length) {
        el.innerHTML = '<div class="ep-empty"><div class="ep-empty-icon">📊</div>Gelişim grafiği için en az 2 deneme sonucu gerekir.</div>';
        return;
      }
      el.innerHTML = `
        <div style="overflow-x:auto"><table class="ep-exams-table">
          <tr><th>Deneme</th><th>Tarih</th><th>Toplam Net</th></tr>
          ${netTrend.map(t => `<tr><td>${escapeHtml(t.examName)}</td><td>${escapeHtml(t.examDate)||'—'}</td><td class="ep-net-badge">${t.totalNet}</td></tr>`).join('')}
        </table></div>`;
    }

    function renderTrendFilters(netTrend) {
      const el = document.getElementById('net-trend-filters');
      if (!el) return;
      if (!netTrend || netTrend.length < 3) { el.innerHTML = ''; return; }
      const options = [
        { key: 'last5', label: 'Son 5' },
        { key: 'last10', label: 'Son 10' },
        { key: 'all', label: 'Tümü' },
      ];
      el.innerHTML = options.map(o =>
        `<button type="button" class="ep-filter-btn${netTrendWindow === o.key ? ' active' : ''}" onclick="setTrendWindow('${o.key}')">${o.label}</button>`
      ).join('');
    }

    function renderNetAreaChart(netTrend) {
      const canvas = document.getElementById('net-area-chart');
      if (!canvas) return;
      if (areaChart) { areaChart.destroy(); areaChart = null; }
      if (!netTrend || netTrend.length < 2) {
        canvas.closest('.chart-box').innerHTML = '<div class="ep-empty"><div class="ep-empty-icon">📈</div>Grafik için en az 2 deneme sonucu gerekir.</div>';
        return;
      }
      // Trend badge
      const last5 = netTrend.slice(-5);
      const delta = Math.round((last5[last5.length-1].totalNet - last5[0].totalNet)*100)/100;
      const badgeEl = document.getElementById('net-trend-badge');
      if (badgeEl) {
        const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neu';
        const txt = delta > 0 ? `📈 Son ${last5.length} denemede +${delta} net artış` :
                    delta < 0 ? `📉 Son ${last5.length} denemede ${delta} net düşüş` :
                    `➖ Son ${last5.length} denemede stabil seyir`;
        badgeEl.innerHTML = `<span class="ep-chart-badge ${cls}">${txt}</span>`;
      }
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0,0,0,260);
      gradient.addColorStop(0,'rgba(20,184,166,0.45)');
      gradient.addColorStop(1,'rgba(20,184,166,0.02)');
      areaChart = new Chart(canvas, {
        type:'line',
        data:{
          labels: netTrend.map(t => t.examName),
          datasets:[{ label:'Toplam Net',
            data: netTrend.map(t => t.totalNet),
            borderColor:'#14B8A6', backgroundColor:gradient, borderWidth:3,
            fill:true, tension:0.4, pointRadius:5, pointHoverRadius:7,
            pointBackgroundColor:'#14B8A6', pointBorderColor:'#fff', pointBorderWidth:2,
          }],
        },
        options: chartDefaults(),
      });
    }

    // ----- ÇALIŞMA PLANI -----
    function generateStudyPlan(topicStats) {
      const weak = (topicStats||[]).slice(0,2);
      const t1 = (weak[0]&&weak[0].kazanim)||'Genel Tekrar';
      const t2 = (weak[1]&&weak[1].kazanim)||(weak[0]&&weak[0].kazanim)||'Genel Tekrar';
      return [
        {day:'Pazartesi', icon:'📚', text:`${t1} — 25 Soru`},
        {day:'Salı',      icon:'📐', text:`${t2} — Konu Tekrarı`},
        {day:'Çarşamba',  icon:'🧮', text:`${t1} — 25 Soru`},
        {day:'Perşembe',  icon:'📝', text:'Deneme Analizi'},
        {day:'Cuma',      icon:'🔁', text:'Yanlışların Tekrarı'},
      ];
    }
    function renderStudyPlanCard(topicStats) {
      const card = document.getElementById('study-plan-card');
      if (!topicStats||!topicStats.length) { card.style.display='none'; return; }
      card.style.display='';
      const plan = generateStudyPlan(topicStats);
      document.getElementById('study-plan').innerHTML = plan.map(p => `
        <div class="ep-plan-day">
          <div class="ep-plan-day-icon">${p.icon}</div>
          <div>
            <div class="ep-plan-day-name">${p.day}</div>
            <div class="ep-plan-day-text">${escapeHtml(p.text)}</div>
          </div>
        </div>`).join('');
    }

    // ----- KİŞİSEL ÇALIŞMA PLANI (bölüm 10.10 - soru havuzuna bağlı, GERÇEK
    // sorular içerir; yukarıdaki renderStudyPlanCard'dan FARKLI bir özellik,
    // o sadece metin önerisi üretir, bu ise deneme hata hafızasından soru
    // havuzunda gerçek telafi soruları seçer) -----
    async function renderPersonalStudyPlan() {
      const container = document.getElementById('study-plan-container');
      let plan;
      try {
        plan = await fetch('/api/student/study-plan/latest').then(r => r.json());
      } catch (e) {
        container.innerHTML = '<p class="text-muted">❌ Çalışma planı yüklenemedi.</p>';
        return;
      }
      if (!plan) {
        container.innerHTML = `
          <p style="color:var(--text-muted);font-size:13px">Son denemendeki zayıf konulardan sana özel bir çalışma planı oluşturabiliriz.</p>
          <button class="ep-task-cta" onclick="generatePersonalStudyPlan()">✨ Çalışma Planı Oluştur</button>
          <div id="study-plan-status" class="text-muted" style="margin-top:8px;font-size:13px"></div>
        `;
        return;
      }
      const solvedCount = plan.questions.filter(q => q.solved).length;
      container.innerHTML = `
        <p style="color:var(--text-muted);font-size:13px">${solvedCount}/${plan.questions.length} tamamlandı</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          ${plan.questions.map(q => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid var(--bg-glass-border);border-radius:8px">
              <span style="font-size:13px">${q.solved ? '✅' : '⬜'} ${escapeHtml(q.matchedKazanim || 'Genel tekrar')}</span>
              <button class="btn-sm" style="padding:6px 12px;border:none;border-radius:6px;background:#14B8A6;color:#fff;cursor:pointer" onclick="solveStudyPlanQuestion(${q.questionId}, '${q.questionImageUrl}')">${q.solved ? 'Tekrar Çöz' : 'Çöz'}</button>
            </div>
          `).join('')}
        </div>
      `;
    }

    async function generatePersonalStudyPlan() {
      const statusEl = document.getElementById('study-plan-status');
      if (statusEl) statusEl.textContent = 'Oluşturuluyor...';
      try {
        const res = await fetch('/api/student/study-plan/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Oluşturulamadı.');
        await renderPersonalStudyPlan();
      } catch (err) {
        if (statusEl) statusEl.textContent = '❌ ' + err.message;
      }
    }

    // Plan sorusunu, pratik modunun AYNI çözme ekranıyla açar (bkz.
    // renderPracticeQuestion/submitPracticeAnswer) - ayrı bir çözme arayüzü
    // yazmaya gerek yok, aynı adaptif motor zaten questionId+answer üzerinden çalışıyor.
    function solveStudyPlanQuestion(questionId, imageUrl) {
      _practiceState = { questionId, imageUrl };
      showPage('practice');
      renderPracticeQuestion();
    }

    // ----- HATA HAFIZASI -----
    function renderErrorMemory(errorMemory) {
      const card = document.getElementById('error-memory-card');
      if (!errorMemory) { card.style.display='none'; return; }
      card.style.display='';
      document.getElementById('error-memory-list').innerHTML = `
        <div class="ep-err-grid">
          <div class="ep-err-tile"><div class="label">⚠️ Dikkat Hataları</div><div class="value">${errorMemory.counts['Dikkat Hataları']}</div></div>
          <div class="ep-err-tile"><div class="label">🔧 İşlem Hataları</div><div class="value">${errorMemory.counts['İşlem Hataları']}</div></div>
          <div class="ep-err-tile"><div class="label">📚 Konu Eksikliği</div><div class="value">${errorMemory.counts['Konu Eksikliği']}</div></div>
        </div>`;
      document.getElementById('error-memory-comment').textContent = errorMemory.aiComment || 'Henüz yeterli veri yok.';
    }

    // ----- SAYFA NAVİGASYONU -----
    // ---- Ödevlerim ----
    async function renderAssignmentsList() {
      const container = document.getElementById('assignments-list');
      document.getElementById('assignment-detail-card').innerHTML = '';
      container.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
      let list;
      try {
        list = await fetch('/api/student/assignments').then(r => r.json());
      } catch (e) {
        container.innerHTML = '<p class="text-muted">❌ Ödevler yüklenemedi.</p>';
        return;
      }
      if (!list.length) {
        container.innerHTML = '<p class="text-muted">Şu an size verilmiş bir ödev yok.</p>';
        return;
      }
      container.innerHTML = list.map(a => `
        <div class="ep-card" style="margin-top:10px;cursor:pointer" onclick="openAssignment(${a.id})">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <b>${escapeHtml(a.title)}</b>
              ${a.dueDate ? `<div class="text-muted" style="font-size:12px">Son tarih: ${escapeHtml(a.dueDate)}</div>` : ''}
            </div>
            <span style="color:${a.completed ? '#4ade80' : '#facc15'}">${a.completed ? '✅ Tamamlandı' : '⏳ Bekliyor'}</span>
          </div>
        </div>
      `).join('');
    }

    async function openAssignment(id) {
      const card = document.getElementById('assignment-detail-card');
      card.innerHTML = '<div class="ep-card" style="margin-top:10px"><p class="text-muted">Yükleniyor...</p></div>';
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const res = await fetch(`/api/student/assignments/${id}`);
      const data = await res.json();
      if (!res.ok) { card.innerHTML = `<div class="ep-card" style="margin-top:10px"><p class="text-muted">❌ ${data.error}</p></div>`; return; }

      // kaynak: "native_db" | "drive_havuzu" (bkz. edupusula-drive-entegrasyon-
      // prompt.md bölüm 5/6) - imageUrl backend'de zaten dogru uca (native
      // /api/student/question-image ya da Drive proxy) isaret ediyor,
      // burada kaynaga gore ayrica dal budaklanmaya gerek yok. Cevap
      // input'unda hangi kimlik alaninin dolu oldugu submitAssignment'a
      // data-drive-referans-id ile tasiniyor (questionBankId drive
      // sorularinda null).
      const questionsHtml = data.questions.map((q, i) => `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bg-glass-border)">
          <div style="font-size:13px;color:var(--text-muted)">Soru ${i + 1} — ${escapeHtml(q.displayCode)}</div>
          ${q.questionText ? `<div style="margin-top:6px">${escapeHtml(q.questionText)}</div>` : ''}
          ${q.hasImage && q.imageUrl ? `<img src="${q.imageUrl}" alt="Soru ${i + 1}" style="margin-top:8px;max-width:100%;border-radius:8px;border:1px solid var(--bg-glass-border)" loading="lazy"
                 onerror="this.outerHTML='<p class=&quot;text-muted&quot; style=&quot;margin-top:8px;font-size:12px&quot;>🖼️ Görsel şu an yüklenemedi (silinmiş/taşınmış olabilir) - öğretmeninize danışın.</p>'">` : ''}
          <input type="text" class="form-control assignment-answer-input"
                 data-question-id="${q.questionBankId ?? ''}" data-drive-referans-id="${q.driveReferansId ?? ''}"
                 style="margin-top:8px;max-width:200px" placeholder="Cevabınız"
                 value="${escapeHtml(q.myAnswer || '')}" ${data.status !== 'active' ? 'disabled' : ''}>
          ${q.isCorrect !== null && q.isCorrect !== undefined ? `<span style="margin-left:8px">${q.isCorrect ? '✅' : '❌'}</span>` : ''}
        </div>
      `).join('');

      card.innerHTML = `
        <div class="ep-card" style="margin-top:10px">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">📋</div> ${escapeHtml(data.title)}</div></div>
          ${data.description ? `<p class="text-muted">${escapeHtml(data.description)}</p>` : ''}
          ${questionsHtml}
          ${data.status === 'active' ? `<button onclick="submitAssignment(${id})" style="margin-top:14px;padding:10px 20px;border:none;border-radius:8px;background:#14B8A6;color:#fff;font-weight:600;cursor:pointer">Gönder</button>` : '<p class="text-muted mt-2">Bu ödev artık aktif değil.</p>'}
          <div id="assignment-submit-status" class="text-muted" style="margin-top:8px;font-size:13px"></div>
        </div>
      `;
    }

    async function submitAssignment(id) {
      const inputs = [...document.querySelectorAll('.assignment-answer-input')];
      const answers = inputs
        .map(el => ({
          questionBankId: el.dataset.questionId ? Number(el.dataset.questionId) : null,
          driveReferansId: el.dataset.driveReferansId || null,
          answer: el.value.trim(),
        }))
        .filter(a => a.answer);
      const statusEl = document.getElementById('assignment-submit-status');
      if (!answers.length) { statusEl.textContent = '❌ En az bir soruyu cevaplayın.'; return; }
      statusEl.textContent = 'Gönderiliyor...';
      try {
        const res = await fetch(`/api/student/assignments/${id}/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gönderilemedi.');
        // openAssignment() tum karti (statusEl dahil) yeniden olusturuyor -
        // once yeniden render edip mesaji YENI elemente yazmak gerekiyor,
        // aksi halde eski statusEl'e yazilan mesaj aninda silinirdi. Liste
        // (Odevlerim) bir sonraki nav tiklamasinda zaten tazeleniyor -
        // burada renderAssignmentsList() cagirmiyoruz cunku o, su an
        // gorunen bu detay kartini da temizliyor (basari mesaji kaybolurdu).
        await openAssignment(id);
        document.getElementById('assignment-submit-status').textContent = '✅ Cevaplarınız kaydedildi.';
      } catch (err) {
        statusEl.textContent = '❌ ' + err.message;
      }
    }

    // ----- PRATİK MODU (bölüm 10.5+10.8 adaptif motor - ödeve bağlı değil) -----
    let _practiceState = null; // { questionId, imageUrl }

    async function renderPracticeSubjects() {
      const container = document.getElementById('practice-container');
      container.innerHTML = '<p class="text-muted">Yükleniyor...</p>';
      let subjects;
      try {
        subjects = await fetch('/api/student/practice/subjects').then(r => r.json());
      } catch (e) {
        container.innerHTML = '<p class="text-muted">❌ Dersler yüklenemedi.</p>';
        return;
      }
      if (!subjects.length) {
        container.innerHTML = '<p class="text-muted">Şu an sınıf seviyenizde pratik yapılabilecek bir ders bulunmuyor.</p>';
        return;
      }
      container.innerHTML = `
        <p style="font-size:13px;color:var(--text-muted)">Bir ders seç, başlayalım:</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">
          ${subjects.map(s => `
            <button onclick="startPractice(${s.id})" style="padding:12px 18px;border:none;border-radius:10px;background:${subjectColor(s.name)};color:#fff;font-weight:600;cursor:pointer">
              ${subjectIcon(s.name)} ${escapeHtml(s.name)}
            </button>
          `).join('')}
        </div>
      `;
    }

    async function startPractice(subjectId) {
      const container = document.getElementById('practice-container');
      container.innerHTML = '<p class="text-muted">Soru hazırlanıyor...</p>';
      try {
        const res = await fetch(`/api/student/practice/start?subjectId=${subjectId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Başlatılamadı.');
        _practiceState = { questionId: data.questionId, imageUrl: data.questionImageUrl };
        renderPracticeQuestion();
      } catch (err) {
        container.innerHTML = `<p class="text-muted">❌ ${escapeHtml(err.message)}</p><button onclick="renderPracticeSubjects()" style="margin-top:8px;padding:8px 16px;border:none;border-radius:8px;background:#334155;color:#fff;cursor:pointer">← Derslere Dön</button>`;
      }
    }

    function renderPracticeQuestion() {
      const container = document.getElementById('practice-container');
      if (!_practiceState) { renderPracticeSubjects(); return; }
      container.innerHTML = `
        <div class="ep-card" style="margin-top:10px">
          <img src="${_practiceState.imageUrl}" alt="Soru" style="max-width:100%;border-radius:8px;border:1px solid var(--bg-glass-border)" loading="lazy">
          <input type="text" id="practice-answer-input" class="form-control" style="margin-top:10px;max-width:200px" placeholder="Cevabınız">
          <div style="margin-top:10px;display:flex;gap:8px">
            <button onclick="submitPracticeAnswer()" style="padding:10px 20px;border:none;border-radius:8px;background:#14B8A6;color:#fff;font-weight:600;cursor:pointer">Gönder</button>
            <button onclick="renderPracticeSubjects()" style="padding:10px 20px;border:none;border-radius:8px;background:#334155;color:#fff;cursor:pointer">Ders Değiştir</button>
          </div>
          <div id="practice-feedback" style="margin-top:10px;font-size:13px"></div>
        </div>
      `;
      document.getElementById('practice-answer-input').focus();
    }

    async function submitPracticeAnswer() {
      const input = document.getElementById('practice-answer-input');
      const answer = input.value.trim();
      const feedback = document.getElementById('practice-feedback');
      if (!answer) { feedback.innerHTML = '<span style="color:#facc15">Önce bir cevap girin.</span>'; return; }
      feedback.textContent = 'Kontrol ediliyor...';
      try {
        const res = await fetch('/api/student/practice/answer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: _practiceState.questionId, answer }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gönderilemedi.');

        let msg = data.isCorrect === true ? '✅ Doğru!' : (data.isCorrect === false ? '❌ Yanlış.' : '📝 Kaydedildi.');
        if (data.needsSupport && data.supportExplanation) {
          msg += `<div class="ep-card" style="margin-top:8px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.3)">💡 ${escapeHtml(data.supportExplanation)}</div>`;
        }
        feedback.innerHTML = msg;

        if (data.nextQuestionId) {
          _practiceState = { questionId: data.nextQuestionId, imageUrl: data.nextQuestionImageUrl };
          setTimeout(renderPracticeQuestion, data.needsSupport ? 2500 : 900);
        } else {
          feedback.innerHTML += '<div style="margin-top:8px;color:var(--text-muted)">Bu ders/konuda şu an başka uygun soru kalmadı 🎉</div>';
        }
      } catch (err) {
        feedback.innerHTML = `<span style="color:#fb7185">❌ ${escapeHtml(err.message)}</span>`;
      }
    }

    function showPage(page, data) {
      if (window.NavHistory) NavHistory.record(page, data);
      // 'dash-*' görünümleri Ana Sayfa bölümünün alt görünümleridir (bkz. setDashView)
      const dashView = DASH_PAGES[page];
      const section = dashView ? 'dashboard' : page;
      document.querySelectorAll('.nav-item[data-page]').forEach(i => i.classList.toggle('active', i.dataset.page===section));
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(i => i.classList.toggle('active', i.dataset.page===section));
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(`page-${section}`);
      if (sec) sec.classList.add('active');
      const titles = {
        dashboard: ['Ana Sayfa','Başarı Merkezi'],
        'dash-general': ['Genel Denemeler','Netlerin & Gelişimin'],
        'dash-mastery': ['Kazanım Denemeleri','Ders Ders Kazanımların'],
        'dash-mastery-subject': ['Kazanım Denemeleri',''],
        analytics: ['Analizler','Konu Analizi & Sınıf Karşılaştırma'],
        exams:     ['Denemelerim','Deneme Sonuçlarım'],
        assignments: ['Ödevlerim','Öğretmenimin Verdiği Ödevler'],
        practice:  ['Pratik Yap','Zorluk Kendini Ayarlar'],
        settings:  ['Ayarlar','Hesap & Güvenlik'],
      };
      const [title, subtitle] = titles[page] || [page,''];
      document.getElementById('page-title').firstChild.textContent = title + ' ';
      document.getElementById('page-subtitle').textContent = subtitle;
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.querySelector('.sidebar-overlay');
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
      if (dashView) setDashView(dashView, data);
    }

    function setupNav() {
      if (window.NavHistory) NavHistory.init((p, d) => showPage(p, d), 'dashboard');
      document.querySelectorAll('.nav-item[data-page]').forEach(i => i.addEventListener('click', () => {
        showPage(i.dataset.page);
        if (i.dataset.page === 'assignments') renderAssignmentsList();
        if (i.dataset.page === 'practice') renderPracticeSubjects();
      }));
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(i => i.addEventListener('click', () => {
        showPage(i.dataset.page);
        if (i.dataset.page === 'assignments') renderAssignmentsList();
        if (i.dataset.page === 'practice') renderPracticeSubjects();
      }));
      const toggle  = document.getElementById('menu-toggle');
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.querySelector('.sidebar-overlay');
      if (toggle) toggle.addEventListener('click', () => { if(sidebar) sidebar.classList.toggle('open'); if(overlay) overlay.classList.toggle('active'); });
      if (overlay) overlay.addEventListener('click', () => { if(sidebar) sidebar.classList.remove('open'); overlay.classList.remove('active'); });
      const mailBtn = document.getElementById('mail-btn');
      if (mailBtn) mailBtn.addEventListener('click', () => {
        showPage('dashboard');
        const card = document.getElementById('teacher-messages-card');
        if (card && card.style.display !== 'none') card.scrollIntoView({behavior:'smooth',block:'start'});
        markMessagesRead();
      });
    }

    // =====================================================================
    // ANA SAYFA GÖRÜNÜMLERİ: Seçim -> Genel Denemeler | Kazanım Denemeleri
    // Panel açılınca sadece iki seçim kartı görünür. Her görünüm ayrı bir
    // NavHistory sayfası ('dash-*'), böylece telefonun geri tuşu bir üst
    // görünüme döner. Hepsi aynı #page-dashboard bölümünde yaşar.
    // =====================================================================
    const DASH_PAGES = { 'dashboard': 'chooser', 'dash-general': 'general', 'dash-mastery': 'mastery', 'dash-mastery-subject': 'mastery-subject' };
    const LAST_VIEW_KEY = 'ogr.lastDashView';
    let masteryData = null;      // /api/student/mastery yanıtı (ilk girişte bir kez çekilir)
    let kmCharts = [];

    function fmtDate(s) {
      if (!s) return '—';
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (!m) return s;
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function kmStatus(rate) {
      if (rate >= 70) return { key: 'ok',  label: 'Kazanıldı', icon: '✅', color: '#22C55E' };
      if (rate >= 50) return { key: 'mid', label: 'Gelişiyor', icon: '🟡', color: '#F59E0B' };
      return               { key: 'low', label: 'Eksik',     icon: '🔴', color: '#EF4444' };
    }

    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    // Sunucunun düz deneme listesinden Ders -> Konu -> Kazanım ağacı
    function kmBuildTree(exams) {
      const subjects = new Map();
      [...exams].reverse().forEach(ex => { // sunucu yeni->eski döner; ağaçta eski->yeni
        let sub = subjects.get(ex.subjectName);
        if (!sub) { sub = { name: ex.subjectName, exams: [], kazanims: new Map(), topics: new Map() }; subjects.set(ex.subjectName, sub); }
        sub.exams.push(ex);
        let kz = sub.kazanims.get(ex.kazanimKodu);
        if (!kz) {
          kz = { key: ex.kazanimKodu, name: ex.kazanimAdi, topic: ex.topic, attempts: [] };
          sub.kazanims.set(ex.kazanimKodu, kz);
          if (!sub.topics.has(ex.topic)) sub.topics.set(ex.topic, []);
          sub.topics.get(ex.topic).push(kz);
        }
        kz.attempts.push(ex);
      });
      subjects.forEach(sub => {
        sub.avgRate = avg(sub.exams.map(e => e.successRate));
        const withClass = sub.exams.filter(e => e.classAvgRate != null);
        sub.classAvgRate = avg(withClass.map(e => e.classAvgRate));
        sub.classDiff = withClass.length ? avg(withClass.map(e => e.successRate - e.classAvgRate)) : null;
        sub.kazanims.forEach(kz => {
          kz.latest = kz.attempts[kz.attempts.length - 1];
          kz.prev = kz.attempts.length > 1 ? kz.attempts[kz.attempts.length - 2] : null;
          kz.avgRate = avg(kz.attempts.map(a => a.successRate));
          kz.status = kmStatus(kz.latest.successRate);
        });
        const kzList = [...sub.kazanims.values()];
        sub.statusCounts = { ok: 0, mid: 0, low: 0 };
        kzList.forEach(kz => sub.statusCounts[kz.status.key]++);
        sub.weakest = kzList.filter(kz => kz.latest.successRate < 70).sort((a, b) => a.latest.successRate - b.latest.successRate);
      });
      return [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    }

    function kmDestroyCharts() { kmCharts.forEach(c => c.destroy()); kmCharts = []; }

    function kmRatePill(rate) {
      const st = kmStatus(rate);
      return `<span class="km-pill" style="color:${st.color};background:${st.color}1f;border-color:${st.color}55">%${rate}</span>`;
    }

    function kmClassLine(rate, classRate) {
      if (classRate == null) return '';
      const d = rate - classRate;
      const cls = d > 0 ? 'km-up' : d < 0 ? 'km-down' : '';
      return `<span class="km-class ${cls}">Sınıf %${classRate}${d ? ` · ${d > 0 ? '+' : ''}${d}` : ''}</span>`;
    }

    function kmDiffText(d) {
      return d === 0 ? 'Sınıfla aynı' : `Sınıfa göre ${d > 0 ? '+' : ''}${d}`;
    }

    function kmAnswerStrip(answers) {
      if (!answers || !answers.length) return '';
      const label = { D: 'Doğru', Y: 'Yanlış', B: 'Boş' };
      return `<div class="km-strip">${answers.map((a, i) => {
        const k = a === 'D' || a === 'Y' ? a : 'B';
        return `<span class="km-q km-q-${k}" title="${i + 1}. soru: ${label[k]}">${i + 1}</span>`;
      }).join('')}</div>`;
    }

    // ---------- Kazanım Denemeleri: genel bakış ----------
    async function renderMasteryOverview() {
      const el = document.getElementById('km-overview');
      if (!masteryData) {
        el.innerHTML = '<div class="ep-empty">Yükleniyor...</div>';
        try {
          const res = await fetch('/api/student/mastery');
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'Veri alınamadı.');
          masteryData = d;
        } catch (e) {
          el.innerHTML = `<div class="ep-empty"><div class="ep-empty-icon">⚠️</div>${escapeHtml(e.message)}</div>`;
          return;
        }
      }
      kmDestroyCharts();
      const exams = masteryData.exams || [];
      if (!exams.length) {
        el.innerHTML = `<div class="ep-card"><div class="ep-empty"><div class="ep-empty-icon">🎯</div>
          Henüz Kazanım Denemesi sonucun yok.<br>Öğretmenin optik okumayla bir kazanım denemesi okuttuğunda sonuçların burada görünecek.</div></div>`;
        return;
      }
      const tree = kmBuildTree(exams);
      const allKz = tree.flatMap(s => [...s.kazanims.values()]);
      const okCount = allKz.filter(k => k.status.key === 'ok').length;
      const lowCount = allKz.filter(k => k.status.key === 'low').length;
      const recent = exams.slice(0, 5);

      el.innerHTML = `
        <div class="km-kpis anim-fade-up">
          <div class="km-kpi"><span class="km-kpi-val">${exams.length}</span><span class="km-kpi-lbl">Kazanım denemesi</span></div>
          <div class="km-kpi"><span class="km-kpi-val">%${avg(exams.map(e => e.successRate))}</span><span class="km-kpi-lbl">Ortalama başarı</span></div>
          <div class="km-kpi"><span class="km-kpi-val" style="color:#22C55E">${okCount}<small>/${allKz.length}</small></span><span class="km-kpi-lbl">Kazanılan kazanım</span></div>
          <div class="km-kpi"><span class="km-kpi-val" style="color:${lowCount ? '#EF4444' : '#22C55E'}">${lowCount}</span><span class="km-kpi-lbl">Çalışılacak kazanım</span></div>
        </div>

        <div class="ep-card anim-fade-up anim-fade-up-d1">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">🕒</div> Son Yapılan Denemeler</div></div>
          <div class="km-recent">
            ${recent.map(ex => `
              <button type="button" class="km-recent-row" onclick="window._ogrOpenMasterySubject(${JSON.stringify(ex.subjectName).replace(/"/g, '&quot;')}, ${JSON.stringify(ex.kazanimKodu).replace(/"/g, '&quot;')})">
                <span class="km-recent-icon" style="background:${subjectColor(ex.subjectName)}26">${subjectIcon(ex.subjectName)}</span>
                <span class="km-recent-main">
                  <span class="km-recent-title">${escapeHtml(ex.kazanimAdi)}</span>
                  <span class="km-recent-sub">${escapeHtml(ex.subjectName)} · ${escapeHtml(ex.topic)} · ${fmtDate(ex.date)}</span>
                </span>
                <span class="km-recent-score">${kmRatePill(ex.successRate)}${kmClassLine(ex.successRate, ex.classAvgRate)}</span>
              </button>`).join('')}
          </div>
        </div>

        <div class="ep-card anim-fade-up anim-fade-up-d2">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">📚</div> Derslerim</div></div>
          <p class="km-hint">Bir derse dokun: o derste hangi konu ve kazanımda deneme yapıldığını ve sonuçlarını gör.</p>
          <div class="km-subject-grid">
            ${tree.map((s, i) => {
              const color = subjectColor(s.name);
              const weak = s.weakest[0];
              return `
              <button type="button" class="km-subject-card" style="--km-c:${color}" onclick="window._ogrOpenMasterySubject(${JSON.stringify(s.name).replace(/"/g, '&quot;')})">
                <span class="km-subject-head"><span class="km-subject-icon">${subjectIcon(s.name)}</span><span class="km-subject-name">${escapeHtml(s.name)}</span><span class="km-subject-go">→</span></span>
                <span class="km-subject-rate">%${s.avgRate}<small> ortalama</small></span>
                <span class="km-bar"><span style="width:${s.avgRate}%;background:${color}"></span>${s.classAvgRate != null ? `<i class="km-bar-mark" style="left:${s.classAvgRate}%" title="Sınıf ortalaması %${s.classAvgRate}"></i>` : ''}</span>
                <span class="km-subject-meta">${s.exams.length} deneme · ${s.kazanims.size} kazanım${s.classDiff != null ? ` · <b class="${s.classDiff > 0 ? 'km-up' : s.classDiff < 0 ? 'km-down' : ''}">${kmDiffText(s.classDiff)}</b>` : ''}</span>
                <span class="km-chips"><span>✅ ${s.statusCounts.ok}</span><span>🟡 ${s.statusCounts.mid}</span><span>🔴 ${s.statusCounts.low}</span></span>
                ${s.exams.length > 1 ? `<span class="km-spark"><canvas id="km-spark-${i}"></canvas></span>` : ''}
                <span class="km-subject-weak">${weak ? `En zayıf: <b>${escapeHtml(weak.name)}</b> (%${weak.latest.successRate})` : '🎉 Tüm kazanımlarda %70 üstündesin'}</span>
              </button>`;
            }).join('')}
          </div>
        </div>

        ${tree.length > 1 ? `
        <div class="ep-card anim-fade-up anim-fade-up-d3">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">📊</div> Ders Karşılaştırma</div></div>
          <p class="km-hint">Kazanım denemelerindeki ortalama başarın${tree.some(s => s.classAvgRate != null) ? ', sınıf ortalamasıyla birlikte' : ''}.</p>
          <div class="chart-box" style="height:${Math.max(180, tree.length * 54)}px"><canvas id="km-compare-chart"></canvas></div>
        </div>` : ''}`;

      tree.forEach((s, i) => {
        const c = document.getElementById(`km-spark-${i}`);
        if (!c) return;
        const color = subjectColor(s.name);
        kmCharts.push(new Chart(c, {
          type: 'line',
          data: { labels: s.exams.map(e => fmtDate(e.date)), datasets: [{ data: s.exams.map(e => e.successRate), borderColor: color, backgroundColor: color + '22', fill: true, borderWidth: 2, tension: 0.35, pointRadius: 0 }] },
          options: { responsive: true, maintainAspectRatio: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } },
                     scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } } },
        }));
      });

      const cmp = document.getElementById('km-compare-chart');
      if (cmp) {
        const datasets = [{ label: 'Sen', data: tree.map(s => s.avgRate), backgroundColor: tree.map(s => subjectColor(s.name)), borderRadius: 6, barThickness: 16 }];
        if (tree.some(s => s.classAvgRate != null)) {
          datasets.push({ label: 'Sınıf ortalaması', data: tree.map(s => s.classAvgRate), backgroundColor: 'rgba(148,163,184,0.45)', borderRadius: 6, barThickness: 16 });
        }
        const base = chartDefaults();
        kmCharts.push(new Chart(cmp, {
          type: 'bar',
          data: { labels: tree.map(s => s.name), datasets },
          options: { ...base, indexAxis: 'y',
            plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (ctx) => `${ctx.dataset.label}: %${ctx.raw}` } } },
            scales: { x: { ...base.scales.x, min: 0, max: 100, ticks: { ...base.scales.x.ticks, callback: v => '%' + v } }, y: base.scales.y } },
        }));
      }
    }

    // ---------- Kazanım Denemeleri: ders detayı ----------
    function renderMasterySubject(subjectName, focusKey) {
      const el = document.getElementById('km-subject');
      kmDestroyCharts();
      const tree = masteryData ? kmBuildTree(masteryData.exams || []) : [];
      const s = tree.find(x => x.name === subjectName);
      if (!s) { el.innerHTML = '<div class="ep-empty">Bu derste kazanım denemesi bulunamadı.</div>'; return; }
      const color = subjectColor(s.name);
      document.getElementById('page-title').firstChild.textContent = s.name + ' ';
      document.getElementById('page-subtitle').textContent = 'Kazanım Denemeleri';

      const topics = [...s.topics.entries()]
        .map(([name, kzs]) => ({ name, kzs, avgRate: avg(kzs.map(k => k.latest.successRate)) }))
        .sort((a, b) => a.avgRate - b.avgRate);
      const allKz = topics.flatMap(t => t.kzs);
      const maxCols = Math.min(6, Math.max(...allKz.map(k => k.attempts.length)));

      const kzRow = (kz) => {
        const st = kz.status;
        let trend = '';
        if (kz.prev) {
          const d = kz.latest.successRate - kz.prev.successRate;
          trend = d > 0 ? `<span class="km-up">▲ ${d}</span>` : d < 0 ? `<span class="km-down">▼ ${-d}</span>` : '<span>＝</span>';
        }
        return `
          <details class="km-kz" data-kz="${escapeHtml(kz.key)}"${kz.key === focusKey ? ' open' : ''}>
            <summary>
              <span class="km-kz-main">
                <span class="km-kz-name">${escapeHtml(kz.name)}</span>
                <span class="km-kz-sub">${/^exam-/.test(kz.key) ? '' : escapeHtml(kz.key) + ' · '}${kz.attempts.length} deneme · son ${fmtDate(kz.latest.date)} ${trend}</span>
                <span class="km-bar"><span style="width:${kz.latest.successRate}%;background:${st.color}"></span>${kz.latest.classAvgRate != null ? `<i class="km-bar-mark" style="left:${kz.latest.classAvgRate}%" title="Sınıf ortalaması %${kz.latest.classAvgRate}"></i>` : ''}</span>
              </span>
              <span class="km-kz-right">
                <span class="km-badge" style="color:${st.color};background:${st.color}1f">${st.icon} ${st.label}</span>
                ${kmRatePill(kz.latest.successRate)}
              </span>
            </summary>
            <div class="km-attempts">
              ${[...kz.attempts].reverse().map(a => `
                <div class="km-attempt">
                  <div class="km-attempt-hd">
                    <span><b>${escapeHtml(a.examName)}</b><br><small>${fmtDate(a.date)}</small></span>
                    <span class="km-attempt-score">${kmRatePill(a.successRate)}${kmClassLine(a.successRate, a.classAvgRate)}</span>
                  </div>
                  <div class="km-dyb"><span class="km-d">✅ ${a.correct} doğru</span><span class="km-y">❌ ${a.wrong} yanlış</span><span class="km-b">⬜ ${a.blank} boş</span></div>
                  ${kmAnswerStrip(a.answers)}
                </div>`).join('')}
            </div>
          </details>`;
      };

      el.innerHTML = `
        <div class="ep-card km-subject-hero anim-fade-up" style="--km-c:${color}">
          <div class="km-subject-hero-top">
            <span class="km-subject-hero-icon">${subjectIcon(s.name)}</span>
            <div>
              <div class="km-subject-hero-name">${escapeHtml(s.name)}</div>
              <div class="km-subject-meta">${s.exams.length} deneme · ${s.topics.size} konu · ${s.kazanims.size} kazanım</div>
            </div>
            <div class="km-subject-hero-rate">%${s.avgRate}<small>ortalama</small></div>
          </div>
          <div class="km-chips">
            <span>✅ ${s.statusCounts.ok} kazanıldı</span><span>🟡 ${s.statusCounts.mid} gelişiyor</span><span>🔴 ${s.statusCounts.low} eksik</span>
            ${s.classDiff != null ? `<span class="${s.classDiff > 0 ? 'km-up' : s.classDiff < 0 ? 'km-down' : ''}">${kmDiffText(s.classDiff)}</span>` : ''}
          </div>
          ${s.exams.length > 1 ? `<div class="chart-box" style="height:200px;margin-top:12px"><canvas id="km-subject-chart"></canvas></div>` : ''}
        </div>

        <div class="ep-card anim-fade-up anim-fade-up-d1">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">🎯</div> Önce Bunlara Çalış</div></div>
          ${s.weakest.length ? `<div class="km-focus">${s.weakest.slice(0, 3).map((kz, i) => `
            <button type="button" class="km-focus-item" onclick="window._ogrFocusKazanim(${JSON.stringify(kz.key).replace(/"/g, '&quot;')})">
              <span class="km-focus-rank">${i + 1}</span>
              <span class="km-recent-main"><span class="km-recent-title">${escapeHtml(kz.name)}</span><span class="km-recent-sub">${escapeHtml(kz.topic)}</span></span>
              ${kmRatePill(kz.latest.successRate)}
            </button>`).join('')}</div>`
          : '<div class="ep-empty"><div class="ep-empty-icon">🎉</div>Bu dersteki tüm kazanımlarda %70 ve üstündesin. Harika!</div>'}
        </div>

        <div class="ep-card anim-fade-up anim-fade-up-d2">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">🗂️</div> Konular ve Kazanımlar</div></div>
          <p class="km-hint">Bir kazanıma dokun: o kazanımda yaptığın denemeleri, sınıf ortalamasını ve soru soru cevaplarını gör. Çubuktaki çizgi sınıf ortalamasıdır.</p>
          ${topics.map(t => `
            <details class="km-topic" open>
              <summary><span class="km-topic-name">📖 ${escapeHtml(t.name)}</span><span class="km-subject-meta">${t.kzs.length} kazanım</span>${kmRatePill(t.avgRate)}</summary>
              ${t.kzs.map(kzRow).join('')}
            </details>`).join('')}
        </div>

        <div class="ep-card anim-fade-up anim-fade-up-d3">
          <div class="ep-section-hd"><div class="ep-section-title"><div class="ep-section-icon">🔥</div> Gelişim Haritası</div></div>
          <p class="km-hint">Her satır bir kazanım; soldan sağa o kazanımdaki denemelerin${maxCols < Math.max(...allKz.map(k => k.attempts.length)) ? ` (son ${maxCols})` : ''}. Renk yeşile döndükçe kazanım oturuyor.</p>
          <div class="km-heat-wrap"><table class="km-heat">
            <tr><th></th>${Array.from({ length: maxCols }, (_, i) => `<th>${i + 1}.</th>`).join('')}</tr>
            ${allKz.map(kz => {
              const atts = kz.attempts.slice(-maxCols);
              return `<tr><td class="km-heat-name" title="${escapeHtml(kz.name)}">${escapeHtml(kz.name)}</td>${Array.from({ length: maxCols }, (_, i) => {
                const a = atts[i];
                if (!a) return '<td class="km-heat-empty"></td>';
                const st = kmStatus(a.successRate);
                return `<td style="background:${st.color}38;color:${st.color}" title="${escapeHtml(a.examName)} · ${fmtDate(a.date)}">%${a.successRate}</td>`;
              }).join('')}</tr>`;
            }).join('')}
          </table></div>
          <div class="km-legend"><span><i style="background:#22C55E"></i>%70+ Kazanıldı</span><span><i style="background:#F59E0B"></i>%50-69 Gelişiyor</span><span><i style="background:#EF4444"></i>%50 altı Eksik</span></div>
        </div>`;

      const sc = document.getElementById('km-subject-chart');
      if (sc) {
        const base = chartDefaults();
        const datasets = [{ label: 'Sen', data: s.exams.map(e => e.successRate), borderColor: color, backgroundColor: color + '26', fill: true, borderWidth: 3, tension: 0.3, pointRadius: 4 }];
        if (s.exams.some(e => e.classAvgRate != null)) {
          datasets.push({ label: 'Sınıf ortalaması', data: s.exams.map(e => e.classAvgRate), borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, tension: 0.3, pointRadius: 2, spanGaps: true });
        }
        kmCharts.push(new Chart(sc, {
          type: 'line',
          data: { labels: s.exams.map(e => fmtDate(e.date)), datasets },
          options: { ...base,
            plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: {
              title: (items) => s.exams[items[0].dataIndex].kazanimAdi,
              label: (ctx) => ctx.raw == null ? '' : `${ctx.dataset.label}: %${ctx.raw}` } } },
            scales: { x: base.scales.x, y: { ...base.scales.y, min: 0, max: 100, ticks: { ...base.scales.y.ticks, callback: v => '%' + v } } } },
        }));
      }
      if (focusKey) setTimeout(() => window._ogrFocusKazanim(focusKey), 50);
    }

    window._ogrFocusKazanim = function (key) {
      const d = [...document.querySelectorAll('#km-subject .km-kz')].find(x => x.dataset.kz === key);
      if (!d) return;
      d.open = true;
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    function setDashView(view, data) {
      const sec = document.getElementById('page-dashboard');
      const onChooser = view === 'chooser';
      sec.querySelector('.ep-hero').classList.toggle('dash-off', !onChooser);
      document.getElementById('teacher-messages-card').classList.toggle('dash-off', !onChooser);
      document.getElementById('dash-chooser').classList.toggle('dash-off', !onChooser);
      document.getElementById('dash-general').hidden = view !== 'general';
      document.getElementById('dash-mastery').hidden = view !== 'mastery';
      document.getElementById('dash-mastery-subject').hidden = view !== 'mastery-subject';
      if (onChooser) {
        let last = null;
        try { last = localStorage.getItem(LAST_VIEW_KEY); } catch (_) { /* depolama kapalı olabilir */ }
        document.querySelectorAll('#dash-chooser .km-choice').forEach(b => b.classList.toggle('km-choice-last', b.dataset.view === last));
      } else if (view === 'general' || view === 'mastery') {
        try { localStorage.setItem(LAST_VIEW_KEY, view); } catch (_) { /* depolama kapalı olabilir */ }
      }
      if (view === 'general') {
        // Gizliyken çizilen grafikler 0 boyutta kalabilir - görünür olunca yeniden ölç
        requestAnimationFrame(() => [radarChart, areaChart, scoreRadarChart, masteryTrendChart].forEach(c => c && c.resize()));
      } else if (view === 'mastery') {
        renderMasteryOverview();
      } else if (view === 'mastery-subject') {
        const go = () => renderMasterySubject(data && data.subject, data && data.focus);
        if (masteryData) go(); else renderMasteryOverview().then(go);
      }
      if (!onChooser) window.scrollTo({ top: 0 });
    }

    window._ogrOpenDashView = function (view) {
      showPage(view === 'general' ? 'dash-general' : 'dash-mastery');
    };

    window._ogrOpenMasterySubject = function (subject, focus) {
      showPage('dash-mastery-subject', { subject, focus: focus || null });
    };

    function renderChooserMeta(generalResults, allResults) {
      const mastery = (allResults || []).filter(isMasteryExam);
      const meta = (list, dateKey) => list.length
        ? `${list.length} deneme · son: ${fmtDate(list[0][dateKey])}`
        : 'Henüz deneme yok';
      document.getElementById('choice-general-meta').textContent = meta(generalResults || [], 'examDate');
      document.getElementById('choice-mastery-meta').textContent = meta(mastery, 'examDate');
    }

    // ----- ANA BOOT -----
    async function boot() {
      setupNav();
      const me = await fetch('/api/me').then(r => r.json());
      if (!me.authenticated || me.role !== 'student') { window.location.href='/login.html'; return; }

      const data = await fetch('/api/student/overview').then(r => r.json());
      if (data.error) { document.getElementById('greeting-title').textContent = data.error; return; }
      studentData = data;

      const s = data.student;
      document.getElementById('header-sub').innerHTML = `<span class="sync-dot"></span><span>${s.firstName} ${s.lastName}</span>`;
      document.getElementById('header-sub').className = 'sync-status-pill sync-ok';
      document.getElementById('greeting-title').textContent = `${s.firstName} ${s.lastName}!`;
      document.getElementById('greeting-date').textContent = '📅 ' + new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});

      // Genel Deneme (Kazanım Denemesi/OMR HARİÇ) - özet kartları/radar
      // karışmasın diye sunucunun ayrı döndürdüğü generalResults kullanılır
      // (bkz. Faz 1: Genel Deneme/Kazanım Denemesi ayrımı).
      const generalResults = data.generalResults || data.results;
      const last    = generalResults[0];
      const prev    = generalResults[1];
      const diffVal = (last && prev) ? Math.round((last.totalNet - prev.totalNet)*100)/100 : null;
      const riseStreak = computeRiseStreak(data.netTrend);

      renderTeacherMessages(data.messages);
      renderMailBadge(data.unreadMessageCount);
      renderChooserMeta(generalResults, data.results);
      setDashView('chooser');
      renderDirectionStatus(data.netTrend);
      renderScorecards(last, diffVal, data.classRank, riseStreak);
      renderStreakCard(riseStreak, data.netTrend);
      renderTodayTask(data.latestExamTopicStats, data.weakestSubject);
      renderTargetRoadmap(data.scoreBreakdown, last);
      renderTrendFilters(data.netTrend);
      renderNetAreaChart(applyTrendWindow(data.netTrend));
      renderScoreHero(data.scoreBreakdown);
      renderScoreRadar(data.scoreBreakdown);
      renderSubjectEnergy(last, prev);
      renderSubjectRadar(last, data.classSubjectAverages);
      renderCompass(data.compass, data.netTrend);
      renderStrengthSummary(data.compass, data.strongestSubject);
      renderAchievements(data.badges);
      renderPusi(data.errorMemory, data.netTrend, data.compass, riseStreak);
      renderErrorMemory(data.errorMemory);
      renderStudyPlanCard(data.latestExamTopicStats);
      renderPersonalStudyPlan();

      renderNetTrendTable(applyTrendWindow(data.netTrend));

      // ----- TÜM DENEMELERİM -----
      renderExamResultsList(data.results, data.masteryTrend);

      // ----- KONU ANALİZİ -----
      const topicCard = document.getElementById('topic-card');
      if (data.latestExamTopicStats && data.latestExamTopicStats.length) {
        topicCard.style.display='';
        const colorMap = { high:'#10b981', med:'#f59e0b', low:'#ef4444' };
        document.getElementById('topic-stats').innerHTML = data.latestExamTopicStats.slice(0,10).map(t => {
          const cls = t.successRate>=70?'high':t.successRate>=50?'med':'low';
          const clr = colorMap[cls];
          return `
            <div class="ep-topic-item">
              <span class="ep-topic-name">${escapeHtml(t.kazanim)}</span>
              <div class="ep-topic-bar-wrap"><div class="ep-topic-bar" style="width:${t.successRate}%;background:${clr}"></div></div>
              <span class="ep-topic-pct" style="color:${clr}">${t.successRate}%</span>
              <span style="font-size:12px;color:var(--text-muted)">${t.correct}D/${t.wrong}Y/${t.blank}B</span>
            </div>`;
        }).join('');
      }

      // ----- SINIF ORTALAMALARI -----
      document.getElementById('class-averages').innerHTML = data.classAverages.map(c => `
        <div class="ep-class-row">
          <span class="ep-class-name">${escapeHtml(c.className)} ${c.className===s.className?'<span class="ep-class-mine">Benim Sınıfım</span>':''}</span>
          <span style="font-size:12.5px;color:var(--text-muted)">${c.studentCount} öğrenci</span>
          <span class="ep-class-avg">${c.avgNet}</span>
        </div>`).join('');
    }

    async function changePassword() {
      const current = document.getElementById('pw-current').value;
      const newPw   = document.getElementById('pw-new').value;
      const status  = document.getElementById('pw-status');
      status.textContent = 'Gönderiliyor...';
      try {
        const res  = await fetch('/api/me/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:current,newPassword:newPw})});
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Değiştirilemedi.');
        status.textContent = '✅ Şifreniz değiştirildi.';
        document.getElementById('pw-current').value='';
        document.getElementById('pw-new').value='';
      } catch(err) { status.textContent='❌ '+err.message; }
    }

    async function logout() {
      await fetch('/api/logout',{method:'POST'});
      window.location.href='/login.html';
    }

    boot();
