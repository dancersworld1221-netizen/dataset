import { describe, it, expect } from "vitest";
import {
  correlationMatrix,
  correlationMatrixAsync,
  correlationStrength,
  identifierReason,
  pairDetail,
  pearsonPair,
  rankAverage,
  spearmanPair,
} from "@/lib/analytics/correlation";
import type { NumericColumn } from "@/lib/analytics/columnStore";
import { AnalysisCancelledError } from "@/lib/analytics/types";

const nan = NaN;
const col = (name: string, values: number[]): NumericColumn => {
  const arr = Float64Array.from(values);
  let valid = 0;
  for (const v of arr) if (!Number.isNaN(v)) valid++;
  return { name, values: arr, validCount: valid, missingCount: values.length - valid, invalidCount: 0, invalidSamples: [], notes: [] };
};

describe("Pearson", () => {
  it("is +1 for a perfect positive linear relationship", () => {
    const r = pearsonPair([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]);
    expect(r.r).toBeCloseTo(1, 12);
    expect(r.n).toBe(5);
  });
  it("is -1 for a perfect negative linear relationship", () => {
    expect(pearsonPair([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]).r).toBeCloseTo(-1, 12);
  });
  it("is 0 for uncorrelated data", () => {
    // symmetric parabola: exact linear correlation is 0
    expect(pearsonPair([-2, -1, 0, 1, 2], [4, 1, 0, 1, 4]).r).toBeCloseTo(0, 12);
  });
  it("matches scipy on pairwise complete observations", () => {
    // scipy.stats.pearsonr over the 5 complete pairs: 0.997869111004336
    const r = pearsonPair([1, 2, nan, 4, 5, 6, 7], [2, 4, 6, nan, 10, 12, 15]);
    expect(r.n).toBe(5);
    expect(r.r).toBeCloseTo(0.997869111004336, 12);
  });
  it("is undefined for a constant column (no NaN, no fake 0)", () => {
    const r = pearsonPair([1, 2, 3, 4], [5, 5, 5, 5]);
    expect(r.r).toBeNull();
    expect(r.reason).toBe("constant");
  });
  it("is undefined for fewer than 3 paired observations", () => {
    expect(pearsonPair([1, 2, nan], [2, 4, 6]).reason).toBe("insufficient");
    expect(pearsonPair([1, 2], [3, 4]).r).toBeNull();
  });
  it("never leaves [-1, 1]", () => {
    const r = pearsonPair([0.1, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3, 0.4]).r as number;
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(-1);
  });
});

describe("Spearman", () => {
  it("assigns average ranks to ties", () => {
    // scipy.stats.rankdata([1,2,2,3,4,4,4,5]) -> [1, 2.5, 2.5, 4, 6, 6, 6, 8]
    expect(Array.from(rankAverage([1, 2, 2, 3, 4, 4, 4, 5]))).toEqual([1, 2.5, 2.5, 4, 6, 6, 6, 8]);
  });
  it("matches scipy with tied ranks (0.9200335844703181)", () => {
    const r = spearmanPair([1, 2, 2, 3, 4, 4, 4, 5], [2, 1, 3, 3, 5, 4, 6, 8]);
    expect(r.r).toBeCloseTo(0.9200335844703181, 12);
  });
  it("is 1 for any monotonic relationship, unlike Pearson", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = x.map((v) => v ** 3);
    expect(spearmanPair(x, y).r).toBeCloseTo(1, 12);
    expect(pearsonPair(x, y).r as number).toBeLessThan(0.99);
  });
  it("ranks within the pairwise complete observations", () => {
    // scipy.stats.spearmanr on the 5 complete pairs -> ~1.0
    const r = spearmanPair([1, 2, nan, 4, 5, 6, 7], [2, 4, 6, nan, 10, 12, 15]);
    expect(r.n).toBe(5);
    expect(r.r).toBeCloseTo(1, 12);
  });
  it("is undefined for constant columns and tiny samples", () => {
    expect(spearmanPair([1, 2, 3], [4, 4, 4]).r).toBeNull();
    expect(spearmanPair([1, 2], [1, 2]).reason).toBe("insufficient");
  });
});

