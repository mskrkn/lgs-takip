// ============================================
// LGS Deneme Takip - Sınav Türleri ve Ders Setleri
// ============================================
// Tek merkezi kayıt: hangi sınav türünde hangi dersler, kaç soru, kaç şık var.
// Yeni bir sınav türü eklemek için burada bir SUBJECT_SETS girdisi tanımlamak yeterli.

// Her dersteki `keywords`, Excel/CSV/PDF içe aktarımında sütun başlıklarını
// otomatik eşlemek için kullanılır (bkz. import.js autoMapColumns).
const SUBJECT_SETS = {
  LGS: [
    { key: 'turkce', name: 'Türkçe', questions: 20, session: 'sozel', color: '#f472b6', keywords: ['türkçe', 'turkce', 'türk', 'turk', 'tür', 'tur', 'tr'] },
    { key: 'inkilap', name: 'T.C. İnkılap Tarihi', questions: 10, session: 'sozel', color: '#fbbf24', keywords: ['sosyal bilgiler', 'sosyal', 'sos', 't c inkılap', 'tc inkilap', 'inkılap tarihi', 'inkilap tarihi', 'inkılap', 'inkilap', 'ink', 'tarih', 'tar'] },
    { key: 'din', name: 'Din Kültürü', questions: 10, session: 'sozel', color: '#a78bfa', keywords: ['din kültürü', 'din kulturu', 'din k', 'din'] },
    { key: 'ingilizce', name: 'İngilizce', questions: 10, session: 'sozel', color: '#fb923c', keywords: ['ingilizce', 'ing', 'yabancı dil', 'y dil', 'ydil'] },
    { key: 'matematik', name: 'Matematik', questions: 20, session: 'sayisal', color: '#60a5fa', keywords: ['matematik', 'mat'] },
    { key: 'fen', name: 'Fen Bilimleri', questions: 20, session: 'sayisal', color: '#34d399', keywords: ['fen bilimleri', 'fen bilgisi', 'fen', 'f b', 'fb'] },
  ],
  // 2026-09-15: TYT/AYT (lise) ders setleri kullanicinin acik istegiyle
  // kaldirildi - site sadece ortaokul (LGS) kapsaminda kalacak. Gercek
  // uretim verisinde zaten HIC TYT/AYT sinavi/ogrencisi yoktu (dogrulandi).
  // getSubjectsForExam zaten bilinmeyen/bos tur icin LGS'e duser, bu yuzden
  // baska bir yerde kalmis 'TYT'/'AYT_*' referansi bile guvenli sekilde
  // LGS'e geri duser, hata vermez.
};

const EXAM_TYPE_LABELS = {
  LGS: 'LGS',
};

// A-D (LGS) şık sayısı — optik değerlendirme için
const EXAM_TYPE_OPTION_COUNT = {
  LGS: 4,
};

// Object.fromEntries/Array.prototype.flat yerine elle döngü kullanılır - bazı
// eski tablet tarayıcılarında (Chrome 73 altı) bu metodlar bulunmuyor ve
// tüm sayfayı çalışmaz hale getiriyordu.
const SUBJECT_LOOKUP = {};
Object.values(SUBJECT_SETS).forEach(function (list) {
  list.forEach(function (s) { SUBJECT_LOOKUP[s.key] = s; });
});

// examOrType: bir exam nesnesi ({examType:...}) ya da doğrudan 'LGS'|'TYT'|... string'i olabilir
function getSubjectsForExam(examOrType) {
  const type = (typeof examOrType === 'string') ? examOrType : ((examOrType && examOrType.examType) || 'LGS');
  return SUBJECT_SETS[type] || SUBJECT_SETS.LGS;
}

function getTotalQuestions(examOrType) {
  return getSubjectsForExam(examOrType).reduce((sum, s) => sum + s.questions, 0);
}

// Geriye dönük uyumluluk: mevcut kodun tamamı henüz LGS_SUBJECTS/TOTAL_QUESTIONS
// global sabitlerini doğrudan kullanıyor. Faz 1 ekran güncellemeleri tamamlanana
// kadar bu takma adlar korunur.
const LGS_SUBJECTS = SUBJECT_SETS.LGS;
const TOTAL_QUESTIONS = getTotalQuestions('LGS');
