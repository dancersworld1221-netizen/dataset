export type ColumnDataType =
  | "string"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "empty"
  | "unknown";

export interface ColumnMetadata {
  id: string;
  name: string;
  displayName: string;
  dataType: ColumnDataType;
  totalRecords: number;
  nonEmptyCount: number;
  missingCount: number;
  missingPercentage: number;
  uniqueCount: number;
  /** Non-missing values repeated beyond their first occurrence. */
  duplicateCount: number;
  /** Non-missing values that do not fit the inferred data type (e.g. text in a numeric column). */
  invalidCount?: number;
  statistics?: ColumnStatistics;
}

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

export interface TopValue {
  value: string;
  count: number;
}

export interface ColumnStatistics {
  min?: number | string | Date;
  max?: number | string | Date;
  sum?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  /** Number of values the statistics were computed from. */
  count?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  /** Values outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR]. */
  outlierCount?: number;
  skewness?: number;
  mode?: number | string;
  modeCount?: number;
  histogram?: HistogramBin[];
  topValues?: TopValue[];
  spanDays?: number;
  minLength?: number;
  maxLength?: number;
  avgLength?: number;
  trueCount?: number;
  falseCount?: number;
  earliestDate?: Date;
  latestDate?: Date;
}

export interface ParsingError {
  category: "structure" | "encoding" | "delimiter" | "row" | "quote";
  rowNumber: number;
  columnName?: string;
  columnIndex?: number;
  message: string;
  severity: "warning" | "error";
  recoverable: boolean;
}

export interface ParsingResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
  columnCount: number;
  errors: ParsingError[];
  warnings: ParsingError[];
  /** Detected delimiter; an empty string when the file has a single column. */
  delimiter: string;
  hasHeader: boolean;
  encoding: string;
  hasBom: boolean;
  truncated: boolean;
}

export interface DatasetProfile {
  datasetId: string;
  totalRecords: number;
  totalColumns: number;
  totalCells: number;
  emptyCells: number;
  nonEmptyCells: number;
  completenessPercentage: number;
  duplicateRecords: number;
  uniqueRecords: number;
  duplicatePercentage: number;
  parsingWarningCount: number;
  parsingErrorCount: number;
  /** Rows whose field count did not match the header. */
  inconsistentRowCount?: number;
  /** Empty or duplicate column names found in the header. */
  headerIssueCount?: number;
  /** True when the file had more rows than the processing limit and was cut. */
  truncated?: boolean;
  columnMetadata: ColumnMetadata[];
  processedAt: string;
}

