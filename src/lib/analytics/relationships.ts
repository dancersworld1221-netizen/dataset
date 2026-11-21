import { classifyMissing } from "@/lib/profiling/typeInference";
import type { ColumnStore } from "./columnStore";
import { countCategories } from "./distribution";
import { pairDetail, spearmanPair } from "./correlation";
import { computeNumericSummary } from "./numeric";
import {
  ANALYTICS_LIMITS,
  type CategoryFrequency,
  type DuplicateColumnGroup,
  type FeatureComparisonItem,
  type FeatureComparisonResult,
  type FeaturePairComparison,
  type SimilarDistributionPair,
} from "./types";
import { isNumericType } from "./types";

export const DEFAULT_REDUNDANCY_THRESHOLD = 0.9;
export const DEFAULT_KS_THRESHOLD = 0.05;
/** Samples smaller than this are too small to call two distributions "similar". */
export const MIN_KS_SAMPLE = 30;

function fnv1a(values: string[], seed: number): number {
  let hash = seed >>> 0;
  for (const value of values) {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31; // separator, so ["ab","c"] differs from ["a","bc"]
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sameTrimmed(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].trim() !== b[i].trim()) return false;
  return true;
}

/**
 * Groups columns whose cell values are identical in every row (after trimming).
 * A hash narrows the candidates, then values are compared directly, so a hash collision can never
 * produce a false duplicate. This is an exact statement, unlike statistical similarity.
 */
