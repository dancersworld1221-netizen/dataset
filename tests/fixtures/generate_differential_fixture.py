"""Builds tests/fixtures/differential.json: many tricky datasets with EXPECTED results computed independently
of the application code, with numpy / scipy and exact decimal arithmetic.
Run:  python3 tests/fixtures/generate_differential_fixture.py
"""
import json, math
from collections import Counter
import numpy as np
from scipy import stats
from scipy.stats import chi2_contingency

rng = np.random.default_rng(20261114)
LD = np.longdouble

def num(x):
    """Cell text: shortest round-trip representation (identical double when parsed back)."""
    x = float(x)
    if x == int(x) and abs(x) < 1e15:
        return str(int(x)) if rng.random() < 0.7 else repr(x)
    return repr(x)

from decimal import Decimal, getcontext
getcontext().prec = 90

def ref_stats(vals):
    """Reference statistics in 90-digit decimal arithmetic (inputs converted exactly), cross-checked with scipy."""
    x = np.array(vals, dtype=np.float64)
    n = len(x)
    out = {"count": n}
    if n == 0:
        return out
    D = [Decimal(float(v)) for v in vals]                  # exact binary value of every input
    out["min"] = float(x.min()); out["max"] = float(x.max()); out["sum"] = math.fsum(vals)
    mean = sum(D) / Decimal(n)
    out["mean"] = float(mean)
    q1, med, q3 = np.percentile(x, [25, 50, 75])
    out.update({"median": float(med), "q1": float(q1), "q3": float(q3), "iqr": float(q3 - q1),
                "mad": float(np.median(np.abs(x - np.median(x))))})
    out["zero"] = int((x == 0).sum()); out["pos"] = int((x > 0).sum()); out["neg"] = int((x < 0).sum())
    cnt = Counter(vals); top = max(cnt.values())
    out["modes"] = sorted(v for v, c in cnt.items() if c == top) if top > 1 else []
    out["modeFrequency"] = top if top > 1 else 0
    d = [v - mean for v in D]
    m2 = sum(v * v for v in d)
    out["populationVariance"] = float(m2 / Decimal(n))
    if n >= 2:
        var = m2 / Decimal(n - 1); sd = var.sqrt()
        out["variance"] = float(var); out["stdDev"] = float(sd)
        if mean != 0: out["cv"] = float(sd / abs(mean))
        if sd > 0:
            z = [v / sd for v in d]
            if n >= 3:
                out["skewness"] = float(Decimal(n) / Decimal((n - 1) * (n - 2)) * sum(v ** 3 for v in z))
            if n >= 4:
                out["kurtosis"] = float(Decimal(n * (n + 1)) / Decimal((n - 1) * (n - 2) * (n - 3)) * sum(v ** 4 for v in z)
                                        - Decimal(3 * (n - 1) ** 2) / Decimal((n - 2) * (n - 3)))
            # cross-check the reference itself against scipy (well-conditioned data only)
            if n >= 4 and abs(float(mean)) < 1e6 * max(float(sd), 1e-12) and 1e-100 < float(np.abs(x).max()) < 1e100 and float(sd) > 1e-6 * float(np.abs(x).max()):
                assert abs(stats.skew(x, bias=False) - out["skewness"]) < 1e-8 * max(1, abs(out["skewness"])), "ref skew"
                assert abs(stats.kurtosis(x, bias=False) - out["kurtosis"]) < 1e-7 * max(1, abs(out["kurtosis"])), "ref kurt"
    return out

def outlier_rows(vals_with_nan):
    x = np.array(vals_with_nan, dtype=np.float64)
    v = x[~np.isnan(x)]
    res = {}
    if len(v) < 5:
        return res
    q1, q3 = np.percentile(v, [25, 75]); iqr = q3 - q1
    for k in (1.5, 3.0):
        lo, hi = q1 - k * iqr, q3 + k * iqr
        res[f"iqr{k}"] = [i for i, a in enumerate(x) if not np.isnan(a) and (a < lo or a > hi)]
    sd = v.std(ddof=1)
    if sd > 0:
        mu = v.mean()
        for t in (2.0, 3.0):
            res[f"z{t}"] = [i for i, a in enumerate(x) if not np.isnan(a) and abs((a - mu) / sd) > t]
    mad = stats.median_abs_deviation(v, scale=1.0); med = np.median(v)
    if mad > 0:
        for t in (2.5, 3.5):
            res[f"mz{t}"] = [i for i, a in enumerate(x) if not np.isnan(a) and abs(0.6745 * (a - med) / mad) > t]
    return res

