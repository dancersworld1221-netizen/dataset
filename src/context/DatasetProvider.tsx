import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CleaningOperationType,
  CleaningParameters,
  CleaningPreview,
  ColumnMetadata,
  DataQualityReport,
  DatasetProcessingStatus,
  DatasetProfile,
  DatasetRecord,
  ParsingResult,
  ProcessingLimits,
  StoredDataset,
} from "@/types/dataset.types";
import { DEFAULT_PROCESSING_LIMITS, STORAGE_VERSION } from "@/types/dataset.types";
import {
  validateFile,
  parseCsvFile,
  DEFAULT_VALIDATION_OPTIONS,
  type FileValidationOptions,
} from "@/lib/csv/csvParser";
import { profileDatasetAsync, type ProfileInput } from "@/lib/profiling/profilingEngine";
import { generateQualityReport } from "@/lib/profiling/dataQuality";
import { datasetRepository, describeStorageError } from "@/lib/storage/datasetRepository";
import { addToast } from "@/lib/toast-state";
import { analysisCache } from "@/lib/analytics/cache";
import { cleaningEngine } from "@/lib/cleaning/engine";
import { DatasetContext, type DatasetContextValue } from "./DatasetContext";

/** What has to be swapped on the dataset record when the active cleaning version changes. */
interface CleaningSnapshot {
  columns: ColumnMetadata[];
  profile: DatasetProfile;
  qualityReport: DataQualityReport;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function generateId(): string {
  return `ds-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

class CancelledError extends Error {
  constructor() {
    super("Processing cancelled");
    this.name = "CancelledError";
  }
}

interface DatasetProviderProps {
  children: ReactNode;
  limits?: ProcessingLimits;
  validationOptions?: FileValidationOptions;
}

/**
 * Single source of truth for the active dataset. Every page reads the same state, the stored
 * dataset is recovered once, and row data is only loaded when a page asks for it.
 */
export function DatasetProvider({
  children,
  limits = DEFAULT_PROCESSING_LIMITS,
  validationOptions = DEFAULT_VALIDATION_OPTIONS,
}: DatasetProviderProps) {
  const [dataset, setDataset] = useState<DatasetRecord | null>(null);
  const [records, setRecords] = useState<Array<Record<string, string>> | null>(null);
  const [status, setStatus] = useState<DatasetProcessingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [parsingResult, setParsingResult] = useState<ParsingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);

  const datasetRef = useRef<DatasetRecord | null>(null);
  const recordsRef = useRef<Array<Record<string, string>> | null>(null);
  const processingRef = useRef(false);
  const cancelRef = useRef(false);
  const recordsRequestRef = useRef<string | null>(null);

  // ------------------------------------------------------------------
  // Cleaning state
  // ------------------------------------------------------------------
  const [cleaningError, setCleaningError] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [preview, setPreview] = useState<CleaningPreview | null>(null);
  const [missingStats, setMissingStats] = useState<Array<{
    column: string;
    dataType: string;
    totalRows: number;
    missingCount: number;
    missingPercentage: number;
    nonMissingCount: number;
    recommendedMethod: CleaningOperationType | null;
  }>>([]);
  const [duplicateStats, setDuplicateStats] = useState<{
    totalDuplicateRecords: number;
    uniqueRecords: number;
    duplicatePercentage: number;
    groups: Array<{ id: string; keyValues: Record<string, string>; rowIndices: number[]; rowCount: number }>;
  } | null>(null);
  const [typeValidation, setTypeValidation] = useState<Array<{
    column: string;
    currentType: string;
    suggestedType: string;
    validCount: number;
    invalidCount: number;
    invalidExamples: string[];
    needsChange: boolean;
  }>>([]);

  // Cleaning engine bookkeeping. The engine is a module singleton, so it is (re)initialised lazily for the
  // active dataset, and reset whenever the dataset is replaced or removed.
  const cleaningDatasetRef = useRef<string | null>(null);
  const cleaningBusyRef = useRef(false);
  const snapshotsRef = useRef<Map<string, CleaningSnapshot>>(new Map());
  /** Bumped whenever the (non-React) cleaning engine changes, so the context value is rebuilt. */
  const [cleaningTick, setCleaningTick] = useState(0);

  // Refs are updated at the moment state is set (not in an effect): child effects run before this
  // provider's effects, so a child that calls loadRecords() right after the dataset appears must
  // already see the new dataset.
  const commitDataset = useCallback((next: DatasetRecord | null) => {
    datasetRef.current = next;
    setDataset(next);
  }, []);
  const commitRecords = useCallback((next: Array<Record<string, string>> | null) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  /** Forgets everything about the previous dataset's cleaning session. */
  const resetCleaningState = useCallback(() => {
    cleaningDatasetRef.current = null;
    snapshotsRef.current.clear();
    cleaningEngine.initialize({ rows: [], columns: [] }, "Cleared");
    setPreview(null);
    setMissingStats([]);
    setDuplicateStats(null);
    setTypeValidation([]);
    setCleaningError(null);
    setCleaningTick((t) => t + 1);
  }, []);

  const isProcessing =
    status === "validating" ||
    status === "parsing" ||
    status === "profiling" ||
    status === "saving";

  // Recover the stored dataset (metadata only) once, when the app starts.
  useEffect(() => {
    let cancelled = false;
    const recover = async () => {
      try {
        const active = await datasetRepository.getActiveMeta();
        if (cancelled || !active || processingRef.current) return;
        commitDataset(active.dataset);
        setStatus(active.dataset.status);
        setProgress(100);
      } catch {
        // Recovery is best-effort: without stored data the app simply starts empty.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void recover();
    return () => {
      cancelled = true;
    };
  }, [commitDataset]);

  const loadRecords = useCallback(async () => {
    const current = datasetRef.current;
    if (!current) return;
    if (recordsRef.current || recordsRequestRef.current === current.id) return;
    recordsRequestRef.current = current.id;
    setIsRecordsLoading(true);
    try {
      const rows = await datasetRepository.getRecords(current.id);
      if (datasetRef.current?.id === current.id) {
        commitRecords(rows ?? []);
      }
    } catch (err) {
      addToast({
        title: "Could not load rows",
        description: describeStorageError(err),
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      recordsRequestRef.current = null;
      setIsRecordsLoading(false);
    }
  }, [commitRecords]);

  const clearError = useCallback(() => setError(null), []);

  const cancelProcessing = useCallback(() => {
    if (processingRef.current) cancelRef.current = true;
  }, []);

  const processFile = useCallback(
    async (file: File): Promise<boolean> => {
      if (processingRef.current) return false;

      const validation = validateFile(file, validationOptions);
      if (!validation.valid) {
        setError(validation.error ?? "Invalid file");
        setStatus(datasetRef.current?.status ?? "error");
        addToast({
          title: "Validation failed",
          description: validation.error,
          variant: "destructive",
          duration: 5000,
        });
        return false;
      }

      processingRef.current = true;
      cancelRef.current = false;
      const checkCancelled = () => {
        if (cancelRef.current) throw new CancelledError();
      };

      setError(null);
      setStatus("validating");
      setProgress(10);

      try {
        setStatus("parsing");
        setProgress(25);

        const result = await parseCsvFile(file, {
          skipEmptyLines: true,
          maxRecords: limits.maxRecords,
          maxColumns: limits.maxColumns,
          chunkSize: limits.chunkSize,
        });
        checkCancelled();

        const fatal = result.errors.find((e) => e.severity === "error");
        if (result.rowCount === 0 || result.headers.length > limits.maxColumns) {
          throw new Error(fatal?.message ?? "The file could not be parsed");
        }

        setParsingResult(result);
        setProgress(40);
        setStatus("profiling");

        const id = generateId();
        const profileInput: ProfileInput = {
          headers: result.headers,
          rows: result.rows,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          parsingErrors: result.errors,
          parsingWarnings: result.warnings,
          truncated: result.truncated,
        };

        const profile = await profileDatasetAsync(profileInput, id, (fraction) => {
          setProgress(40 + Math.round(fraction * 45));
        });
        checkCancelled();
        const qualityReport = generateQualityReport(profile);

        setStatus("saving");
        setProgress(90);

        const hasIssues =
          result.errors.length > 0 || result.warnings.length > 0 || result.truncated;
        const now = new Date().toISOString();
        const record: DatasetRecord = {
          id,
          filename: file.name,
          fileSize: file.size,
          fileType: file.type || "text/csv",
          createdAt: now,
          lastProcessedAt: now,
          recordCount: result.rowCount,
          columnCount: result.columnCount,
          columns: profile.columnMetadata,
          status: hasIssues ? "warning" : "ready",
          parsingWarnings: result.warnings,
          parsingErrors: result.errors,
          profile,
          qualityReport,
          truncated: result.truncated,
          delimiter: result.delimiter,
          encoding: result.encoding,
          storageStatus: "saved",
        };

        const stored: StoredDataset = {
          id,
          version: STORAGE_VERSION,
          dataset: record,
          records: result.rows,
          savedAt: now,
        };

        let finalRecord = record;
        try {
          await datasetRepository.save(stored);
          await datasetRepository.pruneExcept(id);
        } catch (saveError) {
          // The data is still usable in memory; tell the user it will not survive a reload.
          const message = describeStorageError(saveError);
          finalRecord = {
            ...record,
            status: "warning",
            storageStatus: "failed",
            storageError: message,
          };
          addToast({
            title: "Dataset not saved",
            description: `${message} You can keep working, but the data will be lost when you close this tab.`,
            variant: "destructive",
            duration: 8000,
          });
        }

        // The previous dataset's analysis results are obsolete as soon as it is replaced.
        if (datasetRef.current) analysisCache.invalidateDataset(datasetRef.current.id);
        resetCleaningState();
        commitDataset(finalRecord);
        commitRecords(result.rows);
        setStatus(finalRecord.status);
        setProgress(100);

        if (finalRecord.storageStatus === "saved") {
          addToast({
            title: "Dataset processed",
            description: `${result.rowCount.toLocaleString()} rows, ${result.columnCount} columns`,
            variant: "success",
            duration: 4000,
          });
        }
        return true;
      } catch (err) {
        if (err instanceof CancelledError) {
          setStatus(datasetRef.current?.status ?? "idle");
          setProgress(datasetRef.current ? 100 : 0);
          addToast({ title: "Processing cancelled", variant: "info", duration: 3000 });
        } else {
          const message = err instanceof Error ? err.message : "Processing failed";
          // A failed upload must not make the dataset that is still loaded look broken.
          setStatus(datasetRef.current?.status ?? "error");
          setError(message);
          addToast({
            title: "Processing failed",
            description: message,
            variant: "destructive",
            duration: 5000,
          });
        }
        return false;
      } finally {
        processingRef.current = false;
        cancelRef.current = false;
      }
    },
    [validationOptions, limits, commitDataset, commitRecords, resetCleaningState]
  );

  const clearDataset = useCallback(async () => {
    const current = datasetRef.current;
    if (current) {
      try {
        await datasetRepository.delete(current.id);
      } catch (err) {
        addToast({
          title: "Could not remove stored data",
          description: describeStorageError(err),
          variant: "destructive",
          duration: 5000,
        });
      }
    }
    // Drop every cached analysis result of the removed dataset right away.
    if (current) analysisCache.invalidateDataset(current.id);
    resetCleaningState();
    commitDataset(null);
    commitRecords(null);
    setStatus("idle");
    setProgress(0);
    setParsingResult(null);
    setError(null);
  }, [commitDataset, commitRecords, resetCleaningState]);

  // ------------------------------------------------------------------
  // Cleaning
  // ------------------------------------------------------------------
  /** Makes sure the engine holds the rows of the active dataset; returns what operations need. */
  const ensureCleaning = useCallback(() => {
    const current = datasetRef.current;
    const rows = recordsRef.current;
    if (!current) throw new Error("No dataset loaded");
    if (!rows) throw new Error("The rows are still loading");
    const columns = current.columns.map((c) => ({ name: c.name, dataType: c.dataType as string }));
    if (cleaningDatasetRef.current !== current.id) {
      cleaningEngine.initialize({ rows, columns }, `Original: ${current.filename}`, current.id);
      snapshotsRef.current.clear();
      const originalId = cleaningEngine.getCurrentVersionId();
      if (originalId && current.profile && current.qualityReport) {
        snapshotsRef.current.set(originalId, {
          columns: current.columns,
          profile: current.profile,
          qualityReport: current.qualityReport,
        });
      }
      cleaningDatasetRef.current = current.id;
      setMissingStats([]);
      setDuplicateStats(null);
      setTypeValidation([]);
      setPreview(null);
      setCleaningTick((t) => t + 1);
    }
    return { current, rows, columns };
  }, []);

  const loadCleaningContext = useCallback(async () => {
    try {
      ensureCleaning();
    } catch {
      // Nothing to prepare until a dataset and its rows are available.
    }
  }, [ensureCleaning]);

  const detect = useCallback(
    async <T,>(run: (ctx: { rows: Array<Record<string, string>>; columns: Array<{ name: string; dataType: string }> }) => T, apply: (result: T) => void, fallback: string) => {
      try {
        const { rows, columns } = ensureCleaning();
        await nextTick();
        apply(run({ rows, columns }));
      } catch (err) {
        if (datasetRef.current && recordsRef.current) {
          setCleaningError(err instanceof Error ? err.message : fallback);
        }
      }
    },
    [ensureCleaning]
  );

  const detectMissingValues = useCallback(
    () => detect((ctx) => cleaningEngine.detectMissingValues(ctx), setMissingStats, "Missing value detection failed"),
    [detect]
  );
  const detectDuplicates = useCallback(
    () => detect((ctx) => cleaningEngine.detectDuplicates(ctx), setDuplicateStats, "Duplicate detection failed"),
    [detect]
  );
  const validateTypes = useCallback(
    () => detect((ctx) => cleaningEngine.validateTypes(ctx), setTypeValidation, "Type validation failed"),
    [detect]
  );

  // Preview ------------------------------------------------------------
  const previewOperation = useCallback(
    async (op: CleaningParameters): Promise<CleaningPreview> => {
      setCleaningError(null);
      try {
        const { rows, columns } = ensureCleaning();
        setIsCleaning(true);
        await nextTick();
        const result = cleaningEngine.preview({ rows, columns }, op);
        setPreview(result);
        return result;
      } catch (err) {
        setCleaningError(err instanceof Error ? err.message : "Preview failed");
        throw err;
      } finally {
        setIsCleaning(false);
      }
    },
    [ensureCleaning]
  );

  /**
   * Publishes a new state of the rows: updates the dataset record (columns, statistics and quality report
   * always describe the rows that are really loaded), drops obsolete analysis results and saves to storage.
   */
  const publishRows = useCallback(
    async (
      base: DatasetRecord,
      rows: Array<Record<string, string>>,
      snapshot: CleaningSnapshot
    ): Promise<void> => {
      const now = new Date().toISOString();
      let next: DatasetRecord = {
        ...base,
        columns: snapshot.columns,
        columnCount: snapshot.columns.length,
        recordCount: rows.length,
        profile: snapshot.profile,
        qualityReport: snapshot.qualityReport,
        lastProcessedAt: now,
        cleaningRevision: cleaningEngine.getAppliedCount(),
      };
      analysisCache.invalidateDataset(base.id);
      commitDataset(next);
      commitRecords(rows);
      setPreview(null);
      setCleaningTick((t) => t + 1);

      try {
        await datasetRepository.save({
          id: next.id,
          version: STORAGE_VERSION,
          dataset: { ...next, storageStatus: "saved", storageError: undefined },
          records: rows,
          savedAt: now,
        });
        if (next.storageStatus !== "saved") {
          next = { ...next, storageStatus: "saved", storageError: undefined };
          if (datasetRef.current?.id === next.id) commitDataset(next);
        }
      } catch (err) {
        const message = describeStorageError(err);
        next = { ...next, storageStatus: "failed", storageError: message };
        if (datasetRef.current?.id === next.id) commitDataset(next);
        addToast({
          title: "Changes not saved",
          description: `${message} The cleaned data is available in this tab but will be lost when you close it.`,
          variant: "destructive",
          duration: 8000,
        });
      }
    },
    [commitDataset, commitRecords]
  );

  const profileRows = useCallback(
    async (
      current: DatasetRecord,
      rows: Array<Record<string, string>>,
      headers: string[]
    ): Promise<CleaningSnapshot> => {
      const profile = await profileDatasetAsync(
        {
          headers,
          rows,
          rowCount: rows.length,
          columnCount: headers.length,
          parsingErrors: current.parsingErrors,
          parsingWarnings: current.parsingWarnings,
          truncated: current.truncated,
        },
        current.id
      );
      return { columns: profile.columnMetadata, profile, qualityReport: generateQualityReport(profile) };
    },
    []
  );

  const applyOperation = useCallback(
    async (op: CleaningParameters): Promise<boolean> => {
      if (cleaningBusyRef.current) return false;
      cleaningBusyRef.current = true;
      setIsCleaning(true);
      setCleaningError(null);
      try {
        const { current, rows, columns } = ensureCleaning();
        const preview = cleaningEngine.preview({ rows, columns }, op);
        const nextColumns = cleaningEngine.columnsAfter(columns, preview);
        const snapshot = await profileRows(current, preview.previewRows, nextColumns.map((c) => c.name));
        if (datasetRef.current?.id !== current.id || recordsRef.current !== rows) {
          throw new Error("The dataset changed while the operation was running. Nothing was applied.");
        }
        const record = cleaningEngine.commitPreview(
          { type: op.type, targetColumns: preview.targetColumns ?? op.targetColumns, parameters: preview.parameters ?? op.parameters },
          preview.previewRows,
          nextColumns,
          preview.affectedRowCount,
          preview.affectedCellCount
        );
        const versionId = cleaningEngine.getCurrentVersionId();
        if (versionId) snapshotsRef.current.set(versionId, snapshot);
        setMissingStats([]);
        setDuplicateStats(null);
        setTypeValidation([]);
        await publishRows(current, preview.previewRows, snapshot);
        addToast({
          title: "Cleaning applied",
          description: `${record.title} — ${preview.affectedRowCount.toLocaleString()} row(s) affected`,
          variant: "success",
          duration: 4000,
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Cleaning failed";
        setCleaningError(message);
        addToast({ title: "Cleaning failed", description: message, variant: "destructive", duration: 5000 });
        return false;
      } finally {
        cleaningBusyRef.current = false;
        setIsCleaning(false);
      }
    },
    [ensureCleaning, profileRows, publishRows]
  );

  /** Moves to the engine's current version (after undo / redo / reset) and publishes its rows. */
  const showCurrentVersion = useCallback(async (): Promise<void> => {
    const current = datasetRef.current;
    if (!current) return;
    const rows = cleaningEngine.getCurrentRows();
    const versionId = cleaningEngine.getCurrentVersionId();
    let snapshot = versionId ? snapshotsRef.current.get(versionId) : undefined;
    if (!snapshot) {
      const headers = rows.length > 0 ? Object.keys(rows[0]) : current.columns.map((c) => c.name);
      snapshot = await profileRows(current, rows, headers);
      if (versionId) snapshotsRef.current.set(versionId, snapshot);
    }
    setMissingStats([]);
    setDuplicateStats(null);
    setTypeValidation([]);
    await publishRows(current, rows, snapshot);
  }, [profileRows, publishRows]);

  const runHistoryMove = useCallback(
    async (move: () => { record: { title: string } } | null, empty: string, done: string): Promise<boolean> => {
      if (cleaningBusyRef.current) return false;
      cleaningBusyRef.current = true;
      setIsCleaning(true);
      setCleaningError(null);
      try {
        ensureCleaning();
        const result = move();
        if (!result) {
          setCleaningError(empty);
          return false;
        }
        await showCurrentVersion();
        addToast({ title: done, description: result.record.title, variant: "info", duration: 3000 });
        return true;
      } catch (err) {
        setCleaningError(err instanceof Error ? err.message : "Could not change the cleaning history");
        return false;
      } finally {
        cleaningBusyRef.current = false;
        setIsCleaning(false);
        setCleaningTick((t) => t + 1);
      }
    },
    [ensureCleaning, showCurrentVersion]
  );

  const undo = useCallback(() => runHistoryMove(() => cleaningEngine.undo(), "Nothing to undo", "Undone"), [runHistoryMove]);
  const redo = useCallback(() => runHistoryMove(() => cleaningEngine.redo(), "Nothing to redo", "Redone"), [runHistoryMove]);

  const resetToOriginal = useCallback(
    () =>
      runHistoryMove(
        () => (cleaningEngine.canUndo() ? (cleaningEngine.reset() ? { record: { title: "All cleaning steps undone" } } : null) : null),
        "There are no cleaning steps to undo",
        "Reset"
      ),
    [runHistoryMove]
  );

  const clearCleaning = useCallback(async () => {
    resetCleaningState();
  }, [resetCleaningState]);

  const executeTypeValidation = useCallback((op: CleaningParameters) => applyOperation(op), [applyOperation]);

  const commitPreview = useCallback(
    (preview: CleaningPreview) =>
      applyOperation({
        type: preview.type,
        targetColumns: preview.targetColumns ?? [],
        parameters: preview.parameters ?? {},
      }),
    [applyOperation]
  );

  const value = useMemo<DatasetContextValue>(
    () => ({
      dataset,
      records,
      status,
      progress,
      parsingResult,
      isProcessing,
      isLoading,
      isRecordsLoading,
      error,
      processFile,
      cancelProcessing,
      clearDataset,
      loadRecords,
      clearError,
      cleaning: {
        datasetId: dataset?.id ?? null,
        versionId: cleaningEngine.getCurrentVersionId(),
        history: cleaningEngine.getHistory(),
        versions: cleaningEngine.getVersions(),
        isCleaning,
        error: cleaningError,
        missingStats,
        duplicateStats,
        typeValidation,
        preview,
        loadCleaningContext,
        detectMissingValues,
        detectDuplicates,
        validateTypes,
        previewMissingCleaning: previewOperation,
        executeMissingCleaning: applyOperation,
        previewDuplicateRemoval: previewOperation,
        executeDuplicateRemoval: applyOperation,
        previewStringCleaning: previewOperation,
        executeStringCleaning: applyOperation,
        previewTypeValidation: previewOperation,
        executeTypeValidation,
        commitPreview,
        undo,
        redo,
        canUndo: cleaningDatasetRef.current === dataset?.id && cleaningEngine.canUndo(),
        canRedo: cleaningDatasetRef.current === dataset?.id && cleaningEngine.canRedo(),
        resetToOriginal,
        clearCleaning,
      },
    }),
    // `cleaningTick` stands for the state of the cleaning engine, which lives outside React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dataset,
      records,
      status,
      progress,
      parsingResult,
      isProcessing,
      isLoading,
      isRecordsLoading,
      error,
      processFile,
      cancelProcessing,
      clearDataset,
      loadRecords,
      clearError,
      cleaningError,
      missingStats,
      duplicateStats,
      typeValidation,
      isCleaning,
      preview,
      cleaningTick,
      loadCleaningContext,
      detectMissingValues,
      detectDuplicates,
      validateTypes,
      previewOperation,
      applyOperation,
      executeTypeValidation,
      commitPreview,
      undo,
      redo,
      resetToOriginal,
      clearCleaning,
    ]
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}
