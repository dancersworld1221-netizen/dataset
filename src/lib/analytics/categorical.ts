import { countCategories } from "./distribution";
import {
  ANALYTICS_LIMITS,
  type CategoryFrequency,
  type ClassImbalanceResult,
  type ImbalanceSeverity,
} from "./types";

export const IMBALANCE_DEFINITION =
  "Imbalance ratio = size of the majority class / size of the minority class (always >= 1). " +
  "Severity uses common rules of thumb, not a statistical test: up to 1.5 balanced, up to 3 mild, up to 10 moderate, up to 100 severe, above 100 extreme.";

export function imbalanceSeverity(ratio: number): Exclude<ImbalanceSeverity, "single-class" | "empty"> {
  if (ratio <= 1.5) return "balanced";
  if (ratio <= 3) return "mild";
  if (ratio <= 10) return "moderate";
  if (ratio <= 100) return "severe";
  return "extreme";
}

/**
 * Class distribution and imbalance of a user-selected target column.
 * Missing target values are excluded and counted separately. Nothing is resampled.
 */
export function analyzeClassImbalance(target: string, raw: ArrayLike<string>): ClassImbalanceResult {
  const { counts, validCount, missingCount } = countCategories(raw);
  const warnings: string[] = [];
  const toFrequency = ([label, count]: [string, number]): CategoryFrequency => ({
    label,
    count,
    percentage: validCount > 0 ? (count / validCount) * 100 : 0,
  });
  // Descending by count, ties alphabetical, so the first entry is the majority class.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const classCount = sorted.length;
  const classes = sorted.map(toFrequency);

  const base = {
    target,
    totalRows: raw.length,
    validCount,
    missingCount,
    classCount,
    classes: classes.slice(0, ANALYTICS_LIMITS.maxTargetClasses),
    classesTruncated: classes.length > ANALYTICS_LIMITS.maxTargetClasses,
    suitableAsTarget: classCount >= 2 && classCount <= ANALYTICS_LIMITS.maxTargetClasses,
    definition: IMBALANCE_DEFINITION,
    warnings,
  };

  if (missingCount > 0) {
    warnings.push(`${missingCount.toLocaleString()} row(s) have no target value and are excluded from the class distribution.`);
  }
  if (classCount > ANALYTICS_LIMITS.maxTargetClasses) {
    warnings.push(`The column has ${classCount.toLocaleString()} distinct values, which is unusual for a classification target (it may be an identifier or a continuous measure).`);
  }

  if (classCount === 0) {
    warnings.push("The target column has no usable values.");
    return { ...base, majority: null, minority: null, ratio: null, severity: "empty" };
  }
  if (classCount === 1) {
    warnings.push("The target has a single class; there is nothing to balance.");
    return { ...base, majority: classes[0], minority: classes[0], ratio: null, severity: "single-class" };
  }

  const majority = classes[0];
  const minority = [...classes].sort((a, b) => a.count - b.count || (a.label < b.label ? -1 : 1))[0];
  const ratio = majority.count / minority.count;
  const severity = imbalanceSeverity(ratio);
  if (severity === "severe" || severity === "extreme") {
    warnings.push("Severe imbalance: accuracy alone would be misleading for a model trained on this target. (No resampling is performed.)");
  }
  return { ...base, majority, minority, ratio, severity };
}