export interface DataQualityIssue {
  type:
    | "missing_values"
    | "duplicate_records"
    | "parsing_warning"
    | "parsing_error"
    | "inconsistent_row_length"
    | "empty_column"
    | "invalid_values"
    | "constant_column"
    | "outliers"
    | "duplicate_column_name"
    | "truncated_data";
  columnId?: string;
  columnName?: string;
  affectedRecordCount: number;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface DataQualityReport {
  datasetId: string;
  completenessScore: number;
  uniquenessScore: number;
  parsingValidityScore: number;
  /** Share of typed cells that match their column type (0-100). */
  validityScore?: number;
  /** Weighted combination of all sub-scores (0-100). */
  overallScore?: number;
  issues: DataQualityIssue[];
}

export type DatasetProcessingStatus =
  | "idle"
  | "selected"
  | "validating"
  | "parsing"
  | "profiling"
  | "saving"
  | "ready"
  | "warning"
  | "error"
  | "cancelled";

export interface DatasetRecord {
  id: string;
  filename: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
  lastProcessedAt?: string;
  recordCount: number;
  columnCount: number;
  columns: ColumnMetadata[];
  status: DatasetProcessingStatus;
  parsingWarnings: ParsingError[];
  parsingErrors: ParsingError[];
  profile?: DatasetProfile;
  qualityReport?: DataQualityReport;
  /** True when only the first part of a larger file was analysed. */
  truncated?: boolean;
  /** Number of cleaning versions applied to the stored rows (0 = rows are exactly as uploaded). */
  cleaningRevision?: number;
  delimiter?: string;
  encoding?: string;
  storageStatus: "pending" | "saved" | "failed";
  storageError?: string;
}

/** Dataset metadata as stored in the `datasets` store (rows live in a separate store). */
export interface StoredDatasetMeta {
  id: string;
  version: number;
  dataset: DatasetRecord;
  savedAt: string;
}

export interface StoredDataset extends StoredDatasetMeta {
  records: Array<Record<string, string>>;
}

export const STORAGE_VERSION = 2;

export interface MissingValuePolicy {
  markers: string[];
  treatWhitespaceOnlyAsMissing: boolean;
  treatEmptyAsMissing: boolean;
}

export const DEFAULT_MISSING_VALUE_POLICY: MissingValuePolicy = {
  // Matching is case-insensitive.
  markers: ["null", "n/a", "na", "nan", "none", "#n/a", "?", "-", "--"],
  treatWhitespaceOnlyAsMissing: true,
  treatEmptyAsMissing: true,
};

export interface ProcessingLimits {
  maxFileSizeBytes: number;
  maxRecords: number;
  maxColumns: number;
  chunkSize: number;
}

export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits = {
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxRecords: 100000,
  maxColumns: 1000,
  chunkSize: 10000,
};

// ---------------------------------------------------------------------------
// Cleaning (Phase 5.1) types
// ---------------------------------------------------------------------------

export type CleaningOperationType =
  | "remove_rows_missing"
  | "remove_column"
  | "impute_mean"
  | "impute_median"
  | "impute_mode"
  | "impute_constant"
  | "remove_duplicates"
  | "trim_whitespace"
  | "normalize_whitespace"
  | "lowercase"
  | "uppercase"
  | "validate_type";

export interface CleaningOperationRecord {
  id: string;
  datasetId: string;
  type: CleaningOperationType;
  title: string;
  description: string;
  targetColumns: string[];
  parameters: Record<string, unknown>;
  affectedRowCount: number;
  affectedCellCount: number;
  status: "pending" | "applied" | "undone" | "redone" | "failed";
  createdAt: string;
  revertedAt?: string;
}

export interface DatasetCleaningVersion {
  id: string;
  datasetId: string;
  parentVersionId?: string;
  operationId?: string;
  records: Array<Record<string, string>>;
  rowCount: number;
  columnCount: number;
  createdAt: string;
  label: string;
}

export interface ColumnMissingStats {
  column: string;
  dataType: string;
  totalRows: number;
  missingCount: number;
  missingPercentage: number;
  nonMissingCount: number;
  recommendedMethod: CleaningOperationType | null;
}

export interface DuplicateGroup {
  id: string;
  keyValues: Record<string, string>;
  rowIndices: number[];
  rowCount: number;
}

export interface DuplicateStats {
  totalDuplicateRecords: number;
  uniqueRecords: number;
  duplicatePercentage: number;
  groups: DuplicateGroup[];
}

export interface ColumnTypeValidation {
  column: string;
  currentType: string;
  suggestedType: string;
  validCount: number;
  invalidCount: number;
  invalidExamples: string[];
  needsChange: boolean;
}

/** One changed cell, shown as before/after evidence in a cleaning preview. */
export interface CleaningCellChange {
  /** 1-based row number in the dataset the operation was previewed on. */
  rowNumber: number;
  column: string;
  before: string;
  after: string;
}

export interface CleaningRemovedRow {
  rowNumber: number;
  row: Record<string, string>;
}

export interface CleaningPreview {
  operationId: string;
  type: CleaningOperationType;
  originalRowCount: number;
  previewRowCount: number;
  affectedRowCount: number;
  affectedCellCount: number;
  previewRows: Array<Record<string, string>>;
  /** Original versions of the first affected rows (never the already-cleaned values). */
  beforeSample: Array<Record<string, string>>;
  /** Cleaned versions of the same rows, in the same order as `beforeSample`. */
  afterSample: Array<Record<string, string>>;
  warnings: string[];
  /** Up to 20 changed cells (before -> after). Empty for operations that only remove rows or columns. */
  changes?: CleaningCellChange[];
  /** Up to 10 rows that the operation removes. */
  removedRows?: CleaningRemovedRow[];
  /** Columns the operation removes. */
  removedColumns?: string[];
  /** The operation the preview was computed for, so it can be committed without guessing. */
  targetColumns?: string[];
  parameters?: Record<string, unknown>;
}

export interface CleaningContextValue {
  datasetId: string | null;
  versionId: string | null;
  history: CleaningOperationRecord[];
  versions: DatasetCleaningVersion[];
  isCleaning: boolean;
  error: string | null;
  missingStats: ColumnMissingStats[];
  duplicateStats: DuplicateStats | null;
  typeValidation: ColumnTypeValidation[];
  preview: CleaningPreview | null;
  loadCleaningContext: () => Promise<void>;
  detectMissingValues: () => Promise<void>;
  detectDuplicates: () => Promise<void>;
  validateTypes: () => Promise<void>;
  previewMissingCleaning: (op: CleaningParameters) => Promise<CleaningPreview>;
  executeMissingCleaning: (op: CleaningParameters) => Promise<boolean>;
  previewDuplicateRemoval: (op: CleaningParameters) => Promise<CleaningPreview>;
  executeDuplicateRemoval: (op: CleaningParameters) => Promise<boolean>;
  previewStringCleaning: (op: CleaningParameters) => Promise<CleaningPreview>;
  executeStringCleaning: (op: CleaningParameters) => Promise<boolean>;
  previewTypeValidation: (op: CleaningParameters) => Promise<CleaningPreview>;
  executeTypeValidation: (op: CleaningParameters) => Promise<boolean>;
  commitPreview: (preview: CleaningPreview) => Promise<boolean>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: boolean;
  canRedo: boolean;
  /** Discards every cleaning step and goes back to the originally uploaded rows. */
  resetToOriginal: () => Promise<boolean>;
  clearCleaning: () => Promise<void>;
}

export interface CleaningParameters {
  type: CleaningOperationType;
  targetColumns: string[];
  parameters: Record<string, unknown>;
}
