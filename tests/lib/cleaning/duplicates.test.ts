import { describe, expect, it } from "vitest";
import { detectDuplicates, previewDuplicateRemoval } from "@/lib/cleaning/duplicates";

const rows = [
  { id: "1", email: "a@x.com", name: "Alice" },
  { id: "2", email: "b@x.com", name: "Bob" },
  { id: "3", email: "a@x.com", name: "Alice" },
  { id: "4", email: "c@x.com", name: "Carol" },
  { id: "5", email: "a@x.com", name: "Alice" },
];

describe("detectDuplicates", () => {
  it("detects full-row duplicates", () => {
    const stats = detectDuplicates(rows, ["email", "name"]);
    expect(stats.totalDuplicateRecords).toBe(2);
    expect(stats.uniqueRecords).toBe(3);
    expect(stats.duplicatePercentage).toBe(40);
  });

  it("detects selected-column duplicates", () => {
    const stats = detectDuplicates(rows, ["email"]);
    expect(stats.totalDuplicateRecords).toBe(2);
    expect(stats.groups.length).toBeGreaterThan(0);
  });

  it("handles no duplicates", () => {
    const stats = detectDuplicates(
      [{ id: "1" }, { id: "2" }],
      ["id"]
    );
    expect(stats.totalDuplicateRecords).toBe(0);
    expect(stats.uniqueRecords).toBe(2);
  });

  it("handles empty dataset", () => {
    const stats = detectDuplicates([], ["id"]);
    expect(stats.totalDuplicateRecords).toBe(0);
    expect(stats.groups).toHaveLength(0);
  });
});

describe("previewDuplicateRemoval", () => {
  it("keeps first occurrence by default", () => {
    const result = previewDuplicateRemoval(rows, ["email"], {
      type: "remove_duplicates",
      targetColumns: ["email"],
      parameters: { keepFirst: true },
    });
    expect(result.affectedRowCount).toBe(2);
    expect(result.previewRows.length).toBe(3);
    expect(result.previewRows[0].email).toBe("a@x.com");
  });

  it("keeps last occurrence when requested", () => {
    const result = previewDuplicateRemoval(rows, ["email"], {
      type: "remove_duplicates",
      targetColumns: ["email"],
      parameters: { keepLast: true },
    });
    expect(result.previewRows[0].email).toBe("b@x.com");
    expect(result.previewRows.find((r) => r.email === "a@x.com")?.id).toBe("5");
  });

  it("removes all duplicate groups when requested", () => {
    const result = previewDuplicateRemoval(rows, ["email"], {
      type: "remove_duplicates",
      targetColumns: ["email"],
      parameters: { removeAllGroups: true },
    });
    expect(result.previewRows.length).toBe(2);
    expect(result.previewRows.map((r) => r.email).sort()).toEqual(["b@x.com", "c@x.com"]);
  });

  it("uses all columns when no target columns given", () => {
    // All rows unique by full row (unique ids), so no duplicates removed.
    const result = previewDuplicateRemoval(rows, ["id", "email", "name"], {
      type: "remove_duplicates",
      targetColumns: [],
      parameters: { keepFirst: true },
    });
    expect(result.affectedRowCount).toBe(0);
    expect(result.previewRows.length).toBe(5);
  });

  it("provides before/after samples", () => {
    const result = previewDuplicateRemoval(rows, ["email"], {
      type: "remove_duplicates",
      targetColumns: ["email"],
      parameters: { keepFirst: true },
    });
    expect(result.beforeSample.length).toBeGreaterThan(0);
    expect(result.afterSample.length).toBeGreaterThan(0);
  });
});
