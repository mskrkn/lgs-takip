"""Optik Okuma (Kamera OMR) raporlari + PDF/Excel/CSV/TXT disa aktarma.

Iki katman:
  1) Rapor kuruculari (build_*): DB'den onayli taramalari okuyup TEK ortak
     sekle cevirir -> {"title","subtitle","columns":[...],"rows":[[...]],"notes":[...]}
  2) Bicim ceviricileri (to_csv/to_txt/to_xlsx/to_pdf): bu ortak sekli dosyaya
     cevirir - boylece her rapor 4 formati otomatik alir.

Excel icin openpyxl KULLANILMIYOR (bagimlilik eklemek paylasilan VM venv'ine
dokunmayi gerektirirdi): to_xlsx stdlib zipfile + minimal OOXML yazar.
Ag/DB cagrisi yapan tek yer build_* fonksiyonlaridir (db = sqlite3 baglantisi,
row_factory=sqlite3.Row)."""
import csv
import io
import json
import os
import re
import zipfile
from collections import Counter
from xml.sax.saxutils import escape as _xml_escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Vera (reportlab ile gelir) Turkce karakterleri icerir - omr_form.py ile ayni
# font adlari; tekrar kaydetmek zararsizdir.
_FONTS_DIR = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
pdfmetrics.registerFont(TTFont("EduPusulaSans", os.path.join(_FONTS_DIR, "Vera.ttf")))
pdfmetrics.registerFont(TTFont("EduPusulaSans-Bold", os.path.join(_FONTS_DIR, "VeraBd.ttf")))

REPORT_KINDS = ("basic", "detailed", "class_compare", "question", "answer_dist",
                "kazanim", "subject", "student", "class_tests")
FORMATS = ("json", "pdf", "xlsx", "csv", "txt")
_EXT = {"pdf": "pdf", "xlsx": "xlsx", "csv": "csv", "txt": "txt"}
_MIME = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
}


def omr_net(correct, wrong):
    """Net = dogru - yanlis/3 (alt sinir 0) - js/optikProfiles.js ve
    server._omr_net ile AYNI formul (reportlab'siz de calissin diye server'da
    ayri tutulur; ikisi ayni sonucu verir)."""
    return max(0, round(correct - wrong / 3, 2))


# ============================================================
# Veri yukleme
# ============================================================

def _load_exam_def(db, org_id, exam_def_id):
    return db.execute(
        "SELECT e.id, e.title, e.question_count, e.answer_key_json, e.kazanim_adi, s.name AS subject_name "
        "FROM omr_exam_definitions e LEFT JOIN subjects s ON s.id = e.subject_id "
        "WHERE e.id = ? AND e.organization_id = ?",
        (exam_def_id, org_id),
    ).fetchone()


def _load_student_results(db, org_id, exam_def_id, allowed_ids):
    """Test icin onayli taramalar - ogrenci basina EN SON onayli tarama.
    allowed_ids: None (sinirsiz) ya da izinli ogrenci id kumesi. Doner:
    (satirlar, notlar) - satir: dict(student..., questions, correct, wrong,
    blank, net, success)."""
    scans = db.execute(
        "SELECT sc.id, sc.student_id, sc.per_question_json, st.first_name, st.last_name, "
        "st.school_number, st.class_name "
        "FROM omr_scans sc JOIN students st ON st.id = sc.student_id "
        "WHERE sc.exam_definition_id = ? AND sc.organization_id = ? AND sc.status = 'approved' "
        "AND sc.per_question_json IS NOT NULL ORDER BY sc.id",
        (exam_def_id, org_id),
    ).fetchall()
    latest = {}
    for sc in scans:
        if allowed_ids is not None and sc["student_id"] not in allowed_ids:
            continue
        latest[sc["student_id"]] = sc

    rows = []
    for sc in latest.values():
        payload = json.loads(sc["per_question_json"])
        questions = payload.get("questions", [])
        summary = payload.get("summary", {})
        correct = summary.get("correct", 0)
        wrong = summary.get("wrong", 0)
        blank = summary.get("blank", 0) + summary.get("flagged", 0)  # onay ucuyla tutarli
        total = len(questions) or (correct + wrong + blank)
        rows.append({
            "student_id": sc["student_id"],
            "name": f"{sc['first_name'] or ''} {sc['last_name'] or ''}".strip(),
            "no": sc["school_number"] or "", "class": sc["class_name"] or "",
            "questions": sorted(questions, key=lambda q: q["question"]),
            "correct": correct, "wrong": wrong, "blank": blank,
            "net": omr_net(correct, wrong),
            "success": round(correct / total * 100) if total else 0,
        })

    notes = []
    pending = db.execute(
        "SELECT COUNT(*) c, SUM(CASE WHEN student_id IS NULL THEN 1 ELSE 0 END) u FROM omr_scans "
        "WHERE exam_definition_id = ? AND organization_id = ? AND status = 'needs_review'",
        (exam_def_id, org_id),
    ).fetchone()
    if pending["c"]:
        msg = f"{pending['c']} tarama henüz onaylanmadı (rapora dahil değil)"
        if pending["u"]:
            msg += f"; {pending['u']} tanesinde öğrenci atanmamış"
        notes.append(msg + ".")
    return rows, notes


