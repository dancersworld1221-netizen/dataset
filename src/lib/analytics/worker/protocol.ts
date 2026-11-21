import type { AnalysisRequest } from "../types";
import type { LoadedDataset } from "../engine";

/** Messages sent from the page to the analysis worker. */
export type ToWorkerMessage =
  | { type: "load"; loadId: number; dataset: LoadedDataset }
  | { type: "run"; requestId: number; datasetKey: string; request: AnalysisRequest }
  | { type: "cancel"; requestId: number }
  | { type: "unload" };

/** Messages sent from the analysis worker to the page. */
export type FromWorkerMessage =
  | { type: "loaded"; loadId: number }
  | { type: "result"; requestId: number; result: unknown }
  | { type: "error"; requestId: number; message: string; cancelled: boolean };
