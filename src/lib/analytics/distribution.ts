import { JALALI_YEAR_MAX, JALALI_YEAR_MIN, classifyMissing, detectDateOrder, normalizeDigits, parseDateValue } from "@/lib/profiling/typeInference";
import type { ParsedDate } from "@/lib/profiling/typeInference";
import { computeNumericSummary, quantileSorted, sortedCopy } from "./numeric";
import {
  ANALYTICS_LIMITS,
  type BinMethod,
  type CardinalityClass,
  type CategoryFrequency,
  type CountPoint,
  type DateDistributionResult,
  type FrequencyResult,
  type HistogramResult,
} from "./types";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

/** Sturges' rule: ceil(log2(n)) + 1 bins. */
export function sturgesBinCount(n: number): number {
  return Math.ceil(Math.log2(n)) + 1;
}

/**
 * Freedman-Diaconis rule: bin width 2 * IQR / n^(1/3). Returns null when the IQR is 0 or the sample
 * is too small for the rule to be meaningful, so callers can fall back to Sturges.
 */
export function freedmanDiaconisBinCount(sorted: Float64Array): number | null {
  const n = sorted.length;
  if (n < 5) return null;
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const range = sorted[n - 1] - sorted[0];
  if (!(iqr > 0) || !(range > 0)) return null;
  const width = (2 * iqr) / Math.cbrt(n);
  return Math.ceil(range / width);
}

export interface HistogramOptions {
  method: BinMethod;
  /** Used when method is "fixed" (clamped to 1..maxHistogramBins). */
  bins?: number;
}

/**
 * Equal-width histogram of valid observations. Bins are half-open [start, end) except the last,
 * which is closed, so the frequencies always add up to the number of valid observations.
 */
