import type { NumericColumn } from "./columnStore";
import {
  ANALYTICS_LIMITS,
  AnalysisCancelledError,
  type CorrelationCell,
  type CorrelationMethod,
  type CorrelationPair,
  type CorrelationResult,
  type CorrelationStrength,
  type ExcludedFeature,
  type PairDetailResult,
} from "./types";

/** At least this many paired observations are required for a coefficient (2 pairs always give +-1). */
export const MIN_PAIRED_OBSERVATIONS = 3;

/** Correlation strength by |r|: <0.1 negligible, <0.3 weak, <0.5 moderate, <0.7 strong, otherwise very strong. */
export function correlationStrength(r: number): CorrelationStrength {
  const a = Math.abs(r);
  if (a < 0.1) return "negligible";
  if (a < 0.3) return "weak";
  if (a < 0.5) return "moderate";
  if (a < 0.7) return "strong";
  return "very strong";
}

/**
 * Ranks with ties receiving the average of the ranks they span (1-based).
 * Implementation note: a native numeric sort of a copy (no comparator callback) plus one binary search
 * per value is several times faster than sorting an index array with a comparator, which matters for
 * the O(p^2) rank computations of a Spearman matrix.
 */
export function rankAverage(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const sorted = Float64Array.from(values as ArrayLike<number>);
  sorted.sort();
  // runLength[i] is only meaningful at the first index of each run of equal values.
  const runLength = new Int32Array(n);
  for (let i = 0; i < n; ) {
    let j = i + 1;
    while (j < n && sorted[j] === sorted[i]) j++;
    runLength[i] = j - i;
    i = j;
  }
  const ranks = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const v = values[k];
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    // lo is the first index of v's run: ranks lo+1 .. lo+runLength, whose average is lo + (runLength + 1) / 2.
    ranks[k] = lo + (runLength[lo] + 1) / 2;
  }
  return ranks;
}

/** Row indices of the valid (non-NaN) values of a column, ascending by value. Computed once per column. */
function sortedRowOrder(values: Float64Array): Int32Array {
  let count = 0;
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) count++;
  const order = new Int32Array(count);
  let k = 0;
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) order[k++] = i;
  order.sort((p, q) => values[p] - values[q] || p - q);
  return order;
}

/**
 * Average ranks (ties share the mean rank) of `values` restricted to the rows where `other` is also
 * valid, written row-indexed into `out` (NaN elsewhere). The column's global sort order is reused and
 * merely filtered, so a pair costs O(n) instead of a fresh O(n log n) sort.
 */
function rankWithinPairs(order: Int32Array, values: Float64Array, other: Float64Array, out: Float64Array): void {
  out.fill(NaN);
  let rank = 0; // number of paired rows seen so far
  let i = 0;
  while (i < order.length) {
    // Skip rows that are not part of the pair.
    if (Number.isNaN(other[order[i]])) {
      i++;
      continue;
    }
    // Collect a run of equal values among the paired rows.
    const value = values[order[i]];
    const start = rank;
    let j = i;
    let runSize = 0;
    while (j < order.length && values[order[j]] === value) {
      if (!Number.isNaN(other[order[j]])) runSize++;
      j++;
    }
    const average = start + (runSize + 1) / 2;
    for (let t = i; t < j; t++) if (!Number.isNaN(other[order[t]])) out[order[t]] = average;
    rank += runSize;
    i = j;
  }
}

/**
 * Pearson r over pairwise complete observations (rows where both values are valid).
 *
 * Numerically robust: deviations from the mean are computed first (exact for nearby values, so a
 * large offset such as 1e12 does not destroy precision), the mean rounding error is removed with the
 * corrected two-pass formula, and deviations are scaled by their maximum before squaring, so neither
 * very large nor very small data overflows or underflows. Correlation is scale invariant, so scaling
 * does not change the result.
 */