def _base(exam, subtitle_extra=""):
    parts = [exam["title"]]
    if exam["subject_name"]:
        parts.append(exam["subject_name"])
    if subtitle_extra:
        parts.append(subtitle_extra)
    return " · ".join(parts)


def _sorted_by_net(rows):
    return sorted(rows, key=lambda r: (-r["net"], r["name"]))


# ============================================================
# Rapor kuruculari
# ============================================================

def build_basic(db, org_id, exam_def_id, allowed_ids):
    exam = _load_exam_def(db, org_id, exam_def_id)
    rows, notes = _load_student_results(db, org_id, exam_def_id, allowed_ids)
    out = [[i, r["no"], r["name"], r["class"], r["correct"], r["wrong"], r["blank"], r["net"], r["success"]]
           for i, r in enumerate(_sorted_by_net(rows), 1)]
    return {
        "title": "Basit Sonuç Raporu", "subtitle": _base(exam),
        "columns": ["Sıra", "No", "Ad Soyad", "Sınıf", "Doğru", "Yanlış", "Boş", "Net", "Başarı %"],
        "rows": out, "notes": notes,
    }


def build_detailed(db, org_id, exam_def_id, allowed_ids):
    exam = _load_exam_def(db, org_id, exam_def_id)
    rows, notes = _load_student_results(db, org_id, exam_def_id, allowed_ids)
    key = json.loads(exam["answer_key_json"] or "{}")
    q_count = max([len(r["questions"]) for r in rows] + [exam["question_count"] or 0]) if rows else (exam["question_count"] or 0)

    def cell(q):
        outcome, ans = q.get("outcome"), q.get("answer")
        if outcome == "correct":
            return ans or "-"
        if outcome == "wrong":
            return f"{ans}*"
        if outcome in ("multi", "ambiguous"):
            return "?"
        return "-"

    columns = ["Sıra", "No", "Ad Soyad", "Sınıf", "D", "Y", "B", "Net"] + [str(i) for i in range(1, q_count + 1)]
    out = [["", "", "ANAHTAR", "", "", "", "", ""] + [key.get(str(i), "") for i in range(1, q_count + 1)]]
    for i, r in enumerate(_sorted_by_net(rows), 1):
        by_no = {q["question"]: q for q in r["questions"]}
        answers = [cell(by_no[n]) if n in by_no else "" for n in range(1, q_count + 1)]
        out.append([i, r["no"], r["name"], r["class"], r["correct"], r["wrong"], r["blank"], r["net"]] + answers)
    notes = notes + ["Gösterim: harf = doğru işaret, harf* = yanlış işaret, - = boş, ? = çift/belirsiz işaret."]
    return {
        "title": "Detaylı Sonuç Raporu", "subtitle": _base(exam),
        "columns": columns, "rows": out, "notes": notes,
    }


