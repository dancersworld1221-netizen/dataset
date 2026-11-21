import { describe, it, expect } from "vitest";
import { AnalysisEngine } from "@/lib/analytics/engine";
import { profileDataset } from "@/lib/profiling/profilingEngine";
import { generateQualityReport } from "@/lib/profiling/dataQuality";
import type { AnalysisRequest, ColumnInfo } from "@/lib/analytics/types";

// Robustness fuzzing: random, deliberately nasty datasets (all-missing, constant, text in numeric columns,
// single rows, ties, ambiguous dates, high cardinality) are run through profiling and EVERY analysis.
// Nothing may throw, no result may contain NaN or Infinity, results must be structured-cloneable (they
// travel through postMessage) and the basic invariants must hold.
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

type Gen = (r: () => number, i: number) => string;
const missing = (r: () => number) => ["", " ", "N/A", "null"][Math.floor(r() * 4)];
const withNoise = (gen: Gen, r: () => number, rateMissing: number, rateBad: number): Gen => (rr, i) => {
  const x = r();
  if (x < rateMissing) return missing(rr);
  if (x < rateMissing + rateBad) return ["abc", "12abc", "1e999", "Infinity", "--"][Math.floor(rr() * 5)];
  return gen(rr, i);
};

const GENERATORS: Array<(r: () => number) => Gen> = [
  (r) => { const mu = (r() - 0.5) * 1e4, sd = 0.001 + r() * 500; return (rr) => String(Math.round((mu + sd * (rr() - 0.5) * 6) * 1e3) / 1e3); },           // decimal
  () => (rr) => String(Math.floor(rr() * 1000)),                                                                                                          // integer
  () => (rr) => String(Math.floor(rr() * 3)),                                                                                                             // 0/1/2 ties
  () => (rr) => (rr() < 0.8 ? "0" : String(Math.round(rr() * 1e4) / 100)),                                                                                 // zero-inflated
  (r) => { const c = String(Math.round(r() * 1e6) / 100); return () => c; },                                                                              // constant
  () => () => "",                                                                                                                                         // all empty
  () => (rr) => ["red", "green", "blue", "yellow"][Math.floor(rr() * 4)],                                                                                 // categorical
  () => (rr, i) => `id-${i}-${Math.floor(rr() * 1e6)}`,                                                                                                   // unique strings
  () => (rr) => (rr() < 0.5 ? "yes" : "no"),                                                                                                              // boolean words
  () => (rr) => `20${10 + Math.floor(rr() * 15)}-${String(1 + Math.floor(rr() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rr() * 28)).padStart(2, "0")}`, // ISO dates
  () => (rr) => `${String(1 + Math.floor(rr() * 12)).padStart(2, "0")}/${String(1 + Math.floor(rr() * 12)).padStart(2, "0")}/2021`,                         // ambiguous dates
  () => (rr) => (rr() < 0.5 ? "3,5" : "1,234"),                                                                                                           // comma numbers
  () => (rr) => String(1e12 + Math.floor(rr() * 1000)),                                                                                                   // big offset
  () => (rr) => String((rr() - 0.5) * 1e-9),                                                                                                              // tiny scale
  () => (rr) => `مقدار ${Math.floor(rr() * 5)}`,                                                                                                          // Persian text
];

function nonFinitePaths(value: unknown, path = "$", out: string[] = []): string[] {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => nonFinitePaths(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) nonFinitePaths(v, `${path}.${k}`, out);
  }
  return out;
}

