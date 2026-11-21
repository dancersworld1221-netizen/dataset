import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { ColumnStore } from "@/lib/analytics/columnStore";
import { computeNumericSummary } from "@/lib/analytics/numeric";
import { buildDateDistribution, buildHistogram } from "@/lib/analytics/distribution";
import { detectOutliers } from "@/lib/analytics/outliers";
import { correlationMatrix } from "@/lib/analytics/correlation";
import { analyzeClassImbalance } from "@/lib/analytics/categorical";
import { cramersV, ksDistance } from "@/lib/analytics/relationships";

// Differential test: tests/fixtures/differential.json is produced by
// tests/fixtures/generate_differential_fixture.py with numpy / scipy and extended precision, so every
// expected value is independent of the application code.
interface NumericCase {
  name: string;
  cells: string[];
  missing: number;
  invalid: number;
  stats: Record<string, number | number[]>;
  outliers: Record<string, number[]>;
  hist: Array<{ method: "fixed" | "freedman-diaconis" | "sturges"; bins: number; counts: number[]; edges: number[] }>;
}
const data = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/differential.json"), "utf8")) as {
  numeric: NumericCase[];
  correlation: Array<{ name: string; names: string[]; cells: string[][]; pairs: Record<string, { n: number; pearson: number | null; spearman: number | null }> }>;
  ks: Array<{ a: number[]; b: number[]; d: number }>;
  cramers: Array<{ x: string[]; y: string[]; v: number | null }>;
  imbalance: Array<{ labels: string[]; counts: number[]; ratio: number | null }>;
  dates: Array<{
    name: string; cells: string[]; missing: number; valid: number; ambiguous: boolean;
    years: Record<string, number>; months: number[]; days: number[];
    earliest: string | null; latest: string | null; span: number | null;
  }>;
};

