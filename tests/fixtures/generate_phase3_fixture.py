"""Builds the deterministic Phase 3 acceptance dataset and computes EXPECTED values independently
with numpy/scipy (not with the app's code). Output: tests/fixtures/phase3.csv and phase3.expected.json"""
import json, math, random
import numpy as np
from scipy import stats

random.seed(20261113)
N = 120
rows = []
age, income, debt, spend, zero_infl, outl, nonlin = [], [], [], [], [], [], []
for i in range(N):
    a = 20 + (i * 37) % 45                       # 20..64, deterministic
    age.append(a)
for i in range(N):
    inc = 1000 + 55 * age[i] + ((i * 7919) % 400 - 200)   # strong positive with age, bounded noise
    income.append(inc)
    debt.append(round(5000 - 40 * age[i] + ((i * 104729) % 300 - 150), 2))  # strong negative with age
    spend.append(round(random.uniform(0, 100), 2))         # unrelated
    zero_infl.append(0 if i % 3 != 0 and i % 5 != 0 else round(10 + (i % 7) * 3.5, 1))
    outl.append(50 + (i % 11))                             # 50..60
outl[10] = 500; outl[77] = -300                            # two known outliers
cats = ["red", "green", "blue", "yellow"]
category = [cats[(i * 5) % 4] if i % 17 != 0 else "" for i in range(N)]   # some missing
flag = ["true" if (i * 3) % 10 < 3 else "false" for i in range(N)]
target = ["no"] * 108 + ["yes"] * 12                                        # 9:1 imbalance
random.shuffle(target)
dates = [f"2026-{1 + (i % 12):02d}-{1 + (i * 3) % 28:02d}" for i in range(N)]
income_missing = {5, 40, 90}
age_text_idx = 33                                                           # one invalid numeric cell

header = ["row_id", "age", "income", "debt", "spend", "zero_inflated", "with_outliers", "dup_age", "category", "flag", "signup_date", "target"]
lines = [",".join(header)]
for i in range(N):
    inc = "" if i in income_missing else str(income[i])
    age_cell = "n/a?" if i == age_text_idx else str(age[i])
    lines.append(",".join([str(i + 1), age_cell, inc, str(debt[i]), str(spend[i]), str(zero_infl[i]), str(outl[i]),
                           age_cell, category[i], flag[i], dates[i], target[i]]))
open("tests/fixtures/phase3.csv", "w").write("\n".join(lines) + "\n")

def clean(xs):
    return np.array([x for x in xs if x is not None], dtype=float)

age_valid = np.array([age[i] for i in range(N) if i != age_text_idx], dtype=float)
income_valid = np.array([income[i] for i in range(N) if i not in income_missing], dtype=float)
out_valid = np.array(outl, dtype=float)
zi = np.array(zero_infl, dtype=float)

def summary(x):
    q1, q2, q3 = np.percentile(x, [25, 50, 75])          # linear interpolation = type 7
    vals, counts = np.unique(x, return_counts=True)
    top = counts.max()
    modes = [float(v) for v, c in zip(vals, counts) if c == top] if top > 1 else []
    return {
        "count": int(len(x)), "min": float(x.min()), "max": float(x.max()), "sum": float(x.sum()),
        "mean": float(x.mean()), "median": float(np.median(x)),
        "variance": float(x.var(ddof=1)), "stdDev": float(x.std(ddof=1)),
        "populationVariance": float(x.var(ddof=0)), "populationStdDev": float(x.std(ddof=0)),
        "q1": float(q1), "q3": float(q3), "iqr": float(q3 - q1),
        "mad": float(stats.median_abs_deviation(x, scale=1.0)),
        "cv": float(x.std(ddof=1) / abs(x.mean())),
        "skewness": float(stats.skew(x, bias=False)), "excessKurtosis": float(stats.kurtosis(x, fisher=True, bias=False)),
        "modes": modes, "modeFrequency": int(top) if top > 1 else 0,
        "zeroCount": int((x == 0).sum()), "positiveCount": int((x > 0).sum()), "negativeCount": int((x < 0).sum()),
    }

def pair(xs, ys):
    xs = np.array(xs, dtype=float); ys = np.array(ys, dtype=float)
    m = ~(np.isnan(xs) | np.isnan(ys))
    return {"pearson": float(stats.pearsonr(xs[m], ys[m])[0]), "spearman": float(stats.spearmanr(xs[m], ys[m])[0]), "n": int(m.sum())}

age_f = [np.nan if i == age_text_idx else float(age[i]) for i in range(N)]
inc_f = [np.nan if i in income_missing else float(income[i]) for i in range(N)]

# IQR outliers for with_outliers (k = 1.5)
q1, q3 = np.percentile(out_valid, [25, 75]); iqr = q3 - q1
iqr_rows = [i for i in range(N) if out_valid[i] < q1 - 1.5 * iqr or out_valid[i] > q3 + 1.5 * iqr]
mu, sd = out_valid.mean(), out_valid.std(ddof=1)
z_rows = [i for i in range(N) if abs((out_valid[i] - mu) / sd) > 3]
med = np.median(out_valid); mad = stats.median_abs_deviation(out_valid, scale=1.0)
mz_rows = [i for i in range(N) if abs(0.6745 * (out_valid[i] - med) / mad) > 3.5]

# histogram expectations (numpy edges = same equal-width rule)
counts, edges = np.histogram(age_valid, bins=8)

# class imbalance
vals, cnt = np.unique(target, return_counts=True)
cat_vals = [c for c in category if c != ""]
cv, cc = np.unique(cat_vals, return_counts=True)

expected = {
    "age": summary(age_valid), "income": summary(income_valid), "with_outliers": summary(out_valid), "zero_inflated": summary(zi),
    "corr_age_income": pair(age_f, inc_f),
    "corr_age_debt": pair(age_f, debt),
    "corr_age_spend": pair(age_f, spend),
    "outliers_iqr_rows": iqr_rows, "outliers_iqr_bounds": [float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)],
    "outliers_z_rows": z_rows, "outliers_modz_rows": mz_rows,
    "age_hist_8": {"counts": [int(c) for c in counts], "edges": [float(e) for e in edges]},
    "target": {"classes": {str(v): int(c) for v, c in zip(vals, cnt)}, "ratio": float(cnt.max() / cnt.min())},
    "category": {"classes": {str(v): int(c) for v, c in zip(cv, cc)}, "missing": N - len(cat_vals)},
    "n": N,
}
json.dump(expected, open("tests/fixtures/phase3.expected.json", "w"), indent=1)
print("rows", N, "iqr_rows", iqr_rows, "z_rows", z_rows, "modz_rows", mz_rows)
print("corr", expected["corr_age_income"], expected["corr_age_debt"], expected["corr_age_spend"])
print("target", expected["target"], "category", expected["category"])
