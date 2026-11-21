import { describe, expect, it } from "vitest";
import { parseCsvContent } from "@/lib/csv/csvParser";
import { cleanedFilename, rowsToCsv } from "@/lib/csv/csvExport";

describe("CSV export", () => {
  const columns = ["name", "note", "n"];
  const rows = [
    { name: "Ali", note: 'say "hi", ok', n: "1" },
    { name: "سارا", note: "line1\nline2", n: "" },
  ];

  it("writes a UTF-8 BOM so Excel reads Persian text, columns in order, and missing cells empty", () => {
    const csv = rowsToCsv(rows, columns);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe("\ufeffname,note,n");
    expect(rowsToCsv(rows, columns, { bom: false }).startsWith("name")).toBe(true);
  });

  it("round-trips through the app's own parser", async () => {
    const parsed = await parseCsvContent(rowsToCsv(rows, columns));
    expect(parsed.headers).toEqual(columns);
    expect(parsed.rows).toEqual(rows);
  });

  it("neutralises spreadsheet formulas but leaves numbers alone", () => {
    const csv = rowsToCsv([{ a: "=SUM(A1)", b: "-5", c: "+1.5", d: "@cmd", e: "-abc" }], ["a", "b", "c", "d", "e"], { bom: false });
    expect(csv.split("\r\n")[1]).toBe("'=SUM(A1),-5,+1.5,'@cmd,'-abc");
  });

  it("names the file after the original", () => {
    expect(cleanedFilename("sales.2024.csv")).toBe("sales.2024-cleaned.csv");
    expect(cleanedFilename("data")).toBe("data-cleaned.csv");
  });
});