def hist_refs(vals):
    x = np.array(vals, dtype=np.float64); out = []
    if len(x) < 5 or x.max() == x.min(): return out
    for k in (1, 3, 7, 10, 25, 30, 64):
        try:
            c, e = np.histogram(x, bins=k)
        except ValueError:      # numpy refuses bins narrower than float resolution (near-constant data)
            continue
        out.append({"method": "fixed", "bins": k, "counts": c.tolist(), "edges": e.tolist()})
    q1, q3 = np.percentile(x, [25, 75])
    try:
        if q3 > q1:
            e = np.histogram_bin_edges(x, bins="fd")
            if 1 <= len(e) - 1 <= 200:
                c, e = np.histogram(x, bins=e); out.append({"method": "freedman-diaconis", "bins": len(e) - 1, "counts": c.tolist(), "edges": e.tolist()})
        e = np.histogram_bin_edges(x, bins="sturges"); c, e = np.histogram(x, bins=e)
        out.append({"method": "sturges", "bins": len(e) - 1, "counts": c.tolist(), "edges": e.tolist()})
    except ValueError:
        pass
    return out

def inject(vals, miss, bad):
    cells, valid_idx = [], []
    for i, v in enumerate(vals):
        r = rng.random()
        if r < miss: cells.append(rng.choice(["", " ", "N/A", "null", "NaN"]))
        elif r < miss + bad: cells.append(rng.choice(["abc", "12abc", "Infinity", "1e999", "#VALUE!", "1.2.3"]))
        else: cells.append(num(v)); valid_idx.append(i)
    return cells

def case_numeric(name, vals, miss=0.0, bad=0.0, drop=()):
    cells = inject(vals, miss, bad)
    # valid values = cells that parse; recompute from injected cells
    valid = []; withnan = []
    for c in cells:
        try:
            if c.strip() in ("", "N/A", "null", "NaN"): raise ValueError
            f = float(c)
            if not math.isfinite(f): raise ValueError
            valid.append(f); withnan.append(f)
        except ValueError:
            withnan.append(float("nan"))
    missing = sum(1 for c in cells if c.strip() in ("", "N/A", "null", "NaN"))
    invalid = len(cells) - len(valid) - missing
    st = ref_stats(valid)
    for k in drop: st.pop(k, None)
    return {"name": name, "cells": cells, "missing": missing, "invalid": invalid, "stats": st,
            "outliers": outlier_rows([None if math.isnan(a) else a for a in withnan]) if False else outlier_rows(withnan),
            "hist": hist_refs(valid)}

numeric = []
for n in (3, 4, 5, 6, 8, 13, 30, 101, 500, 2000):
    numeric.append(case_numeric(f"normal-n{n}", rng.normal(50, 12, n).round(3), 0.0, 0.0))
    numeric.append(case_numeric(f"normal-missing-n{n}", rng.normal(-5, 3, n).round(4), 0.08, 0.04))
