import { describe, it, expect } from "vitest";
import {
  buildHistogram,
  buildFrequency,
  buildDateDistribution,
  analyzeDateFormat,
  classifyCardinality,
  sturgesBinCount,
  freedmanDiaconisBinCount,
} from "@/lib/analytics/distribution";

const meta = { missingCount: 0, invalidCount: 0 };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("histogram", () => {
  const data = [1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 15, 20];

  it("uses Freedman-Diaconis and agrees with numpy's bin count and edges", () => {
    // numpy.histogram_bin_edges(data, 'fd') -> 5 bins starting 1.0, 4.8, 8.6, ...
    const h = buildHistogram("x", data, meta, { method: "auto" });
    expect(h.appliedMethod).toBe("freedman-diaconis");
    expect(h.binCount).toBe(5);
    expect(h.bins[0].start).toBe(1);
    expect(h.bins[0].end).toBeCloseTo(4.8, 10);
    expect(h.bins[1].end).toBeCloseTo(8.6, 10);
    expect(h.bins[4].end).toBe(20);
  });

  it("uses Sturges when asked (numpy 'sturges' gives 6 bins)", () => {
    const h = buildHistogram("x", data, meta, { method: "sturges" });
    expect(h.binCount).toBe(6);
    expect(sturgesBinCount(18)).toBe(6);
  });

  it("frequencies always add up to the number of valid observations", () => {
    for (const method of ["auto", "sturges", "freedman-diaconis"] as const) {
      const h = buildHistogram("x", data, meta, { method });
      expect(sum(h.bins.map((b) => b.count))).toBe(data.length);
      expect(h.totalIncluded).toBe(data.length);
      expect(sum(h.bins.map((b) => b.percentage))).toBeCloseTo(100, 9);
    }
    for (const bins of [1, 2, 7, 33, 200]) {
      const h = buildHistogram("x", data, meta, { method: "fixed", bins });
      expect(sum(h.bins.map((b) => b.count))).toBe(data.length);
      expect(h.binCount).toBe(bins);
    }
  });

  it("puts the maximum into the last bin (closed upper edge) and matches numpy counts for fixed bins", () => {
    const h = buildHistogram("x", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], meta, { method: "fixed", bins: 5 });
    // numpy.histogram(range(11), bins=5) -> [2, 2, 2, 2, 3]
    expect(h.bins.map((b) => b.count)).toEqual([2, 2, 2, 2, 3]);
  });

  it("handles constant columns with one bin", () => {
    const h = buildHistogram("x", [5, 5, 5, 5], meta, { method: "auto" });
    expect(h.shape).toBe("constant");
    expect(h.bins).toHaveLength(1);
    expect(h.bins[0].count).toBe(4);
    expect(h.binWidth).toBe(0);
  });

  it("falls back to Sturges for small samples and a zero IQR", () => {
    expect(freedmanDiaconisBinCount(Float64Array.from([1, 2, 3, 4]))).toBeNull();
    const zeroIqr = [0, 0, 0, 0, 0, 0, 0, 0, 9];
    expect(freedmanDiaconisBinCount(Float64Array.from(zeroIqr))).toBeNull();
    const h = buildHistogram("x", zeroIqr, meta, { method: "auto" });
    expect(h.appliedMethod).toBe("sturges");
    expect(h.notes.join(" ")).toContain("Sturges");
  });

  it("handles empty and single-value input", () => {
    const empty = buildHistogram("x", [], { missingCount: 4, invalidCount: 1 }, { method: "auto" });
    expect(empty.bins).toEqual([]);
    expect(empty.shape).toBe("empty");
    expect(empty.missingCount).toBe(4);
    const one = buildHistogram("x", [3], meta, { method: "auto" });
    expect(one.bins[0].count).toBe(1);
  });

  it("reports zero frequency and sign distribution", () => {
    const h = buildHistogram("x", [-2, -1, 0, 0, 0, 1, 2, 3], meta, { method: "auto" });
    expect(h.zeroCount).toBe(3);
    expect(h.zeroPercentage).toBeCloseTo(37.5, 10);
    expect(h.positiveCount).toBe(3);
    expect(h.negativeCount).toBe(2);
  });

  it("caps the bin count at the limit and says so", () => {
    const h = buildHistogram("x", data, meta, { method: "fixed", bins: 5000 });
    expect(h.binCount).toBe(200);
    expect(h.notes.join(" ")).toContain("capped");
  });
});

