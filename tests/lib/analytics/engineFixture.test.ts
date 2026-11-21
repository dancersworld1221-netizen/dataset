import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { parseCsvContent } from "@/lib/csv/csvParser";
import { profileDataset } from "@/lib/profiling/profilingEngine";
import { AnalysisEngine } from "@/lib/analytics/engine";
import { reportToMarkdown } from "@/lib/analytics/report";
import type { NumericSummary } from "@/lib/analytics/types";

// tests/fixtures/phase3.expected.json was produced by tests/fixtures/generate_phase3_fixture.py with
// numpy / scipy, i.e. independently of the application code.
const fixture = (name: string) => readFileSync(resolve(__dirname, "../../fixtures", name), "utf8");
const expected = JSON.parse(fixture("phase3.expected.json"));

let engine: AnalysisEngine;
let types: Record<string, string>;

beforeAll(async () => {
  const parsed = await parseCsvContent(fixture("phase3.csv"));
  const profile = profileDataset(
    { headers: parsed.headers, rows: parsed.rows, rowCount: parsed.rowCount, columnCount: parsed.columnCount, parsingErrors: parsed.errors, parsingWarnings: parsed.warnings },
    "fixture"
  );
  types = Object.fromEntries(profile.columnMetadata.map((c) => [c.name, c.dataType]));
  engine = new AnalysisEngine();
  engine.load({
    datasetKey: "fixture|1",
    headers: parsed.headers,
    rows: parsed.rows,
    columns: profile.columnMetadata.map((c) => ({ name: c.name, dataType: c.dataType })),
  });
});

const close = (actual: number | null, exp: number, digits = 9) => {
  expect(actual).not.toBeNull();
  expect(actual as number).toBeCloseTo(exp, digits);
};

describe("profiling feeds the analytics engine", () => {
  it("detects the column types of the acceptance dataset", () => {
    expect(types).toMatchObject({
      row_id: "integer", age: "integer", income: "integer", debt: "integer", spend: "decimal",
      zero_inflated: "decimal", with_outliers: "integer", dup_age: "integer",
      category: "string", flag: "boolean", signup_date: "date", target: "boolean", // yes/no values are boolean words
    });
  });
});

describe("numeric statistics match numpy/scipy on the acceptance dataset", () => {
  let summaries: Record<string, NumericSummary>;
  beforeAll(async () => {
    const list = await engine.run({ kind: "numericSummary" });
    summaries = Object.fromEntries(list.map((s) => [s.column, s]));
  });

  for (const column of ["age", "income", "with_outliers", "zero_inflated"] as const) {
    it(`${column}`, () => {
      const e = expected[column];
      const s = summaries[column];
      expect(s.count).toBe(e.count);
      expect(s.min).toBe(e.min);
      expect(s.max).toBe(e.max);
      close(s.sum, e.sum, 6);
      close(s.mean, e.mean);
      close(s.median, e.median);
      close(s.variance, e.variance, 6);
      close(s.stdDev, e.stdDev, 8);
      close(s.populationVariance, e.populationVariance, 6);
      close(s.populationStdDev, e.populationStdDev, 8);
      close(s.q1, e.q1);
      close(s.q3, e.q3);
      close(s.iqr, e.iqr);
      close(s.mad, e.mad);
      close(s.coefficientOfVariation, e.cv);
      close(s.skewness, e.skewness, 8);
      close(s.excessKurtosis, e.excessKurtosis, 8);
      expect(s.modes).toEqual(e.modes);
      expect(s.modeFrequency).toBe(e.modeFrequency);
      expect([s.zeroCount, s.positiveCount, s.negativeCount]).toEqual([e.zeroCount, e.positiveCount, e.negativeCount]);
    });
  }

  it("keeps missing, invalid and valid observations apart", () => {
    expect(summaries.age).toMatchObject({ count: 119, invalidCount: 1, missingCount: 0, totalRows: 120 });
    expect(summaries.income).toMatchObject({ count: 117, invalidCount: 0, missingCount: 3 });
  });
});

