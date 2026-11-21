import type { CleaningPreview, CleaningCellChange, CleaningRemovedRow } from "@/types/dataset.types";

export type Row = Record<string, string>;

/** How many changed cells / removed rows a preview lists as evidence. */
export const CHANGE_SAMPLE_LIMIT = 20;
export const REMOVED_SAMPLE_LIMIT = 10;
export const ROW_SAMPLE_LIMIT = 5;

let previewCounter = 0;
export function nextOperationId(): string {
  previewCounter += 1;
  return `prev-${Date.now()}-${previewCounter}`;
}

/** Collects the evidence shown to the user: changed cells and the rows they belong to. */
export class ChangeCollector {
  readonly changes: CleaningCellChange[] = [];
  readonly beforeSample: Row[] = [];
  readonly afterSample: Row[] = [];
  private readonly sampledRows = new Set<number>();
  affectedCellCount = 0;
  private readonly changedRows = new Set<number>();

  record(rowIndex: number, column: string, before: string, after: string, original: Row, updated: Row): void {
    this.affectedCellCount++;
    this.changedRows.add(rowIndex);
    if (this.changes.length < CHANGE_SAMPLE_LIMIT) {
      this.changes.push({ rowNumber: rowIndex + 1, column, before, after });
    }
    if (this.beforeSample.length < ROW_SAMPLE_LIMIT && !this.sampledRows.has(rowIndex)) {
      this.sampledRows.add(rowIndex);
      this.beforeSample.push(original);
      this.afterSample.push(updated);
    }
  }

  get affectedRowCount(): number {
    return this.changedRows.size;
  }
}

export interface PreviewParts {
  type: CleaningPreview["type"];
  originalRowCount: number;
  previewRows: Row[];
  collector?: ChangeCollector;
  affectedRowCount?: number;
  affectedCellCount?: number;
  removedRows?: CleaningRemovedRow[];
  removedColumns?: string[];
  warnings?: string[];
  targetColumns: string[];
  parameters: Record<string, unknown>;
  beforeSample?: Row[];
  afterSample?: Row[];
}

export function assemblePreview(parts: PreviewParts): CleaningPreview {
  const collector = parts.collector;
  return {
    operationId: nextOperationId(),
    type: parts.type,
    originalRowCount: parts.originalRowCount,
    previewRowCount: parts.previewRows.length,
    affectedRowCount: parts.affectedRowCount ?? collector?.affectedRowCount ?? 0,
    affectedCellCount: parts.affectedCellCount ?? collector?.affectedCellCount ?? 0,
    previewRows: parts.previewRows,
    beforeSample: parts.beforeSample ?? collector?.beforeSample ?? [],
    afterSample: parts.afterSample ?? collector?.afterSample ?? [],
    warnings: parts.warnings ?? [],
    changes: collector?.changes ?? [],
    removedRows: parts.removedRows ?? [],
    removedColumns: parts.removedColumns ?? [],
    targetColumns: parts.targetColumns,
    parameters: parts.parameters,
  };
}
