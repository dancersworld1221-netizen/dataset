import { describe, it, expect } from "vitest";
import { analyzeClassImbalance, imbalanceSeverity } from "@/lib/analytics/categorical";
import { ColumnStore } from "@/lib/analytics/columnStore";
import { compareFeatures, cramersV, findExactDuplicateColumns, findSimilarDistributions, ksDistance } from "@/lib/analytics/relationships";
import type { ColumnInfo } from "@/lib/analytics/types";

const repeat = (label: string, n: number) => Array<string>(n).fill(label);

describe("class imbalance", () => {
  it("analyses a binary target (ratio = majority / minority)", () => {
    const r = analyzeClassImbalance("y", [...repeat("no", 90), ...repeat("yes", 10)]);
    expect(r.classCount).toBe(2);
    expect(r.majority).toMatchObject({ label: "no", count: 90 });
    expect(r.minority).toMatchObject({ label: "yes", count: 10 });
    expect(r.majority?.percentage).toBeCloseTo(90, 10);
    expect(r.ratio).toBe(9);
    expect(r.severity).toBe("moderate");
    expect(r.definition).toContain("majority class / size of the minority class");
  });

  it("maps ratios to severities with documented thresholds", () => {
    expect(imbalanceSeverity(1)).toBe("balanced");
    expect(imbalanceSeverity(1.5)).toBe("balanced");
    expect(imbalanceSeverity(1.51)).toBe("mild");
    expect(imbalanceSeverity(3)).toBe("mild");
    expect(imbalanceSeverity(10)).toBe("moderate");
    expect(imbalanceSeverity(10.1)).toBe("severe");
    expect(imbalanceSeverity(100)).toBe("severe");
    expect(imbalanceSeverity(101)).toBe("extreme");
  });

  it("handles a highly imbalanced target", () => {
    const r = analyzeClassImbalance("y", [...repeat("ok", 999), "fraud"]);
    expect(r.ratio).toBe(999);
    expect(r.severity).toBe("extreme");
    expect(r.warnings.join(" ")).toContain("Severe imbalance");
  });

  it("handles single-class and empty targets without a ratio", () => {
    const single = analyzeClassImbalance("y", repeat("a", 5));
    expect(single.severity).toBe("single-class");
    expect(single.ratio).toBeNull();
    expect(single.suitableAsTarget).toBe(false);
    const empty = analyzeClassImbalance("y", ["", "N/A", ""]);
    expect(empty.severity).toBe("empty");
    expect(empty.majority).toBeNull();
  });

  it("excludes missing target values and reports them", () => {
    const r = analyzeClassImbalance("y", ["a", "a", "b", "", "N/A", "a"]);
    expect(r.missingCount).toBe(2);
    expect(r.validCount).toBe(4);
    expect(r.majority?.percentage).toBeCloseTo(75, 10);
    expect(r.ratio).toBe(3);
    expect(r.warnings.join(" ")).toContain("no target value");
  });

  it("supports multi-class targets and warns about unsuitable (very high-cardinality) targets", () => {
    const multi = analyzeClassImbalance("y", [...repeat("a", 6), ...repeat("b", 3), "c"]);
    expect(multi.classCount).toBe(3);
    expect(multi.ratio).toBe(6);
    expect(multi.minority?.label).toBe("c");
    const ids = analyzeClassImbalance("y", Array.from({ length: 80 }, (_, i) => `id${i}`));
    expect(ids.suitableAsTarget).toBe(false);
    expect(ids.classesTruncated).toBe(true);
    expect(ids.warnings.join(" ")).toContain("distinct values");
  });

  it("breaks majority ties alphabetically and never invents a target", () => {
    const r = analyzeClassImbalance("y", ["b", "a", "b", "a"]);
    expect(r.majority?.label).toBe("a");
    expect(r.ratio).toBe(1);
    expect(r.severity).toBe("balanced");
  });
});

const columns: ColumnInfo[] = [
  { name: "a", dataType: "integer" },
  { name: "b", dataType: "integer" },
  { name: "a_copy", dataType: "integer" },
  { name: "shifted", dataType: "integer" },
  { name: "cat", dataType: "string" },
  { name: "cat2", dataType: "string" },
];
const n = 60;
const rows = Array.from({ length: n }, (_, i) => ({
  a: String(i + 1),
  b: String(2 * (i + 1) + 1),
  a_copy: String(i + 1),
  shifted: String(i + 1 + 1000),
  cat: i % 2 === 0 ? "x" : "y",
  cat2: i % 2 === 0 ? "p" : "q",
}));
const store = new ColumnStore(rows, columns);

