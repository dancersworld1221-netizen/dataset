import { describe, it, expect } from "vitest";
import { parseCsvContent, parseCsvFile, validateFile, detectDelimiter } from "@/lib/csv/csvParser";

describe("parser", () => {
  it("content basic", async () => {
    const r = await parseCsvContent("a,b\n1,2\n3,4\n");
    expect(r.headers).toEqual(["a", "b"]);
    expect(r.rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });
  it("file basic + bom + semicolon", async () => {
    const r = await parseCsvFile(new File(["\uFEFFa;b\n1;2\n"], "t.csv"));
    expect(r.headers).toEqual(["a", "b"]);
    expect(r.hasBom).toBe(true);
    expect(r.delimiter).toBe(";");
  });
  it("ragged", async () => {
    const r = await parseCsvFile(new File(["a,b,c\n1,2\n3,4,5,6\n7,8,9\n"], "t.csv"));
    expect(r.rowCount).toBe(3);
    expect(r.warnings.map((w) => w.rowNumber)).toEqual([2, 3]);
    expect(r.rows[0]).toEqual({ a: "1", b: "2", c: "" });
    expect(Object.keys(r.rows[1])).toEqual(["a", "b", "c"]);
  });
  it("dup + empty headers", async () => {
    const r = await parseCsvFile(new File(["a,a,\n1,2,3\n"], "t.csv"));
    expect(r.headers).toEqual(["a", "a_1", "column_3"]);
    expect(r.warnings.length).toBe(2);
  });
  it("truncation exact", async () => {
    const csv = "a\n1\n2\n3\n";
    expect((await parseCsvContent(csv, { maxRecords: 3 })).truncated).toBe(false);
    const t = await parseCsvContent(csv, { maxRecords: 2 });
    expect(t.truncated).toBe(true);
    expect(t.rowCount).toBe(2);
  });
  it("windows-1256", async () => {
    // "سلام" in windows-1256
    const bytes = new Uint8Array([0x6e, 0x0a, 0xd3, 0xe1, 0xc7, 0xe3]);
    const r = await parseCsvFile(new File([bytes], "t.csv"));
    expect(r.encoding).toBe("windows-1256");
    expect(r.rows[0].n).toBe("سلام");
  });
  it("no ext + hasHeader false", async () => {
    expect(validateFile(new File(["x"], "data")).error).toContain("(none)");
    const r = await parseCsvContent("1,2\n3,4", { hasHeader: false });
    expect(r.headers).toEqual(["column_1", "column_2"]);
    expect(r.rows[1]).toEqual({ column_1: "3", column_2: "4" });
  });
  it("delimiter consistency", () => {
    expect(detectDelimiter("a;b;c\n1;x,y,z,w;3\n4;5;6")).toBe(";");
  });
});

describe("delimiter detection (consistency across all records)", () => {
  it("does not mistake a character in a single value for a delimiter (single-column file)", async () => {
    const r = await parseCsvContent("name\nplain\nsemi;colon\nother\nsemi;again;twice\nlast\n");
    expect(r.headers).toEqual(["name"]);
    expect(r.rows.map((x) => x.name)).toEqual(["plain", "semi;colon", "other", "semi;again;twice", "last"]);
    expect(r.delimiter).toBe(""); // no delimiter: one column
    expect(r.warnings).toEqual([]);
  });

  it("reads a semicolon file with decimal commas as semicolon-separated", async () => {
    const r = await parseCsvContent("a;b;c\n1,5;2,5;3,5\n4,5;5,5;6,5\n");
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows[0]).toEqual({ a: "1,5", b: "2,5", c: "3,5" });
  });

  it("ignores delimiter characters inside quoted fields, including quoted line breaks", async () => {
    const r = await parseCsvContent('id;note\n1;"a;b;c\nsecond; line;with;semicolons"\n2;plain\n');
    expect(r.delimiter).toBe(";");
    expect(r.rowCount).toBe(2);
    expect(r.rows[0].note).toBe("a;b;c\nsecond; line;with;semicolons");
  });

  it("detects tab and pipe files and tolerates a few ragged rows", async () => {
    expect((await parseCsvContent("a\tb\tc\n1\t2\t3\n")).delimiter).toBe("\t");
    expect((await parseCsvContent("a|b|c\n1|2|3\n")).delimiter).toBe("|");
    const ragged = await parseCsvContent("a,b,c\n" + Array.from({ length: 20 }, (_, i) => `${i},2,3`).join("\n") + "\n1,2\n");
    expect(ragged.delimiter).toBe(",");
    expect(ragged.warnings).toHaveLength(1);
  });

  it("an explicit delimiter is always respected", async () => {
    const r = await parseCsvContent("a,b\n1,2\n", { delimiter: "," });
    expect(r.delimiter).toBe(",");
  });
});
