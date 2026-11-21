import { formatNumber } from "@/lib/format";
import {
  isCategoricalType,
  isNumericType,
  type AnalyticalReport,
  type CategoricalSummary,
  type ClassImbalanceResult,
  type ColumnInfo,
  type CorrelationResult,
  type NumericSummary,
  type OutlierResult,
  type RelationshipsResult,
  type ReportWarning,
} from "./types";

export const STRONG_CORRELATION_THRESHOLD = 0.7;
const MAX_STRONG_CORRELATIONS = 10;

export interface ReportInputs {
  meta: AnalyticalReport["generatedFor"] & { completenessPercentage: number | null; truncated: boolean };
  columns: ColumnInfo[];
  rowCount: number;
  numeric: NumericSummary[];
  categorical: CategoricalSummary[];
  outliers: OutlierResult[];
  correlation: CorrelationResult;
  relationships: RelationshipsResult;
  imbalance: ClassImbalanceResult | null;
}

/** Deterministic (en-US) number formatting: the same report text on every machine. */
const fmt = (n: number | null | undefined, maxFractionDigits?: number): string =>
  n === null || n === undefined ? "n/a" : formatNumber(n, maxFractionDigits, "en-US");

/**
 * Builds the analytical report purely from already computed results. It contains no model output
 * and is deterministic, so a later phase can use it as structured context.
 */
export function buildReport(inputs: ReportInputs): AnalyticalReport {
  const { columns, numeric, categorical, outliers, correlation, relationships, imbalance, meta } = inputs;
  const warnings: ReportWarning[] = [];
  const observations: string[] = [];

  for (const s of numeric) {
    if (s.count === 0) continue;
    if (s.stdDev === 0) observations.push(`"${s.column}" is constant (every value is ${fmt(s.min)}).`);
    if (s.skewness !== null && Math.abs(s.skewness) > 1) {
      observations.push(`"${s.column}" is strongly ${s.skewness > 0 ? "right" : "left"}-skewed (skewness ${fmt(s.skewness)}).`);
    }
    if (s.excessKurtosis !== null && s.excessKurtosis > 3) {
      observations.push(`"${s.column}" has heavy tails (excess kurtosis ${fmt(s.excessKurtosis)}).`);
    }
    if (s.count > 0 && s.zeroCount / s.count >= 0.5) {
      observations.push(`"${s.column}" is zero-inflated: ${fmt((s.zeroCount / s.count) * 100, 1)}% of values are exactly 0.`);
    }
    if (s.invalidCount > 0) {
      warnings.push({ severity: "warning", message: `"${s.column}" contains ${s.invalidCount.toLocaleString()} value(s) that are not valid numbers; they are excluded from its statistics.` });
    }
    if (s.count > 0 && s.count < 30) {
      warnings.push({ severity: "info", message: `"${s.column}" has only ${s.count} valid observations; its statistics are not reliable.` });
    }
  }
  for (const c of categorical) {
    const f = c.frequency;
    if (f.cardinality === "constant") observations.push(`"${c.column}" has a single category.`);
    if (f.cardinality === "high" || f.cardinality === "unique") {
      observations.push(`"${c.column}" has very high cardinality (${f.uniqueCount.toLocaleString()} distinct values).`);
    }
    if (f.rareCategoryTotal > 0 && f.cardinality !== "high" && f.cardinality !== "unique") {
      observations.push(`"${c.column}" has ${f.rareCategoryTotal} rare categor${f.rareCategoryTotal === 1 ? "y" : "ies"} (under ${f.rareThresholdPercentage}% of values).`);
    }
  }

  const outlierRows = outliers
    .filter((o) => o.kind !== "not-applicable")
    .map((o) => ({
      column: o.column,
      method: "iqr" as const,
      count: o.outlierCount,
      percentage: o.outlierPercentage,
      kind: o.kind,
      lowerBound: o.lowerBound,
      upperBound: o.upperBound,
    }));
  for (const o of outliers) {
    if (o.kind === "rare-values" && o.outlierCount > 0) {
      warnings.push({ severity: "info", message: `"${o.column}": the IQR is 0, so ${o.outlierCount.toLocaleString()} different value(s) are reported as rare values rather than outliers.` });
    }
  }

  const strongCorrelations = correlation.pairs.filter((p) => Math.abs(p.r) >= STRONG_CORRELATION_THRESHOLD).slice(0, MAX_STRONG_CORRELATIONS);
  for (const e of correlation.excluded) {
    warnings.push({ severity: "info", message: `"${e.name}" was left out of the correlation analysis: ${e.reason}` });
  }
  for (const w of correlation.warnings) warnings.push({ severity: "info", message: w });
  for (const w of relationships.warnings) warnings.push({ severity: "info", message: w });
  if (imbalance) for (const w of imbalance.warnings) warnings.push({ severity: "warning", message: `Target "${imbalance.target}": ${w}` });

  if (meta.truncated) {
    warnings.push({ severity: "warning", message: "The file exceeded the processing limit, so every result describes only the rows that were kept." });
  }
  if (inputs.rowCount < 30) {
    warnings.push({ severity: "warning", message: `The dataset has only ${inputs.rowCount} rows; statistical results are unreliable.` });
  }
  if (relationships.exactDuplicates.length > 0) {
    warnings.push({ severity: "info", message: "Some columns are exact duplicates of each other. Nothing was removed or merged." });
  }
  warnings.push({ severity: "info", message: "Outlier candidates and correlations are statistical findings, not proof of errors or causation." });

  return {
    generatedFor: { datasetId: meta.datasetId, filename: meta.filename, version: meta.version },
    overview: {
      rows: inputs.rowCount,
      columns: columns.length,
      numericColumns: columns.filter((c) => isNumericType(c.dataType)).length,
      categoricalColumns: columns.filter((c) => isCategoricalType(c.dataType)).length,
      dateColumns: columns.filter((c) => c.dataType === "date" || c.dataType === "datetime").length,
      emptyColumns: columns.filter((c) => c.dataType === "empty").length,
      completenessPercentage: meta.completenessPercentage,
      truncated: meta.truncated,
    },
    numeric: numeric.map((s) => ({
      column: s.column,
      count: s.count,
      missingCount: s.missingCount,
      invalidCount: s.invalidCount,
      min: s.min,
      max: s.max,
      mean: s.mean,
      median: s.median,
      stdDev: s.stdDev,
      skewness: s.skewness,
      excessKurtosis: s.excessKurtosis,
      coefficientOfVariation: s.coefficientOfVariation,
    })),
    categorical: categorical.map((c) => ({
      column: c.column,
      uniqueCount: c.frequency.uniqueCount,
      cardinality: c.frequency.cardinality,
      mostFrequent: c.frequency.mostFrequent,
      missingCount: c.frequency.missingCount,
    })),
    distributionObservations: observations,
    outliers: outlierRows,
    strongCorrelations,
    correlationMethod: correlation.method,
    classImbalance: imbalance,
    redundancy: { exactDuplicates: relationships.exactDuplicates, highlyCorrelated: relationships.highlyCorrelated },
    warnings,
  };
}