describe("distributions", () => {
  it("builds the same equal-width histogram as numpy for age (8 bins)", async () => {
    const h = await engine.run({ kind: "histogram", column: "age", method: "fixed", bins: 8 });
    expect(h.bins.map((b) => b.count)).toEqual(expected.age_hist_8.counts);
    h.bins.forEach((b, i) => {
      expect(b.start).toBeCloseTo(expected.age_hist_8.edges[i], 9);
      expect(b.end).toBeCloseTo(expected.age_hist_8.edges[i + 1], 9);
    });
    expect(h.totalIncluded).toBe(119);
    expect(h.bins.reduce((a, b) => a + b.count, 0)).toBe(h.totalIncluded);
    expect(h.missingCount + h.invalidCount).toBe(1);
  });

  it("reports the zero-inflated shape", async () => {
    const h = await engine.run({ kind: "histogram", column: "zero_inflated", method: "auto" });
    expect(h.zeroCount).toBe(expected.zero_inflated.zeroCount);
    expect(h.zeroPercentage).toBeGreaterThan(50);
  });

  it("counts categories like numpy.unique", async () => {
    const f = await engine.run({ kind: "frequency", column: "category" });
    expect(Object.fromEntries(f.categories.map((c) => [c.label, c.count]))).toEqual(expected.category.classes);
    expect(f.missingCount).toBe(expected.category.missing);
    expect(f.uniqueCount).toBe(4);
  });

  it("groups the date column", async () => {
    const d = await engine.run({ kind: "dateDistribution", column: "signup_date" });
    expect(d.validCount).toBe(120);
    expect(d.byYear).toEqual([{ label: "2026", count: 120 }]);
    expect(d.byMonth?.every((m) => m.count === 10)).toBe(true); // 120 rows, 12 months
    expect(d.ambiguousFormat).toBe(false);
  });

  it("summarises categorical and boolean columns", async () => {
    const list = await engine.run({ kind: "categoricalSummary" });
    expect(list.map((c) => c.column).sort()).toEqual(["category", "flag", "target"]);
    const flag = list.find((c) => c.column === "flag")?.frequency;
    expect(flag?.cardinality).toBe("binary");
  });
});

describe("outliers", () => {
  it("finds the two known outliers with every method (numpy rows)", async () => {
    const iqr = await engine.run({ kind: "outliers", column: "with_outliers", params: { method: "iqr" } });
    expect(iqr.rowIndices).toEqual(expected.outliers_iqr_rows);
    close(iqr.lowerBound, expected.outliers_iqr_bounds[0]);
    close(iqr.upperBound, expected.outliers_iqr_bounds[1]);
    expect(iqr.examples.map((e) => e.rowNumber)).toEqual([11, 78]);
    expect(iqr.examples.map((e) => e.value)).toEqual([500, -300]);
    const z = await engine.run({ kind: "outliers", column: "with_outliers", params: { method: "zscore" } });
    expect(z.rowIndices).toEqual(expected.outliers_z_rows);
    const mz = await engine.run({ kind: "outliers", column: "with_outliers", params: { method: "modified-zscore" } });
    expect(mz.rowIndices).toEqual(expected.outliers_modz_rows);
    const all = await engine.run({ kind: "outlierOverview", column: "with_outliers" });
    expect(all.consensusRowIndices).toEqual([10, 77]);
  });

  it("reports the invalid value of age separately", async () => {
    const r = await engine.run({ kind: "outliers", column: "age", params: { method: "iqr" } });
    expect(r.invalidCount).toBe(1);
    expect(r.outlierCount).toBe(0);
  });
});

