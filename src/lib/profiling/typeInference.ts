import type { ColumnDataType, MissingValuePolicy } from "@/types/dataset.types";
import { DEFAULT_MISSING_VALUE_POLICY } from "@/types/dataset.types";

/** Share of non-missing values that must fit a type for the column to get that type. */
export const TYPE_MATCH_THRESHOLD = 0.95;

const INT_RE = /^[+-]?\d+$/;
const DEC_RE = /^[+-]?(?:\d+\.\d*|\.\d+)$/;
const SCI_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;
const THOUSANDS_RE = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const DEC_COMMA_RE = /^[+-]?\d+,\d+$/;
const BOOLEAN_WORDS = new Set(["true", "false", "yes", "no", "t", "f", "y", "n"]);
const TRUE_WORDS = new Set(["true", "yes", "t", "y", "1"]);
const FALSE_WORDS = new Set(["false", "no", "f", "n", "0"]);

const ISO_DATE_RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const PART_DATE_RE =
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i;

export type DateOrder = "dmy" | "mdy";

/** Year range treated as Solar Hijri (Jalali) rather than Gregorian. */
export const JALALI_YEAR_MIN = 1200;
export const JALALI_YEAR_MAX = 1500;

export interface ParsedNumber {
  value: number;
  isInteger: boolean;
}

export interface ParsedDate {
  date: Date;
  hasTime: boolean;
}

export interface ColumnTypeAnalysis {
  dataType: ColumnDataType;
  /** Non-missing values that do not fit the inferred type. */
  invalidCount: number;
  nonMissingCount: number;
}

const NON_LATIN_DIGITS = /[\u06F0-\u06F9\u0660-\u0669\u066B\u066C]/;

/**
 * Converts Persian (U+06F0-06F9) and Arabic-Indic (U+0660-0669) digits to ASCII digits, the Arabic decimal
 * separator (U+066B) to "." and the Arabic thousands separator (U+066C) to ",". Text without such
 * characters is returned unchanged.
 */
export function normalizeDigits(text: string): string {
  if (!NON_LATIN_DIGITS.test(text)) return text;
  return text
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, ",");
}

export type NumberFormat = "plain" | "thousands-comma" | "decimal-comma" | "ambiguous-comma";

export interface DetailedNumber extends ParsedNumber {
  /**
   * How the text writes the number:
   * - plain: digits with an optional "." decimal point or exponent;
   * - thousands-comma: "1,234,567" or "1,234.5" (comma can only be a thousands separator);
   * - decimal-comma: "3,5", "1234,567" or "1.234,56" (comma can only be the decimal separator);
   * - ambiguous-comma: exactly one comma followed by three digits, e.g. "1,234" (1234 or 1.234?).
   */
  format: NumberFormat;
}

const DOT_THOUSANDS_COMMA_DECIMAL_RE = /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/;

/**
 * Parses a numeric string and reports which number format it uses, so callers can resolve the
 * ambiguity of "1,234" consistently for a whole column.
 * Integers with leading zeros ("00123", zip codes, phone numbers) and integers longer than 15 digits are
 * treated as identifiers, not numbers. Never returns Infinity or NaN.
 */
