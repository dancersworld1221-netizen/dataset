import type {
  CleaningOperationRecord,
  CleaningOperationType,
  CleaningPreview,
  DatasetCleaningVersion,
} from "@/types/dataset.types";
import { detectMissingValues, previewMissingCleaning } from "./missing";
import { detectDuplicates, previewDuplicateRemoval } from "./duplicates";
import { previewStringCleaning, STRING_OPERATIONS } from "./strings";
import { validateColumnTypes, previewTypeValidation } from "./types";

export interface EngineContext {
  rows: Array<Record<string, string>>;
  columns: Array<{ name: string; dataType: string }>;
}

export interface EngineOperation {
  type: CleaningOperationType;
  targetColumns: string[];
  parameters: Record<string, unknown>;
}

type Rows = Array<Record<string, string>>;

/** Every operation type the engine can preview and apply. */
export type OperationFamily = "missing" | "duplicates" | "strings" | "types";

export function operationFamily(type: CleaningOperationType): OperationFamily {
  if (type === "remove_duplicates") return "duplicates";
  if (STRING_OPERATIONS.includes(type)) return "strings";
  if (type === "validate_type") return "types";
  return "missing";
}

/**
 * Keeps the cleaning history of ONE dataset: every applied operation creates a new version of the rows,
 * and undo / redo only move a pointer between those versions. Unchanged row objects are shared between
 * versions, so a version costs little more than an array of references.
 */
export class CleaningEngine {
  private versions: DatasetCleaningVersion[] = [];
  private history: CleaningOperationRecord[] = [];
  private currentVersionId: string | null = null;
  private pointer = -1;
  private datasetId = "dataset";

