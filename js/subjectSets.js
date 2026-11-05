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
// Bir exam nesnesi `questionCounts` ({turkce: 15, ...}) taşıyorsa o denemenin
// GERÇEK ders soru sayıları bunlardır (ör. 5-6. sınıf yayınevi denemelerinde
// Türkçe/Mat/Fen 15 soru) - set'teki sabit LGS sayılarının üzerine yazılır.
// questionCounts olmayan (tüm eski) denemeler aynen eski davranışı görür.
function getSubjectsForExam(examOrType) {
  const type = (typeof examOrType === 'string') ? examOrType : ((examOrType && examOrType.examType) || 'LGS');
  const base = SUBJECT_SETS[type] || SUBJECT_SETS.LGS;
  const isObj = examOrType && typeof examOrType === 'object';
  const counts = isObj ? examOrType.questionCounts : null;
  // Denemenin kademesi biliniyorsa (gradeLevel) 5-7. sınıfta "inkilap" dersi
  // aslında Sosyal Bilgiler'dir (bkz. subjectDisplayName).
  const grade = isObj ? _subjectGradeOf(examOrType.gradeLevel) : null;
  if (!counts && !(grade && grade < 8)) return base;
  return base.map(function (s) {
    const n = counts ? parseInt(counts[s.key], 10) : NaN;
    const renameSosyal = s.key === 'inkilap' && grade && grade < 8;
    if (!renameSosyal && (!(n > 0) || n === s.questions)) return s;
    const copy = {};
    Object.keys(s).forEach(function (k) { copy[k] = s[k]; });
    if (n > 0) copy.questions = n;
    if (renameSosyal) copy.name = 'Sosyal Bilgiler';
    return copy;
  });
}

// ---- Kademeye göre ders adı ----
// "inkilap" anahtarı 8. sınıfta T.C. İnkılap Tarihi, 5-7. sınıfta Sosyal
// Bilgiler'dir (veri modelinde aynı anahtar). Tek öğrenci gösteren ekranlar
// (öğrenci/veli paneli, öğretmen panelinde öğrenci detayı) öğrencinin sınıfını
// setSubjectGradeContext ile bildirir; subjectDisplayName sınıf verilmezse
// bu bağlamı kullanır.
let SUBJECT_GRADE_CONTEXT = null;
function _subjectGradeOf(v) {
  const m = String(v == null ? '' : v).match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
function setSubjectGradeContext(gradeOrClass) {
  SUBJECT_GRADE_CONTEXT = gradeOrClass == null ? null : gradeOrClass;
}
function subjectDisplayName(key, gradeOrClass) {
  const g = _subjectGradeOf(gradeOrClass != null ? gradeOrClass : SUBJECT_GRADE_CONTEXT);
  if (key === 'inkilap' && g && g < 8) return 'Sosyal Bilgiler';
  return SUBJECT_LOOKUP[key] ? SUBJECT_LOOKUP[key].name : key;
}

// Tek bir ders sonucunun soru sayısı: sonuç kaydı kendi `questions`'ını
// taşıyorsa (denemeye özel sayı) o, yoksa ders setindeki varsayılan.
function getSubjectQuestionCount(subjectKey, subjectResult) {
  const n = subjectResult && parseInt(subjectResult.questions, 10);
  if (n > 0) return n;
  return (SUBJECT_LOOKUP[subjectKey] && SUBJECT_LOOKUP[subjectKey].questions) || 20;
}

function getTotalQuestions(examOrType) {
  return getSubjectsForExam(examOrType).reduce((sum, s) => sum + s.questions, 0);
}

// Geriye dönük uyumluluk: mevcut kodun tamamı henüz LGS_SUBJECTS/TOTAL_QUESTIONS
// global sabitlerini doğrudan kullanıyor. Faz 1 ekran güncellemeleri tamamlanana
// kadar bu takma adlar korunur.
const LGS_SUBJECTS = SUBJECT_SETS.LGS;
const TOTAL_QUESTIONS = getTotalQuestions('LGS');
