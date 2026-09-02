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
//
// Referans kaynak: proje kök dizinindeki "form Okutma Ayarları ve örnek
// formatlar/" klasörü, DATASİS marka optik okuyucu formlarının 7 farklı
// tarayıcı markası (Axiome/Sürat, Bikom, Markwiev, Opscan, Optijet,
// Scanbook, Sekonic) için dışa aktarılmış resmi alan tanımlarını içerir.
// Şu an sadece LGS 1./2. Oturum (OMR_92/93) formları kullanıldı (yukarıdaki
// iki profil). Klasörde ayrıca TYT, AYT, YGS, LYS-1..5, KTT, TEOG, SBS, YDS
// ve KPSS için de hazır DATASİS form tanımları var - ileride bu sınavlardan
// birine ait gerçek bir optik dökümü gelirse, önce buradaki ilgili .fmt/.srt
// dosyasından ders sırası/isimleri doğrulanıp, SONRA gerçek örnek satırlara
// karşı bayt ofsetleri ölçülerek (asla sadece tarayıcı dosyasından
// tahmin edilerek değil) yeni bir profil eklenebilir.

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
      //
      // Ek doğrulama (2026): "form Okutma Ayarları ve örnek formatlar/"
      // klasöründeki resmi DATASİS form tanımları (aynı OMR_92/OMR_93
      // formu için 3 bağımsız tarayıcı markası - Bikom/.fmt, Optijet/.FMT,
      // Sürat-Axiome/.srt - kodlaması) ders SIRASI ve isimlerini bire bir
      // doğruladı: 1.oturum = Türkçe(20, iki 10'luk blok halinde ardışık)
      // → İnkılap(10) → Din(10) → İngilizce(10); 2.oturum = Matematik(20)
      // → Fen(20). Bayt ofsetleri yine de gerçek örnek satırlardan ölçülen
      // değerlerdir (tarayıcı yazılımlarının kendi iç satır/sütun
      // koordinat sistemi doğrudan dışa aktarım pozisyonuna güvenle
      // çevrilemiyor - alanlar arası tutarsız/göreli numaralandırma
      // gözlemlendi), ama artık hangi bloğun hangi derse ait olduğundan
      // ve blok sırasından resmi kaynakla teyitli olarak eminiz.
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
      // "SAYISAL11.txt" örneğinden (185 satırın TAMAMI, %100 eşleşme ile)
      // bire bir ölçüldü. Yukarıdaki lgs-iki-oturum-sayisal-dosya ile AYNI
      // okul/firma değil - farklı bir vendor'un dökümü: sabit 280 karakter,
      // öğrenci no 9-14 (kurum kodu 0-9'da, hep sabit), ad soyad 14-45,
      // ardından tek bir "0" hanesi ve boşluk, sonra sınıf+cinsiyet+kitapçık
      // bloğu (56: sınıf 2 kr. "8B" gibi, 58: cinsiyet K/E, 59: kitapçık A/B).
      //
      // Aynı vendor'un SÖZEL11.txt dosyası da elde edildi (186 satırın
      // TAMAMI, %100 eşleşme ile ölçüldü - not: örnek metinde Türkçe İ harfi
      // "Ä°" olarak iki karakterli bozuk kopyalanmıştı, kolon ölçümü buna göre
      // düzeltilerek yapıldı; gerçek dosya uygulamanın kendi Türkçe kodlama
      // algılamasından geçeceği için bu sorun yaşanmaz). SÖZEL11.txt AYNI
      // başlık düzenini kullanıyor, sadece cevap bloğu farklı yerde: 160-190
      // Türkçe(20)+İnkılap(10), 200-210 Din(10), 220-230 İngilizce(10).
      // Bu aralık SAYISAL11.txt'nin Matematik/Fen bloğuyla (240-280) hiç
      // ÇAKIŞMIYOR - her iki dosya da diğerinin blok bölgesinde boşluk
      // bırakıyor. Bu yüzden tek profilde HER İKİ blok grubu birden
      // tanımlanabiliyor: sayısal dosyasının satırlarında sözel blokları
      // (ve tersi) otomatik boş çıkar ve evaluateOpticalData bu boş bloğu
      // atlar (bkz. importOptical.js) - böylece sayısal.txt + sözel.txt
      // art arda yapıştırılıp TEK seferde değerlendirildiğinde aynı öğrenci
      // (okul no ile) otomatik birleşir, boş taraf gerçek veriyi ezmez.
      id: 'lgs-sayisal-dosya-v2',
      label: 'LGS Sayısal/Sözel Dosyası (SAYISAL11/SÖZEL11 tipi, 280 kr.)',
      examType: 'LGS',
      kind: 'fixedWidth',
      optionCount: 4,
      builtIn: true,
      fields: [
        { role: 'ignore', start: 0, end: 9 }, // Kurum kodu - sabit, program tarafından kullanılmıyor
        { role: 'schoolNumber', start: 9, end: 14 },
        { role: 'fullName', start: 14, end: 45 },
        { role: 'ignore', start: 45, end: 46 },
        { role: 'className', start: 56, end: 58 },
        { role: 'ignore', start: 58, end: 59 }, // Cinsiyet (K/E) - program tarafından kullanılmıyor
        { role: 'booklet', start: 59, end: 60 },
        { role: 'answerBlock', start: 160, end: 180, subjectKey: 'turkce', label: 'Türkçe' },
        { role: 'answerBlock', start: 180, end: 190, subjectKey: 'inkilap', label: 'İnkılap' },
        { role: 'answerBlock', start: 200, end: 210, subjectKey: 'din', label: 'Din K.' },
        { role: 'answerBlock', start: 220, end: 230, subjectKey: 'ingilizce', label: 'İngilizce' },
        { role: 'answerBlock', start: 240, end: 260, subjectKey: 'matematik', label: 'Matematik' },
        { role: 'answerBlock', start: 260, end: 280, subjectKey: 'fen', label: 'Fen' },
      ],
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
    {
      // "format 1.txt" tarifinden eklendi (2. - kesinleşmiş sürüm): eskiden
      // İKİ AYRI optik dökümü (sözel.txt + sayısal.txt, bkz. lgs-iki-oturum-*
      // profilleri) olarak gelen LGS sonuçlarının artık TEK satırda birleşik
      // çıktığı bir format. Kullanıcı bu sefer sözel/sayısal ders bloklarının
      // her birinin pozisyonunu AYRI AYRI ve SÖZEL/SAYISAL KISIM başlıklarıyla
      // net verdi (öncekinde tek "sözel"/"sayısal" toplam aralığı vardı):
      //   kurum kodu 4-9, numara 10-14, ad soyad 15-45, sınıf 57-58,
      //   kitapçık 60, Türkçe 161-181, Sosyal/İnkılap 181-191,
      //   Din ve Ahlak 201-211, İngilizce 221-231,
      //   Matematik 241-"61" (261'in yazım hatası - Fen'in 261'de başladığı
      //   ve diğer 3 sözel blok arasındaki 10 kr.'lik boşluk deseniyle
      //   tutarlı olduğu için 261 olarak düzeltildi), Fen 261-281.
      // Tüm blok sınırları ve aradaki 10 kr.'lik boş yabancı dil payları
      // (191-201, 211-221, 231-241) baştan sona tutarlı - bu nedenle önceki
      // sürümdeki belirsizlik notu kaldırıldı. Yine de gerçek bir örnek
      // satıra karşı ölçülmedi; ilk gerçek veride "Alan Eşleştirme
      // Önizlemesi" tablosundan doğrulanması önerilir.
      id: 'lgs-sozel-sayisal-birlesik-tek-satir',
      label: 'LGS Sözel+Sayısal Birleşik (Tek Satırlı Format)',
      examType: 'LGS',
      kind: 'fixedWidth',
      optionCount: 4,
      builtIn: true,
      fields: [
        { role: 'ignore', start: 0, end: 4 },
        { role: 'ignore', start: 4, end: 9 }, // Kurum Kodu - program tarafından kullanılmıyor
        { role: 'schoolNumber', start: 10, end: 14 },
        { role: 'fullName', start: 15, end: 45 },
        { role: 'className', start: 57, end: 59 },
        { role: 'booklet', start: 60, end: 61 },
        { role: 'answerBlock', start: 161, end: 181, subjectKey: 'turkce', label: 'Türkçe' },
        { role: 'answerBlock', start: 181, end: 191, subjectKey: 'inkilap', label: 'Sosyal/İnkılap' },
        { role: 'answerBlock', start: 201, end: 211, subjectKey: 'din', label: 'Din ve Ahlak' },
        { role: 'answerBlock', start: 221, end: 231, subjectKey: 'ingilizce', label: 'İngilizce' },
        { role: 'answerBlock', start: 241, end: 261, subjectKey: 'matematik', label: 'Matematik' },
        { role: 'answerBlock', start: 261, end: 281, subjectKey: 'fen', label: 'Fen Bilgisi' },
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
  // `perQuestion`: her soru için 'D'/'Y'/'B' - konu/soru analizi (bkz. db.getExamTopicAnalysis)
  // bu diziyi topicMap ile aynı sırada (dizilim) eşleştirerek hangi konunun
  // en çok yanlış/boş yapıldığını hesaplar.
  evaluateAnswers(studentRaw, keyAns) {
    let correct = 0, wrong = 0, blank = 0;
    const key = keyAns || '';
    const student = (studentRaw || '').padEnd(key.length, ' ');
    const perQuestion = [];
    for (let i = 0; i < key.length; i++) {
      const k = (key[i] || '').toUpperCase();
      const s = (student[i] || '').toUpperCase();
      if (!k || k === ' ') { perQuestion.push(null); continue; }
      if (!s || s === ' ') { blank++; perQuestion.push('B'); }
      else if (s === k) { correct++; perQuestion.push('D'); }
      else { wrong++; perQuestion.push('Y'); }
    }
    const net = Math.max(0, correct - wrong / 3);
    return { correct, wrong, blank, net: parseFloat(net.toFixed(2)), perQuestion };
  },
};
