import { describe, it, expect } from "vitest";
import { computeNumericSummary, quantileSorted, compensatedSum, sortedCopy } from "@/lib/analytics/numeric";
import { ColumnStore } from "@/lib/analytics/columnStore";
import { parseNumber } from "@/lib/profiling/typeInference";

const summarize = (values: number[], meta = { totalRows: values.length, missingCount: 0, invalidCount: 0 }) =>
  computeNumericSummary("x", Float64Array.from(values), meta);

// Expected values below were computed independently with numpy / scipy.stats.
describe("computeNumericSummary", () => {
  it("matches numpy/scipy on [2,4,4,4,5,5,7,9]", () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.count).toBe(8);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
    expect(s.range).toBe(7);
    expect(s.sum).toBe(40);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.modes).toEqual([4]);
    expect(s.modeFrequency).toBe(3);
    expect(s.variance).toBeCloseTo(4.571428571428571, 12); // sample, n - 1
    expect(s.populationVariance).toBe(4); // population, n
    expect(s.stdDev).toBeCloseTo(2.138089935299395, 12);
    expect(s.populationStdDev).toBe(2);
    expect([s.q1, s.q2, s.q3]).toEqual([4, 4.5, 5.5]);
    expect(s.iqr).toBe(1.5);
    expect(s.mad).toBe(0.5);
    expect(s.coefficientOfVariation).toBeCloseTo(0.427617987059879, 12);
    expect(s.skewness).toBeCloseTo(0.8184875533567996, 10);
    expect(s.excessKurtosis).toBeCloseTo(0.9406249999999998, 10);
  });

  it("handles negative and decimal values (numpy/scipy reference)", () => {
    const s = summarize([-3.5, -1.25, 0, 0.5, 2.75, 10.125]);
    expect(s.mean).toBeCloseTo(1.4375, 12);
    expect(s.variance).toBeCloseTo(22.3484375, 10);
    expect(s.q1).toBeCloseTo(-0.9375, 12);
    expect(s.median).toBeCloseTo(0.25, 12);
    expect(s.q3).toBeCloseTo(2.1875, 12);
    expect(s.mad).toBe(2);
    expect(s.skewness).toBeCloseTo(1.4605358459491462, 10);
    expect(s.excessKurtosis).toBeCloseTo(2.6506249817640937, 10);
    expect(s.zeroCount).toBe(1);
    expect(s.positiveCount).toBe(3);
    expect(s.negativeCount).toBe(2);
    // Small samples are flagged as unstable.
    expect(s.warnings.join(" ")).toContain("unstable");
  });

  it("returns no mode when every value is unique", () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.modes).toEqual([]);
    expect(s.modeFrequency).toBe(0);
  });

  it("reports every mode of a multimodal sample", () => {
    expect(summarize([1, 1, 2, 2, 3]).modes).toEqual([1, 2]);
  });

  it("handles an empty column without NaN", () => {
    const s = summarize([], { totalRows: 5, missingCount: 3, invalidCount: 2 });
    expect(s.count).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.variance).toBeNull();
    expect(s.missingCount).toBe(3);
    expect(s.invalidCount).toBe(2);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it("handles a single observation: spread statistics are undefined, not 0", () => {
    const s = summarize([42]);
    expect(s.mean).toBe(42);
    expect(s.median).toBe(42);
    expect(s.populationVariance).toBe(0);
    expect(s.variance).toBeNull();
    expect(s.stdDev).toBeNull();
    expect(s.skewness).toBeNull();
    expect(s.excessKurtosis).toBeNull();
  });

  it("handles constant columns safely", () => {
    const s = summarize([7, 7, 7, 7, 7]);
    expect(s.variance).toBe(0);
    expect(s.stdDev).toBe(0);
    expect(s.iqr).toBe(0);
    expect(s.mad).toBe(0);
    expect(s.coefficientOfVariation).toBe(0);
    expect(s.skewness).toBeNull();
    expect(s.excessKurtosis).toBeNull();
    expect(s.modes).toEqual([7]);
    expect(s.warnings.join(" ")).toContain("Constant column");
  });

  it("does not compute a coefficient of variation when the mean is 0", () => {
    const s = summarize([-1, 1, -2, 2]);
    expect(s.mean).toBe(0);
    expect(s.coefficientOfVariation).toBeNull();
  });

  it("requires 3 values for skewness and 4 for kurtosis", () => {
    expect(summarize([1, 2]).skewness).toBeNull();
    expect(summarize([1, 2, 4]).skewness).not.toBeNull();
    expect(summarize([1, 2, 4]).excessKurtosis).toBeNull();
    expect(summarize([1, 2, 4, 9]).excessKurtosis).not.toBeNull();
  });

  it("handles very large values without losing the mean to overflow", () => {
    const s = summarize([1e308, 1e308, 1e308]);
    expect(s.sum).toBeNull(); // 3e308 overflows
    expect(s.mean).toBeCloseTo(1e308, -300);
    expect(s.warnings.join(" ")).toContain("overflow");
    expect(Number.isNaN(s.mean as number)).toBe(false);
  });

  it("stays accurate for a large offset (numerically stable variance)", () => {
    const s = summarize([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]);
    expect(s.variance).toBeCloseTo(30, 6); // numpy: np.var([4,7,13,16], ddof=1) == 30
  });
});