describe("correlation matrix", () => {
  const a = col("a", [1, 2, 3, 4, 5, 6, 7, 8]);
  const b = col("b", [2, 4, 6, 8, 10, 12, 14, 16]); // +1 with a
  const c = col("c", [8, 7, 6, 5, 4, 3, 2, 1]); // -1 with a
  const k = col("k", [3, 3, 3, 3, 3, 3, 3, 3]); // constant

  it("reports strongest positive and negative pairs with sample counts", () => {
    const m = correlationMatrix({ names: ["a", "b", "c"], columns: [a, b, c], method: "pearson" });
    expect(m.features).toEqual(["a", "b", "c"]);
    expect(m.cells[0][1].r).toBeCloseTo(1, 12);
    expect(m.cells[0][2].r).toBeCloseTo(-1, 12);
    expect(m.cells[1][0]).toBe(m.cells[0][1]); // symmetric
    expect(m.cells[0][0].r).toBe(1);
    expect(m.cells[0][1].n).toBe(8);
    expect(m.strongestPositive[0]).toMatchObject({ a: "a", b: "b", strength: "very strong", direction: "positive" });
    expect(m.strongestNegative[0]).toMatchObject({ direction: "negative" });
  });

  it("leaves constant columns undefined and explains it", () => {
    const m = correlationMatrix({ names: ["a", "k"], columns: [a, k], method: "pearson" });
    expect(m.cells[0][1].r).toBeNull();
    expect(m.pairs).toHaveLength(0);
    expect(m.warnings.join(" ")).toContain("no coefficient");
  });

  it("excludes columns with too few values and honours pre-excluded identifiers", () => {
    const sparse = col("sparse", [1, nan, nan, nan, nan, nan, nan, 2]);
    const m = correlationMatrix({
      names: ["a", "sparse", "b"],
      columns: [a, sparse, b],
      method: "spearman",
      preExcluded: [{ name: "row_id", reason: "identifier" }],
    });
    expect(m.features).toEqual(["a", "b"]);
    expect(m.excluded.map((e) => e.name)).toEqual(["row_id", "sparse"]);
  });

  it("limits very wide datasets instead of building a huge matrix", () => {
    const names = Array.from({ length: 60 }, (_, i) => `f${i}`);
    const columns = names.map((n, i) => col(n, [1, 2, 3, 4, 5, 6].map((v) => v * (i + 1) + (v % 2))));
    const m = correlationMatrix({ names, columns, method: "pearson" });
    expect(m.features).toHaveLength(40);
    expect(m.excluded).toHaveLength(20);
    expect(m.warnings.join(" ")).toContain("Only 40 of 60");
  });

  it("supports user feature selection", () => {
    const m = correlationMatrix({ names: ["a", "b", "c"], columns: [a, b, c], method: "pearson", selected: ["a", "c"] });
    expect(m.features).toEqual(["a", "c"]);
  });

  it("Spearman matrix agrees with the pairwise function, including missing values", () => {
    const p = col("p", [1, 2, nan, 4, 5, 6, 7]);
    const q = col("q", [2, 4, 6, nan, 10, 12, 15]);
    const m = correlationMatrix({ names: ["p", "q"], columns: [p, q], method: "spearman" });
    expect(m.cells[0][1].n).toBe(5);
    expect(m.cells[0][1].r).toBeCloseTo(spearmanPair(p.values, q.values).r as number, 12);
  });

  it("Spearman matrix equals the standalone pairwise function on tied data with different missing masks", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const make = (name: string, missingRate: number, levels: number) =>
      col(name, Array.from({ length: 400 }, () => (rnd() < missingRate ? nan : Math.floor(rnd() * levels) + rnd() * 0)));
    const cols = [make("p", 0, 7), make("q", 0.2, 5), make("r", 0.35, 50), make("s", 0.1, 3)];
    const m = correlationMatrix({ names: cols.map((c) => c.name), columns: cols, method: "spearman" });
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const direct = spearmanPair(cols[i].values, cols[j].values);
        expect(m.cells[i][j].n).toBe(direct.n);
        expect(m.cells[i][j].r).toBeCloseTo(direct.r as number, 12);
      }
    }
  });

  it("async matrix gives the same result and honours cancellation", async () => {
    const input = { names: ["a", "b", "c"], columns: [a, b, c], method: "pearson" as const };
    const sync = correlationMatrix(input);
    const asyncResult = await correlationMatrixAsync(input, { isCancelled: () => false, yieldToEventLoop: async () => undefined });
    expect(asyncResult.cells.map((r) => r.map((c) => c.r))).toEqual(sync.cells.map((r) => r.map((c) => c.r)));

    let calls = 0;
    await expect(
      correlationMatrixAsync(input, {
        isCancelled: () => ++calls > 1,
        yieldToEventLoop: async () => undefined,
      })
    ).rejects.toBeInstanceOf(AnalysisCancelledError);
  });
});

describe("strength labels and identifiers", () => {
  it("labels |r| ranges", () => {
    expect(correlationStrength(0.05)).toBe("negligible");
    expect(correlationStrength(-0.2)).toBe("weak");
    expect(correlationStrength(0.4)).toBe("moderate");
    expect(correlationStrength(-0.6)).toBe("strong");
    expect(correlationStrength(0.95)).toBe("very strong");
  });
  it("does not correlate identifier columns", () => {
    const seq = col("n", Array.from({ length: 30 }, (_, i) => i + 1));
    expect(identifierReason({ name: "customer_id", dataType: "integer", column: col("x", [1, 5, 9]) })).toContain("identifier");
    expect(identifierReason({ name: "CustomerID", dataType: "integer", column: col("x", [1, 5, 9]) })).toContain("identifier");
    expect(identifierReason({ name: "n", dataType: "integer", column: seq })).toContain("Consecutive");
    expect(identifierReason({ name: "price", dataType: "decimal", column: col("price", [1.5, 2.5, 3.5]) })).toBeNull();
    expect(identifierReason({ name: "paid", dataType: "integer", column: col("paid", [3, 9, 4]) })).toBeNull();
  });
});

describe("pair detail", () => {
  it("returns both coefficients and a deterministic bounded sample", () => {
    const n = 5000;
    const x = col("x", Array.from({ length: n }, (_, i) => i));
    const y = col("y", Array.from({ length: n }, (_, i) => 2 * i + 1));
    const d = pairDetail(x, y);
    expect(d.pairedCount).toBe(n);
    expect(d.points).toHaveLength(1000);
    expect(d.sampled).toBe(true);
    expect(d.pearson.r).toBeCloseTo(1, 12);
    expect(d.spearman.r).toBeCloseTo(1, 12);
    expect(pairDetail(x, y).points).toEqual(d.points);
    expect(d.notes.join(" ")).toContain("causation");
  });
});
