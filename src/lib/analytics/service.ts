import { analysisCache, makeCacheKey, type AnalysisCache } from "./cache";
import type { AnalysisClient } from "./client";
import type { LoadedDataset } from "./engine";
import { AnalysisCancelledError, type AnalysisRequest, type AnalysisResultFor } from "./types";

export interface DatasetHandle {
  id: string;
  /** Changes whenever the dataset content may have changed. */
  version: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  columns: LoadedDataset["columns"];
}

interface InFlight {
  promise: Promise<unknown>;
  consumers: number;
  cancel: () => void;
}

/**
 * Coordinates the analysis client and the cache for the active dataset:
 * - results are cached by dataset id + version + parameters;
 * - identical concurrent requests share one computation;
 * - when a result is no longer wanted (parameters changed, page left) its computation is cancelled;
 * - when the dataset changes or is removed, in-flight work is cancelled and its cache entries are dropped.
 */
export class AnalysisService {
  private current: { id: string; version: string } | null = null;
  private loading: Promise<void> = Promise.resolve();
  private readonly inFlight = new Map<string, InFlight>();
  private activeClient: AnalysisClient | null = null;

  /**
   * @param clientSource an existing client, or a factory. With a factory the client (for example a Web
   * Worker) is created lazily and re-created after `dispose()`, which is what React StrictMode needs:
   * in development it mounts, unmounts and mounts a component again, so a disposed service must stay usable.
   */
  constructor(
    private readonly clientSource: AnalysisClient | (() => AnalysisClient),
    private readonly cache: AnalysisCache = analysisCache
  ) {
    if (typeof clientSource !== "function") this.activeClient = clientSource;
  }

  private get client(): AnalysisClient {
    if (!this.activeClient) {
      if (typeof this.clientSource !== "function") throw new Error("The analysis client was disposed.");
      this.activeClient = this.clientSource();
    }
    return this.activeClient;
  }

  get datasetId(): string | null {
    return this.current?.id ?? null;
  }

  get datasetVersion(): string | null {
    return this.current?.version ?? null;
  }

  private cancelAll(): void {
    for (const flight of this.inFlight.values()) flight.cancel();
    this.inFlight.clear();
  }

  /** Makes `dataset` the active one (or none). Reloading the same id and version is a no-op. */
  async setDataset(dataset: DatasetHandle | null): Promise<void> {
    if (dataset && this.current?.id === dataset.id && this.current.version === dataset.version) {
      await this.loading;
      return;
    }
    const previous = this.current;
    this.cancelAll();
    if (previous) this.cache.invalidateDataset(previous.id);

    if (!dataset) {
      this.current = null;
      this.activeClient?.unload();
      this.loading = Promise.resolve();
      return;
    }
    this.current = { id: dataset.id, version: dataset.version };
    const key = `${dataset.id}|${dataset.version}`;
    this.loading = this.client.load({ datasetKey: key, headers: dataset.headers, rows: dataset.rows, columns: dataset.columns });
    await this.loading;
  }

  /** Drops the active dataset and everything cached for it. */
  async clear(): Promise<void> {
    await this.setDataset(null);
  }

  async run<R extends AnalysisRequest>(request: R, signal?: AbortSignal): Promise<AnalysisResultFor<R>> {
    await this.loading;
    const dataset = this.current;
    if (!dataset) throw new AnalysisCancelledError();
    const cacheKey = makeCacheKey(dataset.id, dataset.version, request);

    const cached = this.cache.get<AnalysisResultFor<R>>(cacheKey);
    if (cached !== undefined) return cached;
    if (signal?.aborted) throw new AnalysisCancelledError();

    let flight = this.inFlight.get(cacheKey);
    if (!flight) {
      const running = this.client.start(`${dataset.id}|${dataset.version}`, request);
      const created: InFlight = {
        consumers: 0,
        cancel: () => this.client.cancel(running.id),
        promise: running.promise
          .then((result) => {
            // Only keep the result if the dataset is still the active one.
            if (this.current?.id === dataset.id && this.current.version === dataset.version) {
              this.cache.set(cacheKey, dataset.id, result);
            }
            return result;
          })
          .finally(() => {
            if (this.inFlight.get(cacheKey) === created) this.inFlight.delete(cacheKey);
          }),
      };
      flight = created;
      this.inFlight.set(cacheKey, created);
    }

    const shared = flight;
    shared.consumers++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      shared.consumers--;
      // Nobody is waiting for this result any more: stop computing it.
      if (shared.consumers <= 0 && this.inFlight.get(cacheKey) === shared) {
        shared.cancel();
        this.inFlight.delete(cacheKey);
      }
    };

    return new Promise<AnalysisResultFor<R>>((resolve, reject) => {
      const onAbort = () => {
        release();
        reject(new AnalysisCancelledError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      shared.promise.then(
        (value) => {
          signal?.removeEventListener("abort", onAbort);
          released = true;
          resolve(value as AnalysisResultFor<R>);
        },
        (error: unknown) => {
          signal?.removeEventListener("abort", onAbort);
          released = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  dispose(): void {
    this.cancelAll();
    if (this.current) this.cache.invalidateDataset(this.current.id);
    this.current = null;
    this.loading = Promise.resolve();
    this.activeClient?.terminate();
    // A factory-created client is re-created on next use; an injected one cannot be.
    if (typeof this.clientSource === "function") this.activeClient = null;
  }
}
