import type { AnalysisEngine, LoadedDataset } from "./engine";
import { AnalysisCancelledError, type AnalysisRequest, type AnalysisResultFor } from "./types";
import type { FromWorkerMessage, ToWorkerMessage } from "./worker/protocol";

export interface RunningAnalysis<R extends AnalysisRequest> {
  id: number;
  promise: Promise<AnalysisResultFor<R>>;
}

/** Where analyses run: a Web Worker in the browser, the calling thread when no Worker exists. */
export interface AnalysisClient {
  load(dataset: LoadedDataset): Promise<void>;
  start<R extends AnalysisRequest>(datasetKey: string, request: R): RunningAnalysis<R>;
  cancel(id: number): void;
  unload(): void;
  terminate(): void;
}

/** The part of the Worker API the client needs (lets tests supply an in-process worker). */
export interface WorkerLike {
  postMessage(message: ToWorkerMessage): void;
  terminate(): void;
  onmessage: ((event: { data: FromWorkerMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class WorkerAnalysisClient implements AnalysisClient {
  private nextId = 1;
  private readonly loads = new Map<number, { resolve: () => void; reject: (reason: Error) => void }>();
  private readonly pending = new Map<number, Pending>();

  /** @param onCrash called once when the worker script fails to load or crashes. */
  constructor(
    private readonly worker: WorkerLike,
    private readonly onCrash?: (error: Error) => void
  ) {
    worker.onmessage = (event) => this.handle(event.data);
    worker.onerror = () => {
      const error = new Error("The analysis worker crashed or could not be started.");
      this.failAll(error);
      for (const load of this.loads.values()) load.reject(error);
      this.loads.clear();
      this.onCrash?.(error);
    };
  }

  private handle(message: FromWorkerMessage): void {
    if (message.type === "loaded") {
      this.loads.get(message.loadId)?.resolve();
      this.loads.delete(message.loadId);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === "result") pending.resolve(message.result);
    else pending.reject(message.cancelled ? new AnalysisCancelledError() : new Error(message.message));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  load(dataset: LoadedDataset): Promise<void> {
    const loadId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.loads.set(loadId, { resolve, reject });
      this.worker.postMessage({ type: "load", loadId, dataset });
    });
  }

  start<R extends AnalysisRequest>(datasetKey: string, request: R): RunningAnalysis<R> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "run", requestId: id, datasetKey, request });
    }) as Promise<AnalysisResultFor<R>>;
    return { id, promise };
  }

  cancel(id: number): void {
    this.worker.postMessage({ type: "cancel", requestId: id });
  }

  unload(): void {
    this.failAll(new AnalysisCancelledError());
    this.worker.postMessage({ type: "unload" });
  }

  terminate(): void {
    this.failAll(new AnalysisCancelledError());
    this.worker.terminate();
  }
}

/** Runs the engine on the calling thread (no Worker available, for example in tests). */
export class InlineAnalysisClient implements AnalysisClient {
  private engine: AnalysisEngine | null = null;
  private readonly cancelled = new Set<number>();
  private nextId = 1;

  async load(dataset: LoadedDataset): Promise<void> {
    // Imported on demand so the engine is not part of the main bundle (the Web Worker has its own copy).
    const { AnalysisEngine: Engine } = await import("./engine");
    const engine = new Engine();
    engine.load(dataset);
    this.engine = engine;
  }

  start<R extends AnalysisRequest>(datasetKey: string, request: R): RunningAnalysis<R> {
    const id = this.nextId++;
    const promise = (async () => {
      const engine = this.engine;
      if (!engine || engine.datasetKey !== datasetKey) throw new AnalysisCancelledError();
      try {
        return await engine.run(request, {
          isCancelled: () => this.cancelled.has(id),
          yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
        });
      } finally {
        this.cancelled.delete(id);
      }
    })();
    return { id, promise };
  }

  cancel(id: number): void {
    this.cancelled.add(id);
  }

  unload(): void {
    this.engine?.unload();
    this.engine = null;
  }

  terminate(): void {
    this.unload();
  }
}

/**
 * Uses a Web Worker and silently falls back to running on the calling thread when the worker cannot
 * be started or crashes (unsupported module workers, blocked by a content-security policy, ...), so
 * analysis never hangs waiting for a worker that does not exist.
 */
export class ResilientAnalysisClient implements AnalysisClient {
  private primary: AnalysisClient | null;
  private fallback: InlineAnalysisClient | null = null;
  private lastDataset: LoadedDataset | null = null;
  private fallbackReady: Promise<void> = Promise.resolve();

  constructor(createPrimary: (onCrash: (error: Error) => void) => AnalysisClient) {
    this.primary = createPrimary((error) => void this.switchToFallback(error));
  }

  /** True once the worker has been given up. */
  get usingFallback(): boolean {
    return this.fallback !== null;
  }

  private switchToFallback(_error: Error): Promise<void> {
    if (this.fallback) return this.fallbackReady;
    const inline = new InlineAnalysisClient();
    this.fallback = inline;
    try {
      this.primary?.terminate();
    } catch {
      // The crashed worker is gone anyway.
    }
    this.primary = null;
    this.fallbackReady = this.lastDataset ? inline.load(this.lastDataset) : Promise.resolve();
    return this.fallbackReady;
  }

  private get active(): AnalysisClient {
    return (this.fallback ?? this.primary) as AnalysisClient;
  }

  async load(dataset: LoadedDataset): Promise<void> {
    this.lastDataset = dataset;
    if (this.fallback) return this.fallback.load(dataset);
    try {
      await (this.primary as AnalysisClient).load(dataset);
    } catch {
      // The worker failed while loading: continue on the calling thread.
      await this.switchToFallback(new Error("worker load failed"));
    }
  }

  start<R extends AnalysisRequest>(datasetKey: string, request: R): RunningAnalysis<R> {
    const run = this.active.start(datasetKey, request);
    if (this.fallback) return run;
    // If the worker dies while this request is running, repeat it transparently on the calling thread.
    const promise = run.promise.catch(async (error: unknown) => {
      const inline = this.fallback;
      if (error instanceof AnalysisCancelledError || !inline) throw error;
      await this.fallbackReady;
      return inline.start(datasetKey, request).promise;
    });
    return { id: run.id, promise };
  }

  cancel(id: number): void {
    this.active.cancel(id);
  }

  unload(): void {
    this.lastDataset = null;
    this.active.unload();
  }

  terminate(): void {
    this.lastDataset = null;
    this.primary?.terminate();
    this.fallback?.terminate();
  }
}

/** A real Web Worker when the browser supports it (with automatic fallback), otherwise the inline client. */
export function createAnalysisClient(): AnalysisClient {
  if (typeof Worker !== "undefined") {
    try {
      return new ResilientAnalysisClient((onCrash) => {
        const worker = new Worker(new URL("./worker/analysis.worker.ts", import.meta.url), { type: "module" });
        return new WorkerAnalysisClient(worker as unknown as WorkerLike, onCrash);
      });
    } catch {
      // Fall through to the inline client when the worker cannot be created.
    }
  }
  return new InlineAnalysisClient();
}