export function pearsonPair(x: ArrayLike<number>, y: ArrayLike<number>): CorrelationCell {
  const length = Math.min(x.length, y.length);
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < length; i++) {
    const a = x[i];
    const b = y[i];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    n++;
    sx += a;
    sy += b;
  }
  if (n < MIN_PAIRED_OBSERVATIONS) return { r: null, n, reason: "insufficient" };

  let mx = sx / n;
  let my = sy / n;
  if (!Number.isFinite(mx) || !Number.isFinite(my)) {
    // The sums overflow: fall back to running means.
    mx = 0;
    my = 0;
    let k = 0;
    for (let i = 0; i < length; i++) {
      if (Number.isNaN(x[i]) || Number.isNaN(y[i])) continue;
      k++;
      mx += (x[i] - mx) / k;
      my += (y[i] - my) / k;
    }
  }

  let scaleX = 0;
  let scaleY = 0;
  for (let i = 0; i < length; i++) {
    const a = x[i];
    const b = y[i];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    const dx = Math.abs(a - mx);
    const dy = Math.abs(b - my);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { r: null, n, reason: "overflow" };
    if (dx > scaleX) scaleX = dx;
    if (dy > scaleY) scaleY = dy;
  }
  // Identical values give exactly zero deviation, so this is an exact constant-column test.
  if (scaleX === 0 || scaleY === 0) return { r: null, n, reason: "constant" };

  let sdx = 0;
  let sdy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < length; i++) {
    const a = x[i];
    const b = y[i];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    const ux = (a - mx) / scaleX;
    const uy = (b - my) / scaleY;
    sdx += ux;
    sdy += uy;
    sxx += ux * ux;
    syy += uy * uy;
    sxy += ux * uy;
  }
  // Corrected two-pass: remove the effect of the rounded means.
  sxx -= (sdx * sdx) / n;
  syy -= (sdy * sdy) / n;
  sxy -= (sdx * sdy) / n;
  if (!(sxx > 0) || !(syy > 0)) return { r: null, n, reason: "constant" };
  const r = sxy / Math.sqrt(sxx * syy);
  if (!Number.isFinite(r)) return { r: null, n, reason: "constant" };
  return { r: Math.max(-1, Math.min(1, r)), n, reason: null };
}

/** Spearman rank correlation: Pearson on average ranks computed within the paired complete observations. */
export function spearmanPair(x: ArrayLike<number>, y: ArrayLike<number>): CorrelationCell {
  const length = Math.min(x.length, y.length);
  let n = 0;
  for (let i = 0; i < length; i++) if (!Number.isNaN(x[i]) && !Number.isNaN(y[i])) n++;
  if (n < MIN_PAIRED_OBSERVATIONS) return { r: null, n, reason: "insufficient" };
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < length; i++) {
    if (Number.isNaN(x[i]) || Number.isNaN(y[i])) continue;
    xs[k] = x[i];
    ys[k] = y[i];
    k++;
  }
  return pearsonPair(rankAverage(xs), rankAverage(ys));
}

export interface IdentifierCheckInput {
  name: string;
  dataType: string;
  column: NumericColumn;
}

const ID_NAME = /(^|[^a-z0-9])(id|uid|uuid|guid|index|idx|key)([^a-z0-9]|$)/i;
const CAMEL_ID = /[a-z0-9](ID|Id)$/;

/** Returns why a numeric column should not be correlated (identifier / row index), or null. */
export function identifierReason({ name, dataType, column }: IdentifierCheckInput): string | null {
  if (dataType === "integer" && (ID_NAME.test(name) || CAMEL_ID.test(name))) {
    return "Looks like an identifier (by name); correlating identifiers is meaningless.";
  }
  if (dataType === "integer" && column.validCount >= 20 && column.invalidCount === 0 && column.missingCount === 0) {
    let min = Infinity;
    let max = -Infinity;
    const seen = new Set<number>();
    for (let i = 0; i < column.values.length; i++) {
      const v = column.values[i];
      if (v < min) min = v;
      if (v > max) max = v;
      seen.add(v);
    }
    if (seen.size === column.validCount && max - min + 1 === column.validCount) {
      return "Consecutive unique integers (a row index or identifier).";
    }
  }
  return null;
}

