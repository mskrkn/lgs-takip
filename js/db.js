// ============================================
// LGS Deneme Takip - Database Layer (Dexie.js)
// ============================================

const DB_NAME = 'LGSDenemetakipDB';
const DB_VERSION = 2;

// Ders/sınav türü tanımları artık js/subjectSets.js içinde (SUBJECT_SETS,
// getSubjectsForExam, LGS_SUBJECTS/TOTAL_QUESTIONS takma adları dahil).
// index.html'de subjectSets.js, db.js'den ÖNCE yüklenmelidir.

// Helper to normalize Turkish text for matching
function normalizeTrText(text) {
  if (!text) return '';
  return String(text)
    .toLocaleLowerCase('tr-TR')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper to normalize school numbers (strips decimal .0, leading zeros, whitespace)
function normalizeSchoolNo(num) {
  if (!num) return '';
  let s = String(num).trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  // remove leading zeros only if digits
  if (/^\d+$/.test(s)) {
    const parsed = parseInt(s, 10);
    return isNaN(parsed) ? s : String(parsed);
  }
  return s;
}

// Helper to normalize class names (e.g. '5/A', '5-A', '5A', '5 A', '5.A', '5_A', '6G', '6/G', '6-G' -> '5/A', '6/G')
function normalizeClassName(className) {
  if (!className) return '';
  const str = String(className).trim();
  const match = str.match(/^([0-9]{1,2})\s*[\/\-\.\_\s]?\s*([a-zA-ZğüşıöçĞÜŞİÖÇ])$/i);
  if (match) {
    let branch = match[2];
    if (branch === 'i' || branch === 'İ') branch = 'İ';
    else if (branch === 'ı' || branch === 'I') branch = 'I';
    else branch = branch.toLocaleUpperCase('tr-TR');
    return `${match[1]}/${branch}`;
  }
  return str.replace(/\s+/g, ' ');
}

class Database {
  constructor() {
    this.db = new Dexie(DB_NAME);
    this._initSchema();
  }

  _initSchema() {
    // v1: orijinal şema (LGS-only, exam'lerde tür bilgisi yok).
    this.db.version(1).stores({
      students: '++id, schoolNumber, firstName, lastName, className',
      exams: '++id, name, date',
      results: '++id, studentId, examId, [studentId+examId]',
    });

    // v2: çoklu sınav türü desteği. exams.examType eklendi, optikProfiles tablosu
    // eklendi. Var olan exam kayıtları examType alanı olmadan geldiği için
    // upgrade adımında hepsi 'LGS' ile geriye dönük olarak işaretlenir.
    this.db.version(2).stores({
      students: '++id, schoolNumber, firstName, lastName, className',
      exams: '++id, name, date, examType',
      results: '++id, studentId, examId, [studentId+examId]',
      optikProfiles: '++id, examType, kind, builtIn',
    }).upgrade(tx => {
      return tx.table('exams').toCollection().modify(exam => {
        if (!exam.examType) exam.examType = 'LGS';
      });
    });
  }

  // ---- Students ----
  async addStudent(student) {
    return await this.findOrMatchStudent(student);
  }

  // Smart student matcher: checks school number first, then normalized full name
  async findOrMatchStudent(student) {
    const rawSNum = String(student.schoolNumber || '').trim();
    const cleanSNum = normalizeSchoolNo(rawSNum);
    const isAutoSNum = !rawSNum || rawSNum.startsWith('AUTO-');

    const fn = String(student.firstName || '').trim();
    const ln = String(student.lastName || '').trim();
    const cleanName = normalizeTrText(`${fn} ${ln}`);

    const allStudents = await this.db.students.toArray();

    // 1. Match by school number (if not auto/empty)
    if (!isAutoSNum && cleanSNum) {
      const matchByNo = allStudents.find(s => {
        const sCleanNo = normalizeSchoolNo(s.schoolNumber);
        return sCleanNo && sCleanNo === cleanSNum;
      });

      if (matchByNo) {
        // Update missing class name or name if helpful
        const updates = {};
        if (student.className && !matchByNo.className) updates.className = normalizeClassName(student.className);
        if (fn && (!matchByNo.firstName || matchByNo.firstName.startsWith('AUTO-') || matchByNo.firstName === 'Bilinmeyen')) {
          updates.firstName = fn;
          updates.lastName = ln;
        }
        if (Object.keys(updates).length > 0) {
          await this.updateStudent(matchByNo.id, updates);
        }
        return matchByNo.id;
      }
    }

    // 2. Match by full name
    if (cleanName.length >= 2) {
      const matchByName = allStudents.find(s => {
        const sFullName = normalizeTrText(`${s.firstName} ${s.lastName}`);
        return sFullName === cleanName;
      });

      if (matchByName) {
        const updates = {};
        // If existing has AUTO or empty number, but new import has a real school number, assign it!
        if (!isAutoSNum && cleanSNum && (!matchByName.schoolNumber || matchByName.schoolNumber.startsWith('AUTO-'))) {
          updates.schoolNumber = rawSNum;
        }
        if (student.className && !matchByName.className) {
          updates.className = normalizeClassName(student.className);
        }
        if (Object.keys(updates).length > 0) {
          await this.updateStudent(matchByName.id, updates);
        }
        return matchByName.id;
      }
    }

    // 3. No match found -> Add new student
    const finalSchoolNo = rawSNum || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newId = await this.db.students.add({
      schoolNumber: finalSchoolNo,
      firstName: fn || 'Öğrenci',
      lastName: ln || '',
      className: normalizeClassName(student.className),
    });
    this._notifyChange();
    return newId;
  }

  _notifyChange() {
    if (typeof SyncModule !== 'undefined' && SyncModule.notifyLocalChange) {
      SyncModule.notifyLocalChange();
    }
  }

  async updateStudent(id, data) {
    if (data && data.className !== undefined) {
      data.className = normalizeClassName(data.className);
    }
    const res = await this.db.students.update(Number(id), data);
    this._notifyChange();
    return res;
  }

  async deleteStudent(id) {
    const nid = Number(id);
    await this.db.results.where('studentId').equals(nid).delete();
    await this.db.students.delete(nid);
    this._notifyChange();
  }

  async getStudent(id) {
    return await this.db.students.get(Number(id));
  }

  async getStudentBySchoolNumber(schoolNumber) {
    const clean = normalizeSchoolNo(schoolNumber);
    const all = await this.db.students.toArray();
    return all.find(s => normalizeSchoolNo(s.schoolNumber) === clean);
  }

  async getAllStudents() {
    return await this.db.students.toArray();
  }

  async searchStudents(query) {
    if (!query || query.length < 1) return [];
    const q = normalizeTrText(query);
    const qCleanNo = normalizeSchoolNo(query);
    const all = await this.db.students.toArray();

    return all.filter(s => {
      const fn = normalizeTrText(s.firstName);
      const ln = normalizeTrText(s.lastName);
      const fullName = `${fn} ${ln}`.trim();
      const sn = normalizeSchoolNo(s.schoolNumber);
      const cn = normalizeTrText(s.className);
      return fn.includes(q) || ln.includes(q) || fullName.includes(q) || (sn && sn === qCleanNo) || (sn && sn.includes(q)) || cn.includes(q);
    }).slice(0, 30);
  }

  async getStudentCount() {
    return await this.db.students.count();
  }

  async bulkAddStudents(students) {
    const results = [];
    for (const s of students) {
      const id = await this.addStudent(s);
      results.push(id);
    }
    this._notifyChange();
    return results;
  }

  // ---- Exams ----
  async addExam(exam) {
    const id = await this.db.exams.add({
      name: String(exam.name || '').trim(),
      date: exam.date || new Date().toISOString().split('T')[0],
      description: String(exam.description || '').trim(),
      examType: exam.examType && SUBJECT_SETS[exam.examType] ? exam.examType : 'LGS',
    });
    this._notifyChange();
    return id;
  }

  async updateExam(id, data) {
    const res = await this.db.exams.update(Number(id), data);
    this._notifyChange();
    return res;
  }

  async deleteExam(id) {
    const nid = Number(id);
    await this.db.results.where('examId').equals(nid).delete();
    await this.db.exams.delete(nid);
    this._notifyChange();
  }

  async getExam(id) {
    return await this.db.exams.get(Number(id));
  }

  async getAllExams() {
    return await this.db.exams.orderBy('date').reverse().toArray();
  }

  async getExamCount() {
    return await this.db.exams.count();
  }

  async getExamByName(name) {
    const all = await this.db.exams.toArray();
    const qName = normalizeTrText(name);
    return all.find(e => normalizeTrText(e.name) === qName);
  }

  // ---- Results ----
  async addResult(result) {
    const studentId = Number(result.studentId);
    const examId = Number(result.examId);

    const [existing, exam] = await Promise.all([
      this.db.results.where('[studentId+examId]').equals([studentId, examId]).first(),
      this.getExam(examId),
    ]);

    const data = {
      studentId,
      examId,
      subjects: {},
    };

    getSubjectsForExam(exam).forEach(sub => {
      const s = result.subjects?.[sub.key] || {};
      const correct = parseInt(s.correct) || 0;
      const wrong = parseInt(s.wrong) || 0;
      const blank = sub.questions - correct - wrong;
      const net = parseFloat((correct - wrong / 3).toFixed(2));
      data.subjects[sub.key] = { correct, wrong, blank: Math.max(0, blank), net };
    });

    let resId;
    if (existing) {
      await this.db.results.update(existing.id, data);
      resId = existing.id;
    } else {
      resId = await this.db.results.add(data);
    }
    this._notifyChange();
    return resId;
  }

  async getResult(studentId, examId) {
    const sid = Number(studentId);
    const eid = Number(examId);
    return await this.db.results
      .where('[studentId+examId]')
      .equals([sid, eid])
      .first();
  }

  async getStudentResults(studentId) {
    const sid = Number(studentId);
    return await this.db.results.where('studentId').equals(sid).toArray();
  }

  async getExamResults(examId) {
    const eid = Number(examId);
    return await this.db.results.where('examId').equals(eid).toArray();
  }

  async getResultCount() {
    return await this.db.results.count();
  }

  async deleteResult(id) {
    return await this.db.results.delete(Number(id));
  }

  async deleteResultByStudentAndExam(studentId, examId) {
    const res = await this.getResult(studentId, examId);
    if (res) {
      await this.db.results.delete(res.id);
      return true;
    }
    return false;
  }

  // High-performance batch import for Excel/PDF
  async batchImportResults(examId, rows) {
    const eid = Number(examId);
    const [allStudents, exam] = await Promise.all([
      this.db.students.toArray(),
      this.getExam(eid),
    ]);
    const examSubjects = getSubjectsForExam(exam);

    // In-memory indexing for lightning fast lookups
    const schoolNoMap = new Map();
    const fullNameMap = new Map();

    allStudents.forEach(s => {
      const cNo = normalizeSchoolNo(s.schoolNumber);
      if (cNo && !cNo.startsWith('AUTO-')) schoolNoMap.set(cNo, s);
      const fn = normalizeTrText(`${s.firstName} ${s.lastName}`);
      if (fn) fullNameMap.set(fn, s);
    });

    let imported = 0;
    let errors = 0;

    await this.db.transaction('rw', [this.db.students, this.db.results], async () => {
      // 1. First pass: find or prepare all students
      for (const item of rows) {
        try {
          const { studentData, subjects } = item;
          const rawSNum = String(studentData.schoolNumber || '').trim();
          const cleanSNum = normalizeSchoolNo(rawSNum);
          const isAuto = !rawSNum || rawSNum.startsWith('AUTO-');

          const fn = String(studentData.firstName || '').trim();
          const ln = String(studentData.lastName || '').trim();
          const cleanName = normalizeTrText(`${fn} ${ln}`);

          let matchedStudent = null;

          // Match by school number
          if (!isAuto && cleanSNum && schoolNoMap.has(cleanSNum)) {
            matchedStudent = schoolNoMap.get(cleanSNum);
          } else if (cleanName && fullNameMap.has(cleanName)) {
            // Match by full name
            matchedStudent = fullNameMap.get(cleanName);
          }

          let studentId;
          if (matchedStudent) {
            studentId = matchedStudent.id;
            const updates = {};
            if (!isAuto && cleanSNum && (!matchedStudent.schoolNumber || matchedStudent.schoolNumber.startsWith('AUTO-'))) {
              updates.schoolNumber = rawSNum;
              matchedStudent.schoolNumber = rawSNum;
              schoolNoMap.set(cleanSNum, matchedStudent);
            }
            if (studentData.className && (!matchedStudent.className || matchedStudent.className !== studentData.className.trim())) {
              updates.className = studentData.className.trim();
              matchedStudent.className = updates.className;
            }
            if (Object.keys(updates).length > 0) {
              await this.db.students.update(studentId, updates);
            }
          } else {
            // Create new student
            const newStudent = {
              schoolNumber: rawSNum || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              firstName: fn || 'Öğrenci',
              lastName: ln || '',
              className: String(studentData.className || '').trim(),
            };
            studentId = await this.db.students.add(newStudent);
            newStudent.id = studentId;
            if (!isAuto && cleanSNum) schoolNoMap.set(cleanSNum, newStudent);
            if (cleanName) fullNameMap.set(cleanName, newStudent);
          }

          // Build result payload
          const resultPayload = {
            studentId,
            examId: eid,
            subjects: {},
          };

          examSubjects.forEach(sub => {
            const s = subjects?.[sub.key] || {};
            const correct = parseInt(s.correct) || 0;
            const wrong = parseInt(s.wrong) || 0;
            const blank = sub.questions - correct - wrong;
            const net = parseFloat((correct - wrong / 3).toFixed(2));
            resultPayload.subjects[sub.key] = { correct, wrong, blank: Math.max(0, blank), net };
          });

          // Update or add result
          const existingRes = await this.db.results
            .where('[studentId+examId]')
            .equals([studentId, eid])
            .first();

          if (existingRes) {
            await this.db.results.update(existingRes.id, resultPayload);
          } else {
            await this.db.results.add(resultPayload);
          }

          imported++;
        } catch (err) {
          console.error('Batch import item error:', err);
          errors++;
        }
      }
    });

    return { imported, errors };
  }

  // Automatic Data Repair & Deduplication Utility
  async repairAndLinkStudents() {
    const allStudents = await this.db.students.toArray();
    const allResults = await this.db.results.toArray();

    let mergedCount = 0;
    let fixedNamesCount = 0;

    // 1. Fix duplicated names (e.g. "Ahmet Yılmaz Ahmet Yılmaz" -> "Ahmet Yılmaz")
    for (const student of allStudents) {
      let changed = false;
      let fn = student.firstName || '';
      let ln = student.lastName || '';

      if (fn.trim() === ln.trim() && fn.includes(' ')) {
        const parts = fn.trim().split(/\s+/);
        fn = parts.slice(0, -1).join(' ');
        ln = parts[parts.length - 1];
        changed = true;
      }

      if (changed) {
        await this.db.students.update(student.id, { firstName: fn, lastName: ln });
        student.firstName = fn;
        student.lastName = ln;
        fixedNamesCount++;
      }
    }

    // 2. Find and merge duplicates by normalized name
    const nameGroups = new Map();
    allStudents.forEach(s => {
      const key = normalizeTrText(`${s.firstName} ${s.lastName}`);
      if (!nameGroups.has(key)) nameGroups.set(key, []);
      nameGroups.get(key).push(s);
    });

    for (const [key, group] of nameGroups.entries()) {
      if (group.length > 1 && key.length > 1) {
        // Find best primary student: prefer the one with a non-AUTO schoolNumber or most results
        const primary = group.find(s => s.schoolNumber && !s.schoolNumber.startsWith('AUTO-')) || group[0];
        const secondaryList = group.filter(s => s.id !== primary.id);

        for (const sec of secondaryList) {
          // Re-link all results of secondary to primary
          const secResults = allResults.filter(r => r.studentId === sec.id);
          for (const r of secResults) {
            // Check if primary already has result for this exam
            const primaryHas = allResults.some(pr => pr.studentId === primary.id && pr.examId === r.examId);
            if (!primaryHas) {
              await this.db.results.update(r.id, { studentId: primary.id });
              r.studentId = primary.id;
            } else {
              await this.db.results.delete(r.id);
            }
          }
          // Delete duplicate student
          await this.db.students.delete(sec.id);
          mergedCount++;
        }
      }
    }

    return { mergedCount, fixedNamesCount };
  }

  // ---- Analytics (Optimized for High Performance) ----

  calcTotalNet(result) {
    const totalNet = Object.values(result.subjects || {}).reduce((sum, s) => sum + (s?.net || 0), 0);
    return parseFloat(totalNet.toFixed(2));
  }

  async getExamRankings(examId) {
    const [results, students] = await Promise.all([
      this.getExamResults(examId),
      this.getAllStudents()
    ]);

    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    const ranked = results.map(r => ({
      ...r,
      student: studentMap[r.studentId],
      totalNet: this.calcTotalNet(r),
    }));

    ranked.sort((a, b) => b.totalNet - a.totalNet);

    ranked.forEach((item, index) => {
      item.rank = index + 1;
      item.totalStudents = ranked.length;
    });

    return ranked;
  }

  async getStudentTrend(studentId) {
    const [results, exams] = await Promise.all([
      this.getStudentResults(studentId),
      this.getAllExams()
    ]);

    const examMap = {};
    exams.forEach(e => { examMap[e.id] = e; });

    return results
      .filter(r => examMap[r.examId])
      .map(r => ({
        ...r,
        exam: examMap[r.examId],
        totalNet: this.calcTotalNet(r),
      }))
      .sort((a, b) => new Date(a.exam.date) - new Date(b.exam.date));
  }

  async getStudentAlerts(studentId) {
    const trend = await this.getStudentTrend(studentId);
    if (trend.length < 2) return [];

    const alerts = [];
    const latest = trend[trend.length - 1];
    // Aynı sınav türünden en yakın önceki sonucu bul (LGS'yi TYT ile karşılaştırmamak için)
    const prev = [...trend].reverse().slice(1).find(t => t.exam.examType === latest.exam.examType);
    if (!prev) return [];

    getSubjectsForExam(latest.exam).forEach(sub => {
      const currNet = latest.subjects?.[sub.key]?.net || 0;
      const prevNet = prev.subjects?.[sub.key]?.net || 0;
      const diff = parseFloat((currNet - prevNet).toFixed(2));

      if (diff <= -3) {
        alerts.push({ type: 'critical', subject: sub, diff, currNet, prevNet, examName: latest.exam.name });
      } else if (diff < -1) {
        alerts.push({ type: 'warning', subject: sub, diff, currNet, prevNet, examName: latest.exam.name });
      } else if (diff >= 2) {
        alerts.push({ type: 'success', subject: sub, diff, currNet, prevNet, examName: latest.exam.name });
      }
    });

    const totalDiff = parseFloat((latest.totalNet - prev.totalNet).toFixed(2));
    if (totalDiff <= -5) {
      alerts.push({ type: 'critical', subject: { key: 'total', name: 'Toplam Net' }, diff: totalDiff, currNet: latest.totalNet, prevNet: prev.totalNet, examName: latest.exam.name });
    } else if (totalDiff >= 5) {
      alerts.push({ type: 'success', subject: { key: 'total', name: 'Toplam Net' }, diff: totalDiff, currNet: latest.totalNet, prevNet: prev.totalNet, examName: latest.exam.name });
    }

    return alerts;
  }

  // Blazing fast single-batch alerts computation for all students
  async getAllAlerts() {
    const [students, exams, results] = await Promise.all([
      this.getAllStudents(),
      this.getAllExams(),
      this.db.results.toArray()
    ]);

    if (students.length === 0 || exams.length < 2 || results.length === 0) return [];

    const examMap = {};
    exams.forEach(e => { examMap[e.id] = e; });

    const studentResultsMap = {};
    results.forEach(r => {
      if (!studentResultsMap[r.studentId]) studentResultsMap[r.studentId] = [];
      if (examMap[r.examId]) {
        studentResultsMap[r.studentId].push({
          ...r,
          exam: examMap[r.examId],
          totalNet: this.calcTotalNet(r)
        });
      }
    });

    const allAlerts = [];
    for (const student of students) {
      const trend = studentResultsMap[student.id];
      if (!trend || trend.length < 2) continue;

      trend.sort((a, b) => new Date(a.exam.date) - new Date(b.exam.date));

      const latest = trend[trend.length - 1];
      const prev = [...trend].reverse().slice(1).find(t => t.exam.examType === latest.exam.examType);
      if (!prev) continue;

      getSubjectsForExam(latest.exam).forEach(sub => {
        const currNet = latest.subjects?.[sub.key]?.net || 0;
        const prevNet = prev.subjects?.[sub.key]?.net || 0;
        const diff = parseFloat((currNet - prevNet).toFixed(2));

        if (diff <= -3) {
          allAlerts.push({ type: 'critical', subject: sub, diff, currNet, prevNet, examName: latest.exam.name, student });
        } else if (diff < -1) {
          allAlerts.push({ type: 'warning', subject: sub, diff, currNet, prevNet, examName: latest.exam.name, student });
        } else if (diff >= 2) {
          allAlerts.push({ type: 'success', subject: sub, diff, currNet, prevNet, examName: latest.exam.name, student });
        }
      });

      const totalDiff = parseFloat((latest.totalNet - prev.totalNet).toFixed(2));
      if (totalDiff <= -5) {
        allAlerts.push({ type: 'critical', subject: { key: 'total', name: 'Toplam Net' }, diff: totalDiff, currNet: latest.totalNet, prevNet: prev.totalNet, examName: latest.exam.name, student });
      } else if (totalDiff >= 5) {
        allAlerts.push({ type: 'success', subject: { key: 'total', name: 'Toplam Net' }, diff: totalDiff, currNet: latest.totalNet, prevNet: prev.totalNet, examName: latest.exam.name, student });
      }
    }

    const priority = { critical: 0, warning: 1, success: 2 };
    allAlerts.sort((a, b) => priority[a.type] - priority[b.type]);
    return allAlerts;
  }

  async getExamAverages(examId) {
    const [results, exam] = await Promise.all([
      this.getExamResults(examId),
      this.getExam(examId),
    ]);
    if (results.length === 0) return null;

    const averages = {};
    let totalNetSum = 0;

    getSubjectsForExam(exam).forEach(sub => {
      let sum = 0;
      let count = 0;
      results.forEach(r => {
        if (r.subjects?.[sub.key]) {
          sum += r.subjects[sub.key].net;
          count++;
        }
      });
      averages[sub.key] = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;
    });

    results.forEach(r => {
      totalNetSum += this.calcTotalNet(r);
    });

    averages.totalNet = parseFloat((totalNetSum / results.length).toFixed(2));
    averages.studentCount = results.length;

    return averages;
  }

  async getAllExamsAverages() {
    const [exams, results] = await Promise.all([
      this.getAllExams(),
      this.db.results.toArray()
    ]);

    const examResultsMap = {};
    results.forEach(r => {
      if (!examResultsMap[r.examId]) examResultsMap[r.examId] = [];
      examResultsMap[r.examId].push(r);
    });

    const averagesMap = {};
    exams.forEach(exam => {
      const eResults = examResultsMap[exam.id] || [];
      if (eResults.length === 0) {
        averagesMap[exam.id] = null;
        return;
      }

      const averages = {};
      let totalNetSum = 0;

      getSubjectsForExam(exam).forEach(sub => {
        let sum = 0;
        let count = 0;
        eResults.forEach(r => {
          if (r.subjects?.[sub.key]) {
            sum += r.subjects[sub.key].net;
            count++;
          }
        });
        averages[sub.key] = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;
      });

      eResults.forEach(r => {
        totalNetSum += this.calcTotalNet(r);
      });

      averages.totalNet = parseFloat((totalNetSum / eResults.length).toFixed(2));
      averages.studentCount = eResults.length;
      averagesMap[exam.id] = averages;
    });

    return averagesMap;
  }

  // Export all data as JSON
  async exportData() {
    const [students, exams, results] = await Promise.all([
      this.getAllStudents(),
      this.getAllExams(),
      this.db.results.toArray()
    ]);
    return { students, exams, results, exportDate: new Date().toISOString() };
  }

  // Import data from JSON
  // Import data from JSON or Cloud Sync
  async importData(data) {
    if (!data) return;

    // 1. Students
    if (data.students && Array.isArray(data.students)) {
      for (const s of data.students) {
        if (s && s.id) {
          await this.db.students.put(s);
        } else if (s) {
          await this.addStudent(s);
        }
      }
    }

    // 2. Exams
    if (data.exams && Array.isArray(data.exams)) {
      for (const e of data.exams) {
        if (e && e.id) {
          await this.db.exams.put(e);
        } else if (e) {
          const existing = await this.getExamByName(e.name);
          if (!existing) await this.addExam(e);
        }
      }
    }

    // 3. Results
    if (data.results && Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r) {
          await this.db.results.put(r);
        }
      }
    }
  }

  // Clear only all students and their results (keeps exams intact)
  async clearAllStudents() {
    await this.db.results.clear();
    await this.db.students.clear();
    this._notifyChange();
  }

  // ---- Optik Format Profilleri (kullanıcı tarafından kalibre edilmiş, kalıcı) ----
  async addOptikProfile(profile) {
    const id = await this.db.optikProfiles.add({
      ...profile,
      builtIn: false,
      createdAt: new Date().toISOString(),
    });
    this._notifyChange();
    return id;
  }

  async getCustomOptikProfiles() {
    return await this.db.optikProfiles.toArray();
  }

  async updateOptikProfile(id, data) {
    const res = await this.db.optikProfiles.update(Number(id), data);
    this._notifyChange();
    return res;
  }

  async deleteOptikProfile(id) {
    await this.db.optikProfiles.delete(Number(id));
    this._notifyChange();
  }

  // Clear all data
  async clearAllData() {
    await this.db.results.clear();
    await this.db.exams.clear();
    await this.db.students.clear();
    this._notifyChange();
  }
}

// Singleton
const db = new Database();