describe("exact duplicate columns vs statistical similarity", () => {
  it("finds identical columns and nothing statistical", () => {
    const groups = findExactDuplicateColumns(store, columns.map((c) => c.name));
    expect(groups).toEqual([{ columns: ["a", "a_copy"] }]); // b is perfectly correlated but NOT identical
  });

  it("treats trimmed-equal values as identical but different values as different", () => {
    const s = new ColumnStore(
      [{ p: " 1", q: "1", r: "2" }, { p: "2 ", q: "2", r: "1" }],
      ["p", "q", "r"].map((name) => ({ name, dataType: "integer" as const }))
    );
    expect(findExactDuplicateColumns(s, ["p", "q", "r"])).toEqual([{ columns: ["p", "q"] }]);
  });

  it("is not fooled by value boundaries", () => {
    const s = new ColumnStore(
      [{ p: "ab", q: "a" }, { p: "c", q: "bc" }],
      ["p", "q"].map((name) => ({ name, dataType: "string" as const }))
    );
    expect(findExactDuplicateColumns(s, ["p", "q"])).toEqual([]);
  });

  it("matches scipy's two-sample KS distance (0.2 for 1..40 vs 9..48)", () => {
    const u = Float64Array.from({ length: 40 }, (_, i) => i + 1);
    const v = Float64Array.from({ length: 40 }, (_, i) => i + 9);
    expect(ksDistance(u, v)).toBeCloseTo(0.2, 12);
    expect(ksDistance(u, u)).toBe(0);
  });

  it("reports similar distributions only for large enough samples and skips exact duplicates", () => {
    const u = Float64Array.from({ length: 40 }, (_, i) => i);
    const tiny = Float64Array.from([1, 2, 3]);
    const out = findSimilarDistributions(
      [{ name: "u1", sorted: u }, { name: "u2", sorted: u }, { name: "tiny", sorted: tiny }, { name: "dup", sorted: u }],
      0.05,
      new Set(["u1\u0000dup"])
    );
    expect(out.pairs.map((p) => `${p.a}/${p.b}`)).toEqual(["u1/u2", "u2/dup"]);
    expect(out.pairs.every((p) => p.ksDistance === 0)).toBe(true);
  });
});

describe("feature comparison", () => {
  it("compares two numeric features with correlation and distribution distance", () => {
    const c = compareFeatures(store, ["a", "b"]);
    expect(c.items).toHaveLength(2);
    expect(c.items[0].numeric?.mean).toBeCloseTo(30.5, 12);
    expect(c.pairs).toHaveLength(1);
    expect(c.pairs[0].kind).toBe("numeric");
    expect(c.pairs[0].exactDuplicate).toBe(false);
    expect(c.pairs[0].pearson?.r).toBeCloseTo(1, 12);
    expect(c.pairs[0].ksDistance).toBeGreaterThan(0.05);
  });

  it("flags exact duplicates among three or more selected features", () => {
    const c = compareFeatures(store, ["a", "b", "a_copy"]);
    expect(c.pairs).toHaveLength(3);
    expect(c.pairs.find((p) => p.a === "a" && p.b === "a_copy")?.exactDuplicate).toBe(true);
    expect(c.pairs.find((p) => p.a === "a" && p.b === "b")?.exactDuplicate).toBe(false);
  });

  it("uses Cramér's V for categorical pairs (scipy: 0.6 for [[20,5],[5,20]])", () => {
    const a = [...repeat("x", 25), ...repeat("y", 25)];
    const b = [...repeat("p", 20), ...repeat("q", 5), ...repeat("p", 5), ...repeat("q", 20)];
    expect(cramersV(a, b)).toBeCloseTo(0.6, 12);
    expect(cramersV(["x", "x"], ["p", "q"])).toBeNull();
    const c = compareFeatures(store, ["cat", "cat2"]);
    expect(c.pairs[0].kind).toBe("categorical");
    expect(c.pairs[0].cramersV).toBeCloseTo(1, 12); // x<->p and y<->q perfectly associated
  });

  it("does not compute coefficients for mixed feature types", () => {
    const c = compareFeatures(store, ["a", "cat"]);
    expect(c.pairs[0].kind).toBe("mixed");
    expect(c.pairs[0].pearson).toBeNull();
  });
});
