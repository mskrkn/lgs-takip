"""Deneme Yükleme Sihirbazı - yayınevi denemesi (TXT optik çıktısı + kazanım/cevap
anahtarı Excel'i) -> kademe başına deneme + eşleşmiş, puanlanmış sonuçlar.

Mozaik TG-1 aktarımında (2026-11-04) elle yapılıp PDF'lerle doğrulanan mantığın
ürünleşmiş hali (bkz. memory: edupusula_mozaik_deneme1_import):
- TXT: 280 karakterlik sabit genişlik (Mozaik / Datasis "SAYISAL11/SÖZEL11" tipi):
  9-14 okul no, 14-44 ad soyad, 56 kademe, 57 şube, 59 kitapçık, cevaplar
  160'tan itibaren 20'şer karakterlik 6 blok (Tür, Sos/İnk, Din, İng, Mat, Fen).
  7-8. sınıfta sözel ve sayısal AYRI satırdadır - aynı öğrencide birleştirilir.
- Excel: "Ders / A Soru / B Soru / Cevap / Kazanım Kodu / Kazanım" sütunları;
  kademe başlıktan ("8.SINIF ...") ya da dosya adından.
- Puanlama satır (oturum) bazında: kitapçık harfi boşsa iki kitapçıkla puanlanıp
  neti yüksek olan seçilir; B kitapçığı "B Soru" sütunuyla A sırasına çevrilir.
- Eşleştirme: aynı kademede isim; tutmazsa numara (+şube/kısmi isim); kademeyi
  yanlış kodlayan öğrenci diğer kademelerde neredeyse birebir isimle (ya da
  numara+isim) bulunur ve GERÇEK kademesinin anahtarıyla puanlanır.

Bu modül yalnızca hesaplar; veritabanına yazmaz (bkz. server.py
api_admin_wizard_commit).
"""
import io
import re
import zipfile
import difflib
import collections
import xml.etree.ElementTree as ET

ORDER = ["turkce", "inkilap", "din", "ingilizce", "matematik", "fen"]
_TR = str.maketrans("ıİşŞçÇğĞöÖüÜâÂîÎûÛ", "iissccggoouuaaiiuu")
_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def fold(s):
    return (s or "").translate(_TR).lower()


def norm_name(s):
    return re.sub(r"[^A-ZÇĞİÖŞÜ]", "", (s or "").replace("i", "İ").upper())


