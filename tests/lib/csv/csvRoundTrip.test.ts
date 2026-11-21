import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { parseCsvContent, parseCsvFile } from "@/lib/csv/csvParser";

// CSV texts produced by Python's csv module (tests/fixtures/generate_csv_fixture.py) with random delimiters,
// quoting, embedded newlines and quotes, Unicode, BOM and CRLF. The parser must return exactly the data
// that was written, with delimiter detection but without being told the delimiter.
interface Case { csv: string; delimiter: string; header: string[]; rows: string[][] }
const cases = JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/csv-roundtrip.json"), "utf8")) as Case[];

describe("CSV round trip against Python's csv module", () => {
  cases.forEach((c, i) => {
    it(`case ${i} (delimiter ${JSON.stringify(c.delimiter)}, ${c.header.length} columns, ${c.rows.length} rows)`, async () => {
      const result = await parseCsvContent(c.csv);
      expect(result.errors.filter((e) => e.severity === "error")).toEqual([]);
      expect(result.headers).toEqual(c.header.map((h) => h.trim()));
      expect(result.rowCount).toBe(c.rows.length);
      const expectedRows = c.rows.map((row) => Object.fromEntries(c.header.map((h, j) => [h.trim(), row[j]])));
      expect(result.rows).toEqual(expectedRows);
      expect(result.delimiter).toBe(c.header.length === 1 ? result.delimiter : c.delimiter);
    });
  });

  it("gives the same result when the text arrives as a File (bytes, BOM, encoding detection)", async () => {
    for (const c of cases.slice(0, 40)) {
      const fromFile = await parseCsvFile(new File([c.csv], "x.csv", { type: "text/csv" }));
      const fromText = await parseCsvContent(c.csv);
      expect(fromFile.rows).toEqual(fromText.rows);
      expect(fromFile.headers).toEqual(fromText.headers);
    }
  });
});
