// ============================================
// LGS Deneme Takip - Optik Format Profilleri
// ============================================
// Her okul/optik firması ham cevap dökümünü farklı bir düzende (sabit
// sütun pozisyonlu ya da bir karakterle ayrılmış) dışa aktarır. Bu dosya,
// böyle bir "profil" tanımını genel (examType/format'tan bağımsız) bir
// şekilde işleyip öğrenci + cevap bloklarını çıkaran ortak motoru sağlar.
// Yeni bir okul/firma formatı geldiğinde ya BUILT_IN_PROFILES'a yeni bir
// profil eklenir, ya da kullanıcı içe aktarma ekranındaki kalibratörle
// (bkz. import.js) profili kendisi tanımlayıp kalıcı olarak kaydeder.

const OptikProfiles = {
  // ---- Hazır (built-in) profiller ----
  // NOT: haruniye-limit-tyt ve koray-limit-deneme profillerindeki cevap
  // bloklarının uzunlukları (40/25/40/20 ve 40/46/40/40) gerçek örnek
  // dosyalardan bire bir ölçülerek doğrulandı - bu yüzden alan sınırları
  // kesin. Ancak hangi bloğun hangi derse ait olduğu (resmi TYT/AYT soru
  // sayılarıyla tam örtüşmüyor, muhtemelen kurumun kendi soru dağılımı)
  // BİLİNMİYOR - bu yüzden subjectKey bilerek boş bırakıldı; içe aktarma
  // ekranı ilk kullanımda kullanıcıya "hangi blok hangi ders" sorusunu bir
  // kez sorar ve isterse profil olarak kaydeder.
  builtIn: [
    {
      id: 'lgs-legacy-fixedwidth',
      label: 'LGS Optik (Standart, A/B Kitapçık)',
      examType: 'LGS',
      kind: 'fixedWidth',
      optionCount: 4,
      builtIn: true,
      // Örnek/varsayılan cevap anahtarı — sadece bu profilin daha önce üretimde
      // kullanılan bilinen bir cevap anahtarı olduğu için doldurulmuştur; diğer
      // profillerde kullanıcı kendi anahtarını girer.
      defaultAnswerKeys: {
        A: { turkce: 'DBADDBDCCCCDABCDBDCA', inkilap: 'BADBABDACD', din: 'CAADBCBBDC', ingilizce: 'ACADBCBCAB', matematik: 'CDCACADBADABACB CADB', fen: 'DAAADCBACDBCCCBBCBBA' },
        B: { turkce: 'AADBABBCDDBACDBDCABD', inkilap: 'DCADCABDAB', din: 'CDBBCBDAAC', ingilizce: 'BACACBDDCA', matematik: 'BDDCBDCADADABBACAABA', fen: 'ABCCBDCCDDDCABCDAAAD' },
      },
      fields: [
        { role: 'ignore', start: 0, end: 10 },
        { role: 'schoolNumber', start: 10, end: 15 },
        { role: 'fullName', start: 15, end: 35 },
        { role: 'className', start: 35, end: 37 },
        { role: 'booklet', start: 49, end: 51 },
        { role: 'answerBlock', start: 51, end: 71, subjectKey: 'turkce', label: 'Türkçe' },
        { role: 'answerBlock', start: 71, end: 81, subjectKey: 'inkilap', label: 'İnkılap' },
        { role: 'answerBlock', start: 91, end: 101, subjectKey: 'din', label: 'Din K.' },
        { role: 'answerBlock', start: 111, end: 121, subjectKey: 'ingilizce', label: 'İngilizce' },
        { role: 'answerBlock', start: 131, end: 151, subjectKey: 'matematik', label: 'Matematik' },
        { role: 'answerBlock', start: 151, end: 171, subjectKey: 'fen', label: 'Fen' },
      ],
    },
    {
      id: 'haruniye-limit-tyt-backslash',
      label: "Haruniye/Limit TYT ( \\ Ayraçlı)",
      examType: 'TYT',
      kind: 'delimited',
      delimiter: '\\',
      optionCount: 5,
      builtIn: true,
      fields: [
        { role: 'ignore', index: 0 },
        { role: 'firstName', index: 1 },
        { role: 'lastName', index: 2 },
        { role: 'ignore', index: 3 },
        { role: 'className', index: 4 },
        { role: 'ignore', index: 5 },
        { role: 'ignore', index: 6 },
        { role: 'booklet', index: 7 },
        { role: 'answerBlock', index: 8, label: 'Blok 1 (40 karakter)' },
        { role: 'answerBlock', index: 9, label: 'Blok 2 (25 karakter)' },
        { role: 'answerBlock', index: 10, label: 'Blok 3 (40 karakter)' },
        { role: 'answerBlock', index: 11, label: 'Blok 4 (20 karakter)' },
        { role: 'tcNo', index: 12 },
      ],
    },
    {
      id: 'koray-limit-deneme-backslash',
      label: "Koray Deneme ( \\ Ayraçlı)",
      examType: 'TYT',
      kind: 'delimited',
      delimiter: '\\',
      optionCount: 5,
      builtIn: true,
      fields: [
        { role: 'fullName', index: 1 },
        { role: 'ignore', index: 2 },
        { role: 'className', index: 3 },
        { role: 'ignore', index: 4 },
        { role: 'ignore', index: 5 },
        { role: 'booklet', index: 6 },
        { role: 'answerBlock', index: 7, label: 'Blok 1 (40 karakter)' },
        { role: 'answerBlock', index: 8, label: 'Blok 2 (46 karakter)' },
        { role: 'answerBlock', index: 9, label: 'Blok 3 (40 karakter)' },
        { role: 'answerBlock', index: 10, label: 'Blok 4 (40 karakter)' },
        { role: 'tcNo', index: 11 },
        { role: 'tcNo2', index: 12 },
      ],
    },
    {
      // Gerçek sözel.txt dosyasından bire bir ölçüldü: 316 satırın hepsinde
      // ayraç konumu tutarlı; oturum=1 satırları (sözel bölüm) TR/SOS/DIN/ING
      // bloklarını, oturum=2 satırları (sayısal bölüm) MAT/FEN bloklarını
      // taşıyor - konumlar LGS legacy profiliyle bire bir aynı (aynı optik
      // altyapısının farklı bir okul başlığıyla dökümü olduğu anlaşılıyor).
      id: 'lgs-iki-oturum-sozel-dosya',
      label: 'LGS Sözel/Sayısal Bölüm (sözel.txt tipi başlık)',
      examType: 'LGS',
      kind: 'fixedWidth',
      optionCount: 4,
      builtIn: true,
      fields: [
        { role: 'schoolNumber', start: 0, end: 15 },
        { role: 'fullName', start: 15, end: 35 },
        { role: 'className', start: 35, end: 37 },
        { role: 'ignore', start: 37, end: 49 },
        { role: 'booklet', start: 50, end: 51 },
      ],
      sessionField: { start: 49, end: 50 },
      variants: {
        '1': { fields: [
          { role: 'answerBlock', start: 51, end: 71, subjectKey: 'turkce', label: 'Türkçe' },
          { role: 'answerBlock', start: 71, end: 81, subjectKey: 'inkilap', label: 'İnkılap' },
          { role: 'answerBlock', start: 91, end: 101, subjectKey: 'din', label: 'Din K.' },
          { role: 'answerBlock', start: 111, end: 121, subjectKey: 'ingilizce', label: 'İngilizce' },
        ] },
        '2': { fields: [
          { role: 'answerBlock', start: 131, end: 151, subjectKey: 'matematik', label: 'Matematik' },
          { role: 'answerBlock', start: 151, end: 171, subjectKey: 'fen', label: 'Fen' },
        ] },
      },
    },
    {
      // Gerçek sayısal.txt dosyasından bire bir ölçüldü. Aynı okul/altyapı,
      // farklı (daha kısa) bir başlık düzeni kullanıyor; oturum etiketinin
      // anlamı bu dosyada TERSİNE dönük: oturum=1 -> sayısal bölüm (MAT/FEN),
      // oturum=2 -> sözel bölüm (TR/SOS/DIN/ING). Öğrenci no 17 karakterlik
      // sağa-yaslı bir alanda; oturum hanesi ve kitapçık hemen ardından gelir.
      id: 'lgs-iki-oturum-sayisal-dosya',
      label: 'LGS Sözel/Sayısal Bölüm (sayısal.txt tipi başlık)',
      examType: 'LGS',
      kind: 'fixedWidth',
      optionCount: 4,
      builtIn: true,
      fields: [
        { role: 'ignore', start: 0, end: 9 },
        { role: 'className', start: 9, end: 10 },
        { role: 'schoolNumber', start: 10, end: 27 },
        { role: 'booklet', start: 28, end: 29 },
        { role: 'fullName', start: 29, end: 50 },
      ],
      sessionField: { start: 27, end: 28 },
      variants: {
        '1': { fields: [
          { role: 'answerBlock', start: 130, end: 150, subjectKey: 'matematik', label: 'Matematik' },
          { role: 'answerBlock', start: 150, end: 170, subjectKey: 'fen', label: 'Fen' },
        ] },
        '2': { fields: [
          { role: 'answerBlock', start: 50, end: 70, subjectKey: 'turkce', label: 'Türkçe' },
          { role: 'answerBlock', start: 70, end: 80, subjectKey: 'inkilap', label: 'İnkılap' },
          { role: 'answerBlock', start: 90, end: 100, subjectKey: 'din', label: 'Din K.' },
          { role: 'answerBlock', start: 110, end: 120, subjectKey: 'ingilizce', label: 'İngilizce' },
        ] },
      },
    },
    {
      // haruniye-3d-tyt-3dtytoptik.txt örneğinden bire bir ölçüldü (26/26
      // satır tam tutarlı, sabit 220 karakter). Cevap harfleri A-E (TYT/AYT
      // tipi). 3 cevap bloğunun uzunlukları (64/37/22) resmi TYT ders soru
      // sayılarıyla örtüşmüyor - bu yüzden hangi bloğun hangi derse ait
      // olduğu bilinmiyor, içe aktarımda kullanıcıya sorulur.
      id: 'haruniye-3d-tyt',
      label: 'Haruniye 3D TYT Optik (Sabit Genişlik)',
      examType: 'TYT',
      kind: 'fixedWidth',
      optionCount: 5,
      builtIn: true,
      fields: [
        { role: 'ignore', start: 0, end: 6 },
        { role: 'fullName', start: 6, end: 24 },
        { role: 'ignore', start: 24, end: 26 },
        { role: 'schoolNumber', start: 26, end: 32 },
        { role: 'booklet', start: 32, end: 33 },
        { role: 'className', start: 33, end: 35 },
        { role: 'answerBlock', start: 59, end: 123, label: 'Blok 1 (64 karakter)' },
        { role: 'answerBlock', start: 139, end: 176, label: 'Blok 2 (37 karakter)' },
        { role: 'answerBlock', start: 177, end: 199, label: 'Blok 3 (22 karakter)' },
      ],
    },
  ],

  // ---- Profil listesi (hazır + kullanıcı tarafından kaydedilmiş) ----
  async getAllProfiles() {
    let custom = [];
    try {
      custom = (await db.getCustomOptikProfiles()) || [];
    } catch (_) { /* db henüz hazır değilse hazır profillerle devam et */ }
    return [...custom, ...this.builtIn];
  },

  profileNeedsBlockMapping(profile) {
    const allFields = profile.variants
      ? [...(profile.fields || []), ...Object.values(profile.variants).flatMap(v => v.fields || [])]
      : (profile.fields || []);
    return allFields.some(f => f.role === 'answerBlock' && !f.subjectKey);
  },

  // ---- Format otomatik tespiti ----
  // sampleLines: dosyanın/metnin ilk birkaç dolu satırı
  async detectBest(sampleLines) {
    const lines = (sampleLines || []).filter(l => l && l.trim().length > 5).slice(0, 8);
    if (lines.length === 0) return null;

    const profiles = await this.getAllProfiles();
    let best = null;
    let bestScore = 0;
    for (const profile of profiles) {
      const score = this._scoreProfile(profile, lines);
      if (score > bestScore) {
        bestScore = score;
        best = profile;
      }
    }
    return best ? { profile: best, confidence: bestScore } : null;
  },

  _scoreProfile(profile, lines) {
    // Oturum-varyantlı profillerde bir satır, varyantlardan HERHANGİ biriyle
    // iyi eşleşiyorsa yeterlidir (o satırın hangi oturuma ait olduğu zaten
    // sessionField'dan okunacak) - o yüzden her satır için en iyi varyant skoru alınır.
    const variantFieldSets = profile.variants
      ? Object.values(profile.variants).map(v => [...profile.fields, ...v.fields])
      : [profile.fields];

    let hits = 0;
    for (const line of lines) {
      let lineOk = false;
      for (const fields of variantFieldSets) {
        if (this._lineMatchesFields(profile, line, fields)) { lineOk = true; break; }
      }
      if (lineOk) hits++;
    }
    return hits / lines.length;
  },

  _lineMatchesFields(profile, line, fields) {
    if (profile.kind === 'delimited') {
      const parts = line.split(profile.delimiter);
      const maxIndex = Math.max(...fields.map(f => f.index));
      if (parts.length <= maxIndex) return false;
      const bookletField = fields.find(f => f.role === 'booklet');
      const bookletVal = bookletField ? (parts[bookletField.index] || '').trim() : '';
      if (bookletField && bookletVal && !/^[A-E]$/i.test(bookletVal)) return false;
      return true;
    }

    const maxEnd = Math.max(...fields.map(f => f.end));
    // Alt sınır: satır sonu boşlukları kırpılmış olabilir (biraz tolerans).
    // Üst sınır: `\` ayraçlı formatlar da satır uzunluğu bakımından
    // fixedWidth profillerle yanlışlıkla eşleşmesin diye sıkı tutulur.
    if (line.length < maxEnd - 5 || line.length > maxEnd + 20) return false;
    const bookletField = fields.find(f => f.role === 'booklet');
    if (bookletField) {
      const raw = line.slice(bookletField.start, bookletField.end).trim();
      const letter = raw ? raw[raw.length - 1].toUpperCase() : '';
      if (letter && !/^[A-E]$/.test(letter)) return false;
    }
    // Tanımlı alanlar arasındaki boşluk bırakılmış aralıklar gerçek bir
    // satırda da boş olmalı - farklı sabit-genişlikli formatları ayırt eder.
    // (sessionField varsa - tek haneli oturum göstergesi - o da "kapsanan"
    // sayılır, yoksa gap-boşluk kontrolü onu yanlışlıkla boşluk sanır.)
    const allCoveredFields = profile.sessionField ? [...fields, profile.sessionField] : fields;
    const covered = allCoveredFields.filter(f => f.start != null && f.end != null).sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const f of covered) {
      if (f.start > cursor) {
        const gap = line.slice(cursor, f.start);
        if (gap.trim().length > 0) return false;
      }
      cursor = Math.max(cursor, f.end);
    }
    return true;
  },

  // ---- Bir satırı verilen profile göre ayrıştır ----
  // Bazı formatlarda (ör. LGS'nin sözel/sayısal iki oturumlu dökümü) aynı okul/
  // firma tek bir dosyada satır satır FARKLI derslerin cevaplarını dökebiliyor;
  // hangi dersin o satırda olduğu bir "oturum" alanıyla (ör. tek haneli 1/2)
  // belirleniyor. Böyle profiller `sessionField` + `variants` tanımlar:
  // `fields` ortak/başlık alanlarını, `variants[oturumDeğeri].fields` ise o
  // oturuma özgü cevap bloklarını taşır. Aynı öğrencinin farklı oturumlardaki
  // satırları import.js'teki mergeOpticalRows ile tek sonuçta birleştirilir.
  extractLine(profile, rawLine, blockSubjectOverrides) {
    if (!rawLine || !rawLine.trim()) return null;
    const isDelimited = profile.kind === 'delimited';
    const parts = isDelimited ? rawLine.split(profile.delimiter) : null;

    const get = (field) => {
      if (isDelimited) return (parts[field.index] ?? '').trim();
      return rawLine.slice(field.start, field.end).trim();
    };
    const getRaw = (field) => {
      // Cevap bloklarında boşluk = boş cevap anlamına geldiği için trim ETMİYORUZ.
      if (isDelimited) return (parts[field.index] ?? '');
      return rawLine.slice(field.start, field.end);
    };

    let fieldsToUse = profile.fields;
    if (profile.variants) {
      const sessionVal = get(profile.sessionField);
      const variant = profile.variants[sessionVal];
      if (!variant) return null; // taninmayan/bos oturum degeri - satir atlanir
      fieldsToUse = [...profile.fields, ...variant.fields];
    }

    const rec = { schoolNumber: '', firstName: '', lastName: '', className: '', booklet: 'A', meta: {}, answerBlocks: [] };
    let blockIdx = 0;

    for (const field of fieldsToUse) {
      switch (field.role) {
        case 'schoolNumber': rec.schoolNumber = get(field); break;
        case 'fullName': {
          const full = get(field);
          const parts2 = full.split(/\s+/).filter(Boolean);
          rec.firstName = parts2.slice(0, -1).join(' ') || parts2[0] || '';
          rec.lastName = parts2.length > 1 ? parts2[parts2.length - 1] : '';
          break;
        }
        case 'firstName': rec.firstName = get(field); break;
        case 'lastName': rec.lastName = get(field); break;
        case 'className': rec.className = get(field); break;
        case 'booklet': {
          const raw = get(field);
          const letter = raw ? raw[raw.length - 1].toUpperCase() : 'A';
          rec.booklet = /^[A-E]$/.test(letter) ? letter : 'A';
          break;
        }
        case 'tcNo': case 'tcNo2': rec.meta[field.role] = get(field); break;
        case 'answerBlock': {
          const subjectKey = (blockSubjectOverrides && blockSubjectOverrides[blockIdx]) || field.subjectKey || null;
          rec.answerBlocks.push({ index: blockIdx, label: field.label || `Blok ${blockIdx + 1}`, raw: getRaw(field), subjectKey });
          blockIdx++;
          break;
        }
        case 'ignore': default: break;
      }
    }

    if (!rec.schoolNumber && !rec.firstName) return null;
    return rec;
  },

  // ---- Cevap karşılaştırma (LGS A-D / TYT-AYT A-E fark etmeksizin çalışır) ----
  evaluateAnswers(studentRaw, keyAns) {
    let correct = 0, wrong = 0, blank = 0;
    const key = keyAns || '';
    const student = (studentRaw || '').padEnd(key.length, ' ');
    for (let i = 0; i < key.length; i++) {
      const k = (key[i] || '').toUpperCase();
      const s = (student[i] || '').toUpperCase();
      if (!k || k === ' ') continue;
      if (!s || s === ' ') blank++;
      else if (s === k) correct++;
      else wrong++;
    }
    const net = Math.max(0, correct - wrong / 3);
    return { correct, wrong, blank, net: parseFloat(net.toFixed(2)) };
  },
};
