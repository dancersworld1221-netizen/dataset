import { describe, it, expect } from "vitest";
import { detectOutliers, detectOutliersAllMethods, MIN_OUTLIER_SAMPLE } from "@/lib/analytics/outliers";

const input = (values: Array<number | null>, extra: { missingCount?: number; invalidCount?: number } = {}) => ({
  column: "x",
  values: Float64Array.from(values.map((v) => (v === null ? NaN : v))),
  missingCount: extra.missingCount ?? values.filter((v) => v === null).length,
  invalidCount: extra.invalidCount ?? 0,
});

// 20 ordinary values plus two extremes.
const base = [10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20];

describe("IQR method", () => {
  // numpy.percentile([...base, 40, -20], [25, 75]) = [13, 18]; IQR = 5; fences = [5.5, 25.5]
  it("flags values outside Q1 - 1.5 IQR and Q3 + 1.5 IQR", () => {
    const r = detectOutliers(input([...base, 40, -20]), { method: "iqr" });
    expect(r.kind).toBe("statistical-outliers");
    expect(r.outlierCount).toBe(2);
    expect(r.rowIndices).toEqual([20, 21]);
    expect(r.highCount).toBe(1);
    expect(r.lowCount).toBe(1);
    expect(r.examples.map((e) => [e.rowNumber, e.value, e.direction])).toEqual([[21, 40, "high"], [22, -20, "low"]]);
    expect(r.outlierPercentage).toBeCloseTo((2 / 22) * 100, 10);
  });

  it("matches the numpy quartile fences exactly", () => {
    const r = detectOutliers(input([...base, 40, -20]), { method: "iqr" });
    expect(r.lowerBound).toBeCloseTo(5.5, 12);
    expect(r.upperBound).toBeCloseTo(25.5, 12);
  });

  it("does not flag a value just inside the fence", () => {
    expect(detectOutliers(input([...base, 25]), { method: "iqr" }).outlierCount).toBe(0); // 25 < 25.5
    expect(detectOutliers(input([...base, 26]), { method: "iqr" }).outlierCount).toBe(1); // 26 > 25.5
  });

  it("lets the user adjust the multiplier", () => {
    // 30 lies above the k = 1.5 fence (25.5) but inside the k = 3 fence (33); numpy-verified.
    const strict = detectOutliers(input([...base, 30]), { method: "iqr", multiplier: 1.5 });
    const loose = detectOutliers(input([...base, 30]), { method: "iqr", multiplier: 3 });
    expect(strict.outlierCount).toBe(1);
    expect(loose.outlierCount).toBe(0);
    expect(loose.params.multiplier).toBe(3);
  });

  it("never touches the input and skips missing values", () => {
    const original = input([...base, 99, null, null]);
    const before = Array.from(original.values);
    const r = detectOutliers(original, { method: "iqr" });
    expect(Array.from(original.values).map(String)).toEqual(before.map(String));
    expect(r.validCount).toBe(21);
    expect(r.missingCount).toBe(2);
    expect(r.rowIndices).toEqual([20]);
  });

  it("is explicit that a statistical outlier is not necessarily an error", () => {
    const r = detectOutliers(input([...base, 99]), { method: "iqr" });
    expect(r.limitations.join(" ")).toContain("not necessarily an error");
    expect(r.explanation).toContain("Q1");
  });

  it("handles a zero IQR: different values are rare values, not statistical outliers", () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 3];
    const r = detectOutliers(input(values), { method: "iqr" });
    expect(r.kind).toBe("rare-values");
    expect(r.lowerBound).toBe(0);
    expect(r.upperBound).toBe(0);
    expect(r.rowIndices).toEqual([10, 11]);
    expect(r.zeroInflated).toBe(true);
    expect(r.notes.join(" ")).toContain("IQR is 0");
    expect(r.notes.join(" ")).toContain("zero-inflated");
  });

  it("can judge a zero-inflated column on its non-zero values only", () => {
    // 30 zeros (79%) + 8 non-zero values: Q1 = Q3 = 0, so the plain IQR fences collapse onto 0.
    const values = [...Array(30).fill(0), 10, 11, 12, 13, 14, 15, 16, 400];
    const naive = detectOutliers(input(values), { method: "iqr" });
    expect(naive.kind).toBe("rare-values");
    expect(naive.outlierCount).toBe(8); // every non-zero value looks "different"
    // On the non-zero values numpy gives fences [6.5, 20.5] (Q1 11.75, Q3 15.25): only 400 is flagged.
    const aware = detectOutliers(input(values), { method: "iqr", ignoreZeros: true });
    expect(aware.kind).toBe("statistical-outliers");
    expect(aware.rowIndices).toEqual([37]);
    expect(aware.lowerBound).toBeCloseTo(6.5, 12);
    expect(aware.upperBound).toBeCloseTo(20.5, 12);
    expect(aware.notes.join(" ")).toContain("Zeros");
  });

  it("does nothing for constant columns and tiny samples", () => {
    const constant = detectOutliers(input([5, 5, 5, 5, 5, 5, 5]), { method: "iqr" });
    expect(constant.outlierCount).toBe(0);
    const tiny = detectOutliers(input([1, 2, 100]), { method: "iqr" });
    expect(tiny.kind).toBe("not-applicable");
    expect(tiny.outlierCount).toBe(0);
    expect(tiny.notes.join(" ")).toContain(String(MIN_OUTLIER_SAMPLE));
  });

  it("reports invalid values separately from outliers", () => {
    const r = detectOutliers(input([...base, 99], { invalidCount: 3 }), { method: "iqr" });
    expect(r.invalidCount).toBe(3);
    expect(r.notes.join(" ")).toContain("invalid");
    expect(r.outlierCount).toBe(1);
  });
});

