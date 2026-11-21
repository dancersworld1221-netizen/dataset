import { describe, expect, it } from "vitest";
import { CleaningEngine } from "@/lib/cleaning/engine";
import { detectDuplicates, previewDuplicateRemoval } from "@/lib/cleaning/duplicates";
import { imputeColumn, previewMissingCleaning } from "@/lib/cleaning/missing";
import { previewStringCleaning } from "@/lib/cleaning/strings";
import { previewTypeValidation, validateColumnTypes } from "@/lib/cleaning/types";

const cols = [
  { name: "age", dataType: "integer" },
  { name: "city", dataType: "string" },
];
const rows = [
  { age: "10", city: "Baku" },
  { age: "", city: "Baku" },
  { age: "30", city: "" },
  { age: "N/A", city: "Tehran" },
];
const op = (type: never, targetColumns: string[], parameters: Record<string, unknown> = {}) => ({ type, targetColumns, parameters });

describe("previews show what really changes", () => {
  it("imputation: 'before' holds the original rows and 'after' the cleaned ones", () => {
    const preview = previewMissingCleaning(rows, cols, op("impute_median" as never, ["age"]));
    expect(preview.beforeSample.map((r) => r.age)).toEqual(["", "N/A"]);
    expect(preview.afterSample.map((r) => r.age)).toEqual(["20", "20"]);
    expect(preview.changes).toEqual([
      { rowNumber: 2, column: "age", before: "", after: "20" },
      { rowNumber: 4, column: "age", before: "N/A", after: "20" },
    ]);
    expect(preview.affectedRowCount).toBe(2);
    expect(preview.targetColumns).toEqual(["age"]);
  });

  it("string cleaning keeps the original text in 'before'", () => {
    const spaced = [{ city: "  Baku " }, { city: "Tehran" }];
    const preview = previewStringCleaning(spaced, [{ name: "city" }], op("trim_whitespace" as never, ["city"]));
    expect(preview.beforeSample).toEqual([{ city: "  Baku " }]);
    expect(preview.afterSample).toEqual([{ city: "Baku" }]);
    expect(preview.changes?.[0]).toMatchObject({ before: "  Baku ", after: "Baku" });
  });

  it("removing rows with missing values previews exactly the rows that execution removes", () => {
    const preview = previewMissingCleaning(rows, cols, op("remove_rows_missing" as never, []));
    expect(preview.affectedRowCount).toBe(3);
    expect(preview.previewRows).toEqual([rows[0]]);
    expect(preview.removedRows?.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
  });

  it("removing a column previews the removed column and rejects impossible requests", () => {
    const preview = previewMissingCleaning(rows, cols, op("remove_column" as never, ["city"]));
    expect(preview.removedColumns).toEqual(["city"]);
    expect(preview.previewRows[0]).toEqual({ age: "10" });
    expect(preview.affectedCellCount).toBe(rows.length);
    expect(() => previewMissingCleaning(rows, cols, op("remove_column" as never, []))).toThrow(/at least one column/i);
    expect(() => previewMissingCleaning(rows, cols, op("remove_column" as never, ["nope"]))).toThrow(/unknown column/i);
    expect(() => previewMissingCleaning(rows, cols, op("remove_column" as never, ["age", "city"]))).toThrow(/must remain/i);
  });

  it("warns instead of silently doing nothing", () => {
    const noConstant = previewMissingCleaning(rows, cols, op("impute_constant" as never, ["age"]));
    expect(noConstant.warnings.join(" ")).toMatch(/constant/i);
    expect(noConstant.affectedCellCount).toBe(0);
    const textMean = previewMissingCleaning(rows, cols, op("impute_mean" as never, ["city"]));
    expect(textMean.warnings.join(" ")).toMatch(/not numeric/i);
  });
});

describe("imputation values", () => {
  it("does not leak floating-point noise into the data", () => {
    const { result } = imputeColumn(["1", "1", "2", ""], "impute_mean");
    expect(result[3]).toBe("1.33333333333");
  });
});

describe("duplicates", () => {
  it("detects duplicates in a single pass: 60 000 distinct rows are handled quickly", () => {
    const big = Array.from({ length: 60_000 }, (_, i) => ({ id: String(i), v: String(i % 7) }));
    big.push({ id: "5", v: "5" });
    const started = performance.now();
    const stats = detectDuplicates(big, ["id", "v"]);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(stats.totalDuplicateRecords).toBe(1);
    expect(stats.groups).toHaveLength(1); // only real duplicate groups are returned
    expect(stats.groups[0].rowIndices).toEqual([5, 60_000]);
    expect(stats.uniqueRecords).toBe(60_000);
  });

  it("keeps the first or the last occurrence on request", () => {
    const data = [
      { k: "a", n: "1" },
      { k: "a", n: "2" },
      { k: "b", n: "3" },
    ];
    const first = previewDuplicateRemoval(data, ["k"], op("remove_duplicates" as never, ["k"], { keepFirst: true }));
    expect(first.previewRows.map((r) => r.n)).toEqual(["1", "3"]);
    const last = previewDuplicateRemoval(data, ["k"], op("remove_duplicates" as never, ["k"], { keepLast: true }));
    expect(last.previewRows.map((r) => r.n)).toEqual(["2", "3"]);
    expect(last.removedRows?.[0].rowNumber).toBe(1);
  });
});

describe("type validation", () => {
  const typed = [
    { qty: "5" },
    { qty: "abc" },
    { qty: "abc" },
    { qty: "xyz" },
    { qty: "" },
    { qty: "7" },
    { qty: "8" },
    { qty: "9" },
    { qty: "10" },
    { qty: "11" },
  ];
  const typedCols = [{ name: "qty", dataType: "integer" }];

  it("counts every invalid cell (not only distinct values) and lists examples", () => {
    const [report] = validateColumnTypes(typed, typedCols);
    expect(report.invalidCount).toBe(3);
    expect(report.invalidExamples).toEqual(["abc", "xyz"]);
    expect(report.validCount).toBe(6);
    expect(report.needsChange).toBe(true);
  });

  it("can clear invalid cells so they become missing values", () => {
    const preview = previewTypeValidation(typed, typedCols, op("validate_type" as never, ["qty"]));
    expect(preview.affectedCellCount).toBe(3);
    expect(preview.previewRows.filter((r) => r.qty === "")).toHaveLength(4);
    expect(preview.changes?.[0]).toEqual({ rowNumber: 2, column: "qty", before: "abc", after: "" });
  });

  it("reports nothing for a clean column", () => {
    const [report] = validateColumnTypes([{ qty: "1" }, { qty: "2" }], typedCols);
    expect(report.invalidCount).toBe(0);
    expect(report.needsChange).toBe(false);
  });
});

describe("cleaning engine history", () => {
  it("applies, undoes and redoes, and releases versions of an abandoned branch", () => {
    const engine = new CleaningEngine();
    engine.initialize({ rows, columns: cols }, "orig", "ds");
    const first = engine.apply({ rows, columns: cols }, op("impute_median" as never, ["age"]));
    const second = engine.apply({ rows: first.preview.previewRows, columns: cols }, op("remove_rows_missing" as never, []));
    expect(engine.getVersions()).toHaveLength(3);
    expect(engine.getCurrentRows()).toEqual(second.preview.previewRows);

    engine.undo();
    engine.undo();
    expect(engine.getCurrentRows()).toEqual(rows);
    expect(engine.canRedo()).toBe(true);

    // A new operation after an undo starts a new branch; the two undone versions must not stay in memory.
    engine.apply({ rows, columns: cols }, op("trim_whitespace" as never, ["city"]));
    expect(engine.getVersions()).toHaveLength(2);
    expect(engine.getHistory()).toHaveLength(1);
    expect(engine.canRedo()).toBe(false);
  });

  it("returns copies of the history so React can see status changes", () => {
    const engine = new CleaningEngine();
    engine.initialize({ rows, columns: cols });
    engine.apply({ rows, columns: cols }, op("impute_mode" as never, ["city"]));
    const before = engine.getHistory();
    engine.undo();
    expect(before[0].status).toBe("applied");
    expect(engine.getHistory()[0].status).toBe("undone");
  });

  it("reports the columns that remain after a column removal", () => {
    const engine = new CleaningEngine();
    engine.initialize({ rows, columns: cols });
    const result = engine.apply({ rows, columns: cols }, op("remove_column" as never, ["city"]));
    expect(result.columns.map((c) => c.name)).toEqual(["age"]);
  });
});
