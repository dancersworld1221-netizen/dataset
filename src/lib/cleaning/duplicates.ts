import type {
  CleaningOperationType,
  CleaningPreview,
} from "@/types/dataset.types";
import { REMOVED_SAMPLE_LIMIT, assemblePreview, type Row } from "./shared";

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
  /** Only groups that really contain duplicates (two or more identical rows), largest first. */
  groups: DuplicateGroup[];
}

function fingerprint(row: Record<string, string>, keys: string[]): string {
  const values = new Array<string>(keys.length);
  for (let i = 0; i < keys.length; i++) {
    values[i] = row[keys[i]] ?? "";
  }
  return JSON.stringify(values);
}

/** One pass over the rows (O(n)): groups rows by the values of `keys`. */
export function detectDuplicates(
  rows: Array<Record<string, string>>,
  keys: string[]
): DuplicateStats {
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const fp = fingerprint(row, keys);
    const indices = groups.get(fp);
    if (indices) indices.push(i);
    else groups.set(fp, [i]);
  });

  const groupList: DuplicateGroup[] = [];
  let totalDuplicateRecords = 0;
  groups.forEach((indices, fp) => {
    if (indices.length < 2) return;
    totalDuplicateRecords += indices.length - 1;
    const first = rows[indices[0]];
    const keyValues: Record<string, string> = {};
    for (const k of keys) keyValues[k] = first[k] ?? "";
    groupList.push({ id: fp, keyValues, rowIndices: indices, rowCount: indices.length });
  });

  groupList.sort((a, b) => b.rowCount - a.rowCount || a.rowIndices[0] - b.rowIndices[0]);

  return {
    totalDuplicateRecords,
    uniqueRecords: groups.size,
    duplicatePercentage: rows.length > 0 ? (totalDuplicateRecords / rows.length) * 100 : 0,
    groups: groupList,
  };
}

export function previewDuplicateRemoval(
  rows: Array<Record<string, string>>,
  keys: string[],
  op: {
    type: CleaningOperationType;
    targetColumns: string[];
    parameters: Record<string, unknown>;
  }
): CleaningPreview {
  const effectiveKeys = op.targetColumns && op.targetColumns.length > 0 ? op.targetColumns : keys;
  const stats = detectDuplicates(rows, effectiveKeys);

  const keepLast = op.parameters.keepLast === true;
  const removeAllGroups = op.parameters.removeAllGroups === true;

  const removeIndices = new Set<number>();
  for (const group of stats.groups) {
    const indices = group.rowIndices;
    const toRemove = removeAllGroups ? indices : keepLast ? indices.slice(0, -1) : indices.slice(1);
    for (const idx of toRemove) removeIndices.add(idx);
  }

  const previewRows: Row[] = [];
  const removedRows: Array<{ rowNumber: number; row: Row }> = [];
  let removedRowCount = 0;
  rows.forEach((row, i) => {
    if (removeIndices.has(i)) {
      removedRowCount++;
      if (removedRows.length < REMOVED_SAMPLE_LIMIT) removedRows.push({ rowNumber: i + 1, row });
    } else {
      previewRows.push(row);
    }
  });

  const warnings: string[] = [];
  if (previewRows.length === 0 && rows.length > 0) warnings.push("This would remove every row.");
  if (removeAllGroups && removedRowCount > 0) {
    warnings.push("Every copy of a duplicated row is removed, including the first one.");
  }

  return assemblePreview({
    type: op.type,
    originalRowCount: rows.length,
    previewRows,
    affectedRowCount: removedRowCount,
    affectedCellCount: removedRowCount,
    removedRows,
    beforeSample: removedRows.slice(0, 5).map((r) => r.row),
    afterSample: previewRows.slice(0, 5),
    warnings,
    targetColumns: op.targetColumns,
    parameters: op.parameters,
  });
}
