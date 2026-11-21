import { describe, it, expect, vi } from "vitest";
import { AnalysisCache, makeCacheKey, stableStringify } from "@/lib/analytics/cache";
import { InlineAnalysisClient, ResilientAnalysisClient, WorkerAnalysisClient, type AnalysisClient, type WorkerLike } from "@/lib/analytics/client";
import { AnalysisService, type DatasetHandle } from "@/lib/analytics/service";
import { createWorkerHandler } from "@/lib/analytics/worker/workerHandler";
import type { FromWorkerMessage, ToWorkerMessage } from "@/lib/analytics/worker/protocol";
import { AnalysisCancelledError, type AnalysisRequest } from "@/lib/analytics/types";

const makeDataset = (id: string, version = "v1", rowsCount = 300): DatasetHandle => ({
  id,
  version,
  headers: ["a", "b", "c"],
  rows: Array.from({ length: rowsCount }, (_, i) => ({ a: String(i), b: String(i * 2 + (i % 5)), c: i % 3 === 0 ? "x" : "y" })),
  columns: [
    { name: "a", dataType: "integer" },
    { name: "b", dataType: "integer" },
    { name: "c", dataType: "string" },
  ],
});

/** An in-process Worker: messages are structured-cloned and delivered asynchronously, like a real one. */
function createFakeWorker(): WorkerLike & { terminated: boolean; sent: ToWorkerMessage[] } {
  const fake = {
    terminated: false,
    sent: [] as ToWorkerMessage[],
    onmessage: null as ((event: { data: FromWorkerMessage }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    postMessage(message: ToWorkerMessage) {
      fake.sent.push(message);
      const copy = structuredClone(message);
      setTimeout(() => handle(copy), 0);
    },
    terminate() {
      fake.terminated = true;
    },
  };
  const handle = createWorkerHandler((message) => {
    setTimeout(() => fake.onmessage?.({ data: structuredClone(message) }), 0);
  });
  return fake;
}

/** Counts how many computations were actually started. */
function spyClient(inner: AnalysisClient) {
  const start = vi.spyOn(inner, "start");
  const cancel = vi.spyOn(inner, "cancel");
  return { client: inner, start, cancel };
}

/** Aborts the controller in the microtask right after a computation has been started (deterministic, no timers). */
function abortRightAfterStart(client: AnalysisClient, controller: AbortController): void {
  const original = client.start.bind(client);
  client.start = ((datasetKey, request) => {
    const running = original(datasetKey, request);
    queueMicrotask(() => controller.abort());
    return running;
  }) as AnalysisClient["start"];
}

const histogram = (column = "a"): Extract<AnalysisRequest, { kind: "histogram" }> => ({ kind: "histogram", column, method: "fixed", bins: 10 });

describe("cache keys and cache", () => {
  it("builds the same key regardless of property order and differs by parameters", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
    const r1 = makeCacheKey("ds", "v1", { kind: "histogram", column: "a", method: "fixed", bins: 10 });
    const r2 = makeCacheKey("ds", "v1", { kind: "histogram", bins: 10, method: "fixed", column: "a" });
    expect(r1).toBe(r2);
    expect(makeCacheKey("ds", "v1", { kind: "histogram", column: "a", method: "fixed", bins: 12 })).not.toBe(r1);
    expect(makeCacheKey("ds", "v2", { kind: "histogram", column: "a", method: "fixed", bins: 10 })).not.toBe(r1);
    expect(makeCacheKey("other", "v1", { kind: "histogram", column: "a", method: "fixed", bins: 10 })).not.toBe(r1);
  });

  it("evicts the least recently used entry and invalidates per dataset", () => {
    const cache = new AnalysisCache(3);
    cache.set("k1", "d1", 1);
    cache.set("k2", "d1", 2);
    cache.set("k3", "d2", 3);
    cache.get("k1"); // k1 is now the most recent
    cache.set("k4", "d2", 4); // evicts k2
    expect(cache.has("k2")).toBe(false);
    expect(cache.has("k1")).toBe(true);
    expect(cache.size("d2")).toBe(2);
    expect(cache.invalidateDataset("d2")).toBe(2);
    expect(cache.size()).toBe(1);
  });
});

describe("worker message protocol", () => {
  it("returns the same results as the inline engine", async () => {
    const worker = new WorkerAnalysisClient(createFakeWorker());
    const inline = new InlineAnalysisClient();
    const dataset = makeDataset("p");
    const loaded = { datasetKey: "p|v1", headers: dataset.headers, rows: dataset.rows, columns: dataset.columns };
    await worker.load(loaded);
    await inline.load(loaded);
    for (const request of [histogram("a"), { kind: "correlation", method: "spearman" } as AnalysisRequest, { kind: "frequency", column: "c" } as AnalysisRequest]) {
      expect(await worker.start("p|v1", request).promise).toEqual(await inline.start("p|v1", request).promise);
    }
  });

  it("rejects requests for a dataset that is no longer loaded", async () => {
    const worker = new WorkerAnalysisClient(createFakeWorker());
    const d = makeDataset("p");
    await worker.load({ datasetKey: "p|v1", headers: d.headers, rows: d.rows, columns: d.columns });
    await expect(worker.start("old|v0", histogram()).promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it("cancels a running analysis cooperatively", async () => {
    const fake = createFakeWorker();
    const worker = new WorkerAnalysisClient(fake);
    const d = makeDataset("p");
    await worker.load({ datasetKey: "p|v1", headers: d.headers, rows: d.rows, columns: d.columns });
    const running = worker.start("p|v1", { kind: "relationships" });
    const outcome = running.promise.then(() => "finished", (e: unknown) => (e instanceof AnalysisCancelledError ? "cancelled" : "failed"));
    worker.cancel(running.id);
    expect(await outcome).toBe("cancelled");
    expect(fake.sent.some((m) => m.type === "cancel")).toBe(true);
  });

  it("fails pending requests when the worker is terminated or unloaded", async () => {
    const fake = createFakeWorker();
    const worker = new WorkerAnalysisClient(fake);
    const d = makeDataset("p");
    await worker.load({ datasetKey: "p|v1", headers: d.headers, rows: d.rows, columns: d.columns });
    const running = worker.start("p|v1", { kind: "relationships" });
    worker.terminate();
    await expect(running.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(fake.terminated).toBe(true);
  });
});

describe("AnalysisService", () => {
  const setup = (client: AnalysisClient = new InlineAnalysisClient()) => {
    const cache = new AnalysisCache();
    const spies = spyClient(client);
    return { cache, service: new AnalysisService(spies.client, cache), ...spies };
  };

  it("caches results by dataset id, version and parameters", async () => {
    const { service, cache, start } = setup();
    await service.setDataset(makeDataset("ds1"));
    const first = await service.run(histogram("a"));
    const second = await service.run(histogram("a"));
    expect(second).toBe(first); // same object from the cache
    expect(start).toHaveBeenCalledTimes(1);
    await service.run({ kind: "histogram", column: "a", method: "fixed", bins: 12 });
    await service.run(histogram("b"));
    expect(start).toHaveBeenCalledTimes(3);
    expect(cache.size("ds1")).toBe(3);
  });

  it("does not recompute when the same dataset version is set again", async () => {
    const { service, start } = setup();
    const dataset = makeDataset("ds1");
    await service.setDataset(dataset);
    await service.run(histogram());
    await service.setDataset({ ...dataset });
    await service.run(histogram());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("invalidates stale entries when the dataset version changes", async () => {
    const { service, cache, start } = setup();
    await service.setDataset(makeDataset("ds1", "v1"));
    await service.run(histogram());
    expect(cache.size("ds1")).toBe(1);
    await service.setDataset(makeDataset("ds1", "v2", 250));
    expect(cache.size("ds1")).toBe(0);
    const fresh = await service.run(histogram());
    expect(start).toHaveBeenCalledTimes(2);
    expect(fresh.totalIncluded).toBe(250); // computed from the new rows, not served from the old cache
  });

  it("drops every cached result when another dataset replaces it or it is removed", async () => {
    const { service, cache } = setup();
    await service.setDataset(makeDataset("ds1"));
    await service.run(histogram());
    await service.setDataset(makeDataset("ds2"));
    expect(cache.size("ds1")).toBe(0);
    await service.run(histogram());
    expect(cache.size("ds2")).toBe(1);
    await service.clear();
    expect(cache.size()).toBe(0);
    await expect(service.run(histogram())).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it("shares one computation between identical concurrent requests", async () => {
    const { service, start } = setup();
    await service.setDataset(makeDataset("ds1"));
    const [a, b] = await Promise.all([service.run({ kind: "relationships" }), service.run({ kind: "relationships" })]);
    expect(a).toBe(b);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("cancels an outdated calculation when its only consumer goes away", async () => {
    const controller = new AbortController();
    const client = new InlineAnalysisClient();
    abortRightAfterStart(client, controller);
    const { service, cache, cancel } = setup(client);
    await service.setDataset(makeDataset("ds1"));
    const pending = service.run({ kind: "relationships" }, controller.signal);
    await expect(pending).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(cancel).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(cache.size("ds1")).toBe(0); // the cancelled result is never cached
  });

  it("keeps computing while at least one consumer still waits", async () => {
    const { service, cancel, start } = setup();
    await service.setDataset(makeDataset("ds1"));
    const first = new AbortController();
    const a = service.run({ kind: "relationships" }, first.signal);
    const b = service.run({ kind: "relationships" });
    first.abort();
    await expect(a).rejects.toBeInstanceOf(AnalysisCancelledError);
    await expect(b).resolves.toBeDefined();
    expect(cancel).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("cancels running work and never caches its result when the dataset changes", async () => {
    const { service, cache } = setup();
    await service.setDataset(makeDataset("ds1"));
    const old = service.run({ kind: "relationships" });
    const outcome = old.then(() => "finished", (e: unknown) => (e instanceof AnalysisCancelledError ? "cancelled" : "failed"));
    await service.setDataset(makeDataset("ds2"));
    expect(await outcome).toBe("cancelled");
    expect(cache.size("ds1")).toBe(0);
  });

  it("works through a Web Worker client too (cache + cancellation)", async () => {
    const fake = createFakeWorker();
    const client = new WorkerAnalysisClient(fake);
    const { service, start } = setup(client);
    await service.setDataset(makeDataset("ds1"));
    const a = await service.run(histogram());
    const b = await service.run(histogram());
    expect(b).toBe(a);
    expect(start).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    abortRightAfterStart(client, controller);
    const pending = service.run({ kind: "relationships" }, controller.signal);
    await expect(pending).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(fake.sent.some((m) => m.type === "cancel")).toBe(true);
  });

  it("does not start anything when the caller has already gone away", async () => {
    const { service, start } = setup();
    await service.setDataset(makeDataset("ds1"));
    const controller = new AbortController();
    controller.abort();
    await expect(service.run(histogram(), controller.signal)).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("StrictMode safety (dispose then reuse)", () => {
  it("re-creates a factory-created client after dispose, so a service survives mount / unmount / mount", async () => {
    const created: InlineAnalysisClient[] = [];
    const service = new AnalysisService(() => {
      const client = new InlineAnalysisClient();
      created.push(client);
      return client;
    }, new AnalysisCache());
    expect(created).toHaveLength(0); // lazy: nothing is created until needed

    await service.setDataset(makeDataset("ds1"));
    expect((await service.run(histogram())).totalIncluded).toBe(300);

    service.dispose(); // what React does in StrictMode's simulated unmount
    await service.setDataset(makeDataset("ds1")); // ... and the remount loads the dataset again
    expect((await service.run(histogram())).totalIncluded).toBe(300);
    expect(created).toHaveLength(2);
  });

  it("a Web Worker client is replaced by a fresh worker after dispose", async () => {
    const workers: Array<ReturnType<typeof createFakeWorker>> = [];
    const service = new AnalysisService(() => {
      const worker = createFakeWorker();
      workers.push(worker);
      return new WorkerAnalysisClient(worker);
    }, new AnalysisCache());
    await service.setDataset(makeDataset("ds1"));
    await service.run(histogram());
    service.dispose();
    expect(workers[0].terminated).toBe(true);
    await service.setDataset(makeDataset("ds1"));
    expect((await service.run(histogram())).totalIncluded).toBe(300);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
  });
});

describe("resilience", () => {
  it("falls back to the calling thread when the worker cannot be started", async () => {
    const crashing: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        // Like a worker script that fails to load: no reply, only an error event.
        setTimeout(() => crashing.onerror?.({}), 0);
      },
      terminate() {},
    };
    const client = new ResilientAnalysisClient((onCrash) => new WorkerAnalysisClient(crashing, onCrash));
    const service = new AnalysisService(client, new AnalysisCache());
    await service.setDataset(makeDataset("ds1"));
    expect(client.usingFallback).toBe(true);
    expect((await service.run(histogram())).totalIncluded).toBe(300);
  });

  it("repeats a running request on the calling thread when the worker dies mid-analysis", async () => {
    const real = createFakeWorker();
    const flaky: WorkerLike = {
      get onmessage() { return real.onmessage; },
      set onmessage(v) { real.onmessage = v; },
      onerror: null,
      postMessage(message) {
        if (message.type === "run") {
          setTimeout(() => flaky.onerror?.({}), 0); // crash instead of answering
          return;
        }
        real.postMessage(message);
      },
      terminate() { real.terminate(); },
    };
    const client = new ResilientAnalysisClient((onCrash) => new WorkerAnalysisClient(flaky, onCrash));
    const service = new AnalysisService(client, new AnalysisCache());
    await service.setDataset(makeDataset("ds1"));
    expect(client.usingFallback).toBe(false);
    const result = await service.run(histogram());
    expect(result.totalIncluded).toBe(300);
    expect(client.usingFallback).toBe(true);
  });
});

describe("weight-bounded cache", () => {
  it("evicts by total weight so large outlier results cannot exhaust memory", () => {
    const big = (n: number) => ({ rowIndices: Array.from({ length: n }, (_, i) => i) });
    const cache = new AnalysisCache(100, 25_000);
    cache.set("a", "d", big(10_000));
    cache.set("b", "d", big(10_000));
    cache.set("c", "d", big(10_000)); // total would be ~30,003 > 25,000: the least recently used goes
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    cache.invalidateDataset("d");
    expect(cache.size()).toBe(0);
    cache.set("x", "d", big(10_000));
    expect(cache.has("x")).toBe(true); // a single entry is always kept
  });
});
