import { describe, expect, it } from "vitest";
import { cleaningEngine } from "@/lib/cleaning/engine";

const rows = [
  { a: "1", b: "x" },
  { a: "2", b: "y" },
  { a: "3", b: "z" },
];

const columns = [
  { name: "a", dataType: "integer" },
  { name: "b", dataType: "string" },
];

describe("cleaningEngine", () => {
  it("initializes and tracks versions", () => {
    const version = cleaningEngine.initialize(
      { rows, columns },
      "Original"
    );
    expect(version.rowCount).toBe(3);
    expect(cleaningEngine.getCurrentVersionId()).toBe(version.id);
    expect(cleaningEngine.canUndo()).toBe(false);
    expect(cleaningEngine.canRedo()).toBe(false);
  });

  it("commits a preview and tracks history", () => {
    cleaningEngine.initialize({ rows, columns }, "Original");
    const preview = cleaningEngine.previewStringCleaning(
      { rows, columns },
      { type: "uppercase", targetColumns: ["b"], parameters: {} }
    );
    const record = cleaningEngine.commitPreview(
      { type: "uppercase", targetColumns: ["b"], parameters: {} },
      preview.previewRows,
      columns,
      preview.affectedRowCount,
      preview.affectedCellCount
    );
    expect(record.title).toBe("Convert to uppercase");
    expect(cleaningEngine.canUndo()).toBe(true);
    expect(cleaningEngine.canRedo()).toBe(false);
    expect(cleaningEngine.getHistory()).toHaveLength(1);
  });

  it("undo restores previous version", () => {
    const result = cleaningEngine.undo();
    expect(result).not.toBeNull();
    expect(result!.record.status).toBe("undone");
    expect(cleaningEngine.getCurrentRows()[0].b).toBe("x");
    expect(cleaningEngine.canUndo()).toBe(false);
    expect(cleaningEngine.canRedo()).toBe(true);
  });

  it("redo restores undone version", () => {
    const result = cleaningEngine.redo();
    expect(result).not.toBeNull();
    expect(result!.record.status).toBe("redone");
    expect(cleaningEngine.getCurrentRows()[0].b).toBe("X");
    expect(cleaningEngine.canUndo()).toBe(true);
    expect(cleaningEngine.canRedo()).toBe(false);
  });
});
