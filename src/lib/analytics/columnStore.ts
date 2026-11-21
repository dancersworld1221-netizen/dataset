import { classifyMissing, normalizeDigits, parseNumberDetailed, resolveColumnNumberFormat } from "@/lib/profiling/typeInference";
import type { ColumnInfo } from "./types";

export interface NumericColumn {
  name: string;
  /** One slot per row; NaN where the cell is missing or not a finite number. */
  values: Float64Array;
  validCount: number;
  missingCount: number;
  invalidCount: number;
  /** A few non-numeric cell values, for messages. */
  invalidSamples: string[];
  /** Explanations about how ambiguous number formats were read (shown as warnings). */
  notes: string[];
}

/**
 * Read-only, lazily materialised column view over the dataset rows.
 * The rows themselves are never modified.
 */
export class ColumnStore {
  readonly rowCount: number;
  private readonly rows: Array<Record<string, string>>;
  private readonly infoByName = new Map<string, ColumnInfo>();
  private readonly rawCache = new Map<string, string[]>();
  private readonly numericCache = new Map<string, NumericColumn>();

  constructor(rows: Array<Record<string, string>>, readonly columns: ColumnInfo[]) {
    this.rows = rows;
    this.rowCount = rows.length;
    for (const c of columns) this.infoByName.set(c.name, c);
  }

  info(name: string): ColumnInfo {
    const info = this.infoByName.get(name);
    if (!info) throw new Error(`Unknown column "${name}"`);
    return info;
  }

  has(name: string): boolean {
    return this.infoByName.has(name);
  }

  /** Raw cell strings of a column ("" for absent cells). */
  raw(name: string): string[] {
    this.info(name);
    let column = this.rawCache.get(name);
    if (!column) {
      column = new Array<string>(this.rowCount);
      for (let i = 0; i < this.rowCount; i++) column[i] = this.rows[i][name] ?? "";
      this.rawCache.set(name, column);
    }
    return column;
  }

  numeric(name: string): NumericColumn {
    let column = this.numericCache.get(name);
    if (!column) {
      const raw = this.raw(name);
      const values = new Float64Array(raw.length);
      const detailed: Array<ReturnType<typeof parseNumberDetailed> | undefined> = new Array(raw.length);
      let missingCount = 0;
      let invalidCount = 0;
      let validCount = 0;
      const invalidSamples: string[] = [];
      const counts = { thousands: 0, decimal: 0, ambiguous: 0 };

      // Pass 1: classify every cell exactly once and count comma conventions.
      for (let i = 0; i < raw.length; i++) {
        if (classifyMissing(raw[i]) !== null) {
          values[i] = NaN;
          missingCount++;
          continue;
        }
        const parsed = parseNumberDetailed(raw[i]);
        detailed[i] = parsed;
        if (parsed?.format === "thousands-comma") counts.thousands++;
        else if (parsed?.format === "decimal-comma") counts.decimal++;
        else if (parsed?.format === "ambiguous-comma") counts.ambiguous++;
      }

      // Pass 2: interpret ambiguous commas consistently for the whole column.
      const format = resolveColumnNumberFormat(counts);
      for (let i = 0; i < raw.length; i++) {
        if (classifyMissing(raw[i]) !== null) continue;
        const parsed = detailed[i];
        let value: number | null = parsed ? parsed.value : null;
        if (parsed && parsed.format === format.rejected) value = null;
        else if (parsed && parsed.format === "ambiguous-comma" && format.ambiguousAs === "decimal") {
          value = Number(normalizeDigits(raw[i].trim()).replace(",", "."));
        }
        if (value !== null && Number.isFinite(value)) {
          values[i] = value;
          validCount++;
        } else {
          values[i] = NaN;
          invalidCount++;
          if (invalidSamples.length < 5) invalidSamples.push(raw[i]);
        }
      }
      column = { name, values, validCount, missingCount, invalidCount, invalidSamples, notes: format.note ? [format.note] : [] };
      this.numericCache.set(name, column);
    }
    return column;
  }

  /** Valid numeric observations only, in row order. */
  validValues(name: string): Float64Array {
    const { values, validCount } = this.numeric(name);
    const out = new Float64Array(validCount);
    let k = 0;
    for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) out[k++] = values[i];
    return out;
  }
}
