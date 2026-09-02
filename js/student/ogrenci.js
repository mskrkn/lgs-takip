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
      dotsEl.innerHTML = dots.map(d => `<div class="ep-streak-dot ${d.state}" title="${d.label}">${d.label}</div>`).join('');
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
        <div class="ep-task-title">${t.title}</div>
        <p class="ep-task-detail">${t.detail}</p>
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
        </p>`;
    }

    // ----- PUSİ YORUMU -----
    function renderPusi(errorMemory, netTrend) {
      const el = document.getElementById('pusi-message');
      if (errorMemory && errorMemory.aiComment) { el.textContent = errorMemory.aiComment; return; }
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
          ? `Şu an en çok <b>${subjectName(t.subjectKey)} - ${t.kazanim}</b> konusuna odaklanmalısın (başarı oranın %${t.successRate}).`
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
              <span>${medals[i]||'⭐'} ${s.kazanim}</span>
              <b>%${s.successRate}</b>
            </li>`).join('')
        : `<li class="ep-strength-item" style="color:var(--text-muted)">${strongestSubject ? `En güçlü dersin: ${subjectName(strongestSubject)}` : 'Henüz yeterli veri yok'}</li>`;

      const workHtml = workList.length
        ? workList.map(s => `
            <li class="ep-strength-item">
              <span>🎯 ${s.kazanim}</span>
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
    function renderCompass(compass) {
      const el = document.getElementById('compass');
      if (!compass) { el.innerHTML = '<p style="color:var(--text-muted)">Henüz yeterli veri yok.</p>'; return; }
      const list = (items, emptyText, mapFn) => items.length
        ? `<ul class="ep-q-list">${items.map(mapFn).join('')}</ul>`
        : `<p style="font-size:12px;color:var(--text-muted);margin-top:auto">${emptyText}</p>`;
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
            ${list(compass.strong,'Optik okuma sonucu gelince görünür', s=>`<li>${s.kazanim}<b>%${s.successRate}</b></li>`)}
          </div>
          <div class="ep-quadrant" style="--q-clr:#ef4444;border-bottom-left-radius:18px">
            <span class="ep-q-dir">Öncelikli Çalışma</span>
            <h4 class="ep-q-head">🎯 Odaklanılacaklar</h4>
            ${list(compass.priority,'Acil öncelik yok', p=>`<li>${p.kazanim}<b>%${p.successRate}</b></li>`)}
          </div>
          <div class="ep-quadrant" style="--q-clr:#f59e0b;border-bottom-right-radius:18px;background:color-mix(in srgb,#f59e0b 12%,rgba(255,255,255,0.025))">
            <span class="ep-q-dir">Dikkat Gerektiren</span>
            <h4 class="ep-q-head">👀 Gözden Geçir</h4>
            ${list(compass.attention,'Dikkat gereken konu yok', a=>`<li>${a.kazanim}<b>%${a.successRate}</b></li>`)}
          </div>
          <div class="ep-compass-center" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9.5" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
              <path d="M12 4 L14 12 L12 20 L10 12 Z" fill="#14B8A6"/>
            </svg>
          </div>
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
          ${netTrend.map(t => `<tr><td>${t.examName}</td><td>${t.examDate||'—'}</td><td class="ep-net-badge">${t.totalNet}</td></tr>`).join('')}
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
            <div class="ep-plan-day-text">${p.text}</div>
          </div>
        </div>`).join('');
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
    function showPage(page) {
      document.querySelectorAll('.nav-item[data-page]').forEach(i => i.classList.toggle('active', i.dataset.page===page));
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(i => i.classList.toggle('active', i.dataset.page===page));
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(`page-${page}`);
      if (sec) sec.classList.add('active');
      const titles = {
        dashboard: ['Ana Sayfa','Başarı Merkezi'],
        analytics: ['Analizler','Konu Analizi & Sınıf Karşılaştırma'],
        exams:     ['Denemelerim','Deneme Sonuçlarım'],
        settings:  ['Ayarlar','Hesap & Güvenlik'],
      };
      const [title, subtitle] = titles[page] || [page,''];
      document.getElementById('page-title').firstChild.textContent = title + ' ';
      document.getElementById('page-subtitle').textContent = subtitle;
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.querySelector('.sidebar-overlay');
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
    }

    function setupNav() {
      document.querySelectorAll('.nav-item[data-page]').forEach(i => i.addEventListener('click', () => showPage(i.dataset.page)));
      document.querySelectorAll('.mobile-nav-item[data-page]').forEach(i => i.addEventListener('click', () => showPage(i.dataset.page)));
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

      const last    = data.results[0];
      const prev    = data.results[1];
      const diffVal = (last && prev) ? Math.round((last.totalNet - prev.totalNet)*100)/100 : null;
      const riseStreak = computeRiseStreak(data.netTrend);

      renderTeacherMessages(data.messages);
      renderMailBadge(data.unreadMessageCount);
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
      renderCompass(data.compass);
      renderStrengthSummary(data.compass, data.strongestSubject);
      renderAchievements(data.badges);
      renderPusi(data.errorMemory, data.netTrend);
      renderErrorMemory(data.errorMemory);
      renderStudyPlanCard(data.latestExamTopicStats);

      renderNetTrendTable(applyTrendWindow(data.netTrend));

      // ----- TÜM DENEMELERİM -----
      if (!data.results.length) {
        document.getElementById('exam-results').innerHTML = '<div class="ep-empty"><div class="ep-empty-icon">📝</div>Henüz deneme sonucu bulunmuyor.</div>';
      } else {
        document.getElementById('exam-results').innerHTML = `
          <div style="overflow-x:auto"><table class="ep-exams-table">
            <tr><th>Deneme</th><th>Tarih</th><th>Toplam Net</th></tr>
            ${data.results.map(r => `<tr><td>${r.examName}</td><td>${r.examDate||'—'}</td><td class="ep-net-badge">${r.totalNet}</td></tr>`).join('')}
          </table></div>`;
      }

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
              <span class="ep-topic-name">${t.kazanim}</span>
              <div class="ep-topic-bar-wrap"><div class="ep-topic-bar" style="width:${t.successRate}%;background:${clr}"></div></div>
              <span class="ep-topic-pct" style="color:${clr}">${t.successRate}%</span>
              <span style="font-size:12px;color:var(--text-muted)">${t.correct}D/${t.wrong}Y/${t.blank}B</span>
            </div>`;
        }).join('');
      }

      // ----- SINIF ORTALAMALARI -----
      document.getElementById('class-averages').innerHTML = data.classAverages.map(c => `
        <div class="ep-class-row">
          <span class="ep-class-name">${c.className} ${c.className===s.className?'<span class="ep-class-mine">Benim Sınıfım</span>':''}</span>
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