export function parseNumberDetailed(raw: string): DetailedNumber | null {
  const s = normalizeDigits(raw.trim());
  if (s === "") return null;

  if (INT_RE.test(s)) {
    const digits = s.replace(/^[+-]/, "");
    if (digits.length > 15) return null;
    if (digits.length > 1 && digits.startsWith("0")) return null;
    return { value: Number(s), isInteger: true, format: "plain" };
  }
  if (DEC_RE.test(s)) {
    if (/^[+-]?0\d/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? { value: n, isInteger: false, format: "plain" } : null;
  }
  if (SCI_RE.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? { value: n, isInteger: false, format: "plain" } : null;
  }
  if (THOUSANDS_RE.test(s)) {
    const value = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    const groups = s.split(",").length - 1;
    const ambiguous = groups === 1 && !s.includes(".");
    return { value, isInteger: !s.includes("."), format: ambiguous ? "ambiguous-comma" : "thousands-comma" };
  }
  if (DOT_THOUSANDS_COMMA_DECIMAL_RE.test(s)) {
    const value = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(value) ? { value, isInteger: false, format: "decimal-comma" } : null;
  }
  if (DEC_COMMA_RE.test(s)) {
    if (/^[+-]?0\d/.test(s)) return null;
    const value = Number(s.replace(",", "."));
    return Number.isFinite(value) ? { value, isInteger: false, format: "decimal-comma" } : null;
  }
  return null;
}

/**
 * Per-cell parse used by type inference and sorting. An ambiguous "1,234" is read as a thousands
 * separator here; the analytics engine resolves it per column (see `resolveColumnNumberFormat`).
 */
export function parseNumber(raw: string): ParsedNumber | null {
  const detailed = parseNumberDetailed(raw);
  return detailed ? { value: detailed.value, isInteger: detailed.isInteger } : null;
}

export interface ColumnNumberFormat {
  /** How an "ambiguous-comma" cell is read in this column. */
  ambiguousAs: "thousands" | "decimal";
  /** Format whose cells are rejected because the column mostly uses the other one. */
  rejected: "thousands-comma" | "decimal-comma" | null;
  counts: { thousands: number; decimal: number; ambiguous: number };
  note: string | null;
}

/**
 * Decides, for a whole column, how comma-containing numbers are interpreted, so that "3,5" (3.5) and
 * "1,200" (1200) are never mixed silently:
 * - only decimal commas present: "1,234" is 1.234;
 * - only thousands commas present (or nothing but ambiguous cells): "1,234" is 1234 (and a note says so);
 * - both present: the majority convention wins and the minority cells become invalid.
 */
export function resolveColumnNumberFormat(counts: { thousands: number; decimal: number; ambiguous: number }): ColumnNumberFormat {
  const { thousands, decimal, ambiguous } = counts;
  if (thousands > 0 && decimal > 0) {
    const thousandsWins = thousands >= decimal;
    return {
      ambiguousAs: thousandsWins ? "thousands" : "decimal",
      rejected: thousandsWins ? "decimal-comma" : "thousands-comma",
      counts,
      note: `This column mixes thousands separators (${thousands.toLocaleString()} cells) and decimal commas (${decimal.toLocaleString()} cells); the ${thousandsWins ? "decimal-comma" : "thousands-separator"} cells were treated as invalid.`,
    };
  }
  if (decimal > 0) {
    return {
      ambiguousAs: "decimal",
      rejected: null,
      counts,
      note: ambiguous > 0 ? `${ambiguous.toLocaleString()} value(s) such as "1,234" were read as decimal commas (1.234) because other values in this column use decimal commas.` : null,
    };
  }
  return {
    ambiguousAs: "thousands",
    rejected: null,
    counts,
    note: ambiguous > 0 ? `${ambiguous.toLocaleString()} value(s) such as "1,234" were read as thousands separators (1234). If your file uses a decimal comma, they are 1000 times too large.` : null,
  };
}

function buildUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  offsetMinutes: number
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Years 1200-1500 are almost certainly Solar Hijri (Jalali) dates such as 1402/05/12. Reading them as
  // Gregorian would give wrong spans and orderings, so they are not accepted as dates.
  if (year >= JALALI_YEAR_MIN && year <= JALALI_YEAR_MAX) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return new Date(ms - offsetMinutes * 60000);
}

function parseOffset(raw: string | undefined): number {
  if (!raw || raw.toUpperCase() === "Z") return 0;
  const sign = raw[0] === "-" ? -1 : 1;
  const digits = raw.slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/**
 * Parses date and datetime strings without relying on `new Date(string)` so that results do not
 * depend on the browser time zone: values without an offset are read as UTC wall-clock time.
 * Supported: yyyy-mm-dd, yyyy/mm/dd, ISO with time and offset, and dd/mm/yyyy or mm/dd/yyyy
 * (1-2 digit parts, "/", "-" or "." separators, optional time, optional AM/PM).
 */
export function parseDateValue(raw: string, order: DateOrder = "mdy"): ParsedDate | null {
  const s = normalizeDigits(raw.trim());
  if (s === "") return null;

  const iso = ISO_DATE_RE.exec(s);
  if (iso) {
    const hasTime = iso[4] !== undefined;
    const d = buildUtcDate(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      hasTime ? Number(iso[4]) : 0,
      hasTime ? Number(iso[5]) : 0,
      iso[6] !== undefined ? Number(iso[6]) : 0,
      parseOffset(iso[7])
    );
    return d ? { date: d, hasTime } : null;
  }

  const part = PART_DATE_RE.exec(s);
  if (part) {
    const first = Number(part[1]);
    const second = Number(part[2]);
    const day = order === "dmy" ? first : second;
    const month = order === "dmy" ? second : first;
    const hasTime = part[4] !== undefined;
    let hour = hasTime ? Number(part[4]) : 0;
    const meridiem = part[7]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
    }
    const d = buildUtcDate(
      Number(part[3]),
      month,
      day,
      hour,
      hasTime ? Number(part[5]) : 0,
      part[6] !== undefined ? Number(part[6]) : 0,
      0
    );
    return d ? { date: d, hasTime } : null;
  }

  return null;
}