describe("analysis engine robustness (fuzz)", () => {
  it("never throws, never emits NaN / Infinity and keeps invariants on 250 random datasets", async () => {
    const r = rng(20261115);
    let analyses = 0;
    for (let round = 0; round < 250; round++) {
      const nRows = 1 + Math.floor(r() * (round % 10 === 0 ? 400 : 45));
      const nCols = 1 + Math.floor(r() * 8);
      const names = Array.from({ length: nCols }, (_, j) => `col${j}`);
      const gens = names.map(() => {
        const base = GENERATORS[Math.floor(r() * GENERATORS.length)](r);
        return withNoise(base, r, r() < 0.5 ? 0 : r() * 0.4, r() < 0.6 ? 0 : r() * 0.1);
      });
      const rows = Array.from({ length: nRows }, (_, i) => Object.fromEntries(names.map((n, j) => [n, gens[j](r, i)])));

      const profile = profileDataset({ headers: names, rows, rowCount: nRows, columnCount: nCols, parsingErrors: [], parsingWarnings: [] }, "fz");
      expect(nonFinitePaths(profile.columnMetadata), `profile of round ${round}`).toEqual([]);
      generateQualityReport(profile); // must not throw either

      const columns: ColumnInfo[] = profile.columnMetadata.map((c) => ({ name: c.name, dataType: c.dataType }));
      const engine = new AnalysisEngine();
      engine.load({ datasetKey: "fz|1", headers: names, rows, columns });

      const requests: AnalysisRequest[] = [
        { kind: "numericSummary" },
        { kind: "categoricalSummary" },
        { kind: "correlation", method: "pearson" },
        { kind: "correlation", method: "spearman" },
        { kind: "relationships" },
      ];
      for (const c of columns) {
        if (c.dataType === "integer" || c.dataType === "decimal") {
          requests.push({ kind: "histogram", column: c.name, method: "auto" });
          requests.push({ kind: "histogram", column: c.name, method: "fixed", bins: 1 + Math.floor(r() * 30) });
          requests.push({ kind: "outlierOverview", column: c.name });
          requests.push({ kind: "outliers", column: c.name, params: { method: "iqr", ignoreZeros: true } });
        } else if (c.dataType === "date" || c.dataType === "datetime") {
          requests.push({ kind: "dateDistribution", column: c.name });
        }
        if (c.dataType !== "empty") requests.push({ kind: "frequency", column: c.name, topN: 1 + Math.floor(r() * 60) });
        requests.push({ kind: "classImbalance", target: c.name });
      }
      const numeric = columns.filter((c) => c.dataType === "integer" || c.dataType === "decimal");
      if (numeric.length >= 2) requests.push({ kind: "pairDetail", x: numeric[0].name, y: numeric[1].name });
      const usable = columns.filter((c) => c.dataType !== "empty");
      if (usable.length >= 2) requests.push({ kind: "compare", columns: usable.map((c) => c.name).slice(0, 4) });
      requests.push({
        kind: "report",
        target: columns[Math.floor(r() * columns.length)].name,
        meta: { datasetId: "fz", filename: "fz.csv", version: "1", completenessPercentage: profile.completenessPercentage, truncated: false },
      });

      for (const request of requests) {
        const label = `round ${round}, ${JSON.stringify(request)}`;
        const result = await engine.run(request);
        analyses++;
        expect(nonFinitePaths(result), label).toEqual([]);
        expect(() => structuredClone(result), label).not.toThrow();

        if (request.kind === "histogram") {
          const h = result as Awaited<ReturnType<AnalysisEngine["run"]>> & { bins: Array<{ count: number }>; totalIncluded: number };
          expect(h.bins.reduce((a, b) => a + b.count, 0), label).toBe(h.totalIncluded);
        }
        if (request.kind === "outliers") {
          const o = result as { outlierCount: number; validCount: number; rowIndices: number[] };
          expect(o.outlierCount, label).toBe(o.rowIndices.length);
          expect(o.outlierCount, label).toBeLessThanOrEqual(o.validCount);
        }
        if (request.kind === "correlation") {
          const m = result as { features: string[]; cells: Array<Array<{ r: number | null; n: number }>> };
          m.cells.forEach((row, i) => row.forEach((cell, j) => {
            if (cell.r !== null) expect(Math.abs(cell.r), label).toBeLessThanOrEqual(1);
            expect(m.cells[j][i], label).toBe(cell);
            expect(cell.n, label).toBeLessThanOrEqual(nRows);
          }));
        }
        if (request.kind === "numericSummary") {
          for (const s of result as Array<{ count: number; missingCount: number; invalidCount: number; totalRows: number }>) {
            expect(s.count + s.missingCount + s.invalidCount, label).toBe(s.totalRows);
          }
        }
        if (request.kind === "frequency") {
          const f = result as { validCount: number; missingCount: number; categories: Array<{ count: number }>; otherCount: number; totalRows: number };
          expect(f.validCount + f.missingCount, label).toBe(f.totalRows);
          expect(f.categories.reduce((a, b) => a + b.count, 0) + f.otherCount, label).toBe(f.validCount);
        }
      }
    }
    expect(analyses).toBeGreaterThan(5000);
  }, 120000);
});
