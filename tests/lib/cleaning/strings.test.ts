import { describe, expect, it } from "vitest";
import { previewStringCleaning } from "@/lib/cleaning/strings";

const rows = [
  { name: "  Alice  ", city: "NYC" },
  { name: "Bob   Smith", city: "LA" },
  { name: "  carol  ", city: "SF" },
];

const columns = [
  { name: "name", dataType: "string" },
  { name: "city", dataType: "string" },
];

describe("previewStringCleaning", () => {
  it("trims whitespace", () => {
    const result = previewStringCleaning(rows, columns, {
      type: "trim_whitespace",
      targetColumns: ["name"],
      parameters: {},
    });
    expect(result.affectedRowCount).toBe(2);
    expect(result.previewRows[0].name).toBe("Alice");
    expect(result.previewRows[1].name).toBe("Bob   Smith");
    expect(result.previewRows[2].name).toBe("carol");
  });

  it("normalizes whitespace", () => {
    const result = previewStringCleaning(rows, columns, {
      type: "normalize_whitespace",
      targetColumns: ["name"],
      parameters: {},
    });
    expect(result.previewRows[1].name).toBe("Bob Smith");
  });

  it("lowercases", () => {
    const result = previewStringCleaning(rows, columns, {
      type: "lowercase",
      targetColumns: ["name"],
      parameters: {},
    });
    expect(result.previewRows[0].name).toBe("  alice  ");
  });

  it("uppercases", () => {
    const result = previewStringCleaning(rows, columns, {
      type: "uppercase",
      targetColumns: ["name"],
      parameters: {},
    });
    expect(result.previewRows[0].name).toBe("  ALICE  ");
  });

  it("respects target columns", () => {
    const result = previewStringCleaning(rows, columns, {
      type: "lowercase",
      targetColumns: ["city"],
      parameters: {},
    });
    expect(result.previewRows[0].name).toBe("  Alice  ");
    expect(result.previewRows[0].city).toBe("nyc");
  });

  it("handles empty dataset", () => {
    const result = previewStringCleaning([], columns, {
      type: "trim_whitespace",
      targetColumns: ["name"],
      parameters: {},
    });
    expect(result.affectedRowCount).toBe(0);
    expect(result.previewRows).toHaveLength(0);
  });
});
