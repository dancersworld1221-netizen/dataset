import type { ColumnDataType } from "@/types/dataset.types";

/** Limits that keep analysis responsive. They are surfaced to the user as warnings, never silently. */
export const ANALYTICS_LIMITS = {
  /** Largest correlation matrix (features) computed in one request. */
  maxMatrixFeatures: 40,
  /** Largest number of histogram bins a user can request. */
  maxHistogramBins: 200,
  /** Categories listed individually before the rest is grouped as "Other". */
  maxCategoriesShown: 50,
  /** Outlier rows returned in `examples` (all row indices are still returned). */
  maxOutlierExamples: 200,
  /** Points drawn in a scatter plot (deterministic stride sampling). */
  maxScatterPoints: 1000,
  /** Numeric columns compared pairwise for similar distributions. */
  maxSimilarityFeatures: 20,
  /** Distinct classes above which a column is not a sensible classification target. */
  maxTargetClasses: 50,
} as const;

export interface ColumnInfo {
  name: string;
  dataType: ColumnDataType;
}

export const isNumericType = (t: ColumnDataType): boolean => t === "integer" || t === "decimal";
export const isCategoricalType = (t: ColumnDataType): boolean => t === "string" || t === "boolean";

/** Thrown when a running analysis is cancelled because its result is no longer needed. */
export class AnalysisCancelledError extends Error {
  constructor() {
    super("Analysis cancelled");
    this.name = "AnalysisCancelledError";
  }
}

// ---------------------------------------------------------------------------
// Numeric statistics
// ---------------------------------------------------------------------------