describe("quantiles and helpers", () => {
  it("uses linear interpolation (type 7)", () => {
    const sorted = Float64Array.from([1, 2, 3, 4]);
    expect(quantileSorted(sorted, 0.25)).toBe(1.75); // numpy.percentile([1,2,3,4], 25)
    expect(quantileSorted(sorted, 0.5)).toBe(2.5);
    expect(quantileSorted(sorted, 0.75)).toBe(3.25);
    expect(quantileSorted(sorted, 0)).toBe(1);
    expect(quantileSorted(sorted, 1)).toBe(4);
  });
  it("sorts numerically, not lexicographically", () => {
    expect(Array.from(sortedCopy([10, 9, 100, 1]))).toEqual([1, 9, 10, 100]);
  });
  it("compensated sum beats naive summation", () => {
    const values = [1e16, 1, -1e16, 1];
    expect(compensatedSum(values)).toBe(2);
  });
});

describe("classification of missing, invalid and valid cells", () => {
  const rows = ["1", "2.5", "", "N/A", "abc", "Infinity", "NaN", "1e999", "9".repeat(400) + ".5", "-3", "  7  "].map((v) => ({ c: v }));
  const store = new ColumnStore(rows, [{ name: "c", dataType: "decimal" }]);
  const col = store.numeric("c");
  it("counts each cell exactly once", () => {
    expect(col.validCount + col.missingCount + col.invalidCount).toBe(rows.length);
    expect(col.validCount).toBe(4); // 1, 2.5, -3, 7
    // "", "N/A" and "NaN" are missing-value markers (the app-wide missing policy).
    expect(col.missingCount).toBe(3);
    expect(col.invalidCount).toBe(4); // abc, Infinity, 1e999, overflowing decimal
  });
  it("never lets NaN or Infinity into the valid values", () => {
    const valid = Array.from(store.validValues("c"));
    expect(valid.sort((a, b) => a - b)).toEqual([-3, 1, 2.5, 7]);
    expect(parseNumber("1e999")).toBeNull();
  });
});

describe("number formats are interpreted consistently per column", () => {
  const read = (cells: string[]) => {
    const store = new ColumnStore(cells.map((c) => ({ c })), [{ name: "c", dataType: "decimal" }]);
    const col = store.numeric("c");
    return { values: Array.from(col.values), invalid: col.invalidCount, notes: col.notes };
  };

  it("reads decimal commas", () => {
    expect(read(["3,5", "4,25", "10,0"]).values).toEqual([3.5, 4.25, 10]);
  });

  it("reads European thousands dots with a decimal comma", () => {
    expect(read(["1.234,56", "2.000,5"]).values).toEqual([1234.56, 2000.5]);
  });

  it("reads an unambiguous thousands column as thousands", () => {
    const r = read(["1,234,567", "12,345.5", "2,000"]);
    expect(r.values).toEqual([1234567, 12345.5, 2000]); // "2,000" follows the column's thousands convention
    expect(r.invalid).toBe(0);
  });

  it('reads "1,234" as a decimal comma when other values in the column use decimal commas', () => {
    const r = read(["1,234", "2,5", "7,25"]);
    expect(r.values).toEqual([1.234, 2.5, 7.25]);
    expect(r.notes.join(" ")).toContain("decimal commas");
  });

  it('reads a column of only "1,234"-style values as thousands and says so (cannot be known)', () => {
    const r = read(["1,234", "2,500", "3,750"]);
    expect(r.values).toEqual([1234, 2500, 3750]);
    expect(r.notes.join(" ")).toContain("1000 times too large");
  });

  it("never mixes conventions silently: minority-format cells become invalid", () => {
    const r = read(["1,234,567", "2,345,678", "12,5"]);
    expect(r.values.slice(0, 2)).toEqual([1234567, 2345678]);
    expect(Number.isNaN(r.values[2])).toBe(true);
    expect(r.invalid).toBe(1);
    expect(r.notes.join(" ")).toContain("mixes thousands separators");
  });

  it("does not change plain numbers, exponents or identifiers", () => {
    const r = read(["12", "-0.5", "1e3", "007", "1.5"]);
    expect(r.values.slice(0, 3)).toEqual([12, -0.5, 1000]);
    expect(Number.isNaN(r.values[3])).toBe(true); // leading-zero identifier
    expect(r.notes).toEqual([]);
  });

  it("passes the note on as a warning of the numeric summary", () => {
    const store = new ColumnStore(["1,234", "2,500"].map((c) => ({ c })), [{ name: "c", dataType: "decimal" }]);
    const col = store.numeric("c");
    const s = computeNumericSummary("c", store.validValues("c"), { totalRows: 2, missingCount: 0, invalidCount: 0, notes: col.notes });
    expect(s.mean).toBe(1867);
    expect(s.warnings.join(" ")).toContain("thousands separators");
  });
});

describe("Persian and Arabic-Indic digits", () => {
  const parse = (t: string) => parseNumber(t)?.value ?? null;
  it("reads numbers written with non-Latin digits", () => {
    expect(parse("۱۲۳")).toBe(123);
    expect(parse("۱۲۳٫۵")).toBe(123.5);
    expect(parse("٣٫١٤")).toBe(3.14);
    expect(parse("۱٬۲۳۴٬۵۶۷")).toBe(1234567);
    expect(parse("-۴۲")).toBe(-42);
    expect(parse("۰۱۲۳")).toBeNull(); // leading zero: an identifier, like with Latin digits
  });
  it("analyses a Persian-digit column", () => {
    const store = new ColumnStore(["۱۰", "۲۰", "۳۰", "۴۰"].map((c) => ({ c })), [{ name: "c", dataType: "integer" }]);
    const s = computeNumericSummary("c", store.validValues("c"), { totalRows: 4, missingCount: 0, invalidCount: 0 });
    expect(s.mean).toBe(25);
    expect(s.median).toBe(25);
  });
});