  private generateId(): string {
    return `cln-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private currentVersion(): DatasetCleaningVersion | null {
    if (this.currentVersionId === null) return null;
    return this.versions.find((v) => v.id === this.currentVersionId) ?? null;
  }

  private currentRows(): Rows {
    const v = this.currentVersion();
    return v ? v.records : [];
  }

  initialize(ctx: EngineContext, label = "Original dataset", datasetId = "dataset"): DatasetCleaningVersion {
    const id = this.generateId();
    const version: DatasetCleaningVersion = {
      id,
      datasetId,
      records: ctx.rows,
      rowCount: ctx.rows.length,
      columnCount: ctx.columns.length,
      createdAt: new Date().toISOString(),
      label,
    };
    this.datasetId = datasetId;
    this.versions = [version];
    this.currentVersionId = id;
    this.history = [];
    this.pointer = -1;
    return version;
  }

  /** Copies, so React notices a change even though a record's status is updated in place by undo / redo. */
  getHistory(): CleaningOperationRecord[] {
    return this.history.map((record) => ({ ...record }));
  }

  getVersions(): DatasetCleaningVersion[] {
    return [...this.versions];
  }

  getCurrentVersionId(): string | null {
    return this.currentVersionId;
  }

  getOriginalVersionId(): string | null {
    return this.versions[0]?.id ?? null;
  }

  getCurrentRows(): Rows {
    return this.currentRows();
  }

  getDatasetId(): string {
    return this.datasetId;
  }

  /** Number of applied (not undone) operations. */
  getAppliedCount(): number {
    return this.pointer + 1;
  }

  canUndo(): boolean {
    return this.pointer >= 0;
  }

  canRedo(): boolean {
    return this.pointer < this.history.length - 1;
  }

  detectMissingValues(ctx: EngineContext) {
    return detectMissingValues(ctx.rows, ctx.columns);
  }

  detectDuplicates(ctx: EngineContext, keys?: string[]) {
    const effectiveKeys = keys && keys.length > 0 ? keys : ctx.columns.map((c) => c.name);
    return detectDuplicates(ctx.rows, effectiveKeys);
  }

  validateTypes(ctx: EngineContext) {
    return validateColumnTypes(ctx.rows, ctx.columns);
  }

  /** Previews any operation; throws a readable Error when the operation is invalid. */
  preview(ctx: EngineContext, op: EngineOperation): CleaningPreview {
    switch (operationFamily(op.type)) {
      case "duplicates":
        return this.previewDuplicateRemoval(ctx, op);
      case "strings":
        return this.previewStringCleaning(ctx, op);
      case "types":
        return this.previewTypeValidation(ctx, op);
      default:
        return this.previewMissingCleaning(ctx, op);
    }
  }

  previewMissingCleaning(ctx: EngineContext, op: EngineOperation) {
    return previewMissingCleaning(ctx.rows, ctx.columns, op);
  }

  previewDuplicateRemoval(ctx: EngineContext, op: EngineOperation) {
    const keys = op.targetColumns && op.targetColumns.length > 0
      ? op.targetColumns
      : ctx.columns.map((c) => c.name);
    return previewDuplicateRemoval(ctx.rows, keys, op);
  }

  previewStringCleaning(ctx: EngineContext, op: EngineOperation) {
    return previewStringCleaning(ctx.rows, ctx.columns, op);
  }

  previewTypeValidation(ctx: EngineContext, op: EngineOperation) {
    return previewTypeValidation(ctx.rows, ctx.columns, op);
  }

  // The execute* methods return only what is needed to commit; they are thin wrappers over the previews,
  // so what the user saw in the preview is exactly what is applied.
  executeMissingCleaning(ctx: EngineContext, op: EngineOperation) {
    return this.summarize(this.previewMissingCleaning(ctx, op));
  }

  executeDuplicateRemoval(ctx: EngineContext, op: EngineOperation) {
    return this.summarize(this.previewDuplicateRemoval(ctx, op));
  }

  executeStringCleaning(ctx: EngineContext, op: EngineOperation) {
    return this.summarize(this.previewStringCleaning(ctx, op));
  }

  executeTypeValidation(ctx: EngineContext, op: EngineOperation) {
    return this.summarize(this.previewTypeValidation(ctx, op));
  }

  private summarize(preview: CleaningPreview) {
    return {
      previewRows: preview.previewRows,
      affectedRowCount: preview.affectedRowCount,
      affectedCellCount: preview.affectedCellCount,
    };
  }

  /** The columns that remain after `preview` is applied. */
  columnsAfter(columns: EngineContext["columns"], preview: CleaningPreview): EngineContext["columns"] {
    const removed = new Set(preview.removedColumns ?? []);
    return removed.size === 0 ? columns : columns.filter((c) => !removed.has(c.name));
  }

  commitPreview(
    op: EngineOperation,
    previewRows: Rows,
    columns: Array<{ name: string; dataType: string }>,
    affectedRowCount: number,
    affectedCellCount: number
  ): CleaningOperationRecord {
    const id = this.generateId();
    const versionId = this.generateId();
    const record: CleaningOperationRecord = {
      id,
      datasetId: this.datasetId,
      type: op.type,
      title: this.titleFor(op.type),
      description: this.descriptionFor(op),
      targetColumns: op.targetColumns,
      parameters: op.parameters,
      affectedRowCount,
      affectedCellCount,
      status: "applied",
      createdAt: new Date().toISOString(),
    };

    const version: DatasetCleaningVersion = {
      id: versionId,
      datasetId: this.datasetId,
      parentVersionId: this.currentVersionId ?? undefined,
      operationId: id,
      records: previewRows,
      rowCount: previewRows.length,
      columnCount: columns.length,
      createdAt: new Date().toISOString(),
      label: record.title,
    };

    // Committing after an undo starts a new branch: the undone steps can never be redone, so their versions
    // (each holds a full copy of the row references) are released instead of leaking.
    if (this.pointer < this.history.length - 1) {
      const dropped = new Set(this.history.slice(this.pointer + 1).map((r) => r.id));
      this.history = this.history.slice(0, this.pointer + 1);
      this.versions = this.versions.filter((v) => !v.operationId || !dropped.has(v.operationId));
    }

    this.history.push(record);
    this.pointer = this.history.length - 1;
    this.versions.push(version);
    this.currentVersionId = versionId;

    return record;
  }

  /** Previews and commits in one step; returns the preview that was applied together with its record. */
  apply(ctx: EngineContext, op: EngineOperation): {
    preview: CleaningPreview;
    record: CleaningOperationRecord;
    columns: EngineContext["columns"];
  } {
    const preview = this.preview(ctx, op);
    const columns = this.columnsAfter(ctx.columns, preview);
    const record = this.commitPreview(
      { type: op.type, targetColumns: preview.targetColumns ?? op.targetColumns, parameters: preview.parameters ?? op.parameters },
      preview.previewRows,
      columns,
      preview.affectedRowCount,
      preview.affectedCellCount
    );
    return { preview, record, columns };
  }

  undo(): { record: CleaningOperationRecord; version: DatasetCleaningVersion } | null {
    if (!this.canUndo()) return null;
    const record = this.history[this.pointer];
    record.status = "undone";
    record.revertedAt = new Date().toISOString();
    this.pointer--;

    const version = this.versions.find((v) => v.id === this.currentVersionId);
    if (version && version.parentVersionId) {
      this.currentVersionId = version.parentVersionId;
    } else {
      this.currentVersionId = this.versions[0]?.id ?? null;
    }

    const current = this.currentVersion();
    return { record, version: current! };
  }

  redo(): { record: CleaningOperationRecord; version: DatasetCleaningVersion } | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    const record = this.history[this.pointer];
    record.status = "redone";
    record.revertedAt = undefined;

    const version = this.versions.find((v) => v.operationId === record.id);
    if (version) {
      this.currentVersionId = version.id;
    }

    const current = this.currentVersion();
    return { record, version: current! };
  }

  /** Back to the originally uploaded rows; the history is dropped. */
  reset(): DatasetCleaningVersion | null {
    const original = this.versions[0];
    if (!original) return null;
    this.versions = [original];
    this.history = [];
    this.pointer = -1;
    this.currentVersionId = original.id;
    return original;
  }

  private titleFor(type: CleaningOperationType): string {
    const titles: Record<CleaningOperationType, string> = {
      remove_rows_missing: "Remove rows with missing values",
      remove_column: "Remove column",
      impute_mean: "Mean imputation",
      impute_median: "Median imputation",
      impute_mode: "Mode imputation",
      impute_constant: "Constant value imputation",
      remove_duplicates: "Remove duplicate rows",
      trim_whitespace: "Trim whitespace",
      normalize_whitespace: "Normalize whitespace",
      lowercase: "Convert to lowercase",
      uppercase: "Convert to uppercase",
      validate_type: "Clear invalid values",
    };
    return titles[type];
  }

  private descriptionFor(op: EngineOperation): string {
    const cols = op.targetColumns.join(", ") || "all columns";
    return `${op.type} on ${cols}`;
  }
}

export const cleaningEngine = new CleaningEngine();
