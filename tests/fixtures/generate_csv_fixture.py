"""Builds tests/fixtures/csv-roundtrip.json: CSV texts written by Python's csv module (an independent
implementation) together with the exact data they encode. The app must read back the identical data.
Run:  python3 tests/fixtures/generate_csv_fixture.py
"""
import csv, io, json, random

rnd = random.Random(20261115)
WORDS = ["alpha", "beta", "gamma", "delta", "سلام", "دنیا", "naïve", "café", "日本語", "😀 emoji", "Zoë", "O'Neil", 'He said "hi"',
         "a,b,c", "semi;colon", "pipe|char", "tab\tchar", "line1\nline2", "line1\r\nline2", "  padded  ", "trailing space ", "", "0123", "1,234", "3,5", "#hash", "=SUM(A1)", "back\\slash"]
DELIMS = [",", ";", "\t", "|"]

def cell(col_kind):
    if col_kind == "num": return str(rnd.randint(-10**6, 10**6))
    if col_kind == "dec": return f"{rnd.uniform(-1000, 1000):.4f}"
    if col_kind == "date": return f"20{rnd.randint(10, 25)}-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d}"
    if col_kind == "id": return f"{rnd.randint(0, 99999):05d}"
    return rnd.choice(WORDS)

cases = []
for n in range(160):
    delim = DELIMS[n % 4]
    ncols = rnd.randint(1, 7)
    kinds = [rnd.choice(["num", "dec", "date", "id", "text", "text", "text"]) for _ in range(ncols)]
    header = [f"col{j}" if rnd.random() < 0.7 else rnd.choice(["Customer ID", "سن", "price ($)", "Quantity", "a b", "x.y"]) + f"_{j}" for j in range(ncols)]
    nrows = rnd.randint(1, 60)
    rows = [[cell(k) for k in kinds] for _ in range(nrows)]
    # tests on the empty-string / whole-empty-line rule: the app skips empty lines, a lone empty cell row is "" -> skip
    if ncols == 1:
        rows = [[v if v != "" else "x"] for (v,) in rows]
    newline = "\r\n" if rnd.random() < 0.3 else "\n"
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=delim, lineterminator=newline, quoting=csv.QUOTE_MINIMAL)
    w.writerow(header)
    w.writerows(rows)
    text = buf.getvalue()
    if rnd.random() < 0.25: text = "\ufeff" + text
    if rnd.random() < 0.3: text = text.rstrip("\r\n")          # no trailing newline
    cases.append({"csv": text, "delimiter": delim, "header": header, "rows": rows})

json.dump(cases, open("tests/fixtures/csv-roundtrip.json", "w"), ensure_ascii=False)
print("csv cases:", len(cases))
