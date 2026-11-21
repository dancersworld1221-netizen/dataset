import type { NumericSummary } from "./types";

/** Below this many observations skewness and kurtosis are reported but flagged as unstable. */
export const SHAPE_STABILITY_MIN_N = 8;

/** Ascending sorted copy (typed arrays sort numerically). */
export function sortedCopy(values: ArrayLike<number>): Float64Array {
  const copy = Float64Array.from(values as ArrayLike<number>);
  copy.sort();
  return copy;
}

/**
 * Quantile with linear interpolation between order statistics (Hyndman-Fan type 7, the default of
 * NumPy, R and Excel's QUARTILE.INC). Used for every quantile in the app so results are consistent.
 * `sorted` must be ascending and non-empty.
 */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const position = (n - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Kahan-Babuska compensated sum. */
export function compensatedSum(values: ArrayLike<number>): number {
  let sum = 0;
  let compensation = 0;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    const t = sum + x;
    compensation += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return sum + compensation;
}

/** Median absolute deviation (raw, not scaled) around `center`. */
export function medianAbsoluteDeviation(values: ArrayLike<number>, center: number): number {
  const deviations = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs(values[i] - center);
  deviations.sort();
  return quantileSorted(deviations, 0.5);
}

function emptySummary(
  column: string,
  totalRows: number,
  missingCount: number,
  invalidCount: number
): NumericSummary {
  return {
    column,
    totalRows,
    count: 0,
    missingCount,
    invalidCount,
    min: null,
    max: null,
    range: null,
    sum: null,
    mean: null,
    median: null,
    modes: [],
    modeFrequency: 0,
    variance: null,
    stdDev: null,
    populationVariance: null,
    populationStdDev: null,
    q1: null,
    q2: null,
    q3: null,
    iqr: null,
    mad: null,
    coefficientOfVariation: null,
    skewness: null,
    excessKurtosis: null,
    zeroCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    warnings: [],
  };
}

/**
 * Descriptive statistics for the valid observations of one column.
 *
 * Conventions (also shown in the UI):
 * - `variance` / `stdDev` are SAMPLE statistics (divisor n - 1); the population versions
 *   (divisor n) are reported separately.
 * - Quantiles use linear interpolation (type 7).
 * - Nothing is rounded; rounding is a display concern.
 * - Statistics that are mathematically undefined for the sample (for example the standard
 *   deviation of a single value, or skewness of a constant column) are `null`, never 0 or NaN.
 *
 * @param valid finite numbers only (missing and invalid cells already removed).
 */
export function computeNumericSummary(
  column: string,
  valid: ArrayLike<number>,
  meta: { totalRows: number; missingCount: number; invalidCount: number; notes?: string[] }
): NumericSummary {
  const n = valid.length;
  const summary = emptySummary(column, meta.totalRows, meta.missingCount, meta.invalidCount);
  if (meta.notes) summary.warnings.push(...meta.notes);
  if (n === 0) {
    summary.warnings.push("No valid numeric observations.");
    return summary;
  }

  const sorted = sortedCopy(valid);
  summary.count = n;
  summary.min = sorted[0];
  summary.max = sorted[n - 1];
  summary.range = summary.max - summary.min;
  if (!Number.isFinite(summary.range)) {
    summary.range = null;
    summary.warnings.push("The range overflows the floating-point limit.");
  }

  // Sum and mean (overflow-safe).
  const sum = compensatedSum(sorted);
  let mean: number;
  if (Number.isFinite(sum)) {
    summary.sum = sum;
    mean = sum / n;
  } else {
    summary.warnings.push("Values are too large: the sum overflows, so it is not reported.");
    let running = 0;
    for (let i = 0; i < n; i++) running += (sorted[i] - running) / (i + 1);
    mean = running;
  }
  summary.mean = Number.isFinite(mean) ? mean : null;

  // Quantiles, MAD.
  summary.q1 = quantileSorted(sorted, 0.25);
  summary.median = quantileSorted(sorted, 0.5);
  summary.q2 = summary.median;
  summary.q3 = quantileSorted(sorted, 0.75);
  summary.iqr = summary.q3 - summary.q1;
  summary.mad = medianAbsoluteDeviation(sorted, summary.median);

  // Sign counts.
  for (let i = 0; i < n; i++) {
    const x = sorted[i];
    if (x === 0) summary.zeroCount++;
    else if (x > 0) summary.positiveCount++;
    else summary.negativeCount++;
  }

  // Mode(s): runs in the sorted array with the highest frequency (> 1).
  let bestRun = 1;
  let runStart = 0;
  const runs: Array<[number, number]> = [];
  for (let i = 1; i <= n; i++) {
    if (i === n || sorted[i] !== sorted[runStart]) {
      const length = i - runStart;
      if (length > bestRun) {
        bestRun = length;
        runs.length = 0;
      }
      if (length === bestRun && length > 1) runs.push([sorted[runStart], length]);
      runStart = i;
    }
  }
  summary.modes = runs.map(([value]) => value);
  summary.modeFrequency = summary.modes.length > 0 ? bestRun : 0;

  if (summary.mean === null) return summary;

  // ---- Spread and shape -------------------------------------------------------------------
  // The mean is rounded to a double, so for data with a huge offset (1e12 + small noise) every
  // deviation (x - mean) carries the same small systematic error. It is removed by shifting each
  // deviation by delta = sum(x - mean) / n (the "corrected two-pass" algorithm). Deviations are also
  // scaled by their largest magnitude before squaring, so tiny (1e-200) and huge (1e200) data do not
  // underflow or overflow while the standard deviation stays accurate.
  const constant = sorted[0] === sorted[n - 1];
  if (constant) {
    // Avoid spurious "spread" caused by sum / n rounding (for example 0.1 + 0.1 + 0.1 over 3).
    mean = sorted[0];
    summary.mean = mean;
  }

  let s1 = 0;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const d = sorted[i] - mean;
    if (!Number.isFinite(d)) {
      summary.warnings.push("Values are too large: deviations from the mean overflow, so spread statistics are not reported.");
      return summary;
    }
    s1 += d;
    const a = Math.abs(d);
    if (a > scale) scale = a;
  }
  const delta = constant ? 0 : s1 / n;

  let u2 = 0;
  if (scale > 0 && !constant) {
    for (let i = 0; i < n; i++) {
      const u = (sorted[i] - mean - delta) / scale;
      u2 += u * u;
    }
  }
  const populationStdDev = constant ? 0 : scale * Math.sqrt(u2 / n);
  const sampleStdDev = n >= 2 ? (constant ? 0 : scale * Math.sqrt(u2 / (n - 1))) : null;

  const populationVariance = populationStdDev * populationStdDev;
  if (populationStdDev > 0 && (populationVariance === 0 || !Number.isFinite(populationVariance))) {
    summary.warnings.push("The variance is outside the floating-point range (data scale is extreme); the standard deviation is still reported.");
  } else {
    summary.populationVariance = populationVariance;
  }
  summary.populationStdDev = populationStdDev;

  if (n < 2 || sampleStdDev === null) {
    summary.warnings.push("A single observation: sample variance, standard deviation and shape statistics are undefined.");
    return summary;
  }

  const variance = sampleStdDev * sampleStdDev;
  if (sampleStdDev > 0 && (variance === 0 || !Number.isFinite(variance))) {
    // Variance is not representable, the standard deviation is.
  } else {
    summary.variance = variance;
  }
  summary.stdDev = sampleStdDev;

  if (summary.mean !== 0) {
    const cv = sampleStdDev / Math.abs(summary.mean);
    if (Number.isFinite(cv)) summary.coefficientOfVariation = cv;
  } else {
    summary.warnings.push("The mean is 0, so the coefficient of variation is undefined.");
  }

  if (sampleStdDev === 0) {
    summary.warnings.push("Constant column: every observation is identical, so skewness and kurtosis are undefined.");
    return summary;
  }

  let cubes = 0;
  let fourths = 0;
  for (let i = 0; i < n; i++) {
    const z = (sorted[i] - mean - delta) / sampleStdDev;
    const z2 = z * z;
    cubes += z2 * z;
    fourths += z2 * z2;
  }
  if (n >= 3 && Number.isFinite(cubes)) {
    summary.skewness = (n / ((n - 1) * (n - 2))) * cubes;
  } else if (n < 3) {
    summary.warnings.push("Skewness needs at least 3 observations.");
  }
  if (n >= 4 && Number.isFinite(fourths)) {
    summary.excessKurtosis =
      ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * fourths -
      (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  } else if (n < 4) {
    summary.warnings.push("Kurtosis needs at least 4 observations.");
  }
  if (n < SHAPE_STABILITY_MIN_N) {
    summary.warnings.push(`Only ${n} observations: skewness and kurtosis are unstable below ${SHAPE_STABILITY_MIN_N}.`);
  }

  return summary;
}