/** |actual - expected| <= rel * scale (scale defaults to |expected|), with a floor for values that are exactly 0. */
function near(actual: number | null, expected: number, rel: number, scale = Math.abs(expected)): void {
  expect(actual, "value is not null").not.toBeNull();
  const tolerance = rel * Math.max(scale, Number.MIN_VALUE);
  expect(Math.abs((actual as number) - expected), `actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(tolerance);
}

const storeFor = (cells: string[]) => new ColumnStore(cells.map((x) => ({ x })), [{ name: "x", dataType: "decimal" }]);

describe("numeric statistics vs numpy / scipy / long double reference", () => {
  for (const c of data.numeric) {
    it(c.name, () => {
      const store = storeFor(c.cells);
      const col = store.numeric("x");
      expect(col.missingCount).toBe(c.missing);
      expect(col.invalidCount).toBe(c.invalid);
      const s = computeNumericSummary("x", store.validValues("x"), { totalRows: c.cells.length, missingCount: col.missingCount, invalidCount: col.invalidCount });
      const e = c.stats as Record<string, number & number[]>;
      expect(s.count).toBe(e.count);
      if (e.count === 0) {
        expect(s.mean).toBeNull();
        return;
      }
      const spread = Math.max(Math.abs(e.max), Math.abs(e.min));
      expect(s.min).toBe(e.min);
      expect(s.max).toBe(e.max);
      near(s.sum, e.sum, 1e-13, Math.max(Math.abs(e.sum), spread));
      near(s.mean, e.mean, 1e-13, spread);
      near(s.median, e.median, 1e-13, spread);
      near(s.q1, e.q1, 1e-13, spread);
      near(s.q3, e.q3, 1e-13, spread);
      near(s.iqr, e.iqr, 1e-9, spread);
      near(s.mad, e.mad, 1e-12, spread);
      expect([s.zeroCount, s.positiveCount, s.negativeCount]).toEqual([e.zero, e.pos, e.neg]);
      expect(s.modes).toEqual(e.modes);
      expect(s.modeFrequency).toBe(e.modeFrequency);
      // Extreme-scale cases omit the variance from the reference (it is outside double range).
      if (e.populationVariance !== undefined) near(s.populationVariance, e.populationVariance, 1e-9);
      else if (s.populationVariance !== null) expect(Number.isFinite(s.populationVariance)).toBe(true);
      if (e.count >= 2) {
        if (e.variance !== undefined) near(s.variance, e.variance, 1e-9);
        near(s.stdDev, e.stdDev, 1e-9);
        if (e.cv !== undefined) near(s.coefficientOfVariation, e.cv, 1e-8);
        else expect(s.coefficientOfVariation).toBeNull();
      } else {
        expect(s.variance).toBeNull();
        expect(s.stdDev).toBeNull();
      }
      if (e.skewness !== undefined) near(s.skewness, e.skewness, 1e-8, Math.max(Math.abs(e.skewness), 1));
      else expect(s.skewness).toBeNull();
      if (e.kurtosis !== undefined) near(s.excessKurtosis, e.kurtosis, 1e-8, Math.max(Math.abs(e.kurtosis), 1));
      else expect(s.excessKurtosis).toBeNull();
    });
  }
});

describe("histograms vs numpy.histogram (edges and counts)", () => {
  for (const c of data.numeric.filter((x) => x.hist.length > 0)) {
    it(c.name, () => {
      const store = storeFor(c.cells);
      const valid = store.validValues("x");
      for (const ref of c.hist) {
        const h = buildHistogram("x", valid, { missingCount: 0, invalidCount: 0 }, { method: ref.method, bins: ref.bins });
        expect(h.appliedMethod, `${ref.method} applied`).toBe(ref.method);
        expect(h.binCount, `${ref.method} bin count`).toBe(ref.bins);
        expect(h.bins.map((b) => b.count), `${ref.method} counts`).toEqual(ref.counts);
        h.bins.forEach((b, i) => {
          near(b.start, ref.edges[i], 1e-12, Math.max(Math.abs(ref.edges[i]), Math.abs(ref.edges[ref.edges.length - 1] - ref.edges[0])));
          near(b.end, ref.edges[i + 1], 1e-12, Math.max(Math.abs(ref.edges[i + 1]), Math.abs(ref.edges[ref.edges.length - 1] - ref.edges[0])));
        });
        expect(h.bins.reduce((a, b) => a + b.count, 0)).toBe(valid.length);
      }
    });
  }
});

describe("outlier rows vs numpy", () => {
  for (const c of data.numeric.filter((x) => Object.keys(x.outliers).length > 0)) {
    it(c.name, () => {
      const col = storeFor(c.cells).numeric("x");
      const input = { column: "x", values: col.values, missingCount: col.missingCount, invalidCount: col.invalidCount };
      for (const [key, rows] of Object.entries(c.outliers)) {
        const params = key.startsWith("iqr")
          ? ({ method: "iqr", multiplier: Number(key.slice(3)) } as const)
          : key.startsWith("mz")
            ? ({ method: "modified-zscore", threshold: Number(key.slice(2)) } as const)
            : ({ method: "zscore", threshold: Number(key.slice(1)) } as const);
        expect(detectOutliers(input, params).rowIndices, key).toEqual(rows);
      }
    });
  }
});

describe("correlation (pairwise complete) vs scipy", () => {
  for (const set of data.correlation) {
    for (const method of ["pearson", "spearman"] as const) {
      it(`${set.name} ${method}`, () => {
        const rows = set.cells[0].map((_, i) => Object.fromEntries(set.names.map((n, j) => [n, set.cells[j][i]])));
        const store = new ColumnStore(rows, set.names.map((name) => ({ name, dataType: "decimal" as const })));
        const result = correlationMatrix({ names: set.names, columns: set.names.map((n) => store.numeric(n)), method });
        expect(result.features).toEqual(set.names);
        for (const [key, ref] of Object.entries(set.pairs)) {
          const [i, j] = key.split(",").map(Number);
          const cell = result.cells[i][j];
          expect(cell.n, `${key} paired n`).toBe(ref.n);
          const expected = method === "pearson" ? ref.pearson : ref.spearman;
          if (expected === null) expect(cell.r, `${key} undefined`).toBeNull();
          else near(cell.r, expected, 1e-10, 1);
          expect(result.cells[j][i]).toBe(cell); // symmetric
        }
      });
    }
  }
});

describe("KS distance and Cramér's V vs scipy", () => {
  data.ks.forEach((c, i) => {
    it(`KS ${i}`, () => {
      const a = Float64Array.from(c.a).sort();
      const b = Float64Array.from(c.b).sort();
      near(ksDistance(a, b), c.d, 1e-12, 1);
      near(ksDistance(b, a), c.d, 1e-12, 1);
    });
  });
  data.cramers.forEach((c, i) => {
    it(`Cramér's V ${i}`, () => {
      if (c.v === null) expect(cramersV(c.x, c.y)).toBeNull();
      else near(cramersV(c.x, c.y), c.v, 1e-10, 1);
    });
  });
});

describe("class imbalance vs counted labels", () => {
  data.imbalance.forEach((c, i) => {
    it(`case ${i}`, () => {
      const r = analyzeClassImbalance("t", c.labels);
      expect(r.validCount).toBe(c.counts.reduce((a, b) => a + b, 0));
      expect(r.missingCount).toBe(2);
      expect(r.classCount).toBe(c.counts.length);
      if (c.ratio === null) expect(r.ratio).toBeNull();
      else near(r.ratio, c.ratio, 1e-12);
      expect(r.classes.reduce((a, b) => a + b.count, 0)).toBe(r.validCount);
      expect(r.classes.reduce((a, b) => a + b.percentage, 0)).toBeCloseTo(100, 9);
    });
  });
});


describe("date distributions vs Python datetime", () => {
  for (const c of data.dates) {
    it(c.name, () => {
      const d = buildDateDistribution("d", c.cells);
      expect(d.missingCount).toBe(c.missing);
      expect(d.ambiguousFormat).toBe(c.ambiguous);
      expect(d.validCount).toBe(c.valid);
      if (c.valid === 0) {
        expect(d.byMonth).toBeNull();
        return;
      }
      expect(Object.fromEntries(d.byYear.map((p) => [p.label, p.count]))).toEqual(c.years);
      expect(d.byMonth?.map((p) => p.count)).toEqual(c.months);
      expect(d.byDay?.map((p) => p.count)).toEqual(c.days);
      expect(d.earliest).toBe(c.earliest);
      expect(d.latest).toBe(c.latest);
      expect(d.spanDays).toBe(c.span);
      expect(d.timeline.reduce((a, p) => a + p.count, 0)).toBe(c.valid);
    });
  }
});