def build_class_compare(db, org_id, exam_def_id, allowed_ids):
    exam = _load_exam_def(db, org_id, exam_def_id)
    rows, notes = _load_student_results(db, org_id, exam_def_id, allowed_ids)
    by_class = {}
    for r in rows:
        by_class.setdefault(r["class"] or "-", []).append(r)
    out = []
    for cls in sorted(by_class):
        group = by_class[cls]
        size = db.execute(
            "SELECT COUNT(*) c FROM students WHERE organization_id = ? AND class_name = ?",
            (org_id, cls),
        ).fetchone()["c"] if cls != "-" else len(group)
        nets = [g["net"] for g in group]
        out.append([
            cls, size, len(group), round(len(group) / size * 100) if size else 0,
            round(sum(nets) / len(nets), 2), max(nets), min(nets),
            round(sum(g["success"] for g in group) / len(group)),
        ])
    return {
        "title": "Sınıf Karşılaştırma Raporu", "subtitle": _base(exam),
        "columns": ["Şube", "Mevcut", "Okuyan", "Katılım %", "Ort. Net", "En Yüksek", "En Düşük", "Ort. Başarı %"],
        "rows": out, "notes": notes,
    }


def build_question(db, org_id, exam_def_id, allowed_ids):
    exam = _load_exam_def(db, org_id, exam_def_id)
    rows, notes = _load_student_results(db, org_id, exam_def_id, allowed_ids)
    key = json.loads(exam["answer_key_json"] or "{}")
    stats = {}
    for r in rows:
        for q in r["questions"]:
            s = stats.setdefault(q["question"], {"correct": 0, "wrong": 0, "blank": 0, "flagged": 0, "wrong_opts": Counter()})
            outcome = q.get("outcome")
            if outcome == "correct":
                s["correct"] += 1
            elif outcome == "wrong":
                s["wrong"] += 1
                if q.get("answer"):
                    s["wrong_opts"][q["answer"]] += 1
            elif outcome == "blank":
                s["blank"] += 1
            else:
                s["flagged"] += 1
    out = []
    for no in sorted(stats):
        s = stats[no]
        total = s["correct"] + s["wrong"] + s["blank"] + s["flagged"]
        rate = round(s["correct"] / total * 100) if total else 0
        level = "Kolay" if rate >= 70 else ("Orta" if rate >= 40 else "Zor")
        top_wrong = s["wrong_opts"].most_common(1)
        out.append([no, key.get(str(no), ""), s["correct"], s["wrong"], s["blank"], s["flagged"], rate, level,
                    top_wrong[0][0] if top_wrong else "-"])
    return {
        "title": "Soru Analizi Raporu", "subtitle": _base(exam, f"{len(rows)} öğrenci"),
        "columns": ["Soru", "Anahtar", "Doğru", "Yanlış", "Boş", "Şüpheli", "Başarı %", "Zorluk", "En Çok İşaretlenen Yanlış"],
        "rows": out, "notes": notes,
    }


