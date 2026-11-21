export interface Env {
  /** Static assets binding configured in wrangler.jsonc (`assets.binding`). */
  ASSETS: Fetcher;
  /** "production" when deployed; "development" via .dev.vars for local work. */
  ENVIRONMENT: string;
  /** Gemini API key (server-side only, never exposed to the browser). */
  GEMINI_API_KEY?: string;
  /** Gemini model to use; defaults to gemini-2.5-flash when unset. */
  GEMINI_MODEL?: string;
}

/** Worker-side API contract. The frontend keeps its own copy in src/types. */
export interface HealthResponse {
  status: 'ok';
  service: 'datamind-ai';
  phase: '0';
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  path: string;
}

// ---------------------------------------------------------------------------
// AI (Phase 4) request/response contracts
// ---------------------------------------------------------------------------

/** Compact, dataset-scoped context sent to the AI model. Built by the frontend from
 * existing analysis results; never raw CSV rows. */
export interface DatasetColumnContext {
  name: string;
  type: string;
  missingCount: number;
  missingPercentage: number;
  uniqueCount: number;
  duplicateCount: number;
  invalidCount?: number;
  statistics?: {
    min?: number;
    max?: number;
    mean?: number;
    median?: number;
    stdDev?: number;
    q1?: number;
    q3?: number;
    iqr?: number;
    outlierCount?: number;
    skewness?: number;
    count?: number;
  };
  topValues?: Array<{ value: string; count: number }>;
}

export interface DatasetContext {
  datasetId: string;
  datasetName: string;
  rowCount: number;
  columnCount: number;
  sizeBytes?: number;
  completenessPercentage?: number;
  duplicateRecords?: number;
  duplicatePercentage?: number;
  truncated?: boolean;
  columns: DatasetColumnContext[];
  qualityIssues: Array<{
    type: string;
    columnName?: string;
    affectedRecordCount: number;
    severity: string;
    description: string;
  }>;
  strongCorrelations: Array<{ a: string; b: string; r: number; n: number; strength: string; direction: string }>;
  outlierColumns: Array<{ column: string; count: number; percentage: number; kind: string }>;
}

/** POST /api/ai/insights */
export interface AiInsightsRequest {
  datasetId: string;
  context: DatasetContext;
}

export interface AiInsight {
  id: string;
  title: string;
  category: "statistical" | "data-quality" | "correlation" | "anomaly" | "business";
  severity: "info" | "low" | "medium" | "high";
  description: string;
  evidence: Array<{ label: string; value: string | number }>;
  recommendation: string;
  confidence: "low" | "medium" | "high";
}

export interface AiInsightsResponse {
  summary: string;
  insights: AiInsight[];
  limitations: string[];
}

/** POST /api/ai/chat */
export interface AiChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AiChatRequest {
  datasetId: string;
  context: DatasetContext;
  message: string;
  history: AiChatMessage[];
}

export interface AiChatResponse {
  text: string;
}

/** POST /api/ai/recommendations */
export interface AiRecommendation {
  id: string;
  title: string;
  explanation: string;
  reason: string;
  evidence: Array<{ label: string; value: string | number }>;
  priority: "low" | "medium" | "high";
  suggestedNextStep: string;
}

export interface AiRecommendationsRequest {
  datasetId: string;
  context: DatasetContext;
}

export interface AiRecommendationsResponse {
  recommendations: AiRecommendation[];
}

/** POST /api/ai/reports */
export interface AiReportRequest {
  datasetId: string;
  context: DatasetContext;
}

export interface AiReportResponse {
  report: string;
}
