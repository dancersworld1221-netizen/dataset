import type {
  CleaningOperationType,
  CleaningPreview,
} from "@/types/dataset.types";
import {
  analyzeColumnType,
  detectDateOrder,
  isMissingValue,
  parseDateValue,
  parseNumber,
} from "@/lib/profiling/typeInference";
import { ChangeCollector, assemblePreview, type Row } from "./shared";

export interface ColumnTypeValidation {
  column: string;
  currentType: string;
  suggestedType: string;
  /** Non-missing cells that fit the column's type. */
  validCount: number;
  /** Non-missing cells that do NOT fit the column's type (every cell, not only distinct values). */
  invalidCount: number;
  /** Up to five distinct invalid values. */
  invalidExamples: string[];
  /** True when the column has invalid cells or its type would be inferred differently today. */
  needsChange: boolean;
}

type CellCheck = (value: string) => boolean;

/** Returns a function that tells whether a cell fits `dataType`, or null when every cell fits (text, boolean, empty). */
function cellCheckFor(dataType: string, values: string[]): CellCheck | null {
  if (dataType === "integer" || dataType === "decimal") {
    return (v) => parseNumber(v) !== null;
  }
  if (dataType === "date" || dataType === "datetime") {
    const order = detectDateOrder(values.filter((v) => !isMissingValue(v)));
    return (v) => parseDateValue(v, order) !== null;
  }
  return null;
}

export function findInvalidCells(
  rows: Array<Record<string, string>>,
  column: string,
  dataType: string
): number[] {
  const values = rows.map((r) => r[column] ?? "");
  const check = cellCheckFor(dataType, values);
  if (!check) return [];
  const indices: number[] = [];
  values.forEach((v, i) => {
    if (!isMissingValue(v) && !check(v.trim())) indices.push(i);
  });
  return indices;
}

export function validateColumnTypes(
  rows: Array<Record<string, string>>,
  columns: Array<{ name: string; dataType: string }>
): ColumnTypeValidation[] {
  return columns.map((col) => {
    const values = rows.map((r) => r[col.name] ?? "");
    const analysis = analyzeColumnType(values);
    const invalidIndices = findInvalidCells(rows, col.name, col.dataType);
    const examples: string[] = [];
    const seen = new Set<string>();
    for (const i of invalidIndices) {
      const v = values[i];
      if (seen.has(v)) continue;
      seen.add(v);
      examples.push(v);
      if (examples.length >= 5) break;
    }
    const nonMissing = analysis.nonMissingCount;
    return {
      column: col.name,
      currentType: col.dataType,
      suggestedType: analysis.dataType,
      validCount: nonMissing - invalidIndices.length,
      invalidCount: invalidIndices.length,
      invalidExamples: examples,
      needsChange:
        invalidIndices.length > 0 || (col.dataType !== "empty" && analysis.dataType !== col.dataType),
    };
  });
}

/**
 * "Clear invalid values": every cell that does not fit its column's type (for example the text "abc" in a
 * numeric column) is emptied, so it counts as missing and can then be imputed or its rows removed.
 */
export function previewTypeValidation(
  rows: Array<Record<string, string>>,
  columns: Array<{ name: string; dataType: string }>,
  op: {
    type: CleaningOperationType;
    targetColumns: string[];
    parameters: Record<string, unknown>;
  }
): CleaningPreview {
  const targetSet = new Set(op.targetColumns);
  const targets = columns.filter((c) => targetSet.size === 0 || targetSet.has(c.name));
  const warnings: string[] = [];

  const invalidByColumn = new Map<string, Set<number>>();
  for (const col of targets) {
    const indices = findInvalidCells(rows, col.name, col.dataType);
    if (indices.length > 0) invalidByColumn.set(col.name, new Set(indices));
  }
  if (invalidByColumn.size === 0) warnings.push("No invalid values were found in the selected columns.");

  const collector = new ChangeCollector();
  const previewRows = rows.map((row, rowIndex) => {
    let next: Row | null = null;
    for (const [name, indices] of invalidByColumn) {
      if (!indices.has(rowIndex)) continue;
      next = next ?? { ...row };
      next[name] = "";
    }
    if (!next) return row;
    for (const [name, indices] of invalidByColumn) {
      if (indices.has(rowIndex)) collector.record(rowIndex, name, row[name] ?? "", "", row, next);
    }
    return next;
  });

  return assemblePreview({
    type: op.type,
    originalRowCount: rows.length,
    previewRows,
    collector,
    warnings,
    targetColumns: op.targetColumns,
    parameters: op.parameters,
  });
}