def build_kazanim(db, org_id, class_name):
    """SINIF bazli: o sinifin tum onayli Kazanim Denemeleri uzerinden kazanim
    basina ozet. Erisim kontrolu (sinif izni) cagiran tarafta yapilir."""
    rows = db.execute(
        "SELECT r.student_id, r.exam_id, r.data_json, oed.kazanim_kodu, oed.kazanim_adi, s.name AS subject_name "
        "FROM results r "
        "JOIN students st ON st.id = r.student_id "
        "JOIN omr_exam_definitions oed ON oed.exam_id = r.exam_id "
        "LEFT JOIN subjects s ON s.id = oed.subject_id "
        "WHERE st.class_name = ? AND st.organization_id = ? AND r.source = 'omr_scan' "
        "AND oed.kazanim_kodu IS NOT NULL",
        (class_name, org_id),
    ).fetchall()
    groups = {}
    for r in rows:
        subjects = json.loads(r["data_json"]).get("subjects", {})
        correct = sum((v or {}).get("correct", 0) for v in subjects.values())
        wrong = sum((v or {}).get("wrong", 0) for v in subjects.values())
        blank = sum((v or {}).get("blank", 0) for v in subjects.values())
        total = correct + wrong + blank
        if not total:
            continue
        g = groups.setdefault(r["kazanim_kodu"], {
            "subject": r["subject_name"] or "-", "name": r["kazanim_adi"] or r["kazanim_kodu"],
            "exams": set(), "per_student": {},
        })
        g["exams"].add(r["exam_id"])
        g["per_student"].setdefault(r["student_id"], []).append(correct / total * 100)
    out = []
    for code in sorted(groups, key=lambda c: (groups[c]["subject"], groups[c]["name"])):
        g = groups[code]
        student_avgs = [sum(v) / len(v) for v in g["per_student"].values()]
        out.append([
            g["subject"], g["name"], len(g["exams"]), len(student_avgs),
            round(sum(student_avgs) / len(student_avgs)), sum(1 for a in student_avgs if a < 50),
        ])
    return {
        "title": "Kazanım Özeti Raporu", "subtitle": f"Sınıf: {class_name}",
        "columns": ["Ders", "Kazanım", "Test Sayısı", "Öğrenci", "Ort. Başarı %", "%50 Altı Öğrenci"],
        "rows": out, "notes": [],
    }


def build_answer_dist(db, org_id, exam_def_id, allowed_ids):
    """Cevap dagilimi: her soruda A/B/C/D siklarini (ve bos/cift-belirsiz)
    kac ogrencinin isaretledigi - celdirici analizi icin."""
    exam = _load_exam_def(db, org_id, exam_def_id)
    rows, notes = _load_student_results(db, org_id, exam_def_id, allowed_ids)
    key = json.loads(exam["answer_key_json"] or "{}")
    dist = {}
    for r in rows:
        for q in r["questions"]:
            d = dist.setdefault(q["question"], Counter())
            outcome = q.get("outcome")
            if outcome == "blank":
                d["Boş"] += 1
            elif outcome in ("multi", "ambiguous"):
                d["Çift/Belirsiz"] += 1
            elif q.get("answer"):
                d[q["answer"]] += 1
            else:
                d["Boş"] += 1
    out = []
    for no in sorted(dist):
        d = dist[no]
        total = sum(d.values())
        k = key.get(str(no), "")
        out.append([no, k, d["A"], d["B"], d["C"], d["D"], d["Boş"], d["Çift/Belirsiz"],
                    round(d[k] / total * 100) if k and total else 0])
    return {
        "title": "Cevap Dağılımı Raporu", "subtitle": _base(exam, f"{len(rows)} öğrenci"),
        "columns": ["Soru", "Anahtar", "A", "B", "C", "D", "Boş", "Çift/Belirsiz", "Doğru %"],
        "rows": out, "notes": notes + ["Her şık sütunu, o şıkkı işaretleyen öğrenci sayısıdır."],
    }


def _result_stats(data_json):
    subjects = json.loads(data_json).get("subjects", {})
    correct = sum((v or {}).get("correct", 0) for v in subjects.values())
    wrong = sum((v or {}).get("wrong", 0) for v in subjects.values())
    blank = sum((v or {}).get("blank", 0) for v in subjects.values())
    total = correct + wrong + blank
    return correct, wrong, blank, omr_net(correct, wrong), (round(correct / total * 100) if total else 0)