# ---------------------------------------------------------------- xlsx
def read_xlsx_rows(data):
    """İlk sayfanın satırları (hücre metinleri). openpyxl gerektirmez."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", _NS):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % _NS["m"])))
        sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        if not sheets:
            return []
        root = ET.fromstring(z.read(sheets[0]))
    rows = []
    for row in root.iter("{%s}row" % _NS["m"]):
        cells = {}
        for c in row.findall("m:c", _NS):
            ref = c.get("r", "")
            col = 0
            for ch in re.match(r"[A-Z]+", ref).group(0) if ref else "A":
                col = col * 26 + (ord(ch) - 64)
            t = c.get("t")
            v = c.find("m:v", _NS)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % _NS["m"]))
            else:
                val = v.text if v is not None else ""
            if val is not None and re.fullmatch(r"-?\d+\.0", str(val)):
                val = str(val)[:-2]
            cells[col] = (val or "").strip()
        if cells:
            rows.append([cells.get(i, "") for i in range(1, max(cells) + 1)])
    return rows


def _subject_key(ders):
    t = fold(ders)
    if "turk" in t and "tarih" not in t:
        return "turkce"
    if "mat" in t:
        return "matematik"
    if "fen" in t:
        return "fen"
    if "sosyal" in t or "inkilap" in t or "tarih" in t:
        return "inkilap"
    if "din" in t:
        return "din"
    if "ingiliz" in t or "english" in t or "yabanci" in t:
        return "ingilizce"
    return None


def parse_answer_key(data, file_name=""):
    """Kazanım/cevap anahtarı Excel'i -> {grade, title, subjects: {key: [soru...]}, keys}.
    Her soru: {a, b, ans, code, text}. keys: {key: {A, B, bpos, n}}."""
    if (file_name or "").startswith("~$"):
        raise ValueError(f"{file_name}: Excel'in geçici kilit dosyası (dosya açıkken oluşur) - asıl dosyayı seçin.")
    try:
        rows = read_xlsx_rows(data)
    except (zipfile.BadZipFile, ET.ParseError, KeyError):
        raise ValueError(f"{file_name}: geçerli bir Excel (.xlsx) dosyası değil.")
    head_idx = None
    for i, r in enumerate(rows[:12]):
        h = [fold(x) for x in r]
        if any("ders" in x for x in h) and any(x.startswith("a soru") or "dizilim" in x for x in h) and any("cevap" in x for x in h):
            head_idx = i
            break
    if head_idx is None:
        raise ValueError(f"{file_name}: 'Ders / A Soru / Cevap' başlık satırı bulunamadı.")
    h = [fold(x) for x in rows[head_idx]]
    col = lambda pred: next((i for i, x in enumerate(h) if pred(x)), None)
    c_ders = col(lambda x: "ders" in x)
    c_a = col(lambda x: x.startswith("a soru") or "dizilim" in x)
    c_b = col(lambda x: x.startswith("b soru"))
    c_ans = col(lambda x: x == "cevap" or x == "dogru cevap" or x.startswith("cevap"))
    c_code = col(lambda x: "kazan" in x and "kod" in x)
    c_text = col(lambda x: "kazan" in x and "kod" not in x)

    grade = None
    for r in rows[:head_idx] + [[file_name]]:
        m = re.search(r"\b([5-8])\s*\.?\s*s[ıi]n[ıi]f", fold(" ".join(r)))
        if m:
            grade = m.group(1)
            break
    title = " ".join(x for x in (rows[0] if rows else []) if x)[:120]

    subjects = collections.OrderedDict((k, []) for k in ORDER)
    unknown = set()
    for r in rows[head_idx + 1:]:
        get = lambda c: r[c] if c is not None and c < len(r) else ""
        ders = get(c_ders)
        if not ders:
            continue
        key = _subject_key(ders)
        if not key:
            unknown.add(ders)
            continue
        try:
            a = int(float(get(c_a)))
        except ValueError:
            continue
        b = get(c_b)
        subjects[key].append({
            "a": a, "b": int(float(b)) if re.fullmatch(r"\d+(\.0)?", b or "") else None,
            "ans": (get(c_ans) or " ")[:1].upper(), "code": get(c_code), "text": get(c_text),
        })
    keys = {}
    for k, qs in subjects.items():
        if not qs:
            continue
        qs.sort(key=lambda q: q["a"])
        bpos = [q["b"] for q in qs]
        valid_b = all(isinstance(x, int) for x in bpos) and sorted(bpos) == list(range(1, len(qs) + 1))
        B = [" "] * len(qs)
        if valid_b:
            for q in qs:
                B[q["b"] - 1] = q["ans"]
        keys[k] = {"A": "".join(q["ans"] for q in qs), "B": "".join(B) if valid_b else None,
                   "bpos": bpos if valid_b else None, "n": len(qs)}
    subjects = collections.OrderedDict((k, v) for k, v in subjects.items() if v)
    if not subjects:
        raise ValueError(f"{file_name}: hiçbir ders satırı tanınamadı.")
    return {"grade": grade, "title": title, "subjects": subjects, "keys": keys,
            "unknownSubjects": sorted(unknown), "file": file_name}


# ---------------------------------------------------------------- TXT
LINE_LEN = 280


def decode_text(data):
    for enc in ("utf-8", "cp1254", "cp857", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


def parse_txt(data, file_name=""):
    """280 karakterlik satırlar -> kayıt listesi. Biçime uymayan satırlar
    'rejected' içinde döner (sessizce atlanmaz)."""
    recs, rejected = [], []
    for i, raw in enumerate(decode_text(data).splitlines(), 1):
        if not raw.strip():
            continue
        if not (LINE_LEN - 10 <= len(raw) <= LINE_LEN + 10):
            rejected.append({"file": file_name, "line": i, "reason": f"satır uzunluğu {len(raw)} (beklenen ~{LINE_LEN})"})
            continue
        l = raw.ljust(LINE_LEN)
        blocks = [l[160 + 20 * j:180 + 20 * j] for j in range(6)]
        soz = any(blocks[j].strip() for j in range(4))
        say = any(blocks[j].strip() for j in (4, 5))
        num_raw = l[9:14]
        digits = num_raw.replace(" ", "")
        recs.append({
            "key": f"{file_name}#{i}", "file": file_name, "line": i,
            "num": str(int(digits)) if digits.isdigit() else None, "rawNum": num_raw.strip(),
            "name": " ".join(l[14:44].split()), "grade": l[56] if l[56].isdigit() else None,
            "sube": l[57].strip(), "booklet": l[59].strip().upper() if l[59].strip().upper() in ("A", "B") else "",
            "blocks": blocks, "kind": "both" if soz and say else "soz" if soz else "say" if say else "empty",
        })
    if recs:
        grades = collections.Counter(r["grade"] for r in recs if r["grade"])
        file_grade = grades.most_common(1)[0][0] if grades else None
        for r in recs:
            r["fileGrade"] = file_grade
    return recs, rejected


# ---------------------------------------------------------------- puanlama
def _score_blocks(blocks, booklet, keys, only=None):
    """Bloklari (yalniz dolu olanlari) anahtarla puanlar -> ({key: sonuc}, toplam net)."""
    out, total = {}, 0.0
    for j, k in enumerate(ORDER):
        if only is not None and j not in only:
            continue
        K = keys.get(k)
        if not K or not blocks[j] or not blocks[j].strip():
            continue
        n = K["n"]
        raw = blocks[j][:n].ljust(n)
        if booklet == "B":
            if not K.get("bpos"):
                return None, None  # B sırası bilinmiyor
            raw = "".join(raw[p - 1] for p in K["bpos"])
        pq = ["B" if x == " " else "D" if x == a else "Y" for x, a in zip(raw, K["A"])]
        c, w = pq.count("D"), pq.count("Y")
        net = round(max(0.0, c - w / 3), 2)
        # marks: ogrencinin isaretledigi siklar (A sirasinda, bos=" ") - ogrenci
        # panelinde "sen A isaretledin, dogrusu C" gosterebilmek icin.
        out[k] = {"correct": c, "wrong": w, "blank": n - c - w, "net": net, "answers": pq, "questions": n,
                  "marks": raw.upper()}
        total += net
    return out, round(total, 2)


def score_line(rec, keys):
    """Bir satırı (oturumu) puanlar. Kitapçık boşsa A ve B denenir, neti
    yüksek olan seçilir. -> (booklet, {key: sonuc}, toplam, tahmin_edildi_mi)"""
    if rec["booklet"] in ("A", "B"):
        s, t = _score_blocks(rec["blocks"], rec["booklet"], keys)
        if s is None:  # B sırası yok -> A ile değerlendir, işaretle
            s, t = _score_blocks(rec["blocks"], "A", keys)
            return "A", s, t, True
        return rec["booklet"], s, t, False
    sa, ta = _score_blocks(rec["blocks"], "A", keys)
    sb, tb = _score_blocks(rec["blocks"], "B", keys)
    if sb is not None and tb > ta:
        return "B", sb, tb, True
    return "A", sa, ta, True


# ---------------------------------------------------------------- eşleştirme
def _nscore(t, r):
    t, r = norm_name(t), norm_name(r)
    if len(t) < 3:
        return 0.0
    sm = difflib.SequenceMatcher(None, t, r)
    contain = sum(b.size for b in sm.get_matching_blocks() if b.size >= 2) / len(t)
    return max(sm.ratio(), 0.92 * contain if len(t) >= 5 else 0)


def grade_of(class_name):
    m = re.match(r"\s*(\d)", class_name or "")
    return m.group(1) if m else None


def sube_of(class_name):
    m = re.match(r"\s*\d+\s*[/\-\.\s]?\s*([A-ZÇĞİÖŞÜa-zçğıöşü])", class_name or "")
    return m.group(1).upper() if m else ""


def _num(s):
    n = (s or "").strip()
    return str(int(n)) if n.isdigit() else None


def match_line(rec, roster):
    """-> (en iyi eşleşme dict|None, adaylar[top5])."""
    best, cands = None, []
    for st in roster:
        full = f"{st['first_name']} {st['last_name']}"
        ns = _nscore(rec["name"], full)
        numeq = rec["num"] is not None and rec["num"] == st["num"]
        subeq = bool(rec["sube"]) and rec["sube"] == st["sube"]
        same = st["grade"] == rec["fileGrade"]
        sc = ns + (0.30 if numeq else 0) + (0.08 if subeq else 0) + (0.15 if same else 0)
        cands.append((sc, st, ns, numeq))
        if same:
            ok = ns >= 0.80 or (numeq and (ns >= 0.35 or subeq))
        else:  # kademeyi yanlış kodlamış: neredeyse birebir isim ya da numara+isim
            ratio = difflib.SequenceMatcher(None, norm_name(rec["name"]), norm_name(full)).ratio()
            ok = ratio >= 0.85 or (numeq and ns >= 0.80)
        if ok and (best is None or sc > best["score"]):
            how = "isim+numara" if (numeq and ns >= 0.8) else "isim" if ns >= 0.8 else "numara"
            best = {"score": sc, "student": st, "how": how, "nameScore": round(ns, 2), "crossGrade": not same}
    cands.sort(key=lambda x: -x[0])
    top = [{"id": c[1]["id"], "label": f"{c[1]['first_name']} {c[1]['last_name']} ({c[1]['class_name']}, no {c[1]['num'] or '-'})",
            "nameScore": round(c[2], 2)} for c in cands[:5]]
    return best, top


def prepare_roster(students):
    return [{"id": s["id"], "first_name": s["first_name"] or "", "last_name": s["last_name"] or "",
             "class_name": s["class_name"] or "", "grade": grade_of(s["class_name"]), "sube": sube_of(s["class_name"]),
             "num": _num(s["school_number"])} for s in students]


# ---------------------------------------------------------------- önizleme / plan
def build_plan(recs, key_files, roster, assignments=None):
    """recs: parse_txt kayıtları; key_files: {grade: parse_answer_key}; roster:
    prepare_roster; assignments: {satır_key: student_id | 'skip' | 'new'}
    (kullanıcının önizlemede yaptığı seçimler). Önizleme ve kayıt AYNI planı kullanır."""
    assignments = assignments or {}
    by_id = {s["id"]: s for s in roster}
    line_info = {}
    groups = collections.OrderedDict()
    new_students = collections.OrderedDict()
    for r in recs:
        best, cands = match_line(r, roster)
        a = assignments.get(r["key"])
        status, target = None, None
        if a == "skip":
            status = "atlandi"
        elif a == "new":
            g = r["grade"] or r["fileGrade"]
            status, target = "yeni", f"new:{r['key']}"
            parts = r["name"].split()
            new_students[target] = {"key": target, "firstName": " ".join(parts[:-1]) or r["name"], "lastName": parts[-1] if len(parts) > 1 else "",
                                    "className": f"{g}/{r['sube']}" if g and r["sube"] else (g or ""), "schoolNumber": r["num"], "grade": g}
        elif a not in (None, "", "auto") and str(a).isdigit() and int(a) in by_id:
            status, target = "elle", int(a)
        elif best:
            status, target = best["how"], best["student"]["id"]
        else:
            status = "eslesmedi"
        line_info[r["key"]] = {"status": status, "best": best, "candidates": cands, "target": target}
        if target is not None:
            groups.setdefault(target, []).append(r)

    students_out, warnings = [], []
    for target, lines in groups.items():
        if isinstance(target, str):
            ns = new_students[target]
            grade, label, sid = ns["grade"], f"{ns['firstName']} {ns['lastName']} ({ns['className']}) [yeni]", None
        else:
            st = by_id[target]
            grade, label, sid = st["grade"], f"{st['first_name']} {st['last_name']} ({st['class_name']}, no {st['num'] or '-'})", st["id"]
        kf = key_files.get(grade)
        if not kf:
            warnings.append(f"{label}: {grade}. sınıf için kazanım/cevap anahtarı yüklenmedi - atlandı.")
            continue
        keys = kf["keys"]
        subjects, used, dups, conflicts, booklets, guessed = {}, [], [], [], set(), []
        # Oncelik: kendi kademe dosyasi > saf sozel/sayisal satir > eslesme kalitesi
        # (ayni ogrenciye iki kagit dustuyse isim+numarasi tutan kullanilir)
        def _quality(x):
            li = line_info[x["key"]]
            return 9.0 if li["status"] == "elle" else (li["best"]["score"] if li["best"] else 0.0)
        for r in sorted(lines, key=lambda x: (x["fileGrade"] != grade, x["kind"] == "both", -_quality(x))):
            bk, s, _, guess = score_line(r, keys)
            fresh = {k: v for k, v in (s or {}).items() if k not in subjects}
            clash = [k for k in (s or {}) if k in subjects]
            if clash and not fresh:
                if all(subjects[k]["answers"] == s[k]["answers"] for k in clash):
                    dups.append(r["key"])
                else:
                    conflicts.append(r["key"])
                continue
            if clash:
                conflicts.append(r["key"])
            subjects.update(fresh)
            used.append(r)
            booklets.add(bk)
            if guess:
                guessed.append(r["key"])
        if not subjects:
            continue
        for k in keys:  # girilmemiş oturumun dersleri boş sayılır
            if k not in subjects:
                n = keys[k]["n"]
                subjects[k] = {"correct": 0, "wrong": 0, "blank": n, "net": 0.0, "answers": ["B"] * n, "questions": n}
        students_out.append({
            "target": target, "studentId": sid, "label": label, "grade": grade,
            "booklet": "B" if booklets == {"B"} else "A" if booklets == {"A"} else "A/B",
            "subjects": subjects, "totalNet": round(sum(v["net"] for v in subjects.values()), 2),
            "lines": [x["key"] for x in used], "duplicateLines": dups, "conflictLines": conflicts,
            "bookletGuessed": guessed, "crossGrade": any(x["fileGrade"] != grade for x in used),
            "halves": sorted({x["kind"] for x in used}),
        })
    return {"lines": line_info, "students": students_out, "newStudents": list(new_students.values()), "warnings": warnings}


def exam_payload(name, date, grade, key_file):
    """Kademe denemesinin data_json'u (id hariç)."""
    subj = key_file["subjects"]
    keys = key_file["keys"]
    return {
        "name": f"{name} - {grade}. Sınıf", "date": date, "examType": "LGS", "gradeLevel": int(grade),
        "description": f"Deneme Yükleme Sihirbazı ile aktarıldı ({key_file.get('file') or ''})",
        "questionCounts": {k: v["n"] for k, v in keys.items()},
        "topicMap": {k: [{"dizilim": q["a"], "soruId": None,
                          "kazanim": f"{q['code']} - {q['text']}" if q["code"] and q["text"] else (q["text"] or q["code"] or "")}
                         for q in qs] for k, qs in subj.items()},
        "answerKey": {"A": {k: v["A"] for k, v in keys.items()}, "B": {k: v["B"] for k, v in keys.items() if v["B"]}},
        "bookletBOrder": {k: v["bpos"] for k, v in keys.items() if v["bpos"]},
    }