for n in (20, 400):
    numeric.append(case_numeric(f"lognormal-n{n}", rng.lognormal(1.0, 1.1, n).round(5)))
    numeric.append(case_numeric(f"ties-int-n{n}", rng.integers(0, 6, n).astype(float), 0.05, 0.0))
    numeric.append(case_numeric(f"negatives-n{n}", (-np.abs(rng.normal(0, 40, n))).round(2)))
    numeric.append(case_numeric(f"bimodal-n{n}", np.concatenate([rng.normal(10, 1, n // 2), rng.normal(100, 5, n - n // 2)]).round(3)))
    numeric.append(case_numeric(f"decimal-grid-n{n}", (rng.integers(0, 200, n) / 10.0)))   # values sit exactly on 0.1 steps
    numeric.append(case_numeric(f"zero-inflated-n{n}", np.where(rng.random(n) < 0.7, 0.0, rng.exponential(30, n)).round(2)))
    numeric.append(case_numeric(f"heavy-tail-n{n}", rng.standard_t(2.0, n).round(4)))
numeric.append(case_numeric("offset-1e12", (1e12 + rng.integers(0, 1000, 300)).astype(float)))
numeric.append(case_numeric("offset-1e9-decimals", (1e9 + rng.normal(0, 3, 300)).round(4)))
numeric.append(case_numeric("tiny-scale-1e-9", (rng.normal(0, 1, 200) * 1e-9)))
numeric.append(case_numeric("huge-1e150", (rng.normal(1, 0.3, 120) * 1e150)))
numeric.append(case_numeric("constant", [7.5] * 25))
numeric.append(case_numeric("two-values", [1.0] * 14 + [9.0] * 6))
numeric.append(case_numeric("single", [42.0]))
numeric.append(case_numeric("pair", [2.0, 5.0]))
numeric.append(case_numeric("triple", [1.0, 2.0, 10.0]))
numeric.append(case_numeric("all-missing", [1.0] * 5, miss=1.0))


# --- extreme scales, constants that are not exactly representable sums, edge-hugging values ---
numeric.append(case_numeric("tiny-1e-200", rng.normal(1, 0.3, 150) * 1e-200, drop=("variance", "populationVariance")))
numeric.append(case_numeric("huge-1e200", rng.normal(1, 0.3, 150) * 1e200, drop=("variance", "populationVariance")))
for n_, c_ in [(3, 0.1), (7, 0.1), (10, 0.3), (11, 1e-7), (6, 123456.789)]:
    numeric.append(case_numeric(f"constant-{c_}-n{n_}", [c_] * n_))
numeric.append(case_numeric("near-constant-ulp", [1.0, 1.0 + 2.220446049250313e-16, 1.0, 1.0 + 2.220446049250313e-16, 1.0, 1.0]))
numeric.append(case_numeric("negative-offset-1e10", (-1e10 + rng.normal(0, 2, 250)).round(5)))
for a_, b_, m_ in [(0.0, 1.0, 11), (0.0, 3.0, 31), (-5.0, 5.0, 101), (0.1, 0.7, 7), (1e-3, 9e-3, 9)]:
    numeric.append(case_numeric(f"edge-values-{a_}-{b_}-{m_}", np.linspace(a_, b_, m_)))
numeric.append(case_numeric("decimal-steps-0.1", [round(0.1 * k, 1) for k in range(31)]))
numeric.append(case_numeric("decimal-steps-0.01", [round(0.01 * k, 2) for k in range(101)]))

# ---- correlation: pairwise complete, ties, missing -----------------------------------------
def pair_ref(a, b):
    a = np.array(a, dtype=float); b = np.array(b, dtype=float)
    m = ~(np.isnan(a) | np.isnan(b)); n = int(m.sum())
    r = {"n": n, "pearson": None, "spearman": None}
    if n >= 3 and a[m].std() > 0 and b[m].std() > 0:
        r["pearson"] = float(stats.pearsonr(a[m], b[m])[0]); r["spearman"] = float(stats.spearmanr(a[m], b[m])[0])
    return r

correlation = []
for idx, (n, ncol, miss, levels) in enumerate([(60, 4, 0.0, 0), (60, 4, 0.15, 0), (200, 5, 0.1, 6), (300, 6, 0.3, 12), (25, 3, 0.2, 4), (1000, 5, 0.05, 40)]):
    base = rng.normal(0, 1, n)
    cols = []
    for j in range(ncol):
        v = base * rng.uniform(-2, 2) + rng.normal(0, 1, n) * rng.uniform(0.2, 2)
        if levels: v = np.round(v * levels) / levels      # many ties
        v = np.where(rng.random(n) < miss, np.nan, v)
        cols.append(v)
    cols.append(np.full(n, 3.0))                            # constant column
    cells = [[("" if np.isnan(x) else num(x)) for x in c] for c in cols]
    names = [f"c{j}" for j in range(len(cols))]
    pairs = {}
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            pairs[f"{i},{j}"] = pair_ref(cols[i], cols[j])
    correlation.append({"name": f"corr-{idx}", "names": names, "cells": cells, "pairs": pairs})

def extreme_corr(name, transform, n=300):
    base = rng.normal(0, 1, n)
    raw = [base * 0.8 + rng.normal(0, 0.6, n), -base * 1.5 + rng.normal(0, 0.5, n), rng.normal(0, 1, n)]
    cols = [transform(c) for c in raw]
    cells = [[num(x) for x in c] for c in cols]
    names = ["a", "b", "c"]
    pairs = {}
    for i in range(3):
        for j in range(i + 1, 3):
            # reference on the ORIGINAL standard-scale data (correlation is invariant to offset / scale)
            pairs[f"{i},{j}"] = pair_ref(raw[i], raw[j])
            # recompute on the transformed (rounded) values to stay exact about what the app sees
            a_ = np.array([float(c) for c in cells[i]]); b_ = np.array([float(c) for c in cells[j]])
            al = a_.astype(LD); bl = b_.astype(LD)
            da = al - al.sum() / LD(n); db = bl - bl.sum() / LD(n)
            r_ld = (da * db).sum() / np.sqrt((da * da).sum() * (db * db).sum())     # extended-precision Pearson
            pairs[f"{i},{j}"] = {"n": n, "pearson": float(r_ld), "spearman": float(stats.spearmanr(a_, b_)[0])}
    correlation.append({"name": name, "names": names, "cells": cells, "pairs": pairs})

extreme_corr("corr-offset-1e12", lambda c: 1e12 + np.round(c * 1000))
extreme_corr("corr-tiny-1e-150", lambda c: c * 1e-150)
extreme_corr("corr-huge-1e150", lambda c: c * 1e150)
extreme_corr("corr-mixed-scales", lambda c: c * 1e-9 if c[0] > 0 else c * 1e9)

# ---- KS and Cramér's V ---------------------------------------------------------------------
ks = []
for n1, n2, shift in [(40, 40, 8), (100, 80, 0.0), (500, 300, 0.4), (35, 36, 0.0), (60, 200, 2.0)]:
    a = rng.normal(0, 1, n1).round(3); b = (rng.normal(0, 1, n2) + shift).round(3)
    ks.append({"a": a.tolist(), "b": b.tolist(), "d": float(stats.ks_2samp(a, b).statistic)})

cramers = []
for r_, c_, n in [(2, 2, 200), (3, 4, 500), (5, 5, 60), (2, 6, 150)]:
    p = rng.dirichlet(np.ones(c_), size=r_)
    xs, ys = [], []
    for _ in range(n):
        i = int(rng.integers(0, r_)); j = int(rng.choice(c_, p=p[i])); xs.append(f"A{i}"); ys.append(f"B{j}")
    table = np.zeros((r_, c_))
    for a, b in zip(xs, ys): table[int(a[1:]), int(b[1:])] += 1
    table = table[table.sum(1) > 0][:, table.sum(0) > 0]
    chi2 = chi2_contingency(table, correction=False)[0]
    v = math.sqrt(chi2 / (table.sum() * (min(table.shape) - 1))) if min(table.shape) > 1 else None
    cramers.append({"x": xs, "y": ys, "v": v})

# ---- class imbalance -----------------------------------------------------------------------
imbalance = []
for counts in ([90, 10], [50, 50], [5, 3, 1], [1000, 1], [7], [60, 30, 10, 2]):
    labels = []
    for k, c in enumerate(counts): labels += [f"class{k}"] * c
    rng.shuffle(labels)
    imbalance.append({"labels": labels + ["", "N/A"], "counts": counts,
                      "ratio": (max(counts) / min(counts)) if len(counts) > 1 else None})


# ---- dates ---------------------------------------------------------------------------------
import datetime as dt
dates = []
def date_case(name, cells, valid_dates, expect_ambiguous=False):
    years = Counter(str(d.year) for d in valid_dates)
    months = [sum(1 for d in valid_dates if d.month == m) for m in range(1, 13)]
    days = [sum(1 for d in valid_dates if d.day == k) for k in range(1, 32)]
    missing = sum(1 for c in cells if c.strip() in ("", "N/A"))
    entry = {"name": name, "cells": cells, "missing": missing, "valid": len(valid_dates), "ambiguous": expect_ambiguous,
             "years": dict(years), "months": months, "days": days,
             "earliest": min(valid_dates).isoformat() if valid_dates else None, "latest": max(valid_dates).isoformat() if valid_dates else None,
             "span": float((max(valid_dates) - min(valid_dates)).days) if valid_dates else None}
    dates.append(entry)

base = dt.date(2016, 1, 1)
iso_cells, iso_valid = [], []
for _ in range(240):
    d = base + dt.timedelta(days=int(rng.integers(0, 365 * 9)))
    iso_cells.append(d.isoformat()); iso_valid.append(d)
iso_cells += ["2020-02-29", "2024-02-29", "", "N/A"]; iso_valid += [dt.date(2020, 2, 29), dt.date(2024, 2, 29)]
iso_cells += ["2021-02-30", "2021-13-01", "2021-00-10", "2023-02-29", "not a date", "2021-04-31"]   # invalid dates
date_case("iso-with-invalid", iso_cells, iso_valid)

ts_cells, ts_valid = [], []
for _ in range(200):
    off_h = int(rng.choice([-8, -5, 0, 1, 5, 9])); off_m = int(rng.choice([0, 30])) if off_h in (5, 9) else 0
    sign = "-" if off_h < 0 else "+"
    tz = dt.timezone(dt.timedelta(hours=off_h, minutes=off_m * (1 if off_h >= 0 else -1)))
    t = dt.datetime(2022, 1, 1) + dt.timedelta(minutes=int(rng.integers(0, 60 * 24 * 500)))
    local = t.replace(tzinfo=tz)
    text = local.strftime("%Y-%m-%dT%H:%M:%S") + (f"{sign}{abs(off_h):02d}:{off_m:02d}" if off_h != 0 or off_m else "Z")
    ts_cells.append(text); ts_valid.append(local.astimezone(dt.timezone.utc).date())
date_case("iso-timestamps-with-offsets", ts_cells, ts_valid)

dmy_cells, dmy_valid = [], []
for _ in range(150):
    d = dt.date(2019, 1, 1) + dt.timedelta(days=int(rng.integers(0, 1500)))
    dmy_cells.append(d.strftime("%d/%m/%Y")); dmy_valid.append(d)
dmy_cells[0] = "25/12/2020"; dmy_valid[0] = dt.date(2020, 12, 25)
date_case("day-first-with-evidence", dmy_cells, dmy_valid)

mdy_cells, mdy_valid = [], []
for _ in range(150):
    d = dt.date(2019, 1, 1) + dt.timedelta(days=int(rng.integers(0, 1500)))
    mdy_cells.append(f"{d.month}/{d.day}/{d.year}"); mdy_valid.append(d)
mdy_cells[0] = "12/25/2020"; mdy_valid[0] = dt.date(2020, 12, 25)
date_case("month-first-with-evidence", mdy_cells, mdy_valid)

amb = [f"{int(rng.integers(1, 13)):02d}/{int(rng.integers(1, 13)):02d}/2021" for _ in range(30)]
date_case("ambiguous-all-small", amb, [], expect_ambiguous=True)

json.dump({"dates": dates, "numeric": numeric, "correlation": correlation, "ks": ks, "cramers": cramers, "imbalance": imbalance},
          open("tests/fixtures/differential.json", "w"))
print("numeric cases:", len(numeric), "| correlation sets:", len(correlation), "| ks:", len(ks), "| cramers:", len(cramers))