export interface CorrelationMatrixInput {
  /** Feature names in dataset order. */
  names: string[];
  columns: NumericColumn[];
  method: CorrelationMethod;
  /** Names the user asked for; defaults to all. */
  selected?: string[];
  /** Features the caller already ruled out (for example identifiers), with the reason. */
  preExcluded?: ExcludedFeature[];
}

export interface AsyncControl {
  isCancelled: () => boolean;
  yieldToEventLoop: () => Promise<void>;
}

interface Prepared {
  features: string[];
  columns: NumericColumn[];
  orders: Array<Int32Array | null>;
  scratch: [Float64Array, Float64Array] | null;
  excluded: ExcludedFeature[];
  warnings: string[];
  method: CorrelationMethod;
}

function prepare(input: CorrelationMatrixInput): Prepared {
  const excluded: ExcludedFeature[] = [...(input.preExcluded ?? [])];
  const warnings: string[] = [];
  const wanted = input.selected ? new Set(input.selected) : null;

  let candidates: Array<{ name: string; column: NumericColumn; order: number }> = [];
  input.names.forEach((name, order) => {
    if (wanted && !wanted.has(name)) return;
    const column = input.columns[order];
    candidates.push({ name, column, order });
  });

  candidates = candidates.filter(({ name, column }) => {
    if (column.validCount < MIN_PAIRED_OBSERVATIONS) {
      excluded.push({ name, reason: `Fewer than ${MIN_PAIRED_OBSERVATIONS} valid numeric values.` });
      return false;
    }
    return true;
  });

  if (candidates.length > ANALYTICS_LIMITS.maxMatrixFeatures) {
    const ranked = [...candidates].sort((a, b) => b.column.validCount - a.column.validCount || a.order - b.order);
    const keep = new Set(ranked.slice(0, ANALYTICS_LIMITS.maxMatrixFeatures).map((c) => c.name));
    for (const c of candidates) {
      if (!keep.has(c.name)) excluded.push({ name: c.name, reason: "Not included because of the matrix size limit." });
    }
    warnings.push(
      `Only ${ANALYTICS_LIMITS.maxMatrixFeatures} of ${candidates.length} numeric features are shown to keep the matrix readable and fast; the features with the most valid values were kept. Select specific features to analyse the others.`
    );
    candidates = candidates.filter((c) => keep.has(c.name));
  }

  const rows = candidates[0]?.column.values.length ?? 0;
  const orders = candidates.map(({ column }) => (input.method === "spearman" ? sortedRowOrder(column.values) : null));
  return {
    features: candidates.map((c) => c.name),
    columns: candidates.map((c) => c.column),
    orders,
    scratch: input.method === "spearman" ? [new Float64Array(rows), new Float64Array(rows)] : null,
    excluded,
    warnings,
    method: input.method,
  };
}

function cellFor(p: Prepared, i: number, j: number): CorrelationCell {
  if (i === j) return { r: 1, n: p.columns[i].validCount, reason: null };
  const a = p.columns[i];
  const b = p.columns[j];
  if (p.method === "pearson") return pearsonPair(a.values, b.values);
  // Spearman: rank each column within the pairwise complete rows, reusing the precomputed sort orders.
  const [scratchA, scratchB] = p.scratch as [Float64Array, Float64Array];
  rankWithinPairs(p.orders[i] as Int32Array, a.values, b.values, scratchA);
  rankWithinPairs(p.orders[j] as Int32Array, b.values, a.values, scratchB);
  return pearsonPair(scratchA, scratchB);
}