/**
 * Decides whether ambiguous "a/b/yyyy" dates are day-first or month-first by looking for a
 * part greater than 12. Defaults to month-first when nothing disambiguates.
 */
export function detectDateOrder(values: string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  let inspected = 0;
  for (const v of values) {
    const m = PART_DATE_RE.exec(v.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst++;
    if (Number(m[2]) > 12) monthFirst++;
    if (++inspected >= 2000) break;
  }
  return dayFirst > monthFirst ? "dmy" : "mdy";
}

function markerSet(policy: MissingValuePolicy): Set<string> {
  let cached = markerCache.get(policy);
  if (!cached) {
    cached = new Set(policy.markers.map((m) => m.trim().toLowerCase()));
    markerCache.set(policy, cached);
  }
  return cached;
}
const markerCache = new WeakMap<MissingValuePolicy, Set<string>>();

export type MissingKind = "empty" | "whitespace" | "marker" | null;

/**
 * Single source of truth for "is this cell missing?" and why. Marker matching is case-insensitive.
 */
export function classifyMissing(
  value: string | null | undefined,
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): MissingKind {
  if (value == null || value === "") return policy.treatEmptyAsMissing ? "empty" : null;
  const trimmed = value.trim();
  if (trimmed === "") return policy.treatWhitespaceOnlyAsMissing ? "whitespace" : null;
  return markerSet(policy).has(trimmed.toLowerCase()) ? "marker" : null;
}

export function isMissingValue(
  value: string | null | undefined,
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): boolean {
  return classifyMissing(value, policy) !== null;
}

export function isNonMissingValue(
  value: string | null | undefined,
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): boolean {
  return !isMissingValue(value, policy);
}

/**
 * Infers the data type of a column and counts the values that do not fit it.
 * A numeric or date type needs at least TYPE_MATCH_THRESHOLD of the non-missing values to match;
 * the remaining values are reported as invalid instead of silently skewing the type.
 */
export function analyzeColumnType(
  values: string[],
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): ColumnTypeAnalysis {
  const nonMissing: string[] = [];
  for (const v of values) {
    if (!isMissingValue(v, policy)) nonMissing.push(v.trim());
  }
  const total = nonMissing.length;
  if (total === 0) return { dataType: "empty", invalidCount: 0, nonMissingCount: 0 };

  const order = detectDateOrder(nonMissing);
  let integers = 0;
  let decimals = 0;
  let booleanWords = 0;
  let dates = 0;
  let datetimes = 0;
  let zeros = 0;
  let ones = 0;

  for (const t of nonMissing) {
    if (t === "0") zeros++;
    else if (t === "1") ones++;

    const num = parseNumber(t);
    if (num) {
      if (num.isInteger) integers++;
      else decimals++;
      continue;
    }
    if (BOOLEAN_WORDS.has(t.toLowerCase())) {
      booleanWords++;
      continue;
    }
    const date = parseDateValue(t, order);
    if (date) {
      if (date.hasTime) datetimes++;
      else dates++;
    }
  }

  // A column made only of 0 and 1 (both present) is a flag, not a count.
  if (zeros > 0 && ones > 0 && zeros + ones === total) {
    return { dataType: "boolean", invalidCount: 0, nonMissingCount: total };
  }
  if (booleanWords === total) {
    return { dataType: "boolean", invalidCount: 0, nonMissingCount: total };
  }

  const numeric = integers + decimals;
  if (numeric / total >= TYPE_MATCH_THRESHOLD) {
    return {
      dataType: decimals > 0 ? "decimal" : "integer",
      invalidCount: total - numeric,
      nonMissingCount: total,
    };
  }
  const temporal = dates + datetimes;
  if (temporal / total >= TYPE_MATCH_THRESHOLD) {
    return {
      dataType: datetimes > 0 ? "datetime" : "date",
      invalidCount: total - temporal,
      nonMissingCount: total,
    };
  }
  return { dataType: "string", invalidCount: 0, nonMissingCount: total };
}

export function inferColumnType(
  values: string[],
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): ColumnDataType {
  return analyzeColumnType(values, policy).dataType;
}

export function isTrueValue(value: string): boolean {
  return TRUE_WORDS.has(value.trim().toLowerCase());
}

export function isFalseValue(value: string): boolean {
  return FALSE_WORDS.has(value.trim().toLowerCase());
}
