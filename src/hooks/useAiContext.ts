import { useEffect, useMemo } from "react";
import { useDataset } from "@hooks/useDataset";
import { useAnalysis } from "@/hooks/useAnalysis";
import { buildDatasetContext } from "@/lib/ai/contextBuilder";
import { getDatasetVersion } from "@/lib/analytics/version";
import type { DatasetContext } from "@/types";

export interface AiContextState {
  /** The context to send to the AI, or null when there is no dataset. */
  context: DatasetContext | null;
  /** False while the correlation / outlier analysis that enriches the context is still running. */
  ready: boolean;
  /** True when that analysis failed; the context is then built from the profile alone. */
  analysisFailed: boolean;
  version: string | null;
}

/**
 * Builds the AI context from the profile AND the deterministic analysis (strong correlations, outliers), so the
 * model can answer questions about relationships instead of seeing only per-column statistics.
 */
export function useAiContext(): AiContextState {
  const { dataset, loadRecords } = useDataset();
  const datasetId = dataset?.id;

  useEffect(() => {
    if (datasetId) void loadRecords();
  }, [datasetId, loadRecords]);

  const request = useMemo(
    () =>
      dataset
        ? {
            kind: "report" as const,
            meta: {
              datasetId: dataset.id,
              filename: dataset.filename,
              version: getDatasetVersion(dataset),
              completenessPercentage: dataset.profile?.completenessPercentage ?? null,
              truncated: dataset.truncated ?? false,
            },
          }
        : null,
    [dataset]
  );
  const state = useAnalysis(request);

  const report = state.status === "ready" ? (state.data ?? undefined) : undefined;
  const context = useMemo(() => (dataset ? buildDatasetContext(dataset, report) : null), [dataset, report]);
  return {
    context,
    ready: state.status === "ready" || state.status === "error",
    analysisFailed: state.status === "error",
    version: dataset ? getDatasetVersion(dataset) : null,
  };
}
