import { describe, it, expect } from "vitest";
import { computeNumericSummary, quantileSorted } from "@/lib/analytics/numeric";
import { buildHistogram } from "@/lib/analytics/distribution";
import { detectOutliers } from "@/lib/analytics/outliers";
import { pearsonPair, rankAverage, spearmanPair } from "@/lib/analytics/correlation";
import { analyzeClassImbalance } from "@/lib/analytics/categorical";
import { cramersV, ksDistance } from "@/lib/analytics/relationships";
import { parseDateValue, parseNumber } from "@/lib/profiling/typeInference";

// Property / metamorphic tests: mathematical laws that must hold for ANY data. They use a seeded generator
// so failures are reproducible, and they never compare the engine with a copy of its own formulas.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

type Kind = "normal" | "lognormal" | "ties" | "grid" | "negative" | "bimodal";
function sample(r: () => number, n: number, kind: Kind): number[] {
  return Array.from({ length: n }, () => {
    switch (kind) {
      case "normal": return Math.round(normal(r) * 1e4) / 1e3 + 20;
      case "lognormal": return Math.round(Math.exp(normal(r)) * 1e4) / 1e4;
      case "ties": return Math.floor(r() * 7);
      case "grid": return Math.round(r() * 200) / 10;
      case "negative": return -Math.abs(Math.round(normal(r) * 100) / 10);
      case "bimodal": return (r() < 0.5 ? normal(r) : 60 + 4 * normal(r));
    }
  });
}
const KINDS: Kind[] = ["normal", "lognormal", "ties", "grid", "negative", "bimodal"];
const summary = (x: number[]) => computeNumericSummary("x", Float64Array.from(x), { totalRows: x.length, missingCount: 0, invalidCount: 0 });
const rel = (a: number | null, b: number | null, tol: number) => {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(Math.abs((a as number) - (b as number))).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b as number)));
};

describe("histogram laws", () => {
  it("frequencies sum to n, bins tile [min, max] and match a brute-force recount (500 random cases)", () => {
    const r = rng(1);
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(r() * 300);
      const x = sample(r, n, KINDS[t % KINDS.length]);
      const bins = 1 + Math.floor(r() * 60);
      const h = buildHistogram("x", x, { missingCount: 0, invalidCount: 0 }, { method: "fixed", bins });
      expect(h.bins.reduce((a, b) => a + b.count, 0)).toBe(n);
      if (h.bins.length === 0) continue;
      expect(h.bins[0].start).toBe(Math.min(...x));
      expect(h.bins[h.bins.length - 1].end).toBe(Math.max(...x));
      for (let i = 0; i + 1 < h.bins.length; i++) expect(h.bins[i].end).toBe(h.bins[i + 1].start);
      // Brute force: half-open bins, the last one closed.
      const recount = h.bins.map((b, i) => x.filter((v) => v >= b.start && (i === h.bins.length - 1 ? v <= b.end : v < b.end)).length);
      expect(recount).toEqual(h.bins.map((b) => b.count));
    }
  });
});

