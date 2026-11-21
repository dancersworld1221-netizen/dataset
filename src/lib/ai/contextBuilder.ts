import type {
  AiChatResponse,
  AiInsightsResponse,
  AiRecommendationsResponse,
  AiReportResponse,
  DatasetColumnContext,
  DatasetContext,
} from "@/types";
import type {
  DataQualityIssue,
  DatasetRecord,
} from "@/types/dataset.types";
import type { AnalyticalReport } from "@/lib/analytics/types";

/** Upper bound on columns sent to the model. Keeps prompts bounded and readable. */
const MAX_COLUMNS_IN_CONTEXT = 60;

/** Upper bound on quality issues and correlations included in the context. */
const MAX_ISSUES_IN_CONTEXT = 40;
const MAX_CORRELATIONS_IN_CONTEXT = 20;
const MAX_OUTLIER_COLUMNS_IN_CONTEXT = 20;

/** Most frequent values are only shared for category-like columns, and clipped. */
const MAX_SHARED_DISTINCT = 25;
const MAX_SHARED_VALUE_LENGTH = 40;

/**
 * Sample values can be personal data (names, e-mail addresses, ids). They are therefore only included for
 * low-cardinality text / boolean columns, where the values are labels such as "Male" or "Premium"; columns
 * with many distinct values (almost certainly identifiers or free text) contribute statistics only.
 */
function shareableTopValues(column: DatasetRecord["columns"][number]): Array<{ value: string; count: number }> | undefined {
  const top = column.statistics?.topValues;
  if (!top || top.length === 0) return undefined;
  if (column.dataType !== "string" && column.dataType !== "boolean") return undefined;
  const lowCardinality =
    column.uniqueCount <= MAX_SHARED_DISTINCT && column.uniqueCount <= Math.max(1, column.nonEmptyCount * 0.5);
  if (!lowCardinality) return undefined;
  return top.slice(0, 5).map((t) => ({ value: t.value.slice(0, MAX_SHARED_VALUE_LENGTH), count: t.count }));
}

/** Builds a compact, dataset-scoped AI context from existing analysis results.
 *
 * The context reuses results already computed by previous phases (profiling, quality,
 * correlations, outliers) rather than recomputing them or sending raw CSV rows. Sensitive
 * or identifying cell values are never included.
 */
export function buildDatasetContext(
  dataset: DatasetRecord,
  report?: AnalyticalReport
): DatasetContext {
  const profile = dataset.profile;
  const qualityReport = dataset.qualityReport;

  const columns: DatasetColumnContext[] = dataset.columns
    .slice(0, MAX_COLUMNS_IN_CONTEXT)
    .map((column): DatasetColumnContext => {
      const stats = column.statistics;
      return {
        name: column.name,
        type: column.dataType,
        missingCount: column.missingCount,
        missingPercentage: column.missingPercentage,
        uniqueCount: column.uniqueCount,
        duplicateCount: column.duplicateCount,
        ...(column.invalidCount !== undefined && { invalidCount: column.invalidCount }),
        ...(stats && {
          statistics: {
            ...(typeof stats.min === "number" && { min: stats.min }),
            ...(typeof stats.max === "number" && { max: stats.max }),
            ...(typeof stats.mean === "number" && { mean: stats.mean }),
            ...(typeof stats.median === "number" && { median: stats.median }),
            ...(typeof stats.stdDev === "number" && { stdDev: stats.stdDev }),
            ...(typeof stats.q1 === "number" && { q1: stats.q1 }),
            ...(typeof stats.q3 === "number" && { q3: stats.q3 }),
            ...(typeof stats.iqr === "number" && { iqr: stats.iqr }),
            ...(typeof stats.outlierCount === "number" && { outlierCount: stats.outlierCount }),
            ...(typeof stats.skewness === "number" && { skewness: stats.skewness }),
            ...(typeof stats.count === "number" && { count: stats.count }),
          },
        }),
        ...(shareableTopValues(column) && { topValues: shareableTopValues(column) }),
      };
    });

  const qualityIssues = (qualityReport?.issues ?? [])
    .slice(0, MAX_ISSUES_IN_CONTEXT)
    .map((issue: DataQualityIssue) => ({
      type: issue.type,
      columnName: issue.columnName,
      affectedRecordCount: issue.affectedRecordCount,
      severity: issue.severity,
      description: issue.description,
    }));

  const strongCorrelations = (report?.strongCorrelations ?? [])
    .slice(0, MAX_CORRELATIONS_IN_CONTEXT)
    .map((pair) => ({
      a: pair.a,
      b: pair.b,
      r: pair.r,
      n: pair.n,
      strength: pair.strength,
      direction: pair.direction,
    }));

  const outlierColumns = (report?.outliers ?? [])
    .filter((o) => o.count > 0)
    .slice(0, MAX_OUTLIER_COLUMNS_IN_CONTEXT)
    .map((o) => ({
      column: o.column,
      count: o.count,
      percentage: o.percentage,
      kind: o.kind,
    }));

  return {
    datasetId: dataset.id,
    datasetName: dataset.filename,
    rowCount: dataset.recordCount,
    columnCount: dataset.columnCount,
    sizeBytes: dataset.fileSize,
    completenessPercentage: profile?.completenessPercentage,
    duplicateRecords: profile?.duplicateRecords,
    duplicatePercentage: profile?.duplicatePercentage,
    truncated: dataset.truncated === true,
    columns,
    qualityIssues,
    strongCorrelations,
    outlierColumns,
  };
}

/** Verifies that an AI response object has the shape expected for insights. */
export function isValidAiInsightsResponse(value: unknown): value is AiInsightsResponse {
  const obj = value as Record<string, unknown> | null;
  if (!obj || typeof obj.summary !== "string") return false;
  if (!Array.isArray(obj.insights)) return false;
  for (const insight of obj.insights) {
    const i = insight as Record<string, unknown>;
    if (
      typeof i.id !== "string" ||
      typeof i.title !== "string" ||
      !["statistical", "data-quality", "correlation", "anomaly", "business"].includes(i.category as string) ||
      !["info", "low", "medium", "high"].includes(i.severity as string) ||
      typeof i.description !== "string" ||
      !Array.isArray(i.evidence) ||
      typeof i.confidence !== "string"
    ) {
      return false;
    }
  }
  return Array.isArray(obj.limitations);
}

/** Verifies that an AI response object has the shape expected for recommendations. */
export function isValidAiRecommendationsResponse(value: unknown): value is AiRecommendationsResponse {
  const obj = value as Record<string, unknown> | null;
  if (!obj || !Array.isArray(obj.recommendations)) return false;
  for (const rec of obj.recommendations) {
    const r = rec as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.title !== "string" ||
      typeof r.explanation !== "string" ||
      typeof r.reason !== "string" ||
      !Array.isArray(r.evidence) ||
      !["low", "medium", "high"].includes(r.priority as string)
    ) {
      return false;
    }
  }
  return true;
}

/** Verifies that an AI response object has the shape expected for reports. */
export function isValidAiReportResponse(value: unknown): value is AiReportResponse {
  const obj = value as Record<string, unknown> | null;
  return Boolean(obj && typeof obj.report === "string" && obj.report.length > 0);
}

/** Verifies that an AI chat response has the expected shape. */
export function isValidAiChatResponse(value: unknown): value is AiChatResponse {
  const obj = value as Record<string, unknown> | null;
  return Boolean(obj && typeof obj.text === "string");
}
