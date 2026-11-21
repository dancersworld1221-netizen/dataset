import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDataset } from "@/hooks/useDataset";
import { createAnalysisClient, type AnalysisClient } from "@/lib/analytics/client";
import { AnalysisService } from "@/lib/analytics/service";
import { getDatasetVersion } from "@/lib/analytics/version";
import { AnalyticsContext, type AnalyticsContextValue } from "./AnalyticsContext";

interface AnalyticsProviderProps {
  children: ReactNode;
  /** Lets tests inject a client; defaults to a Web Worker (or the inline fallback). */
  createClient?: () => AnalysisClient;
}

/**
 * Keeps the analysis engine in sync with the active dataset. The rows are sent to the engine once per
 * dataset version; when the dataset is replaced or removed, running work is cancelled and every cached
 * result of the old dataset is dropped.
 */
export function AnalyticsProvider({ children, createClient = createAnalysisClient }: AnalyticsProviderProps) {
  const { dataset, records } = useDataset();
  const serviceRef = useRef<AnalysisService | null>(null);
  // The client factory is passed (not a client) so no Worker is created during render and the service
  // survives StrictMode's mount / unmount / mount cycle in development.
  if (serviceRef.current === null) serviceRef.current = new AnalysisService(createClient);
  const service = serviceRef.current;

  const [ready, setReady] = useState(0);
  const [datasetKey, setDatasetKey] = useState<string | null>(null);

  const datasetId = dataset?.id ?? null;
  const version = dataset ? getDatasetVersion(dataset) : null;
  const columns = dataset?.columns;

  useEffect(() => {
    let cancelled = false;
    if (!datasetId || !version || !columns || !records) {
      if (!datasetId) {
        void service.clear().then(() => {
          if (!cancelled) setDatasetKey(null);
        });
      }
      return () => {
        cancelled = true;
      };
    }
    void service
      .setDataset({
        id: datasetId,
        version,
        headers: columns.map((c) => c.name),
        rows: records,
        columns: columns.map((c) => ({ name: c.name, dataType: c.dataType })),
      })
      .then(() => {
        if (cancelled) return;
        setDatasetKey(`${datasetId}|${version}`);
        setReady((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [service, datasetId, version, columns, records]);

  useEffect(() => () => service.dispose(), [service]);

  const value = useMemo<AnalyticsContextValue>(() => ({ service, ready, datasetKey }), [service, ready, datasetKey]);
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}