def build_subject(db, org_id, class_name):
    """Ders bazli: sinifin onayli tum Kazanim Denemeleri, ders ve tarihe gore -
    test basina okuyan ogrenci sayisi, ortalama net ve basari."""
    rows = db.execute(
        "SELECT r.student_id, r.exam_id, r.data_json, e.name AS exam_name, e.date, s.name AS subject_name "
        "FROM results r JOIN students st ON st.id = r.student_id "
        "JOIN exams e ON e.id = r.exam_id "
        "JOIN omr_exam_definitions oed ON oed.exam_id = e.id "
        "LEFT JOIN subjects s ON s.id = oed.subject_id "
        "WHERE st.class_name = ? AND st.organization_id = ? AND r.source = 'omr_scan'",
        (class_name, org_id),
    ).fetchall()
    tests = {}
    for r in rows:
        _c, _w, _b, net, success = _result_stats(r["data_json"])
        t = tests.setdefault(r["exam_id"], {
            "subject": r["subject_name"] or "-", "name": r["exam_name"], "date": r["date"] or "",
            "students": set(), "nets": [], "succ": [],
        })
        t["students"].add(r["student_id"])
        t["nets"].append(net)
        t["succ"].append(success)
    out = []
    for t in sorted(tests.values(), key=lambda x: (x["subject"], x["date"], x["name"])):
        out.append([t["subject"], t["name"], t["date"], len(t["students"]),
                    round(sum(t["nets"]) / len(t["nets"]), 2), round(sum(t["succ"]) / len(t["succ"]))])
    return {
        "title": "Ders Bazlı Rapor", "subtitle": f"Sınıf: {class_name}",
        "columns": ["Ders", "Test", "Tarih", "Öğrenci", "Ort. Net", "Ort. Başarı %"],
        "rows": out, "notes": [],
    }


def build_student(db, org_id, student_id):
    """Ogrenci bazli: ogrencinin onayli tum Kazanim Denemeleri (cok testli),
    tarih sirasiyla, sinif ortalamasiyla birlikte. Erisim kontrolu cagiran tarafta."""
    st = db.execute(
        "SELECT first_name, last_name, school_number, class_name FROM students WHERE id = ? AND organization_id = ?",
        (student_id, org_id),
    ).fetchone()
    if not st:
        return None
    rows = db.execute(
        "SELECT r.exam_id, r.data_json, e.name AS exam_name, e.date, oed.kazanim_adi, s.name AS subject_name "
        "FROM results r JOIN exams e ON e.id = r.exam_id "
        "JOIN omr_exam_definitions oed ON oed.exam_id = e.id "
        "LEFT JOIN subjects s ON s.id = oed.subject_id "
        "WHERE r.student_id = ? AND r.source = 'omr_scan' ORDER BY e.date, e.id",
        (student_id,),
    ).fetchall()
    out, nets, succs = [], [], []
    for r in rows:
        c, w, b, net, success = _result_stats(r["data_json"])
        mates = db.execute(
            "SELECT r2.data_json FROM results r2 JOIN students s2 ON s2.id = r2.student_id "
            "WHERE r2.exam_id = ? AND s2.class_name = ? AND s2.organization_id = ?",
            (r["exam_id"], st["class_name"], org_id),
        ).fetchall()
        mate_succ = [_result_stats(m["data_json"])[4] for m in mates]
        out.append([r["date"] or "", r["exam_name"], r["subject_name"] or "-", r["kazanim_adi"] or "-",
                    c, w, b, net, success, round(sum(mate_succ) / len(mate_succ)) if mate_succ else ""])
        nets.append(net)
        succs.append(success)
    if out:
        out.append(["", "ORTALAMA", "", "", "", "", "", round(sum(nets) / len(nets), 2),
                    round(sum(succs) / len(succs)), ""])
    name = f"{st['first_name'] or ''} {st['last_name'] or ''}".strip()
    return {
        "title": "Öğrenci Raporu",
        "subtitle": f"{name} · No {st['school_number'] or '-'} · {st['class_name'] or '-'}",
        "columns": ["Tarih", "Test", "Ders", "Kazanım", "Doğru", "Yanlış", "Boş", "Net", "Başarı %", "Sınıf Ort. Başarı %"],
        "rows": out, "notes": [],
    }