describe("correlation", () => {
  it("reproduces the known positive, negative and near-zero correlations (scipy)", async () => {
    const pearson = await engine.run({ kind: "correlation", method: "pearson" });
    const cell = (a: string, b: string) => pearson.cells[pearson.features.indexOf(a)][pearson.features.indexOf(b)];
    close(cell("age", "income").r, expected.corr_age_income.pearson, 10);
    expect(cell("age", "income").n).toBe(expected.corr_age_income.n); // pairwise complete: 116
    close(cell("age", "debt").r, expected.corr_age_debt.pearson, 10);
    close(cell("age", "spend").r, expected.corr_age_spend.pearson, 10);
    expect(Math.abs(cell("age", "spend").r as number)).toBeLessThan(0.1);

    const spearman = await engine.run({ kind: "correlation", method: "spearman" });
    const sCell = (a: string, b: string) => spearman.cells[spearman.features.indexOf(a)][spearman.features.indexOf(b)];
    close(sCell("age", "income").r, expected.corr_age_income.spearman, 10);
    close(sCell("age", "debt").r, expected.corr_age_debt.spearman, 10);
  });

  it("leaves identifiers out and says why", async () => {
    const m = await engine.run({ kind: "correlation", method: "pearson" });
    expect(m.features).not.toContain("row_id");
    expect(m.excluded.find((e) => e.name === "row_id")?.reason).toContain("identifier");
    expect(m.strongestPositive[0].r).toBeGreaterThan(0.9);
    expect(m.strongestNegative[0].r).toBeLessThan(-0.9);
  });

  it("returns pair details", async () => {
    const d = await engine.run({ kind: "pairDetail", x: "age", y: "income" });
    expect(d.pairedCount).toBe(116);
    expect(d.points).toHaveLength(116);
  });
});

describe("class imbalance, relationships, comparison and report", () => {
  it("measures the imbalanced target", async () => {
    const r = await engine.run({ kind: "classImbalance", target: "target" });
    expect(Object.fromEntries(r.classes.map((c) => [c.label, c.count]))).toEqual(expected.target.classes);
    expect(r.ratio).toBe(expected.target.ratio);
    expect(r.severity).toBe("moderate");
  });

  it("finds the exact duplicate feature and the correlated ones separately", async () => {
    const rel = await engine.run({ kind: "relationships" });
    expect(rel.exactDuplicates).toEqual([{ columns: ["age", "dup_age"] }]);
    const names = rel.highlyCorrelated.map((p) => [p.a, p.b].sort().join("/"));
    expect(names).toContain("age/income");
    expect(names).toContain("age/debt");
    expect(names).not.toContain("age/dup_age"); // exact duplicates are not "statistically similar"
  });

  it("compares selected features", async () => {
    const c = await engine.run({ kind: "compare", columns: ["age", "dup_age", "debt"] });
    expect(c.pairs.find((p) => p.a === "age" && p.b === "dup_age")?.exactDuplicate).toBe(true);
    await expect(engine.run({ kind: "compare", columns: ["age"] })).rejects.toThrow("at least two");
  });

  it("generates a deterministic analytical report", async () => {
    const meta = { datasetId: "fixture", filename: "phase3.csv", version: "1", completenessPercentage: null, truncated: false };
    const a = await engine.run({ kind: "report", target: "target", meta });
    const b = await engine.run({ kind: "report", target: "target", meta });
    expect(a).toEqual(b);
    expect(a.overview).toMatchObject({ rows: 120, columns: 12, numericColumns: 8, categoricalColumns: 3, dateColumns: 1 });
    expect(a.classImbalance?.ratio).toBe(9);
    expect(a.redundancy.exactDuplicates).toEqual([{ columns: ["age", "dup_age"] }]);
    expect(a.outliers.find((o) => o.column === "with_outliers")?.count).toBe(2);
    expect(a.strongCorrelations.length).toBeGreaterThan(0);
    expect(a.warnings.some((w) => w.message.includes("not valid numbers"))).toBe(true);
    const md = reportToMarkdown(a);
    expect(md).toContain("# Analytical report: phase3.csv");
    expect(md).toContain("Class imbalance");
    expect(md).toContain("Correlation does not imply causation");
  });

  it("rejects requests for the wrong column type", async () => {
    await expect(engine.run({ kind: "histogram", column: "category", method: "auto" })).rejects.toThrow("not a numeric column");
    await expect(engine.run({ kind: "dateDistribution", column: "age" })).rejects.toThrow("not a date column");
    await expect(engine.run({ kind: "frequency", column: "nope" })).rejects.toThrow("Unknown column");
  });
});
