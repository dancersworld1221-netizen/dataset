import { ColumnStore } from "./columnStore";
import { buildFrequency, buildHistogram, buildDateDistribution } from "./distribution";
import { analyzeClassImbalance } from "./categorical";
import {
  correlationMatrixAsync,
  identifierReason,
  pairDetail,
  type AsyncControl,
  type CorrelationMatrixInput,
} from "./correlation";
import { computeNumericSummary } from "./numeric";
import { detectOutliers, detectOutliersAllMethods } from "./outliers";
import { buildReport } from "./report";
import {
  DEFAULT_KS_THRESHOLD,
  DEFAULT_REDUNDANCY_THRESHOLD,
  compareFeatures,
  findExactDuplicateColumns,
  findSimilarDistributions,
} from "./relationships";
import { sortedCopy } from "./numeric";
import {
  AnalysisCancelledError,
  isCategoricalType,
  isNumericType,
  type AnalysisRequest,
  type AnalysisResultFor,
  type CategoricalSummary,
  type ColumnInfo,
  type CorrelationResult,
  type ExcludedFeature,
  type NumericSummary,
  type OutlierResult,
  type RelationshipsResult,
} from "./types";

export interface LoadedDataset {
  /** Identifies the dataset content: `${id}|${version}`. Requests for another key are rejected. */
  datasetKey: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  columns: ColumnInfo[];
}