export function findExactDuplicateColumns(store: ColumnStore, names: string[]): DuplicateColumnGroup[] {
  const buckets = new Map<string, string[]>();
  for (const name of names) {
    const trimmed = store.raw(name).map((v) => v.trim());
    const key = `${fnv1a(trimmed, 2166136261)}:${fnv1a(trimmed, 5381)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(name);
    else buckets.set(key, [name]);
  }
  const groups: DuplicateColumnGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    // Verify and split the bucket into truly identical groups.
    const remaining = [...bucket];
    while (remaining.length > 0) {
      const first = remaining.shift() as string;
      const identical = [first];
      for (let k = remaining.length - 1; k >= 0; k--) {
        if (sameTrimmed(store.raw(first), store.raw(remaining[k]))) {
          identical.push(remaining[k]);
          remaining.splice(k, 1);
        }
      }
      if (identical.length > 1) groups.push({ columns: identical.sort((a, b) => names.indexOf(a) - names.indexOf(b)) });
    }
  }
  return groups.sort((a, b) => names.indexOf(a.columns[0]) - names.indexOf(b.columns[0]));
}

/** Two-sample Kolmogorov-Smirnov distance between two ascending arrays. */
export function ksDistance(a: Float64Array, b: Float64Array): number {
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < a.length && j < b.length) {
    const x = Math.min(a[i], b[j]);
    while (i < a.length && a[i] <= x) i++;
    while (j < b.length && b[j] <= x) j++;
    d = Math.max(d, Math.abs(i / a.length - j / b.length));
  }
  return d;
}

export function findSimilarDistributions(
  entries: Array<{ name: string; sorted: Float64Array }>,
  threshold: number,
  skipPairs: Set<string>
): { pairs: SimilarDistributionPair[]; warnings: string[] } {
  const warnings: string[] = [];
  let usable = entries.filter((e) => e.sorted.length >= MIN_KS_SAMPLE);
  if (usable.length > ANALYTICS_LIMITS.maxSimilarityFeatures) {
    warnings.push(`Distribution similarity was checked for the first ${ANALYTICS_LIMITS.maxSimilarityFeatures} of ${usable.length} numeric features.`);
    usable = usable.slice(0, ANALYTICS_LIMITS.maxSimilarityFeatures);
  }
  const pairs: SimilarDistributionPair[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (skipPairs.has(`${usable[i].name}\u0000${usable[j].name}`)) continue;
      const d = ksDistance(usable[i].sorted, usable[j].sorted);
      if (d <= threshold) pairs.push({ a: usable[i].name, b: usable[j].name, ksDistance: d });
    }
  }
  return { pairs: pairs.sort((x, y) => x.ksDistance - y.ksDistance), warnings };
}

function contingency(a: string[], b: string[]): { table: Map<string, Map<string, number>>; rows: Set<string>; cols: Set<string>; n: number } {
  const table = new Map<string, Map<string, number>>();
  const rows = new Set<string>();
  const cols = new Set<string>();
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (classifyMissing(a[i]) !== null || classifyMissing(b[i]) !== null) continue;
    const x = a[i].trim();
    const y = b[i].trim();
    rows.add(x);
    cols.add(y);
    let row = table.get(x);
    if (!row) {
      row = new Map();
      table.set(x, row);
    }
    row.set(y, (row.get(y) ?? 0) + 1);
    n++;
  }
  return { table, rows, cols, n };
}

/** Cramer's V (no bias correction) for two categorical columns, over rows where both are present. */
export function cramersV(a: string[], b: string[]): number | null {
  const { table, rows, cols, n } = contingency(a, b);
  const r = rows.size;
  const c = cols.size;
  if (n === 0 || r < 2 || c < 2) return null;
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const [x, row] of table) {
    for (const [y, count] of row) {
      rowTotals.set(x, (rowTotals.get(x) ?? 0) + count);
      colTotals.set(y, (colTotals.get(y) ?? 0) + count);
    }
  }
  let chi2 = 0;
  for (const x of rows) {
    for (const y of cols) {
      const expected = ((rowTotals.get(x) ?? 0) * (colTotals.get(y) ?? 0)) / n;
      const observed = table.get(x)?.get(y) ?? 0;
      chi2 += (observed - expected) ** 2 / expected;
    }
  }
  return Math.min(1, Math.sqrt(chi2 / (n * Math.min(r - 1, c - 1))));
}

export function compareFeatures(store: ColumnStore, names: string[]): FeatureComparisonResult {
  const items: FeatureComparisonItem[] = names.map((name) => {
    const info = store.info(name);
    const raw = store.raw(name);
    const { counts, validCount, missingCount } = countCategories(raw);
    const numeric = isNumericType(info.dataType)
      ? computeNumericSummary(name, store.validValues(name), {
          totalRows: store.rowCount,
          missingCount: store.numeric(name).missingCount,
          invalidCount: store.numeric(name).invalidCount,
          notes: store.numeric(name).notes,
        })
      : null;
    const topCategories: CategoryFrequency[] = numeric
      ? []
      : [...counts.entries()]
          .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
          .slice(0, 5)
          .map(([label, count]) => ({ label, count, percentage: validCount > 0 ? (count / validCount) * 100 : 0 }));
    return {
      column: name,
      dataType: info.dataType,
      totalRows: store.rowCount,
      missingCount,
      missingPercentage: store.rowCount > 0 ? (missingCount / store.rowCount) * 100 : 0,
      uniqueCount: counts.size,
      numeric,
      topCategories,
    };
  });

  const pairs: FeaturePairComparison[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const aNumeric = isNumericType(store.info(a).dataType);
      const bNumeric = isNumericType(store.info(b).dataType);
      const notes: string[] = [];
      const exactDuplicate = sameTrimmed(store.raw(a), store.raw(b));
      if (exactDuplicate) notes.push("Identical values in every row (exact duplicate columns).");

      if (aNumeric && bNumeric) {
        const detail = pairDetail(store.numeric(a), store.numeric(b));
        const sa = store.validValues(a).slice().sort();
        const sb = store.validValues(b).slice().sort();
        pairs.push({
          a,
          b,
          exactDuplicate,
          kind: "numeric",
          pearson: detail.pearson,
          spearman: spearmanPair(store.numeric(a).values, store.numeric(b).values),
          ksDistance: sa.length >= MIN_KS_SAMPLE && sb.length >= MIN_KS_SAMPLE ? ksDistance(sa, sb) : null,
          cramersV: null,
          notes,
        });
      } else if (!aNumeric && !bNumeric) {
        const ua = countCategories(store.raw(a)).counts.size;
        const ub = countCategories(store.raw(b)).counts.size;
        let v: number | null = null;
        if (ua <= ANALYTICS_LIMITS.maxTargetClasses && ub <= ANALYTICS_LIMITS.maxTargetClasses) v = cramersV(store.raw(a), store.raw(b));
        else notes.push("Cramér's V was skipped: a column has too many distinct values.");
        pairs.push({ a, b, exactDuplicate, kind: "categorical", pearson: null, spearman: null, ksDistance: null, cramersV: v, notes });
      } else {
        notes.push("A numeric and a categorical feature: no coefficient is computed.");
        pairs.push({ a, b, exactDuplicate, kind: "mixed", pearson: null, spearman: null, ksDistance: null, cramersV: null, notes });
      }
    }
  }
  return { items, pairs };
}
