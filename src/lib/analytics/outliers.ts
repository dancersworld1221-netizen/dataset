import { medianAbsoluteDeviation, quantileSorted, sortedCopy } from "./numeric";
import {
  ANALYTICS_LIMITS,
  type OutlierExample,
  type OutlierOverview,
  type OutlierParams,
  type OutlierResult,
} from "./types";

/** Fewer valid observations than this: no outlier detection is attempted. */
export const MIN_OUTLIER_SAMPLE = 5;
export const DEFAULT_IQR_MULTIPLIER = 1.5;
export const DEFAULT_Z_THRESHOLD = 3;
export const DEFAULT_MODIFIED_Z_THRESHOLD = 3.5;
/** A column is "zero-inflated" when at least this share of valid values are exactly 0. */
export const ZERO_INFLATION_SHARE = 0.5;
/** 0.6745 is the 75th percentile of the standard normal distribution (Iglewicz & Hoaglin). */
const MODIFIED_Z_CONSTANT = 0.6745;
/** Consistency constant that makes the mean absolute deviation comparable to sigma for normal data. */
const MEAN_AD_CONSTANT = 1.253314;

export interface OutlierInput {
  column: string;
  /** One slot per row; NaN = missing or invalid. */
  values: Float64Array;
  missingCount: number;
  invalidCount: number;
}

const EXPLANATIONS = {
  iqr: (k: number) =>
    `Tukey's fences: a value is a candidate when it is below Q1 - ${k} x IQR or above Q3 + ${k} x IQR, where Q1 and Q3 are the 25th and 75th percentiles and IQR = Q3 - Q1.`,
  zscore: (t: number) =>
    `Z-score: a value is a candidate when its distance from the mean, in sample standard deviations, is greater than ${t}.`,
  "modified-zscore": (t: number) =>
    `Modified z-score: a value is a candidate when 0.6745 x |x - median| / MAD is greater than ${t}. It uses the median and the median absolute deviation (MAD), so it is robust to the outliers themselves.`,
} as const;

const LIMITATIONS = {
  iqr: [
    "Assumes the bulk of the data is reasonably well behaved; with strongly skewed data many ordinary values on the long tail are flagged.",
    "When at least half of the values are identical the IQR is 0 and every different value is flagged.",
  ],
  zscore: [
    "Assumes an approximately normal distribution.",
    "The mean and standard deviation are themselves inflated by outliers, so extreme values can mask each other.",
    "With n observations no value can exceed a |z| of (n - 1) / sqrt(n), so small samples can never reach high thresholds.",
  ],
  "modified-zscore": [
    "When more than half of the values are identical the MAD is 0 and the score falls back to the mean absolute deviation.",
    "Designed for roughly symmetric data; skewed data produces many candidates on the long tail.",
  ],
} as const;

const COMMON_LIMITATION = "A statistical outlier is not necessarily an error: it can be a legitimate rare observation. Nothing is removed or changed.";

function paramsFor(p: OutlierParams): OutlierResult["params"] {
  return {
    method: p.method,
    multiplier: p.method === "iqr" ? (p.multiplier ?? DEFAULT_IQR_MULTIPLIER) : null,
    threshold:
      p.method === "iqr"
        ? null
        : (p.threshold ?? (p.method === "zscore" ? DEFAULT_Z_THRESHOLD : DEFAULT_MODIFIED_Z_THRESHOLD)),
    ignoreZeros: p.ignoreZeros ?? false,
  };
}

/**
 * Flags outlier CANDIDATES in one numeric column. The input is never modified and nothing is deleted.
 * Row indices are 0-based positions among the data rows; `rowNumber` in examples is 1-based.
 */