describe("descriptive statistics laws", () => {
  it("are invariant to row order (exactly) and to shifts (spread and shape)", () => {
    const r = rng(2);
    for (let t = 0; t < 150; t++) {
      const x = sample(r, 8 + Math.floor(r() * 200), KINDS[t % KINDS.length]);
      const base = summary(x);
      const shuffled = [...x].sort(() => r() - 0.5);
      expect(summary(shuffled)).toEqual(base);
      const c = Math.round((r() - 0.5) * 2e6);
      const shifted = summary(x.map((v) => v + c));
      rel(shifted.mean, (base.mean as number) + c, 1e-9);
      rel(shifted.stdDev, base.stdDev, 1e-7);
      rel(shifted.iqr, base.iqr, 1e-9);
      rel(shifted.mad, base.mad, 1e-9);
      if (base.skewness !== null) rel(shifted.skewness, base.skewness, 1e-6);
      if (base.excessKurtosis !== null) rel(shifted.excessKurtosis, base.excessKurtosis, 1e-6);
    }
  });

  it("scale by k > 0 multiplies the spread by k and leaves shape and CV unchanged; k < 0 flips skewness", () => {
    const r = rng(3);
    for (let t = 0; t < 150; t++) {
      const x = sample(r, 10 + Math.floor(r() * 150), KINDS[t % KINDS.length]);
      const k = 0.001 + r() * 1000;
      const a = summary(x);
      const b = summary(x.map((v) => v * k));
      rel(b.stdDev, (a.stdDev as number) * k, 1e-10);
      rel(b.mad, (a.mad as number) * k, 1e-10);
      if (a.skewness !== null) rel(b.skewness, a.skewness, 1e-9);
      if (a.excessKurtosis !== null) rel(b.excessKurtosis, a.excessKurtosis, 1e-9);
      if (a.coefficientOfVariation !== null) rel(b.coefficientOfVariation, a.coefficientOfVariation, 1e-9);
      const neg = summary(x.map((v) => -v));
      if (a.skewness !== null) rel(neg.skewness, -a.skewness, 1e-9);
      if (a.excessKurtosis !== null) rel(neg.excessKurtosis, a.excessKurtosis, 1e-9);
      expect(neg.q1).toBe(-(a.q3 as number)); // quartiles mirror
    }
  });

  it("quantiles are monotone and bounded; population variance = sample variance * (n - 1) / n", () => {
    const r = rng(4);
    for (let t = 0; t < 150; t++) {
      const x = Float64Array.from(sample(r, 2 + Math.floor(r() * 200), KINDS[t % KINDS.length])).sort();
      let previous = -Infinity;
      for (let p = 0; p <= 1.0000001; p += 0.05) {
        const q = quantileSorted(x, Math.min(1, p));
        expect(q).toBeGreaterThanOrEqual(previous);
        previous = q;
        expect(q).toBeGreaterThanOrEqual(x[0]);
        expect(q).toBeLessThanOrEqual(x[x.length - 1]);
      }
      const s = summary(Array.from(x));
      if (s.variance !== null && s.populationVariance !== null) rel(s.populationVariance, (s.variance * (x.length - 1)) / x.length, 1e-12);
      expect(s.min).toBeLessThanOrEqual(s.mean as number);
      expect(s.max).toBeGreaterThanOrEqual(s.mean as number);
    }
  });

  it("constant columns of any value and length have exactly zero spread", () => {
    const r = rng(5);
    for (let t = 0; t < 200; t++) {
      const value = (r() - 0.5) * 10 ** Math.floor(r() * 12 - 4);
      const n = 2 + Math.floor(r() * 60);
      const s = summary(Array(n).fill(value));
      expect(s.variance).toBe(0);
      expect(s.stdDev).toBe(0);
      expect(s.mean).toBe(value);
      expect(s.iqr).toBe(0);
      expect(s.skewness).toBeNull();
    }
  });
});