export function buildHistogram(
  column: string,
  valid: ArrayLike<number>,
  meta: { missingCount: number; invalidCount: number },
  options: HistogramOptions
): HistogramResult {
  const n = valid.length;
  const notes: string[] = [];
  const base = {
    column,
    requestedMethod: options.method,
    missingCount: meta.missingCount,
    invalidCount: meta.invalidCount,
  };

  if (n === 0) {
    return {
      ...base,
      appliedMethod: "sturges",
      binCount: 0,
      binWidth: 0,
      bins: [],
      totalIncluded: 0,
      min: null,
      max: null,
      range: null,
      zeroCount: 0,
      zeroPercentage: 0,
      positiveCount: 0,
      negativeCount: 0,
      skewness: null,
      shape: "empty",
      notes: ["No valid numeric observations."],
    };
  }

  const sorted = sortedCopy(valid);
  const min = sorted[0];
  const max = sorted[n - 1];
  const range = max - min;

  let zeroCount = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  for (let i = 0; i < n; i++) {
    if (sorted[i] === 0) zeroCount++;
    else if (sorted[i] > 0) positiveCount++;
    else negativeCount++;
  }

  // Shape from the adjusted skewness (single implementation, shared with the numeric summary).
  const skewness = n >= 3 && range > 0 ? computeNumericSummary(column, sorted, { totalRows: n, missingCount: 0, invalidCount: 0 }).skewness : null;

  const common = {
    ...base,
    min,
    max,
    range,
    zeroCount,
    zeroPercentage: (zeroCount / n) * 100,
    positiveCount,
    negativeCount,
    skewness,
  };

  if (range === 0) {
    notes.push("Every observation has the same value, so there is a single bin.");
    return {
      ...common,
      appliedMethod: "sturges",
      binCount: 1,
      binWidth: 0,
      bins: [{ start: min, end: max, count: n, percentage: 100 }],
      totalIncluded: n,
      shape: "constant",
      notes,
    };
  }

  // Choose the number of bins.
  let appliedMethod: Exclude<BinMethod, "auto"> = "sturges";
  let binCount: number;
  if (options.method === "fixed") {
    appliedMethod = "fixed";
    binCount = Math.round(options.bins ?? 10);
  } else if (options.method === "sturges") {
    binCount = sturgesBinCount(n);
  } else {
    const fd = freedmanDiaconisBinCount(sorted);
    if (fd !== null) {
      appliedMethod = "freedman-diaconis";
      binCount = fd;
    } else {
      binCount = sturgesBinCount(n);
      notes.push(
        options.method === "freedman-diaconis"
          ? "Freedman-Diaconis is not defined here (IQR is 0 or the sample is small); Sturges' rule was used instead."
          : "Sturges' rule was used (Freedman-Diaconis needs at least 5 values and a non-zero IQR)."
      );
    }
  }
  if (binCount > ANALYTICS_LIMITS.maxHistogramBins) {
    notes.push(`The bin count was capped at ${ANALYTICS_LIMITS.maxHistogramBins}.`);
  }
  binCount = Math.max(1, Math.min(ANALYTICS_LIMITS.maxHistogramBins, binCount));

  const binWidth = range / binCount;
  // Edges exactly as numpy.linspace builds them (the last edge is the maximum, not min + k * width).
  const edges = new Float64Array(binCount + 1);
  for (let i = 0; i < binCount; i++) edges[i] = min + i * binWidth;
  edges[binCount] = max;

  const counts = new Array<number>(binCount).fill(0);
  for (let i = 0; i < n; i++) {
    const x = sorted[i];
    let index = Math.min(binCount - 1, Math.floor((x - min) / binWidth));
    // Correct floating-point error against the real edges (same rule as numpy.histogram), so a value
    // lying exactly on an edge always falls into the bin that starts there.
    if (x < edges[index]) index--;
    else if (index !== binCount - 1 && x >= edges[index + 1]) index++;
    counts[index]++;
  }
  const bins = counts.map((count, i) => ({
    start: edges[i],
    end: edges[i + 1],
    count,
    percentage: (count / n) * 100,
  }));

  let shape: HistogramResult["shape"] = "approximately-symmetric";
  if (skewness !== null && skewness > 0.5) shape = "right-skewed";
  else if (skewness !== null && skewness < -0.5) shape = "left-skewed";
  if (n < 8) notes.push("Few observations: the shape of the distribution is not reliable.");

  return {
    ...common,
    appliedMethod,
    binCount,
    binWidth,
    bins,
    totalIncluded: n,
    shape,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Categorical frequencies
// ---------------------------------------------------------------------------

export function classifyCardinality(uniqueCount: number, validCount: number): CardinalityClass {
  if (validCount === 0 || uniqueCount === 0) return "empty";
  if (uniqueCount === 1) return validCount > 1 ? "constant" : "unique";
  if (uniqueCount === validCount && validCount > 2) return "unique";
  if (uniqueCount === 2) return "binary";
  if (uniqueCount <= 10) return "low";
  if (uniqueCount <= 50) return "medium";
  return "high";
}

export interface FrequencyOptions {
  topN?: number;
  /** Categories with a smaller share (in %) of the non-missing values are "rare". Default 1. */
  rareThresholdPercentage?: number;
}

/** Counts of trimmed, case-sensitive category labels (missing values excluded). */
export function countCategories(raw: ArrayLike<string>): { counts: Map<string, number>; validCount: number; missingCount: number } {
  const counts = new Map<string, number>();
  let validCount = 0;
  let missingCount = 0;
  for (let i = 0; i < raw.length; i++) {
    const cell = raw[i];
    if (classifyMissing(cell) !== null) {
      missingCount++;
      continue;
    }
    const label = cell.trim();
    counts.set(label, (counts.get(label) ?? 0) + 1);
    validCount++;
  }
  return { counts, validCount, missingCount };
}

function byCountThenLabel(a: [string, number], b: [string, number]): number {
  return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

export function buildFrequency(column: string, raw: ArrayLike<string>, options: FrequencyOptions = {}): FrequencyResult {
  const topN = Math.max(1, Math.min(ANALYTICS_LIMITS.maxCategoriesShown, options.topN ?? 20));
  const rareThreshold = options.rareThresholdPercentage ?? 1;
  const { counts, validCount, missingCount } = countCategories(raw);
  const toFrequency = ([label, count]: [string, number]): CategoryFrequency => ({
    label,
    count,
    percentage: validCount > 0 ? (count / validCount) * 100 : 0,
  });

  const sorted = [...counts.entries()].sort(byCountThenLabel);
  const shown = sorted.slice(0, topN).map(toFrequency);
  const rest = sorted.slice(topN);
  const otherCount = rest.reduce((sum, [, c]) => sum + c, 0);

  // Least frequent: ascending count, ties alphabetical.
  const leastFrequent = [...sorted]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 5)
    .map(toFrequency);

  const rareAll = sorted.filter(([, c]) => validCount > 0 && (c / validCount) * 100 < rareThreshold);
  const notes: string[] = [];
  const uniqueCount = counts.size;
  const cardinality = classifyCardinality(uniqueCount, validCount);
  if (cardinality === "high" || cardinality === "unique") {
    notes.push("High-cardinality column: only the most frequent categories are charted; the rest is grouped as \"Other\".");
  }
  if (cardinality === "unique") notes.push("Every value is distinct, so this column behaves like an identifier.");
  if (rest.length > 0) notes.push(`${rest.length.toLocaleString()} further categories are grouped as "Other".`);

  return {
    column,
    totalRows: raw.length,
    validCount,
    missingCount,
    uniqueCount,
    cardinality,
    categories: shown,
    otherCount,
    otherCategoryCount: rest.length,
    mostFrequent: sorted.length > 0 ? toFrequency(sorted[0]) : null,
    leastFrequent,
    rareCategories: rareAll.slice(0, 20).map(toFrequency),
    rareCategoryTotal: rareAll.length,
    rareThresholdPercentage: rareThreshold,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_LIKE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
const PART_LIKE = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}/;

/**
 * Works out how day and month are ordered. Values such as "03/04/2021" are ambiguous on their own,
 * so the order is only trusted when another value proves it (a part greater than 12) and no value
 * proves the opposite. Anything else is reported as ambiguous instead of being guessed.
 */
export function analyzeDateFormat(values: string[]): { order: "dmy" | "mdy" | "iso" | null; ambiguous: boolean } {
  let iso = 0;
  let part = 0;
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  for (const raw of values) {
    const v = normalizeDigits(raw.trim());
    if (ISO_LIKE.test(v)) {
      iso++;
      continue;
    }
    const m = PART_LIKE.exec(v);
    if (m) {
      part++;
      if (Number(m[1]) > 12) dayFirstEvidence++;
      if (Number(m[2]) > 12) monthFirstEvidence++;
    }
  }
  if (part === 0) return { order: iso > 0 ? "iso" : null, ambiguous: false };
  if (iso > 0) return { order: null, ambiguous: true };
  if (dayFirstEvidence > 0 && monthFirstEvidence === 0) return { order: "dmy", ambiguous: false };
  if (monthFirstEvidence > 0 && dayFirstEvidence === 0) return { order: "mdy", ambiguous: false };
  return { order: null, ambiguous: true };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toPoints(map: Map<string, number>): CountPoint[] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([label, count]) => ({ label, count }));
}

export function buildDateDistribution(column: string, raw: string[]): DateDistributionResult {
  const nonMissing: string[] = [];
  let missingCount = 0;
  for (const cell of raw) {
    if (classifyMissing(cell) !== null) missingCount++;
    else nonMissing.push(cell);
  }

  const format = analyzeDateFormat(nonMissing);
  const notes: string[] = [];
  const parseOrder = format.order === "dmy" || format.order === "mdy" ? format.order : detectDateOrder(nonMissing);

  const dates: ParsedDate[] = [];
  let invalidCount = 0;
  for (const cell of nonMissing) {
    // In an ambiguous column a "d/m/y" cell cannot be trusted at all, only unambiguous ISO cells can.
    const isIso = ISO_LIKE.test(normalizeDigits(cell.trim()));
    if (format.ambiguous && !isIso) {
      invalidCount++;
      continue;
    }
    const parsed = parseDateValue(cell, parseOrder);
    if (parsed) dates.push(parsed);
    else invalidCount++;
  }

  const base = {
    column,
    totalRows: raw.length,
    validCount: dates.length,
    missingCount,
    invalidCount,
    ambiguousFormat: format.ambiguous,
    dayMonthOrder: format.order,
    notes,
  };

  const jalaliLike = nonMissing.filter((cell) => {
    const m = /^(\d{4})[-/]\d{1,2}[-/]\d{1,2}/.exec(normalizeDigits(cell.trim()));
    return m !== null && Number(m[1]) >= JALALI_YEAR_MIN && Number(m[1]) <= JALALI_YEAR_MAX;
  }).length;
  if (jalaliLike > 0) {
    notes.push(`${jalaliLike.toLocaleString()} value(s) have a year between ${JALALI_YEAR_MIN} and ${JALALI_YEAR_MAX} and look like Solar Hijri (Jalali) dates. They are not converted to Gregorian dates and are counted as not valid.`);
  }
  if (format.ambiguous) {
    notes.push(
      "The day/month order cannot be determined from the values (for example 03/04/2021 could be 3 April or 4 March), so these cells are not treated as dates. Use an unambiguous format such as YYYY-MM-DD."
    );
  }
  if (dates.length === 0) {
    return { ...base, earliest: null, latest: null, spanDays: null, byYear: [], byMonth: null, byDay: null, timeline: [], timelineGranularity: null };
  }

  let earliest = dates[0].date;
  let latest = dates[0].date;
  const years = new Map<string, number>();
  const months = new Array<number>(12).fill(0);
  const days = new Array<number>(31).fill(0);
  for (const { date } of dates) {
    if (date < earliest) earliest = date;
    if (date > latest) latest = date;
    const y = String(date.getUTCFullYear());
    years.set(y, (years.get(y) ?? 0) + 1);
    months[date.getUTCMonth()]++;
    days[date.getUTCDate() - 1]++;
  }
  // Calendar days between the earliest and latest date (time of day is ignored, like the dates shown).
  const dayStart = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const spanDays = Math.round((dayStart(latest) - dayStart(earliest)) / 86_400_000);

  // Timeline granularity: coarse enough to stay readable.
  let granularity: "day" | "month" | "year" = spanDays <= 92 ? "day" : spanDays <= 3 * 366 ? "month" : "year";
  const bucket = (d: Date, g: "day" | "month" | "year"): string =>
    g === "day" ? isoDay(d) : g === "month" ? `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}` : String(d.getUTCFullYear());
  let timelineMap = new Map<string, number>();
  const fill = (g: "day" | "month" | "year") => {
    timelineMap = new Map<string, number>();
    for (const { date } of dates) {
      const key = bucket(date, g);
      timelineMap.set(key, (timelineMap.get(key) ?? 0) + 1);
    }
  };
  fill(granularity);
  if (timelineMap.size > 400 && granularity === "day") {
    granularity = "month";
    fill(granularity);
  }

  const showCalendarParts = !format.ambiguous;
  return {
    ...base,
    earliest: isoDay(earliest),
    latest: isoDay(latest),
    spanDays,
    byYear: toPoints(years),
    byMonth: showCalendarParts ? months.map((count, i) => ({ label: MONTH_LABELS[i], count })) : null,
    byDay: showCalendarParts ? days.map((count, i) => ({ label: String(i + 1), count })) : null,
    timeline: toPoints(timelineMap),
    timelineGranularity: granularity,
  };
}