describe("Z-score method", () => {
  it("flags |z| above the threshold using the sample standard deviation", () => {
    // 30 values 10..39 plus 200: numpy z(200) = 5.1958; every other |z| is below 0.62.
    const values = Array.from({ length: 30 }, (_, i) => 10 + i).concat([200]);
    const r = detectOutliers(input(values), { method: "zscore" });
    expect(r.rowIndices).toEqual([30]);
    expect(r.examples[0].score).toBeGreaterThan(3);
    expect(r.params.threshold).toBe(3);
  });

  it("supports a configurable threshold", () => {
    const values = Array.from({ length: 30 }, (_, i) => 10 + i).concat([60]);
    // numpy: z(60) = 3.1957 for 10..39 plus 60.
    expect(detectOutliers(input(values), { method: "zscore", threshold: 3 }).outlierCount).toBe(1);
    expect(detectOutliers(input(values), { method: "zscore", threshold: 4 }).outlierCount).toBe(0);
  });

  it("is undefined (and safe) when the standard deviation is zero", () => {
    const r = detectOutliers(input([4, 4, 4, 4, 4, 4]), { method: "zscore" });
    expect(r.kind).toBe("not-applicable");
    expect(r.outlierCount).toBe(0);
    expect(r.notes.join(" ")).toContain("standard deviation is 0");
  });

  it("warns when a small sample can never reach the threshold", () => {
    // n = 8: max possible |z| = (8 - 1) / sqrt(8) = 2.4749 (numpy), so a threshold of 3 is unreachable.
    const r = detectOutliers(input([1, 1, 1, 1, 1, 1, 1, 1000]), { method: "zscore", threshold: 3 });
    expect(r.outlierCount).toBe(0);
    expect(r.notes.join(" ")).toContain("2.47");
  });
});

describe("modified Z-score method", () => {
  it("matches numpy/scipy scores (0.6745 * (x - median) / MAD)", () => {
    // [10,11,12,12,13,13,14,15,100]: median 13, MAD 1 -> modified z of 100 is 58.6815
    const r = detectOutliers(input([10, 11, 12, 12, 13, 13, 14, 15, 100]), { method: "modified-zscore" });
    expect(r.rowIndices).toEqual([8]);
    expect(r.examples[0].score).toBeCloseTo(58.6815, 4);
    expect(r.params.threshold).toBe(3.5);
  });

  it("falls back to the mean absolute deviation when the MAD is 0 and says so", () => {
    const r = detectOutliers(input([5, 5, 5, 5, 5, 5, 5, 5, 9]), { method: "modified-zscore" });
    expect(r.kind).toBe("rare-values");
    expect(r.notes.join(" ")).toContain("MAD is 0");
    expect(r.rowIndices).toEqual([8]);
  });

  it("is not applicable for constant columns", () => {
    const r = detectOutliers(input([2, 2, 2, 2, 2, 2]), { method: "modified-zscore" });
    expect(r.kind).toBe("not-applicable");
  });
});

describe("outlier overview", () => {
  it("lists rows flagged by at least two methods as potential anomalies", () => {
    // numpy IQR fences for this data are [95, 111]; 400 is far beyond all three methods' limits.
    const values = Array.from({ length: 40 }, (_, i) => 100 + (i % 7)).concat([400]);
    const o = detectOutliersAllMethods(input(values));
    expect(o.iqr.rowIndices).toContain(40);
    expect(o.consensusRowIndices).toEqual([40]);
  });
});
