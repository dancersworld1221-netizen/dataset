export interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

export interface PageProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export interface HealthResponse {
  status: 'ok';
  service: 'datamind-ai';
  phase: '0';
  timestamp: string;
}

export type Phase = '0' | '1' | '2' | '3';

// ---------------------------------------------------------------------------
// AI (Phase 4) contracts. Mirror the server-side contracts in worker/types.ts.
// ---------------------------------------------------------------------------

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

export interface AiRecommendation {
  id: string;
  title: string;
  explanation: string;
  reason: string;
  evidence: Array<{ label: string; value: string | number }>;
  priority: "low" | "medium" | "high";
  suggestedNextStep: string;
}

export interface AiRecommendationsResponse {
  recommendations: AiRecommendation[];
}

export interface AiReportResponse {
  report: string;
}

export interface DatasetOverview {
  name: string;
  rows: number;
  columns: number;
  size: number;
  uploadedAt: string;
}

export interface DataQualityMetrics {
  missingValues: number;
  duplicateRows: number;
  invalidValues: number;
  qualityScore: number;
}

export interface ColumnAnalysis {
  name: string;
  type: 'numeric' | 'categorical' | 'datetime' | 'text' | 'boolean';
  missingCount: number;
  uniqueCount: number;
  stats?: {
    mean?: number;
    median?: number;
    std?: number;
    min?: number;
    max?: number;
  };
  topValues?: Array<{ value: string; count: number }>;
}

export interface CleaningOperation {
  id: string;
  type: 'remove_duplicates' | 'fill_missing' | 'remove_outliers' | 'standardize' | 'custom';
  description: string;
  column?: string;
  parameters: Record<string, unknown>;
  preview: {
    before: unknown[][];
    after: unknown[][];
  };
  applied: boolean;
}