describe("categorical frequency", () => {
  const raw = ["a", "b", "a", "c", "a", "b", "", "N/A", " a ", "d"];
  const f = buildFrequency("x", raw, { topN: 2, rareThresholdPercentage: 15 });

  it("counts trimmed labels and excludes missing values", () => {
    expect(f.totalRows).toBe(10);
    expect(f.missingCount).toBe(2);
    expect(f.validCount).toBe(8);
    expect(f.uniqueCount).toBe(4);
    expect(f.mostFrequent).toMatchObject({ label: "a", count: 4 });
  });
  it("computes percentages of non-missing values", () => {
    expect(f.mostFrequent?.percentage).toBeCloseTo(50, 10);
    expect(f.categories.map((c) => c.label)).toEqual(["a", "b"]);
    expect(f.categories[1].percentage).toBeCloseTo(25, 10);
  });
  it("groups the tail as Other and reports it", () => {
    expect(f.otherCount).toBe(2);
    expect(f.otherCategoryCount).toBe(2);
    expect(sum(f.categories.map((c) => c.count)) + f.otherCount).toBe(f.validCount);
  });
  it("finds the least frequent and rare categories", () => {
    expect(f.leastFrequent.map((c) => c.label)).toEqual(["c", "d", "b", "a"]);
    expect(f.rareCategories.map((c) => c.label).sort()).toEqual(["c", "d"]); // 12.5% < 15%
  });
  it("classifies cardinality", () => {
    expect(classifyCardinality(0, 0)).toBe("empty");
    expect(classifyCardinality(1, 10)).toBe("constant");
    expect(classifyCardinality(2, 10)).toBe("binary");
    expect(classifyCardinality(8, 100)).toBe("low");
    expect(classifyCardinality(30, 100)).toBe("medium");
    expect(classifyCardinality(80, 100)).toBe("high");
    expect(classifyCardinality(100, 100)).toBe("unique");
  });
  it("supports high-cardinality columns without producing a huge chart", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `id-${i}`);
    const h = buildFrequency("x", many, { topN: 500 });
    expect(h.categories.length).toBe(50); // capped by the limit
    expect(h.cardinality).toBe("unique");
    expect(h.otherCategoryCount).toBe(4950);
    expect(h.notes.join(" ")).toContain("High-cardinality");
  });
});

describe("date distribution", () => {
  it("groups ISO dates by year, month and day and reports the range", () => {
    const d = buildDateDistribution("d", ["2024-01-15", "2024-01-20", "2024-03-02", "2025-01-15", "", "not a date"]);
    expect(d.validCount).toBe(4);
    expect(d.missingCount).toBe(1);
    expect(d.invalidCount).toBe(1);
    expect(d.dayMonthOrder).toBe("iso");
    expect(d.earliest).toBe("2024-01-15");
    expect(d.latest).toBe("2025-01-15");
    expect(d.byYear).toEqual([{ label: "2024", count: 3 }, { label: "2025", count: 1 }]);
    expect(d.byMonth?.find((m) => m.label === "Jan")?.count).toBe(3);
    expect(d.byDay?.find((m) => m.label === "15")?.count).toBe(2);
    expect(d.spanDays).toBe(366);
  });

  it("does not treat ambiguous day/month formats as valid dates", () => {
    expect(analyzeDateFormat(["03/04/2021", "05/06/2021"])).toEqual({ order: null, ambiguous: true });
    const d = buildDateDistribution("d", ["03/04/2021", "05/06/2021"]);
    expect(d.ambiguousFormat).toBe(true);
    expect(d.validCount).toBe(0);
    expect(d.byMonth).toBeNull();
    expect(d.notes.join(" ")).toContain("cannot be determined");
  });

  it("accepts a d/m/yyyy column once a value proves the order", () => {
    expect(analyzeDateFormat(["13/04/2021", "05/06/2021"]).order).toBe("dmy");
    const d = buildDateDistribution("d", ["13/04/2021", "05/06/2021"]);
    expect(d.ambiguousFormat).toBe(false);
    expect(d.validCount).toBe(2);
    expect(d.byMonth?.find((m) => m.label === "Jun")?.count).toBe(1); // 05/06 is 5 June in d/m order
  });

  it("flags conflicting formats as ambiguous", () => {
    expect(analyzeDateFormat(["13/04/2021", "04/13/2021"]).ambiguous).toBe(true);
    expect(analyzeDateFormat(["2021-04-13", "04/05/2021"]).ambiguous).toBe(true);
  });

  it("builds a timeline with a sensible granularity", () => {
    const days = Array.from({ length: 10 }, (_, i) => `2024-02-${String(i + 1).padStart(2, "0")}`);
    expect(buildDateDistribution("d", days).timelineGranularity).toBe("day");
    const months = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}-10`);
    expect(buildDateDistribution("d", months).timelineGranularity).toBe("month");
    const years = ["2001-05-05", "2010-05-05", "2020-05-05"];
    expect(buildDateDistribution("d", years).timelineGranularity).toBe("year");
  });
});

describe("calendars", () => {
  it("reads Gregorian dates written with Persian digits", () => {
    const d = buildDateDistribution("d", ["۲۰۲۴-۰۱-۱۵", "۲۰۲۴-۰۳-۰۲"]);
    expect(d.validCount).toBe(2);
    expect(d.earliest).toBe("2024-01-15");
  });
  it("does not read Solar Hijri (Jalali) dates as Gregorian dates and says so", () => {
    const d = buildDateDistribution("d", ["1402/05/12", "۱۴۰۲/۰۶/۰۱", "1403/01/01"]);
    expect(d.validCount).toBe(0);
    expect(d.invalidCount).toBe(3);
    expect(d.notes.join(" ")).toContain("Jalali");
  });
});
