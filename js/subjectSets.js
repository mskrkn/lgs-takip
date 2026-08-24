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
  // Soru sayıları "form Okutma Ayarları ve örnek formatlar/AXIOMETUMU/
  // DATASIS_TYT_OMR_83.srt" resmi DATASİS TYT optik form tanımıyla
  // doğrulandı: Türkçe 40 (satır 0-39), Sosyal 20 (satır 42-61),
  // Matematik 40 (satır 0-39), Fen 20 (satır 42-61) - toplam 120.
  TYT: [
    { key: 'tyt_turkce', name: 'Türkçe', questions: 40, color: '#f472b6', keywords: ['türkçe', 'turkce', 'türk', 'turk', 'tr'] },
    { key: 'tyt_sosyal', name: 'Sosyal Bilimler', questions: 20, color: '#fbbf24', keywords: ['sosyal bilimler', 'sosyal', 'sos'] },
    { key: 'tyt_matematik', name: 'Temel Matematik', questions: 40, color: '#60a5fa', keywords: ['temel matematik', 'matematik', 'mat'] },
    { key: 'tyt_fen', name: 'Fen Bilimleri', questions: 20, color: '#34d399', keywords: ['fen bilimleri', 'fen bilgisi', 'fen', 'fb'] },
  ],
  AYT_SAY: [
    { key: 'ayt_matematik', name: 'Matematik', questions: 40, color: '#60a5fa', keywords: ['matematik', 'mat'] },
    { key: 'ayt_fizik', name: 'Fizik', questions: 14, color: '#38bdf8', keywords: ['fizik', 'fiz'] },
    { key: 'ayt_kimya', name: 'Kimya', questions: 13, color: '#34d399', keywords: ['kimya', 'kim'] },
    { key: 'ayt_biyoloji', name: 'Biyoloji', questions: 13, color: '#4ade80', keywords: ['biyoloji', 'biyo', 'biy'] },
  ],
  AYT_SOZ: [
    { key: 'ayt_edebiyat_sos1', name: 'Türk Dili ve Edebiyatı - Sosyal Bilimler 1', questions: 24, color: '#f472b6', keywords: ['edebiyat', 'türk dili', 'turk dili', 'sosyal bilimler 1', 'sosyal 1'] },
    { key: 'ayt_tarih1', name: 'Tarih-1', questions: 10, color: '#fbbf24', keywords: ['tarih 1', 'tarih1', 'tarih-1'] },
    { key: 'ayt_cografya1', name: 'Coğrafya-1', questions: 6, color: '#fb923c', keywords: ['coğrafya 1', 'cografya 1', 'coğrafya1', 'cografya1', 'coğrafya-1', 'cografya-1'] },
    { key: 'ayt_tarih2', name: 'Tarih-2', questions: 11, color: '#f59e0b', keywords: ['tarih 2', 'tarih2', 'tarih-2'] },
    { key: 'ayt_cografya2', name: 'Coğrafya-2', questions: 11, color: '#f97316', keywords: ['coğrafya 2', 'cografya 2', 'coğrafya2', 'cografya2', 'coğrafya-2', 'cografya-2'] },
    { key: 'ayt_felsefe', name: 'Felsefe Grubu', questions: 12, color: '#a78bfa', keywords: ['felsefe grubu', 'felsefe'] },
    { key: 'ayt_din', name: 'Din Kültürü (Seçmeli)', questions: 6, color: '#c084fc', keywords: ['din kültürü', 'din kulturu', 'din'] },
  ],
};

const EXAM_TYPE_LABELS = {
  LGS: 'LGS',
  TYT: 'TYT',
  AYT_SAY: 'AYT - Sayısal',
  AYT_SOZ: 'AYT - Sözel',
};

// A-D (LGS) vs A-E (TYT/AYT) şık sayısı — optik değerlendirme için
const EXAM_TYPE_OPTION_COUNT = {
  LGS: 4,
  TYT: 5,
  AYT_SAY: 5,
  AYT_SOZ: 5,
};

const SUBJECT_LOOKUP = Object.fromEntries(
  Object.values(SUBJECT_SETS).flat().map(s => [s.key, s])
);

// examOrType: bir exam nesnesi ({examType:...}) ya da doğrudan 'LGS'|'TYT'|... string'i olabilir
function getSubjectsForExam(examOrType) {
  const type = (typeof examOrType === 'string') ? examOrType : (examOrType?.examType || 'LGS');
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