/** Control that never cancels and yields through the event loop; used when there is no caller to cancel. */
export const inlineControl: AsyncControl = {
  isCancelled: () => false,
  yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/**
 * Runs analysis requests against one loaded dataset. It is environment independent: the same class
 * runs inside the Web Worker and, when no Worker exists (tests), directly on the calling thread.
 */
export class AnalysisEngine {
  private store: ColumnStore | null = null;
  private key: string | null = null;

  load(dataset: LoadedDataset): void {
    this.store = new ColumnStore(dataset.rows, dataset.columns);
    this.key = dataset.datasetKey;
  }

  unload(): void {
    this.store = null;
    this.key = null;
  }

  get datasetKey(): string | null {
    return this.key;
  }

  private requireStore(): ColumnStore {
    if (!this.store) throw new Error("No dataset is loaded for analysis.");
    return this.store;
  }

  private numericNames(store: ColumnStore): string[] {
    return store.columns.filter((c) => isNumericType(c.dataType)).map((c) => c.name);
  }

  private requireNumeric(store: ColumnStore, name: string): void {
    if (!isNumericType(store.info(name).dataType)) throw new Error(`"${name}" is not a numeric column.`);
  }

  private check(control: AsyncControl): void {
    if (control.isCancelled()) throw new AnalysisCancelledError();
  }

  private async numericSummaries(store: ColumnStore, control: AsyncControl): Promise<NumericSummary[]> {
    const out: NumericSummary[] = [];
    for (const name of this.numericNames(store)) {
      this.check(control);
      const col = store.numeric(name);
      out.push(
        computeNumericSummary(name, store.validValues(name), {
          totalRows: store.rowCount,
          missingCount: col.missingCount,
          invalidCount: col.invalidCount,
          notes: col.notes,
        })
      );
      await control.yieldToEventLoop();
    }
    return out;
  }

  private async correlation(
    store: ColumnStore,
    method: "pearson" | "spearman",
    selected: string[] | undefined,
    control: AsyncControl
  ): Promise<CorrelationResult> {
    const names: string[] = [];
    const columns: CorrelationMatrixInput["columns"] = [];
    const preExcluded: ExcludedFeature[] = [];
    const wanted = selected ? new Set(selected) : null;
    for (const info of store.columns) {
      if (!isNumericType(info.dataType)) continue;
      if (wanted && !wanted.has(info.name)) continue;
      const col = store.numeric(info.name);
      const reason = identifierReason({ name: info.name, dataType: info.dataType, column: col });
      if (reason) {
        preExcluded.push({ name: info.name, reason });
        continue;
      }
      names.push(info.name);
      columns.push(col);
    }
    return correlationMatrixAsync({ names, columns, method, preExcluded }, control);
  }

  private async relationships(store: ColumnStore, threshold: number, control: AsyncControl): Promise<RelationshipsResult> {
    const allNames = store.columns.filter((c) => c.dataType !== "empty").map((c) => c.name);
    const exactDuplicates = findExactDuplicateColumns(store, allNames);
    this.check(control);
    const duplicatePairs = new Set<string>();
    for (const group of exactDuplicates) {
      for (const a of group.columns) for (const b of group.columns) if (a !== b) duplicatePairs.add(`${a}\u0000${b}`);
    }

    const correlation = await this.correlation(store, "pearson", undefined, control);
    const highlyCorrelated = correlation.pairs
      .filter((p) => Math.abs(p.r) >= threshold && !duplicatePairs.has(`${p.a}\u0000${p.b}`) && !duplicatePairs.has(`${p.b}\u0000${p.a}`))
      .map((p) => ({ a: p.a, b: p.b, r: p.r, n: p.n }));

    const entries = this.numericNames(store).map((name) => ({ name, sorted: sortedCopy(store.validValues(name)) }));
    this.check(control);
    const similar = findSimilarDistributions(entries, DEFAULT_KS_THRESHOLD, duplicatePairs);
    return {
      exactDuplicates,
      highlyCorrelated,
      correlationThreshold: threshold,
      similarDistributions: similar.pairs,
      ksThreshold: DEFAULT_KS_THRESHOLD,
      warnings: similar.warnings,
    };
  }

  async run<R extends AnalysisRequest>(request: R, control: AsyncControl = inlineControl): Promise<AnalysisResultFor<R>> {
    const store = this.requireStore();
    this.check(control);
    const result = await this.dispatch(store, request, control);
    this.check(control);
    return result as AnalysisResultFor<R>;
  }

  private async dispatch(store: ColumnStore, request: AnalysisRequest, control: AsyncControl): Promise<unknown> {
    switch (request.kind) {
      case "numericSummary":
        return this.numericSummaries(store, control);

      case "histogram": {
        this.requireNumeric(store, request.column);
        const col = store.numeric(request.column);
        return buildHistogram(request.column, store.validValues(request.column), col, { method: request.method, bins: request.bins });
      }

      case "frequency": {
        return buildFrequency(request.column, store.raw(request.column), {
          topN: request.topN,
          rareThresholdPercentage: request.rareThresholdPercentage,
        });
      }

      case "categoricalSummary": {
        const out: CategoricalSummary[] = [];
        for (const info of store.columns) {
          if (!isCategoricalType(info.dataType)) continue;
          this.check(control);
          out.push({ column: info.name, dataType: info.dataType, frequency: buildFrequency(info.name, store.raw(info.name), { topN: request.topN ?? 10 }) });
          await control.yieldToEventLoop();
        }
        return out;
      }

      case "dateDistribution": {
        const type = store.info(request.column).dataType;
        if (type !== "date" && type !== "datetime") throw new Error(`"${request.column}" is not a date column.`);
        return buildDateDistribution(request.column, store.raw(request.column));
      }

      case "outliers": {
        this.requireNumeric(store, request.column);
        const col = store.numeric(request.column);
        return detectOutliers({ column: request.column, values: col.values, missingCount: col.missingCount, invalidCount: col.invalidCount }, request.params);
      }

      case "outlierOverview": {
        this.requireNumeric(store, request.column);
        const col = store.numeric(request.column);
        return detectOutliersAllMethods(
          { column: request.column, values: col.values, missingCount: col.missingCount, invalidCount: col.invalidCount },
          { multiplier: request.multiplier, zThreshold: request.zThreshold, modifiedThreshold: request.modifiedThreshold, ignoreZeros: request.ignoreZeros }
        );
      }

      case "correlation":
        return this.correlation(store, request.method, request.columns, control);

      case "pairDetail": {
        this.requireNumeric(store, request.x);
        this.requireNumeric(store, request.y);
        return pairDetail(store.numeric(request.x), store.numeric(request.y));
      }

      case "classImbalance":
        return analyzeClassImbalance(request.target, store.raw(request.target));

      case "relationships":
        return this.relationships(store, request.correlationThreshold ?? DEFAULT_REDUNDANCY_THRESHOLD, control);

      case "compare": {
        const unique = [...new Set(request.columns)];
        if (unique.length < 2) throw new Error("Select at least two features to compare.");
        for (const name of unique) store.info(name);
        return compareFeatures(store, unique);
      }

      case "report": {
        const numeric = await this.numericSummaries(store, control);
        const categorical = (await this.dispatch(store, { kind: "categoricalSummary" }, control)) as CategoricalSummary[];
        const outliers: OutlierResult[] = [];
        for (const name of this.numericNames(store)) {
          this.check(control);
          const col = store.numeric(name);
          outliers.push(detectOutliers({ column: name, values: col.values, missingCount: col.missingCount, invalidCount: col.invalidCount }, { method: "iqr" }));
        }
        const correlation = await this.correlation(store, "pearson", undefined, control);
        const relationships = await this.relationships(store, DEFAULT_REDUNDANCY_THRESHOLD, control);
        const imbalance = request.target ? analyzeClassImbalance(request.target, store.raw(request.target)) : null;
        return buildReport({
          meta: { datasetId: request.meta.datasetId, filename: request.meta.filename, version: request.meta.version, completenessPercentage: request.meta.completenessPercentage, truncated: request.meta.truncated },
          columns: store.columns,
          rowCount: store.rowCount,
          numeric,
          categorical,
          outliers,
          correlation,
          relationships,
          imbalance,
        });
      }
    }
  }
}