describe("rank and correlation laws", () => {
  it("ranks sum to n(n+1)/2, tie values share a rank and order is preserved", () => {
    const r = rng(6);
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(r() * 200);
      const x = sample(r, n, KINDS[t % KINDS.length]);
      const ranks = rankAverage(x);
      expect(Array.from(ranks).reduce((a, b) => a + b, 0)).toBeCloseTo((n * (n + 1)) / 2, 8);
      let violations = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (x[i] === x[j] && ranks[i] !== ranks[j]) violations++;
          if (x[i] < x[j] && !(ranks[i] < ranks[j])) violations++;
        }
      }
      expect(violations).toBe(0);
      // ranks are in [1, n] and "average rank" means: rank = (number below) + (number equal + 1) / 2
      for (let i = 0; i < n; i += 7) {
        const below = x.filter((v) => v < x[i]).length;
        const equal = x.filter((v) => v === x[i]).length;
        expect(ranks[i]).toBe(below + (equal + 1) / 2);
      }
    }
  });

  it("Pearson and Spearman are symmetric, bounded, shift/scale invariant and exactly +-1 for linear data", () => {
    const r = rng(7);
    for (let t = 0; t < 150; t++) {
      const n = 5 + Math.floor(r() * 150);
      const x = sample(r, n, KINDS[t % KINDS.length]);
      const y = sample(r, n, KINDS[(t + 2) % KINDS.length]).map((v, i) => v + 0.3 * x[i]);
      const p = pearsonPair(x, y).r;
      const s = spearmanPair(x, y).r;
      if (p === null || s === null) continue;
      expect(Math.abs(p)).toBeLessThanOrEqual(1);
      expect(Math.abs(s)).toBeLessThanOrEqual(1);
      expect(pearsonPair(y, x).r).toBeCloseTo(p, 13);
      expect(spearmanPair(y, x).r).toBeCloseTo(s, 13);
      const a = 0.01 + r() * 100;
      const b = (r() - 0.5) * 1e5;
      expect(pearsonPair(x.map((v) => a * v + b), y).r).toBeCloseTo(p, 10);
      expect(pearsonPair(x.map((v) => -a * v + b), y).r).toBeCloseTo(-p, 10);
      // Spearman is Pearson of the ranks, ranking the ranks changes nothing, and an exact order-preserving
      // rescaling (multiplying by a power of two is exact in floating point) leaves it unchanged.
      expect(pearsonPair(rankAverage(x), rankAverage(y)).r).toBeCloseTo(s, 13);
      expect(spearmanPair(Array.from(rankAverage(x)), Array.from(rankAverage(y))).r).toBeCloseTo(s, 13);
      expect(spearmanPair(x.map((v) => v * 8), y.map((v) => v * 0.25)).r).toBe(s);
      const lin = pearsonPair(x, x.map((v) => a * v + b)).r;
      if (lin !== null) expect(lin).toBeCloseTo(1, 10);
      const anti = pearsonPair(x, x.map((v) => -a * v + b)).r;
      if (anti !== null) expect(anti).toBeCloseTo(-1, 10);
    }
  });

  it("missing values only remove the affected pairs (pairwise complete)", () => {
    const r = rng(8);
    for (let t = 0; t < 60; t++) {
      const n = 20 + Math.floor(r() * 100);
      const x = sample(r, n, "normal");
      const y = x.map((v) => v * 2 + normal(r));
      const withGaps = x.map((v, i) => (r() < 0.2 || i === 0 ? NaN : v));
      const direct = pearsonPair(withGaps, y);
      const keep = withGaps.map((_, i) => i).filter((i) => !Number.isNaN(withGaps[i]));
      const filtered = pearsonPair(keep.map((i) => withGaps[i]), keep.map((i) => y[i]));
      expect(direct.n).toBe(filtered.n);
      expect(direct.r).toBeCloseTo(filtered.r as number, 13);
    }
  });
});

describe("outlier laws", () => {
  const input = (x: number[]) => ({ column: "x", values: Float64Array.from(x), missingCount: 0, invalidCount: 0 });

  it("flagged rows do not change under positive affine transforms; stricter settings flag subsets", () => {
    const r = rng(9);
    for (let t = 0; t < 100; t++) {
      const x = sample(r, 40 + Math.floor(r() * 200), KINDS[t % KINDS.length]);
      const a = 0.5 + r() * 20;
      const b = (r() - 0.5) * 1e4;
      for (const params of [{ method: "iqr" }, { method: "zscore", threshold: 2 }, { method: "modified-zscore", threshold: 3 }] as const) {
        const base = detectOutliers(input(x), params);
        const moved = detectOutliers(input(x.map((v) => a * v + b)), params);
        expect(moved.rowIndices).toEqual(base.rowIndices);
        expect(base.lowCount + base.highCount).toBe(base.outlierCount);
        expect(base.outlierCount).toBeLessThanOrEqual(base.validCount);
      }
      const loose = new Set(detectOutliers(input(x), { method: "iqr", multiplier: 1.5 }).rowIndices);
      const strict = detectOutliers(input(x), { method: "iqr", multiplier: 3 }).rowIndices;
      for (const i of strict) expect(loose.has(i)).toBe(true);
      const z2 = new Set(detectOutliers(input(x), { method: "zscore", threshold: 2 }).rowIndices);
      for (const i of detectOutliers(input(x), { method: "zscore", threshold: 3 }).rowIndices) expect(z2.has(i)).toBe(true);
    }
  });

  it("never modifies its input", () => {
    const r = rng(10);
    const x = sample(r, 100, "lognormal");
    const original = Float64Array.from(x);
    const data = input(x);
    detectOutliers(data, { method: "iqr" });
    detectOutliers(data, { method: "zscore" });
    detectOutliers(data, { method: "modified-zscore" });
    expect(Array.from(data.values)).toEqual(Array.from(original));
  });
});

