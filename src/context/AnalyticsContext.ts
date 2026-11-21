import { createContext } from "react";
import type { AnalysisService } from "@/lib/analytics/service";

export interface AnalyticsContextValue {
  service: AnalysisService;
  /** Increments each time a dataset has been loaded into the analysis engine. */
  ready: number;
  /** "dataset id|version" of the data the engine currently holds, or null. */
  datasetKey: string | null;
}

export const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);