export interface NumericSummary {
  column: string;
  /** Rows in the dataset. */
  totalRows: number;
  /** Valid numeric observations used for every statistic below. */
  count: number;
  /** Empty cells and missing-value markers. */
  missingCount: number;
  /** Non-missing cells that are not finite numbers (text, NaN, Infinity, ...). */
  invalidCount: number;
  min: number | null;
  max: number | null;
  range: number | null;
  /** Compensated (Kahan) sum; null when it overflows. */
  sum: number | null;
  mean: number | null;
  /** Q2. */
  median: number | null;
  /** Every value with the highest frequency, only when that frequency is greater than 1. */
  modes: number[];
  modeFrequency: number;
  /** SAMPLE variance, divisor n - 1. */
  variance: number | null;
  /** SAMPLE standard deviation, sqrt(variance). */
  stdDev: number | null;
  /** POPULATION variance, divisor n. */
  populationVariance: number | null;
  /** POPULATION standard deviation. */
  populationStdDev: number | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  iqr: number | null;
  /** Median absolute deviation, NOT scaled by 1.4826. */
  mad: number | null;
  /** Sample standard deviation divided by |mean|; null when the mean is 0. */
  coefficientOfVariation: number | null;
  /** Adjusted Fisher-Pearson skewness (G1). Needs n >= 3 and a non-zero spread. */
  skewness: number | null;
  /** Sample excess kurtosis (G2, normal distribution = 0). Needs n >= 4 and a non-zero spread. */
  excessKurtosis: number | null;
  zeroCount: number;
  positiveCount: number;
  negativeCount: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

export type BinMethod = "auto" | "sturges" | "freedman-diaconis" | "fixed";

export interface HistogramBin {
  start: number;
  /** Exclusive, except for the last bin whose upper edge is inclusive. */
  end: number;
  count: number;
  /** Share of valid observations (0-100). */
  percentage: number;
}

export interface HistogramResult {
  column: string;
  requestedMethod: BinMethod;
  /** The rule that produced the bin count (after fallbacks). */
  appliedMethod: Exclude<BinMethod, "auto">;
  binCount: number;
  binWidth: number;
  bins: HistogramBin[];
  /** Valid observations placed in bins; always equals the sum of bin counts. */
  totalIncluded: number;
  missingCount: number;
  invalidCount: number;
  min: number | null;
  max: number | null;
  range: number | null;
  zeroCount: number;
  zeroPercentage: number;
  positiveCount: number;
  negativeCount: number;
  skewness: number | null;
  shape: "empty" | "constant" | "approximately-symmetric" | "right-skewed" | "left-skewed";
  notes: string[];
}

export type CardinalityClass = "empty" | "constant" | "binary" | "low" | "medium" | "high" | "unique";

export interface CategoryFrequency {
  label: string;
  count: number;
  /** Share of non-missing values (0-100). */
  percentage: number;
}

export interface FrequencyResult {
  column: string;
  totalRows: number;
  validCount: number;
  missingCount: number;
  uniqueCount: number;
  cardinality: CardinalityClass;
  /** Most frequent categories, at most `topN`. */
  categories: CategoryFrequency[];
  otherCount: number;
  otherCategoryCount: number;
  mostFrequent: CategoryFrequency | null;
  /** Up to five least frequent categories (ties broken alphabetically). */
  leastFrequent: CategoryFrequency[];
  /** Categories below `rareThresholdPercentage` of the non-missing values. */
  rareCategories: CategoryFrequency[];
  rareCategoryTotal: number;
  rareThresholdPercentage: number;
  notes: string[];
}

export interface CountPoint {
  label: string;
  count: number;
}

export interface DateDistributionResult {
  column: string;
  totalRows: number;
  validCount: number;
  missingCount: number;
  /** Non-missing values that are not valid dates. */
  invalidCount: number;
  /** True when day/month order cannot be determined; month/day views are then withheld. */
  ambiguousFormat: boolean;
  dayMonthOrder: "dmy" | "mdy" | "iso" | null;
  earliest: string | null;
  latest: string | null;
  spanDays: number | null;
  byYear: CountPoint[];
  /** Calendar months 1-12 (null when the format is ambiguous). */
  byMonth: CountPoint[] | null;
  /** Day of month 1-31 (null when the format is ambiguous). */
  byDay: CountPoint[] | null;
  timeline: CountPoint[];
  timelineGranularity: "day" | "month" | "year" | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Outliers
// ---------------------------------------------------------------------------

export type OutlierMethod = "iqr" | "zscore" | "modified-zscore";

export interface OutlierParams {
  method: OutlierMethod;
  /** IQR fence multiplier (default 1.5). */
  multiplier?: number;
  /** |z| threshold (default 3 for z-score, 3.5 for modified z-score). */
  threshold?: number;
  /** Compute the fences on non-zero values only and never flag zeros (zero-inflated columns). */
  ignoreZeros?: boolean;
}

export interface OutlierExample {
  /** 1-based position of the row among the data rows (the header is not counted). */
  rowNumber: number;
  value: number;
  /** z or modified z (null for the IQR method). */
  score: number | null;
  direction: "low" | "high";
}

export interface OutlierResult {
  column: string;
  method: OutlierMethod;
  params: Required<Pick<OutlierParams, "method">> & { multiplier: number | null; threshold: number | null; ignoreZeros: boolean };
  validCount: number;
  invalidCount: number;
  missingCount: number;
  /** Number of flagged candidates. */
  outlierCount: number;
  outlierPercentage: number;
  lowCount: number;
  highCount: number;
  lowerBound: number | null;
  upperBound: number | null;
  /** 0-based data-row indices of every flagged row (ascending). */
  rowIndices: number[];
  examples: OutlierExample[];
  /**
   * "statistical-outliers": the method worked as designed.
   * "rare-values": the spread is degenerate (IQR or MAD is 0), so flagged values are merely
   * different from a dominant value, which is not evidence of an error.
   * "not-applicable": too few observations or no spread.
   */
  kind: "statistical-outliers" | "rare-values" | "not-applicable";
  zeroInflated: boolean;
  zeroPercentage: number;
  explanation: string;
  limitations: string[];
  notes: string[];
}

export interface OutlierOverview {
  column: string;
  iqr: OutlierResult;
  zscore: OutlierResult;
  modifiedZScore: OutlierResult;
  /** 0-based rows flagged by at least two methods ("potential anomalies"). */
  consensusRowIndices: number[];
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export type CorrelationMethod = "pearson" | "spearman";
export type CorrelationStrength = "negligible" | "weak" | "moderate" | "strong" | "very strong";

export interface CorrelationCell {
  /** null when the coefficient is undefined (constant column, too few pairs). */
  r: number | null;
  /** Paired complete observations behind the coefficient. */
  n: number;
  reason: "constant" | "insufficient" | "overflow" | null;
}

export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
  n: number;
  strength: CorrelationStrength;
  direction: "positive" | "negative";
}

export interface ExcludedFeature {
  name: string;
  reason: string;
}

export interface CorrelationResult {
  method: CorrelationMethod;
  features: string[];
  /** Row-major square matrix, cells[i][j] (diagonal r = 1). */
  cells: CorrelationCell[][];
  /** Every defined pair, strongest first (by |r|). */
  pairs: CorrelationPair[];
  strongestPositive: CorrelationPair[];
  strongestNegative: CorrelationPair[];
  excluded: ExcludedFeature[];
  warnings: string[];
}

export interface PairDetailResult {
  x: string;
  y: string;
  pearson: CorrelationCell;
  spearman: CorrelationCell;
  /** Deterministic sample of paired complete observations for plotting. */
  points: Array<[number, number]>;
  sampled: boolean;
  pairedCount: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Categorical / class imbalance
// ---------------------------------------------------------------------------

export type ImbalanceSeverity =
  | "balanced"
  | "mild"
  | "moderate"
  | "severe"
  | "extreme"
  | "single-class"
  | "empty";

export interface ClassImbalanceResult {
  target: string;
  totalRows: number;
  /** Rows with a usable target value. */
  validCount: number;
  missingCount: number;
  classCount: number;
  classes: CategoryFrequency[];
  classesTruncated: boolean;
  majority: CategoryFrequency | null;
  minority: CategoryFrequency | null;
  /** majority count / minority count (>= 1); null for fewer than two classes. */
  ratio: number | null;
  severity: ImbalanceSeverity;
  /** False when the column has too many distinct values to be a classification target. */
  suitableAsTarget: boolean;
  definition: string;
  warnings: string[];
}

export interface CategoricalSummary {
  column: string;
  dataType: ColumnDataType;
  frequency: FrequencyResult;
}

// ---------------------------------------------------------------------------
// Feature relationships
// ---------------------------------------------------------------------------

export interface DuplicateColumnGroup {
  columns: string[];
}

export interface RedundantPair {
  a: string;
  b: string;
  /** Pearson r on pairwise complete observations. */
  r: number;
  n: number;
}

export interface SimilarDistributionPair {
  a: string;
  b: string;
  /** Two-sample Kolmogorov-Smirnov distance (0 = identical empirical distributions). */
  ksDistance: number;
}

export interface RelationshipsResult {
  /** Columns whose values are identical row by row (after trimming). Not a statistical claim. */
  exactDuplicates: DuplicateColumnGroup[];
  /** |Pearson r| at or above the threshold. Statistical similarity only. */
  highlyCorrelated: RedundantPair[];
  correlationThreshold: number;
  similarDistributions: SimilarDistributionPair[];
  ksThreshold: number;
  warnings: string[];
}

export interface FeatureComparisonItem {
  column: string;
  dataType: ColumnDataType;
  totalRows: number;
  missingCount: number;
  missingPercentage: number;
  uniqueCount: number;
  numeric: NumericSummary | null;
  topCategories: CategoryFrequency[];
}

export interface FeaturePairComparison {
  a: string;
  b: string;
  exactDuplicate: boolean;
  kind: "numeric" | "categorical" | "mixed";
  pearson: CorrelationCell | null;
  spearman: CorrelationCell | null;
  ksDistance: number | null;
  cramersV: number | null;
  notes: string[];
}

export interface FeatureComparisonResult {
  items: FeatureComparisonItem[];
  pairs: FeaturePairComparison[];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ReportWarning {
  severity: "info" | "warning";
  message: string;
}

export interface AnalyticalReport {
  generatedFor: { datasetId: string; filename: string; version: string };
  overview: {
    rows: number;
    columns: number;
    numericColumns: number;
    categoricalColumns: number;
    dateColumns: number;
    emptyColumns: number;
    completenessPercentage: number | null;
    truncated: boolean;
  };
  numeric: Array<
    Pick<
      NumericSummary,
      | "column" | "count" | "missingCount" | "invalidCount" | "min" | "max" | "mean" | "median"
      | "stdDev" | "skewness" | "excessKurtosis" | "coefficientOfVariation"
    >
  >;
  categorical: Array<{
    column: string;
    uniqueCount: number;
    cardinality: CardinalityClass;
    mostFrequent: CategoryFrequency | null;
    missingCount: number;
  }>;
  distributionObservations: string[];
  outliers: Array<{ column: string; method: "iqr"; count: number; percentage: number; kind: OutlierResult["kind"]; lowerBound: number | null; upperBound: number | null }>;
  strongCorrelations: CorrelationPair[];
  correlationMethod: CorrelationMethod;
  classImbalance: ClassImbalanceResult | null;
  redundancy: { exactDuplicates: DuplicateColumnGroup[]; highlyCorrelated: RedundantPair[] };
  warnings: ReportWarning[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type AnalysisRequest =
  | { kind: "numericSummary" }
  | { kind: "histogram"; column: string; method: BinMethod; bins?: number }
  | { kind: "categoricalSummary"; topN?: number }
  | { kind: "frequency"; column: string; topN?: number; rareThresholdPercentage?: number }
  | { kind: "dateDistribution"; column: string }
  | { kind: "outliers"; column: string; params: OutlierParams }
  | { kind: "outlierOverview"; column: string; multiplier?: number; zThreshold?: number; modifiedThreshold?: number; ignoreZeros?: boolean }
  | { kind: "correlation"; method: CorrelationMethod; columns?: string[] }
  | { kind: "pairDetail"; x: string; y: string }
  | { kind: "classImbalance"; target: string }
  | { kind: "relationships"; correlationThreshold?: number }
  | { kind: "compare"; columns: string[] }
  | { kind: "report"; target?: string; meta: { datasetId: string; filename: string; version: string; completenessPercentage: number | null; truncated: boolean } };

export interface AnalysisResultMap {
  numericSummary: NumericSummary[];
  histogram: HistogramResult;
  categoricalSummary: CategoricalSummary[];
  frequency: FrequencyResult;
  dateDistribution: DateDistributionResult;
  outliers: OutlierResult;
  outlierOverview: OutlierOverview;
  correlation: CorrelationResult;
  pairDetail: PairDetailResult;
  classImbalance: ClassImbalanceResult;
  relationships: RelationshipsResult;
  compare: FeatureComparisonResult;
  report: AnalyticalReport;
}

export type AnalysisKind = keyof AnalysisResultMap;
export type AnalysisResultFor<R extends AnalysisRequest> = AnalysisResultMap[R["kind"]];