/** Plain Markdown rendering of the report, for copying or downloading. */
export function reportToMarkdown(report: AnalyticalReport): string {
  const o = report.overview;
  const lines: string[] = [];
  lines.push(`# Analytical report: ${report.generatedFor.filename}`, "");
  lines.push("## Dataset overview", "");
  lines.push(`- Rows: ${o.rows.toLocaleString()}`, `- Columns: ${o.columns} (${o.numericColumns} numeric, ${o.categoricalColumns} categorical, ${o.dateColumns} date, ${o.emptyColumns} empty)`);
  if (o.completenessPercentage !== null) lines.push(`- Completeness: ${fmt(o.completenessPercentage, 1)}%`);
  if (o.truncated) lines.push("- The file was truncated at the processing limit.");
  lines.push("");

  lines.push("## Numerical features", "");
  if (report.numeric.length === 0) lines.push("No numerical features.", "");
  else {
    lines.push("| Column | Valid | Missing | Invalid | Min | Max | Mean | Median | Std dev | Skewness |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const s of report.numeric) {
      lines.push(`| ${s.column} | ${s.count} | ${s.missingCount} | ${s.invalidCount} | ${fmt(s.min)} | ${fmt(s.max)} | ${fmt(s.mean)} | ${fmt(s.median)} | ${fmt(s.stdDev)} | ${fmt(s.skewness)} |`);
    }
    lines.push("", "Standard deviation is the sample standard deviation (n - 1).", "");
  }

  lines.push("## Categorical features", "");
  if (report.categorical.length === 0) lines.push("No categorical features.", "");
  else {
    for (const c of report.categorical) {
      lines.push(`- ${c.column}: ${c.uniqueCount} distinct (${c.cardinality} cardinality), ${c.missingCount} missing` + (c.mostFrequent ? `, most frequent "${c.mostFrequent.label}" (${fmt(c.mostFrequent.percentage, 1)}%)` : ""));
    }
    lines.push("");
  }

  lines.push("## Distribution observations", "");
  if (report.distributionObservations.length === 0) lines.push("Nothing notable.", "");
  else lines.push(...report.distributionObservations.map((x) => `- ${x}`), "");

  lines.push("## Outlier candidates (IQR, 1.5 x IQR)", "");
  const withOutliers = report.outliers.filter((x) => x.count > 0);
  if (withOutliers.length === 0) lines.push("No outlier candidates.", "");
  else lines.push(...withOutliers.map((x) => `- ${x.column}: ${x.count} (${fmt(x.percentage, 1)}%)${x.kind === "rare-values" ? " - rare values (IQR is 0)" : ""}`), "");

  lines.push(`## Strong correlations (${report.correlationMethod}, |r| >= ${STRONG_CORRELATION_THRESHOLD})`, "");
  if (report.strongCorrelations.length === 0) lines.push("None.", "");
  else lines.push(...report.strongCorrelations.map((p) => `- ${p.a} / ${p.b}: r = ${fmt(p.r, 3)} (${p.strength}, n = ${p.n})`), "", "Correlation does not imply causation.", "");

  lines.push("## Class imbalance", "");
  const ci = report.classImbalance;
  if (!ci) lines.push("No target column was selected.", "");
  else if (ci.ratio === null) lines.push(`- Target "${ci.target}": ${ci.severity}`, "");
  else lines.push(`- Target "${ci.target}": majority "${ci.majority?.label}" (${fmt(ci.majority?.percentage ?? null, 1)}%), minority "${ci.minority?.label}" (${fmt(ci.minority?.percentage ?? null, 1)}%), ratio ${fmt(ci.ratio, 2)} : 1 (${ci.severity})`, "");

  lines.push("## Potentially redundant features", "");
  const red = report.redundancy;
  if (red.exactDuplicates.length === 0 && red.highlyCorrelated.length === 0) lines.push("None found.", "");
  else {
    lines.push(...red.exactDuplicates.map((g) => `- Exact duplicates: ${g.columns.join(", ")}`));
    lines.push(...red.highlyCorrelated.map((p) => `- Highly correlated (statistical, not identical): ${p.a} / ${p.b}, r = ${fmt(p.r, 3)}`), "");
  }

  lines.push("## Warnings", "", ...report.warnings.map((w) => `- ${w.severity === "warning" ? "Warning" : "Note"}: ${w.message}`), "");
  return lines.join("\n");
}