def build_class_tests(db, org_id, class_name):
    """Sinifa RESMEN uygulanmis (omr_exam_applications) testler: Ders |
    Ogretmen | Test | Katilim | Ortalama (ekrandaki 'Sinif Kazanim Raporu'
    tablosunun disa aktarilabilir hali)."""
    total_students = db.execute(
        "SELECT COUNT(*) c FROM students WHERE organization_id = ? AND class_name = ?", (org_id, class_name),
    ).fetchone()["c"]
    apps = db.execute(
        "SELECT oed.title, oed.exam_id, s.name AS subject_name, u.display_name AS teacher_name "
        "FROM omr_exam_applications oea "
        "JOIN omr_exam_definitions oed ON oed.id = oea.exam_definition_id "
        "LEFT JOIN subjects s ON s.id = oed.subject_id LEFT JOIN users u ON u.id = oed.created_by "
        "WHERE oea.class_name = ? AND oea.organization_id = ? ORDER BY oed.created_at DESC",
        (class_name, org_id),
    ).fetchall()
    out = []
    for a in apps:
        if not a["exam_id"]:
            continue
        res = db.execute(
            "SELECT r.data_json FROM results r JOIN students st ON st.id = r.student_id "
            "WHERE r.exam_id = ? AND st.class_name = ? AND st.organization_id = ?",
            (a["exam_id"], class_name, org_id),
        ).fetchall()
        nets = [_result_stats(x["data_json"])[3] for x in res]
        out.append([a["subject_name"] or "-", a["teacher_name"] or "-", a["title"],
                    f"{len(nets)}/{total_students}", round(sum(nets) / len(nets), 2) if nets else ""])
    return {
        "title": "Sınıf Test Raporu", "subtitle": f"Sınıf: {class_name}",
        "columns": ["Ders", "Öğretmen", "Test", "Katılım", "Ort. Net"], "rows": out, "notes": [],
    }


# ============================================================
# Bicim ceviricileri
# ============================================================

def _cell_text(v):
    return "" if v is None else str(v)


def to_csv(report):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(report["columns"])
    for row in report["rows"]:
        w.writerow([_cell_text(v) for v in row])
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")  # BOM: Excel Turkce karakterleri dogru acar


def to_txt(report):
    cols = [_cell_text(c) for c in report["columns"]]
    body = [[_cell_text(v) for v in row] for row in report["rows"]]
    widths = [max([len(cols[i])] + [len(r[i]) for r in body if i < len(r)]) for i in range(len(cols))]

    def fmt(cells):
        return "  ".join(_cell_text(c).ljust(widths[i]) for i, c in enumerate(cells)).rstrip()

    lines = [report["title"], report.get("subtitle", ""), "", fmt(cols), "  ".join("-" * w for w in widths)]
    lines += [fmt(r) for r in body]
    if report.get("notes"):
        lines += [""] + report["notes"]
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _col_letter(i):
    s = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(65 + rem) + s
    return s


