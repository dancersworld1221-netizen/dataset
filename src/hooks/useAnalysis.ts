import { useContext, useEffect, useMemo, useState } from "react";
import { AnalyticsContext } from "@/context/AnalyticsContext";
import { makeCacheKey } from "@/lib/analytics/cache";
import { analysisCache } from "@/lib/analytics/cache";
import { AnalysisCancelledError, type AnalysisRequest, type AnalysisResultFor } from "@/lib/analytics/types";

export interface AnalysisState<R extends AnalysisRequest> {
  status: "idle" | "loading" | "ready" | "error";
  data: AnalysisResultFor<R> | null;
  error: string | null;
}

export function useAnalyticsService() {
  const context = useContext(AnalyticsContext);
  if (!context) throw new Error("useAnalysis must be used inside an AnalyticsProvider");
  return context;
}

/**
 * Runs one analysis request against the active dataset.
 * - `null` disables the request.
 * - Results come from the cache when available (keyed by dataset id, version and parameters).
 * - When the request changes or the component unmounts, an unfinished computation is cancelled.
 * Only the result of the current request is kept in React state.
 */
export function useAnalysis<R extends AnalysisRequest>(request: R | null): AnalysisState<R> {
  const { service, ready, datasetKey } = useAnalyticsService();
  const requestKey = useMemo(() => (request ? JSON.stringify(request) : null), [request]);
  const [state, setState] = useState<{ key: string; value: AnalysisState<R> } | null>(null);

  useEffect(() => {
    if (!request || !datasetKey || !requestKey) return;
    const stateKey = `${datasetKey}|${requestKey}`;
    const [datasetId, version] = datasetKey.split("|");
    const cached = analysisCache.get<AnalysisResultFor<R>>(makeCacheKey(datasetId, version, request));
    if (cached !== undefined) {
      setState({ key: stateKey, value: { status: "ready", data: cached, error: null } });
      return;
    }
    const controller = new AbortController();
    setState({ key: stateKey, value: { status: "loading", data: null, error: null } });
    service.run(request, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key: stateKey, value: { status: "ready", data, error: null } });
      },
      (error: unknown) => {
        if (controller.signal.aborted || error instanceof AnalysisCancelledError) return;
        setState({ key: stateKey, value: { status: "error", data: null, error: error instanceof Error ? error.message : "Analysis failed" } });
      }
    );
    return () => controller.abort();
    // `request` is represented by requestKey; `ready` re-runs the effect after a dataset reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, datasetKey, requestKey, ready]);

  if (!request || !datasetKey || !requestKey) return { status: "idle", data: null, error: null };
  const expectedKey = `${datasetKey}|${requestKey}`;
  if (state && state.key === expectedKey) return state.value;
  return { status: "loading", data: null, error: null };
}
