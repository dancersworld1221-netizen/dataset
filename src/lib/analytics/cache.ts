import type { AnalysisRequest } from "./types";

/** JSON with sorted object keys, so equal requests always produce the same key. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Cache key: dataset id, dataset version and the analysis parameters. */
export function makeCacheKey(datasetId: string, version: string, request: AnalysisRequest): string {
  return `${datasetId}|${version}|${stableStringify(request)}`;
}

const DEFAULT_MAX_ENTRIES = 300;
/** Upper bound of the summed weights; one unit is roughly one stored number (a row index, a bin ...). */
const DEFAULT_MAX_WEIGHT = 2_000_000;

/**
 * Approximate size of a result: outlier results list every flagged row, so they can be large. Everything
 * else (statistics, histograms, matrices) is small and weighs about 1 + its list lengths.
 */
export function resultWeight(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  const v = value as Record<string, unknown>;
  let weight = 1;
  for (const key of ["rowIndices", "consensusRowIndices", "points", "examples", "bins", "categories"]) {
    const list = v[key];
    if (Array.isArray(list)) weight += list.length;
  }
  for (const key of ["iqr", "zscore", "modifiedZScore"]) {
    const nested = v[key];
    if (nested && typeof nested === "object") weight += resultWeight(nested) - 1;
  }
  return weight;
}

/**
 * Small in-memory LRU cache of analysis results. It lives outside React state, so large results are
 * never duplicated into component state, and entries are dropped as soon as their dataset changes.
 */
export class AnalysisCache {
  private readonly entries = new Map<string, { datasetId: string; value: unknown; weight: number }>();
  private totalWeight = 0;

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxWeight = DEFAULT_MAX_WEIGHT
  ) {}

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalWeight -= entry.weight;
    this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, datasetId: string, value: unknown): void {
    this.drop(key);
    const weight = resultWeight(value);
    this.entries.set(key, { datasetId, value, weight });
    this.totalWeight += weight;
    // Evict least recently used entries (never the one just stored) while over a limit.
    while ((this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight) && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.drop(oldest);
    }
  }

  /** Removes every entry of a dataset (all versions). Returns how many were removed. */
  invalidateDataset(datasetId: string): number {
    let removed = 0;
    for (const [key, entry] of [...this.entries]) {
      if (entry.datasetId === datasetId) {
        this.drop(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.totalWeight = 0;
  }

  size(datasetId?: string): number {
    if (datasetId === undefined) return this.entries.size;
    let count = 0;
    for (const entry of this.entries.values()) if (entry.datasetId === datasetId) count++;
    return count;
  }
}

export const analysisCache = new AnalysisCache();
