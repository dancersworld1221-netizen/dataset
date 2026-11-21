import { describe, expect, it } from "vitest";
import {
  detectMissingValues,
  imputeColumn,
  previewMissingCleaning,
  recommendMethod,
  removeColumn,
  removeRowsWithMissing,
} from "@/lib/cleaning/missing";

const rows = [
  { age: "25", city: "NYC", score: "10" },
  { age: "", city: "LA", score: "20" },
  { age: "30", city: "", score: "30" },
  { age: "", city: "SF", score: "" },
];

const columns = [
  { name: "age", dataType: "integer" },
  { name: "city", dataType: "string" },
  { name: "score", dataType: "decimal" },
];

describe("detectMissingValues", () => {
  it("counts missing values per column", () => {
    const result = detectMissingValues(rows, columns);
    expect(result.find((c) => c.column === "age")?.missingCount).toBe(2);
    expect(result.find((c) => c.column === "city")?.missingCount).toBe(1);
    expect(result.find((c) => c.column === "score")?.missingCount).toBe(1);
  });

  it("recommends median for numeric columns", () => {
    const result = detectMissingValues(rows, columns);
    // age: 2/4 missing = 50% -> null; score: 1/4 missing = 25% -> median
    expect(result.find((c) => c.column === "age")?.recommendedMethod).toBeNull();
    expect(result.find((c) => c.column === "score")?.recommendedMethod).toBe("impute_median");
  });

  it("recommends mode for string columns", () => {
    const result = detectMissingValues(rows, columns);
    expect(result.find((c) => c.column === "city")?.recommendedMethod).toBe("impute_mode");
  });

  it("returns null recommendation for high missing percentage", () => {
    const mostlyMissing = [
      { age: "", city: "a" },
      { age: "", city: "b" },
      { age: "", city: "c" },
    ];
    const result = detectMissingValues(mostlyMissing, [
      { name: "age", dataType: "integer" },
      { name: "city", dataType: "string" },
    ]);
    expect(result.find((c) => c.column === "age")?.recommendedMethod).toBeNull();
  });

  it("handles empty dataset", () => {
    const result = detectMissingValues([], columns);
    expect(result).toHaveLength(3);
    expect(result[0].missingCount).toBe(0);
  });
});

describe("imputeColumn", () => {
  it("imputes mean for numeric values", () => {
    const values = ["10", "", "30", ""];
    const result = imputeColumn(values, "impute_mean");
    expect(result.replaced).toBe(2);
    expect(result.result).toEqual(["10", "20", "30", "20"]);
  });

  it("imputes median for numeric values", () => {
    const values = ["10", "", "30", ""];
    const result = imputeColumn(values, "impute_median");
    expect(result.replaced).toBe(2);
    expect(result.result).toEqual(["10", "20", "30", "20"]);
  });

  it("imputes mode for categorical values", () => {
    const values = ["a", "", "a", "b", ""];
    const result = imputeColumn(values, "impute_mode");
    expect(result.replaced).toBe(2);
    expect(result.result).toEqual(["a", "a", "a", "b", "a"]);
  });

  it("imputes constant value", () => {
    const values = ["10", "", "30", ""];
    const result = imputeColumn(values, "impute_constant", "99");
    expect(result.replaced).toBe(2);
    expect(result.result).toEqual(["10", "99", "30", "99"]);
  });

  it("does nothing when no missing values", () => {
    const values = ["1", "2", "3"];
    const result = imputeColumn(values, "impute_mean");
    expect(result.replaced).toBe(0);
    expect(result.result).toEqual(["1", "2", "3"]);
  });

  it("returns empty result for empty values", () => {
    const result = imputeColumn([], "impute_mean");
    expect(result.replaced).toBe(0);
    expect(result.result).toEqual([]);
  });
});

describe("previewMissingCleaning", () => {
  it("produces preview with affected rows and evidence", () => {
    const result = previewMissingCleaning(rows, columns, {
      type: "impute_median",
      targetColumns: ["age"],
      parameters: {},
    });
    expect(result.affectedRowCount).toBe(2);
    expect(result.affectedCellCount).toBe(2);
    expect(result.previewRows).toHaveLength(4);
    expect(result.beforeSample.length).toBeGreaterThan(0);
    expect(result.afterSample.length).toBeGreaterThan(0);
  });

  it("warns when applying mean to non-numeric column", () => {
    const result = previewMissingCleaning(rows, columns, {
      type: "impute_mean",
      targetColumns: ["city"],
      parameters: {},
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("removeRowsWithMissing", () => {
  it("removes rows with missing values", () => {
    const result = removeRowsWithMissing(rows, columns, {
      type: "remove_rows_missing",
      targetColumns: [],
      parameters: {},
    });
    expect(result.removedRowCount).toBe(3);
    expect(result.previewRows).toHaveLength(1);
    expect(result.previewRows[0].age).toBe("25");
  });

  it("removes rows only in target columns", () => {
    const result = removeRowsWithMissing(rows, columns, {
      type: "remove_rows_missing",
      targetColumns: ["city"],
      parameters: {},
    });
    expect(result.removedRowCount).toBe(1);
    expect(result.previewRows).toHaveLength(3);
  });
});

describe("removeColumn", () => {
  it("removes specified columns", () => {
    const result = removeColumn(rows, { targetColumns: ["city", "score"] });
    expect(result.removedColumnCount).toBe(2);
    expect(result.previewRows[0]).toEqual({ age: "25" });
  });

  it("handles empty target columns", () => {
    const result = removeColumn(rows, { targetColumns: [] });
    expect(result.removedColumnCount).toBe(0);
    expect(result.previewRows).toHaveLength(4);
  });
});

describe("recommendMethod", () => {
  it("returns median for numeric columns with low missing %", () => {
    expect(recommendMethod("integer", 10)).toBe("impute_median");
  });
  it("returns mode for string columns", () => {
    expect(recommendMethod("string", 10)).toBe("impute_mode");
  });
  it("returns null for high missing %", () => {
    expect(recommendMethod("integer", 80)).toBeNull();
  });
});
