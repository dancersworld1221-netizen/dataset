import * as Papa from "papaparse";

export interface CsvExportOptions {
  delimiter?: string;
  /** A UTF-8 byte order mark makes Excel read non-Latin text (Persian, Arabic ...) correctly. Default: true. */
  bom?: boolean;
}

/**
 * CSV-injection guard: a text cell that starts with "=" or "@", or with "+" / "-" followed by a non-digit,
 * would be run as a formula when the file is opened in Excel, so it is prefixed with an apostrophe.
 * Numbers such as "-5" or "+1.5" are left untouched.
 */
function guardFormula(value: string): string {
  return /^[=@]/.test(value) || /^[+-][^\d.\s]/.test(value) ? `'${value}` : value;
}

/** Serialises rows to CSV text, in the order of `columns`. Missing cells become empty fields. */
export function rowsToCsv(
  rows: Array<Record<string, string>>,
  columns: string[],
  options: CsvExportOptions = {}
): string {
  const { delimiter = ",", bom = true } = options;
  const data = rows.map((row) => columns.map((name) => guardFormula(row[name] ?? "")));
  const text = Papa.unparse({ fields: columns, data }, { delimiter, newline: "\r\n" });
  return bom ? `\ufeff${text}` : text;
}

export function cleanedFilename(original: string): string {
  const base = original.replace(/\.[^.]+$/, "") || "dataset";
  return `${base}-cleaned.csv`;
}