function finish(p: Prepared, cells: CorrelationCell[][]): CorrelationResult {
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < p.features.length; i++) {
    for (let j = i + 1; j < p.features.length; j++) {
      const c = cells[i][j];
      if (c.r === null) continue;
      pairs.push({
        a: p.features[i],
        b: p.features[j],
        r: c.r,
        n: c.n,
        strength: correlationStrength(c.r),
        direction: c.r >= 0 ? "positive" : "negative",
      });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r) || (x.a + x.b < y.a + y.b ? -1 : 1));
  const strongestPositive = pairs.filter((q) => q.r > 0).sort((x, y) => y.r - x.r).slice(0, 5);
  const strongestNegative = pairs.filter((q) => q.r < 0).sort((x, y) => x.r - y.r).slice(0, 5);
  const warnings = [...p.warnings];
  const undefinedPairs = (p.features.length * (p.features.length - 1)) / 2 - pairs.length;
  if (undefinedPairs > 0) {
    warnings.push(`${undefinedPairs} pair(s) have no coefficient (constant column or fewer than ${MIN_PAIRED_OBSERVATIONS} paired observations).`);
  }
  return {
    method: p.method,
    features: p.features,
    cells,
    pairs,
    strongestPositive,
    strongestNegative,
    excluded: p.excluded,
    warnings,
  };
}

function computeRow(p: Prepared, i: number, cells: CorrelationCell[][]): void {
  for (let j = i; j < p.features.length; j++) {
    const cell = cellFor(p, i, j);
    cells[i][j] = cell;
    cells[j][i] = cell;
  }
}

function emptyCells(size: number): CorrelationCell[][] {
  return Array.from({ length: size }, () => new Array<CorrelationCell>(size));
}

/** Correlation matrix over pairwise complete observations (synchronous). */
export function correlationMatrix(input: CorrelationMatrixInput): CorrelationResult {
  const p = prepare(input);
  const cells = emptyCells(p.features.length);
  for (let i = 0; i < p.features.length; i++) computeRow(p, i, cells);
  return finish(p, cells);
}

/** Same result, but yields between rows and stops early when cancelled. */
export async function correlationMatrixAsync(input: CorrelationMatrixInput, control: AsyncControl): Promise<CorrelationResult> {
  const p = prepare(input);
  const cells = emptyCells(p.features.length);
  for (let i = 0; i < p.features.length; i++) {
    if (control.isCancelled()) throw new AnalysisCancelledError();
    computeRow(p, i, cells);
    await control.yieldToEventLoop();
  }
  if (control.isCancelled()) throw new AnalysisCancelledError();
  return finish(p, cells);
}

/** Pearson and Spearman for one pair, plus a deterministic sample of points for plotting. */
export function pairDetail(x: NumericColumn, y: NumericColumn): PairDetailResult {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < x.values.length; i++) {
    if (!Number.isNaN(x.values[i]) && !Number.isNaN(y.values[i])) points.push([x.values[i], y.values[i]]);
  }
  const pairedCount = points.length;
  let sample = points;
  let sampled = false;
  if (pairedCount > ANALYTICS_LIMITS.maxScatterPoints) {
    sampled = true;
    const step = pairedCount / ANALYTICS_LIMITS.maxScatterPoints;
    sample = Array.from({ length: ANALYTICS_LIMITS.maxScatterPoints }, (_, k) => points[Math.floor(k * step)]);
  }
  const notes: string[] = [];
  if (sampled) notes.push(`The scatter plot shows an evenly spaced sample of ${sample.length.toLocaleString()} of ${pairedCount.toLocaleString()} points; coefficients use all of them.`);
  notes.push("Correlation measures association, not causation.");
  return {
    x: x.name,
    y: y.name,
    pearson: pearsonPair(x.values, y.values),
    spearman: spearmanPair(x.values, y.values),
    points: sample,
    sampled,
    pairedCount,
    notes,
  };
}