describe("distribution distance, association and imbalance laws", () => {
  it("KS distance is in [0, 1], symmetric, zero for identical samples and invariant to monotone transforms", () => {
    const r = rng(11);
    for (let t = 0; t < 100; t++) {
      const a = Float64Array.from(sample(r, 20 + Math.floor(r() * 150), KINDS[t % KINDS.length])).sort();
      const b = Float64Array.from(sample(r, 20 + Math.floor(r() * 150), KINDS[(t + 1) % KINDS.length])).sort();
      const d = ksDistance(a, b);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(ksDistance(b, a)).toBeCloseTo(d, 14);
      expect(ksDistance(a, a)).toBe(0);
      const f = (v: number) => Math.atan(v / 30) * 10 + 3;
      expect(ksDistance(a.map(f), b.map(f))).toBeCloseTo(d, 12);
    }
  });

  it("Cramér's V is in [0, 1], symmetric and unchanged by relabelling", () => {
    const r = rng(12);
    for (let t = 0; t < 100; t++) {
      const n = 30 + Math.floor(r() * 200);
      const x = Array.from({ length: n }, () => `a${Math.floor(r() * 4)}`);
      const y = x.map((v) => (r() < 0.6 ? `b${v.slice(1)}` : `b${Math.floor(r() * 5)}`));
      const v = cramersV(x, y);
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1 + 1e-12);
      expect(cramersV(y, x)).toBeCloseTo(v, 12);
      expect(cramersV(x.map((s) => `L-${s}`), y.map((s) => `M-${s}`))).toBeCloseTo(v, 12);
    }
  });

  it("class imbalance: ratio >= 1, percentages add to 100, order of rows is irrelevant", () => {
    const r = rng(13);
    for (let t = 0; t < 100; t++) {
      const labels = Array.from({ length: 20 + Math.floor(r() * 300) }, () => `c${Math.floor(r() ** 2 * 6)}`);
      const a = analyzeClassImbalance("t", labels);
      expect(a.ratio === null || a.ratio >= 1).toBe(true);
      expect(a.classes.reduce((s, c) => s + c.percentage, 0)).toBeCloseTo(100, 9);
      expect(analyzeClassImbalance("t", [...labels].sort(() => r() - 0.5))).toEqual(a);
    }
  });
});

describe("parsing round trips", () => {
  it("every finite double written by JavaScript parses back to the identical value", () => {
    const r = rng(14);
    for (let t = 0; t < 2000; t++) {
      const v = (r() - 0.5) * 10 ** Math.floor(r() * 40 - 15);
      const texts = [String(v), v.toExponential(), v.toPrecision(15)];
      for (const text of texts) {
        // Integers with more than 15 digits cannot be represented exactly and are treated as identifiers.
        if (/^-?\d{16,}$/.test(text)) {
          expect(parseNumber(text), text).toBeNull();
          continue;
        }
        const parsed = parseNumber(text);
        expect(parsed, text).not.toBeNull();
        expect(parsed?.value, text).toBe(Number(text));
      }
    }
  });

  it("dates round-trip exactly and impossible dates are rejected", () => {
    const r = rng(15);
    for (let t = 0; t < 1500; t++) {
      const ms = Date.UTC(1900, 0, 1) + Math.floor(r() * (Date.UTC(2100, 0, 1) - Date.UTC(1900, 0, 1)));
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      expect(parseDateValue(iso)?.date.toISOString().slice(0, 10), iso).toBe(iso);
      if (day > 12) expect(parseDateValue(`${day}/${m}/${y}`, "dmy")?.date.toISOString().slice(0, 10)).toBe(iso);
      expect(parseDateValue(`${m}/${day}/${y}`, "mdy")?.date.toISOString().slice(0, 10)).toBe(iso);
    }
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      expect(parseDateValue(`2023-${String(m).padStart(2, "0")}-${lengths[m - 1] + 1}`)).toBeNull();
      expect(parseDateValue(`2023-${String(m).padStart(2, "0")}-${lengths[m - 1]}`)).not.toBeNull();
    }
    expect(parseDateValue("2024-02-29")).not.toBeNull();
    expect(parseDateValue("2023-02-29")).toBeNull();
    expect(parseDateValue("1900-02-29")).toBeNull(); // 1900 was not a leap year
    expect(parseDateValue("2000-02-29")).not.toBeNull();
  });
});
