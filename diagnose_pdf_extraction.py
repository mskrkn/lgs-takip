"""EduPusula Soru Havuzu PDF motoru - tanı/regresyon scripti.

pdf_question_extractor.py'nin FAZ 1 dayanıklılık yükseltmesi boyunca her
adımdan önce/sonra MEVCUT davranışı ölçmek için kullanılır (bkz.
claude-code-prompt-pdf-motoru-v2.md). Her yeni FAZ 1 maddesi eklendikçe
buraya yeni bir ölçülebilir sinyal eklenir (1.7'nin talep ettiği gibi).

Kullanım: python diagnose_pdf_extraction.py <pdf1> [<pdf2> ...]
          python diagnose_pdf_extraction.py --dir uploads/source_pdfs
"""

import sys
import os
import argparse

import fitz

import pdf_question_extractor as pqe


def _ocr_page_ratio(doc):
    """Kaç sayfanın gerçek metin katmanı BOŞ çıkıp OCR'a düştüğünü
    ölçer - extract_questions()'ın kamu sözleşmesi bunu döndürmüyor,
    bu yüzden _get_page_lines'a burada, sadece tanı amaçlı, doğrudan
    erişiyoruz."""
    ocr_pages = 0
    for pno in range(doc.page_count):
        _lines, is_ocr = pqe._get_page_lines(doc[pno])
        if is_ocr:
            ocr_pages += 1
    return ocr_pages, doc.page_count


def _column_distribution(doc, page_lines_cache, boilerplate):
    """FAZ 1.4: her sayfa için tespit edilen sütun sayısını döner -
    {sutun_sayisi: sayfa_adedi}."""
    dist = {}
    for pno in range(doc.page_count):
        pw, ph = doc[pno].rect.width, doc[pno].rect.height
        lines, _is_ocr = page_lines_cache[pno]
        filtered = [
            (t, b, bl["bbox"]) for t, b, bl in lines
            if t.strip() not in boilerplate and (bl["bbox"][2] - bl["bbox"][0]) <= pqe._FULL_WIDTH_BLOCK_RATIO * pw
        ]
        cd_entries = [e for e in filtered if e[2][3] > ph * pqe._HEADER_BAND_RATIO]
        n = pqe._detect_column_count(cd_entries, pw)
        dist[n] = dist.get(n, 0) + 1
    return dist


def _degenerate_crops(questions, min_height=15, min_width=30):
    """FAZ 1.4/1.5 regresyon kontrolü: neredeyse sıfır boyutlu (bozuk)
    kırpma dikdörtgeni var mı - sütun/görsel-genişletme mantığındaki bir
    hata genelde önce burada, soru SAYISI hiç değişmeden ortaya çıkar
    (bkz. FAZ 1.4 doğrulamasında bulunan gerçek örnek)."""
    return [
        (q["number"], q["page"], round(q["rect"].height, 1), round(q["rect"].width, 1))
        for q in questions
        if q["rect"].height < min_height or q["rect"].width < min_width
    ]


def diagnose(pdf_path):
    print(f"\n{'='*70}\n{os.path.basename(pdf_path)}\n{'='*70}")
    try:
        result = pqe.extract_questions(pdf_path)
    except Exception as exc:
        print(f"  HATA: extract_questions() patladı: {exc!r}")
        return None

    numbers = sorted(q["number"] for q in result["questions"])
    gaps = []
    if numbers:
        expected = set(range(numbers[0], numbers[-1] + 1))
        gaps = sorted(expected - set(numbers))

    doc = fitz.open(pdf_path)
    try:
        ocr_pages, total_pages = _ocr_page_ratio(doc)
        page_lines_cache = pqe._build_page_lines_cache(doc)
        boilerplate = pqe._detect_boilerplate_lines(doc, page_lines_cache)
        grid_page = pqe._find_grid_answer_key_page(page_lines_cache)
        col_dist = _column_distribution(doc, page_lines_cache, boilerplate)
    finally:
        doc.close()
    degenerate = _degenerate_crops(result["questions"])

    print(f"  Sayfa sayısı        : {result['page_count']}")
    print(f"  Tespit edilen soru  : {len(result['questions'])}")
    print(f"  Numara aralığı      : {numbers[0] if numbers else '-'}"
          f" - {numbers[-1] if numbers else '-'}")
    print(f"  Eksik numaralar     : {gaps if gaps else 'yok'}")
    print(f"  Cevap anahtarı      : {len(result['answer_key'])} kayıt")
    print(f"  OCR'a düşen sayfa   : {ocr_pages}/{total_pages}")
    print(f"  Boilerplate satırı  : {len(boilerplate)} tespit edildi"
          f"{' -> ' + repr(sorted(boilerplate)[0]) if boilerplate else ''}")
    print(f"  Sütun dağılımı      : {col_dist} (sütun_sayısı: sayfa_adedi)")
    print(f"  Dejenere kırpma     : {degenerate if degenerate else 'yok'}")
    print(f"  Matris cevap sayfası: {grid_page if grid_page is not None else 'yok'}"
          f"{' (subject_name/booklet_code verilirse denenir)' if grid_page is not None else ''}")

    return {
        "file": os.path.basename(pdf_path),
        "page_count": result["page_count"],
        "question_count": len(result["questions"]),
        "number_range": (numbers[0], numbers[-1]) if numbers else None,
        "missing_numbers": gaps,
        "answer_key_count": len(result["answer_key"]),
        "ocr_pages": ocr_pages,
        "total_pages": total_pages,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdfs", nargs="*", help="Tanı yapılacak PDF dosyaları")
    parser.add_argument("--dir", help="Bu dizindeki tüm .pdf dosyalarını tara")
    args = parser.parse_args()

    paths = list(args.pdfs)
    if args.dir:
        for name in sorted(os.listdir(args.dir)):
            if name.lower().endswith(".pdf"):
                paths.append(os.path.join(args.dir, name))

    if not paths:
        print("Kullanım: python diagnose_pdf_extraction.py <pdf1> [<pdf2> ...]")
        print("      ya da: python diagnose_pdf_extraction.py --dir <klasör>")
        sys.exit(1)

    summaries = []
    for p in paths:
        s = diagnose(p)
        if s:
            summaries.append(s)

    print(f"\n{'='*70}\nÖZET ({len(summaries)} PDF)\n{'='*70}")
    for s in summaries:
        print(f"  {s['file']}: {s['question_count']} soru, "
              f"{s['ocr_pages']}/{s['total_pages']} OCR, "
              f"eksik={s['missing_numbers'] or 'yok'}")


if __name__ == "__main__":
    main()
