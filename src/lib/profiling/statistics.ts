import type {
  ColumnStatistics,
  ColumnDataType,
  HistogramBin,
  TopValue,
} from "@/types/dataset.types";
import { computeNumericSummary } from "@/lib/analytics/numeric";
import { buildHistogram } from "@/lib/analytics/distribution";
import { detectOutliers } from "@/lib/analytics/outliers";
import {
  detectDateOrder,
  isFalseValue,
  isNonMissingValue,
  isTrueValue,
  parseDateValue,
  parseNumber,
} from "./typeInference";

const HISTOGRAM_BINS = 10;
const TOP_VALUES = 5;
const MS_PER_DAY = 86_400_000;

export interface NumericStats {
  count: number;
  min?: number;
  max?: number;
  sum?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  outlierCount?: number;
  skewness?: number;
  mode?: number;
  modeCount?: number;
  histogram?: HistogramBin[];
}

export interface TextStats {
  minLength: number;
  maxLength: number;
  avgLength: number;
  mode?: string;
  modeCount?: number;
  topValues: TopValue[];
}

export interface BooleanStats {
  trueCount: number;
  falseCount: number;
}

export interface DateStats {
  earliestDate: Date | null;
  latestDate: Date | null;
  spanDays?: number;
}

/**
 * Numeric statistics stored with a column profile. The calculations live in the analytics engine
 * (`lib/analytics`) so there is a single implementation of quantiles, skewness, histograms and
 * outlier fences; this function only adapts the result to the profile shape.
 */
export function calculateNumericStats(values: string[]): NumericStats {
  const valid: number[] = [];
  for (const v of values) {
    if (!isNonMissingValue(v)) continue;
    const n = parseNumber(v);
    if (n) valid.push(n.value);
  }
  if (valid.length === 0) return { count: 0 };

  const summary = computeNumericSummary("", valid, { totalRows: values.length, missingCount: 0, invalidCount: 0 });
  const histogram = buildHistogram("", valid, { missingCount: 0, invalidCount: 0 }, { method: "fixed", bins: HISTOGRAM_BINS });
  const outliers = detectOutliers({ column: "", values: Float64Array.from(valid), missingCount: 0, invalidCount: 0 }, { method: "iqr" });

  return {
    count: summary.count,
    min: summary.min ?? undefined,
    max: summary.max ?? undefined,
    sum: summary.sum ?? undefined,
    mean: summary.mean ?? undefined,
    median: summary.median ?? undefined,
    stdDev: summary.stdDev ?? undefined,
    q1: summary.q1 ?? undefined,
    q3: summary.q3 ?? undefined,
    iqr: summary.iqr ?? undefined,
    outlierCount: outliers.outlierCount,
    skewness: summary.skewness ?? undefined,
    mode: summary.modes[0],
    modeCount: summary.modes.length > 0 ? summary.modeFrequency : undefined,
    histogram: histogram.bins.map(({ start, end, count }) => ({ start, end, count })),
  };
}

export function calculateTextStats(values: string[]): TextStats {
  let count = 0;
  let totalLength = 0;
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;
  const frequency = new Map<string, number>();

  // Plain loop on purpose: spreading large arrays into Math.min/max throws RangeError.
  for (const v of values) {
    if (!isNonMissingValue(v)) continue;
    count++;
    totalLength += v.length;
    if (v.length < minLength) minLength = v.length;
    if (v.length > maxLength) maxLength = v.length;
    frequency.set(v, (frequency.get(v) ?? 0) + 1);
  }

  if (count === 0) {
    return { minLength: 0, maxLength: 0, avgLength: 0, topValues: [] };
  }

  const topValues = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_VALUES)
    .map(([value, c]) => ({ value, count: c }));
  const top = topValues[0];

  return {
    minLength,
    maxLength,
    avgLength: totalLength / count,
    mode: top && top.count > 1 ? top.value : undefined,
    modeCount: top && top.count > 1 ? top.count : undefined,
    topValues,
  };
}

export function calculateBooleanStats(values: string[]): BooleanStats {
  let trueCount = 0;
  let falseCount = 0;

  for (const v of values) {
    if (!isNonMissingValue(v)) continue;
    if (isTrueValue(v)) trueCount++;
    else if (isFalseValue(v)) falseCount++;
  }

  return { trueCount, falseCount };
}

export function calculateDateStats(values: string[]): DateStats {
  const nonMissing = values.filter((v) => isNonMissingValue(v));
  const order = detectDateOrder(nonMissing);
  let earliest: Date | null = null;
  let latest: Date | null = null;

  for (const v of nonMissing) {
    const parsed = parseDateValue(v, order);
    if (!parsed) continue;
    if (!earliest || parsed.date < earliest) earliest = parsed.date;
    if (!latest || parsed.date > latest) latest = parsed.date;
  }

  const spanDays =
    earliest && latest ? (latest.getTime() - earliest.getTime()) / MS_PER_DAY : undefined;
  return { earliestDate: earliest, latestDate: latest, spanDays };
}

/**
 * Builds the statistics stored with a column. Returns undefined when there is nothing to report
 * (for example a numeric column without a single parsable value).
 */
export function buildColumnStatistics(
  dataType: ColumnDataType,
  values: string[]
): ColumnStatistics | undefined {
  switch (dataType) {
    case "integer":
    case "decimal": {
      const stats = calculateNumericStats(values);
      return stats.count === 0 ? undefined : stats;
    }
    case "string":
      return calculateTextStats(values);
    case "boolean":
      return calculateBooleanStats(values);
    case "date":
    case "datetime": {
      const stats = calculateDateStats(values);
      if (!stats.earliestDate || !stats.latestDate) return undefined;
      return {
        earliestDate: stats.earliestDate,
        latestDate: stats.latestDate,
        spanDays: stats.spanDays,
      };
    }
    default:
      return undefined;
  }
}