def _xlsx_cell(ref, value, style):
    if isinstance(value, bool) or value is None or value == "":
        return f'<c r="{ref}" s="{style}"/>' if style else ""
    if isinstance(value, (int, float)):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    text = _xml_escape(_XML_BAD.sub("", str(value)))
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def to_xlsx(report):
    """Minimal OOXML (.xlsx) - stil 0 normal, 1 kalin. Baslik + veri +
    notlar tek sayfada; sutun genisligi icerige gore."""
    sheet_rows = []  # (satir_no, [(deger, stil)])
    r = 1
    sheet_rows.append((r, [(report["title"], 1)])); r += 1
    if report.get("subtitle"):
        sheet_rows.append((r, [(report["subtitle"], 0)])); r += 1
    r += 1
    sheet_rows.append((r, [(c, 1) for c in report["columns"]])); header_row = r; r += 1
    for row in report["rows"]:
        sheet_rows.append((r, [(v, 2 if isinstance(v, str) and len(v) > 40 else 0) for v in row])); r += 1
    if report.get("notes"):
        r += 1
        for n in report["notes"]:
            sheet_rows.append((r, [(n, 0)])); r += 1

    widths = [len(_cell_text(c)) for c in report["columns"]]
    for row in report["rows"]:
        for i, v in enumerate(row):
            if i < len(widths):
                widths[i] = max(widths[i], len(_cell_text(v)))
    cols_xml = "".join(
        f'<col min="{i + 1}" max="{i + 1}" width="{min(max(w + 2, 6), 45)}" customWidth="1"/>'
        for i, w in enumerate(widths))

    rows_xml = []
    for rn, cells in sheet_rows:
        cx = "".join(_xlsx_cell(f"{_col_letter(ci)}{rn}", v, st) for ci, (v, st) in enumerate(cells))
        rows_xml.append(f'<row r="{rn}">{cx}</row>')

    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{header_row}" topLeftCell="A{header_row + 1}" '
        'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f'<cols>{cols_xml}</cols><sheetData>{"".join(rows_xml)}</sheetData></worksheet>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
        '</styleSheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Rapor" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '</Types>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/styles.xml", styles)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def to_pdf(report):
    ncols = len(report["columns"])
    page = landscape(A4) if ncols > 9 else A4
    margin = 12 * mm
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=page, leftMargin=margin, rightMargin=margin,
                            topMargin=margin, bottomMargin=margin, title=report["title"])
    avail = page[0] - 2 * margin
    font_size = 8 if ncols <= 12 else (6.5 if ncols <= 26 else 5.5)

    title_style = ParagraphStyle("t", fontName="EduPusulaSans-Bold", fontSize=15, leading=19)
    sub_style = ParagraphStyle("s", fontName="EduPusulaSans", fontSize=10, leading=13, textColor=colors.HexColor("#555555"))
    note_style = ParagraphStyle("n", fontName="EduPusulaSans", fontSize=8, leading=10, textColor=colors.HexColor("#555555"))

    cell_style = ParagraphStyle("c", fontName="EduPusulaSans", fontSize=font_size, leading=font_size * 1.25)
    head_style = ParagraphStyle("h", fontName="EduPusulaSans-Bold", fontSize=font_size, leading=font_size * 1.25)
    cols = [_cell_text(c) for c in report["columns"]]
    body = [[_cell_text(v) for v in row] for row in report["rows"]]

    # Sutun genisligi: hucreler SARILDIGI icin (Paragraph) uzun bir metin
    # (or. kazanim adi) diger sutunlari ezmez. Her sutunun alt siniri =
    # basligin/icerigin en uzun KELIMESI, istenen genislik = icerigin
    # (60 karakterle sinirli) uzunlugu; sigmiyorsa artan pay orantili dagitilir.
    char_w = font_size * 0.64  # buyuk harf/kalin baslik icin pay birakir
    pad = 7
    mins, wants = [], []
    for i in range(ncols):
        texts = [cols[i]] + [r[i] for r in body if i < len(r)]
        longest_word = max((len(w) for t in texts for w in t.split()), default=1)
        longest_text = max((len(t) for t in texts), default=1)
        mins.append(min(longest_word, 30) * char_w + pad)
        wants.append(max(min(longest_text, 60) * char_w + pad, mins[-1]))
    if sum(wants) <= avail:
        # Sayfaya sigan raporlar sayfa genisligini doldursun (en fazla 1.5x buyur)
        scale = min(avail / sum(wants), 1.5)
        col_widths = [w * scale for w in wants]
    else:
        floor_total = sum(mins)
        if floor_total >= avail:
            col_widths = [avail * m / floor_total for m in mins]
        else:
            room = avail - floor_total
            growth = [w - m for w, m in zip(wants, mins)]
            gtotal = sum(growth) or 1
            col_widths = [m + room * g / gtotal for m, g in zip(mins, growth)]

    data = [[Paragraph(_xml_escape(c), head_style) for c in cols]]
    data += [[Paragraph(_xml_escape(v), cell_style) for v in row] for row in body]

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))

    story = [Paragraph(_xml_escape(report["title"]), title_style)]
    if report.get("subtitle"):
        story.append(Paragraph(_xml_escape(report["subtitle"]), sub_style))
    story += [Spacer(1, 6), table]
    for n in report.get("notes", []):
        story += [Spacer(1, 4), Paragraph(_xml_escape(n), note_style)]
    doc.build(story)
    return buf.getvalue()


_CONVERTERS = {"pdf": to_pdf, "xlsx": to_xlsx, "csv": to_csv, "txt": to_txt}


def render(report, fmt):
    """(bytes, mimetype, uzanti) - fmt in pdf|xlsx|csv|txt."""
    return _CONVERTERS[fmt](report), _MIME[fmt], _EXT[fmt]