export function detectOutliers(input: OutlierInput, requested: OutlierParams): OutlierResult {
  const params = paramsFor(requested);
  const { values } = input;
  const valid: number[] = [];
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) valid.push(values[i]);

  const validCount = valid.length;
  let zeroCount = 0;
  for (const v of valid) if (v === 0) zeroCount++;
  const zeroShare = validCount > 0 ? zeroCount / validCount : 0;
  const zeroInflated = validCount > 0 && zeroShare >= ZERO_INFLATION_SHARE;

  const notes: string[] = [];
  const result: OutlierResult = {
    column: input.column,
    method: params.method,
    params,
    validCount,
    invalidCount: input.invalidCount,
    missingCount: input.missingCount,
    outlierCount: 0,
    outlierPercentage: 0,
    lowCount: 0,
    highCount: 0,
    lowerBound: null,
    upperBound: null,
    rowIndices: [],
    examples: [],
    kind: "statistical-outliers",
    zeroInflated,
    zeroPercentage: zeroShare * 100,
    explanation:
      params.method === "iqr"
        ? EXPLANATIONS.iqr(params.multiplier as number)
        : params.method === "zscore"
          ? EXPLANATIONS.zscore(params.threshold as number)
          : EXPLANATIONS["modified-zscore"](params.threshold as number),
    limitations: [...LIMITATIONS[params.method], COMMON_LIMITATION],
    notes,
  };

  if (input.invalidCount > 0) {
    notes.push(`${input.invalidCount.toLocaleString()} non-numeric value(s) are reported as invalid values and are not part of the outlier analysis.`);
  }

  if (validCount < MIN_OUTLIER_SAMPLE) {
    result.kind = "not-applicable";
    notes.push(`Only ${validCount} valid observation(s): at least ${MIN_OUTLIER_SAMPLE} are needed for outlier detection.`);
    return result;
  }

  // Values the method looks at (zeros are set aside when requested).
  const considered = params.ignoreZeros ? valid.filter((v) => v !== 0) : valid;
  if (params.ignoreZeros) {
    notes.push(`Zeros (${zeroCount.toLocaleString()}) were set aside: the fences are computed on the ${considered.length.toLocaleString()} non-zero values and zeros are never flagged.`);
    if (considered.length < MIN_OUTLIER_SAMPLE) {
      result.kind = "not-applicable";
      notes.push("Too few non-zero values for outlier detection.");
      return result;
    }
  }

  const sorted = sortedCopy(considered);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const median = quantileSorted(sorted, 0.5);
  let isFlagged: (x: number) => { flagged: boolean; score: number | null };
  let degenerate = false;

  if (params.method === "iqr") {
    const iqr = q3 - q1;
    const k = params.multiplier as number;
    const lower = q1 - k * iqr;
    const upper = q3 + k * iqr;
    result.lowerBound = lower;
    result.upperBound = upper;
    if (iqr === 0) {
      degenerate = true;
      notes.push("The IQR is 0, so the fences collapse onto a single value and every different value is flagged. These are rare values, not necessarily errors.");
      if (zeroInflated && !params.ignoreZeros) {
        notes.push("This column is zero-inflated: try \"Ignore zeros\" to judge the non-zero values on their own.");
      }
    }
    isFlagged = (x) => ({ flagged: x < lower || x > upper, score: null });
  } else if (params.method === "zscore") {
    let sum = 0;
    for (const v of considered) sum += v;
    const mean = sum / considered.length;
    let m2 = 0;
    for (const v of considered) m2 += (v - mean) ** 2;
    const sd = Math.sqrt(m2 / (considered.length - 1));
    const threshold = params.threshold as number;
    if (!(sd > 0) || !Number.isFinite(sd)) {
      result.kind = "not-applicable";
      notes.push("The standard deviation is 0 (or not finite), so z-scores are undefined.");
      return result;
    }
    const maxPossible = (considered.length - 1) / Math.sqrt(considered.length);
    if (threshold >= maxPossible) {
      notes.push(`With ${considered.length} observations |z| cannot exceed ${maxPossible.toFixed(2)}, so a threshold of ${threshold} can never flag a value.`);
    }
    result.lowerBound = mean - threshold * sd;
    result.upperBound = mean + threshold * sd;
    isFlagged = (x) => {
      const z = (x - mean) / sd;
      return { flagged: Math.abs(z) > threshold, score: z };
    };
  } else {
    const mad = medianAbsoluteDeviation(sorted, median);
    const threshold = params.threshold as number;
    let scale: number;
    if (mad > 0) {
      scale = mad / MODIFIED_Z_CONSTANT;
    } else {
      let meanAd = 0;
      for (const v of considered) meanAd += Math.abs(v - median);
      meanAd /= considered.length;
      if (!(meanAd > 0)) {
        result.kind = "not-applicable";
        notes.push("MAD and mean absolute deviation are both 0 (almost all values are identical), so the modified z-score is undefined.");
        return result;
      }
      degenerate = true;
      scale = meanAd * MEAN_AD_CONSTANT;
      notes.push("The MAD is 0 (more than half of the values are identical); the mean absolute deviation was used instead. Flagged values are rare values, not necessarily errors.");
    }
    result.lowerBound = median - threshold * scale;
    result.upperBound = median + threshold * scale;
    isFlagged = (x) => {
      const m = (x - median) / scale;
      return { flagged: Math.abs(m) > threshold, score: m };
    };
  }

  if (degenerate) result.kind = "rare-values";

  const examples: OutlierExample[] = [];
  const rowIndices: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (Number.isNaN(x)) continue;
    if (params.ignoreZeros && x === 0) continue;
    const { flagged, score } = isFlagged(x);
    if (!flagged) continue;
    rowIndices.push(i);
    const direction: "low" | "high" = score !== null ? (score < 0 ? "low" : "high") : x < (result.lowerBound as number) ? "low" : "high";
    if (direction === "low") result.lowCount++;
    else result.highCount++;
    if (examples.length < ANALYTICS_LIMITS.maxOutlierExamples) {
      examples.push({ rowNumber: i + 1, value: x, score, direction });
    }
  }

  result.rowIndices = rowIndices;
  result.examples = examples;
  result.outlierCount = rowIndices.length;
  result.outlierPercentage = validCount > 0 ? (rowIndices.length / validCount) * 100 : 0;
  return result;
}

/** Runs the three methods and lists rows flagged by at least two of them. */
export function detectOutliersAllMethods(
  input: OutlierInput,
  options: { multiplier?: number; zThreshold?: number; modifiedThreshold?: number; ignoreZeros?: boolean } = {}
): OutlierOverview {
  const iqr = detectOutliers(input, { method: "iqr", multiplier: options.multiplier, ignoreZeros: options.ignoreZeros });
  const zscore = detectOutliers(input, { method: "zscore", threshold: options.zThreshold, ignoreZeros: options.ignoreZeros });
  const modifiedZScore = detectOutliers(input, { method: "modified-zscore", threshold: options.modifiedThreshold, ignoreZeros: options.ignoreZeros });

  const votes = new Map<number, number>();
  for (const result of [iqr, zscore, modifiedZScore]) {
    for (const index of result.rowIndices) votes.set(index, (votes.get(index) ?? 0) + 1);
  }
  const consensusRowIndices = [...votes.entries()].filter(([, v]) => v >= 2).map(([i]) => i).sort((a, b) => a - b);
  return { column: input.column, iqr, zscore, modifiedZScore, consensusRowIndices };
}
