import type {
  CleaningOperationType,
  CleaningPreview,
  MissingValuePolicy,
} from "@/types/dataset.types";
import { ChangeCollector, REMOVED_SAMPLE_LIMIT, assemblePreview, type Row } from "./shared";
import { DEFAULT_MISSING_VALUE_POLICY } from "@/types/dataset.types";
import {
  isMissingValue,
  parseNumber,
} from "@/lib/profiling/typeInference";

export interface MissingColumnReport {
  column: string;
  dataType: string;
  totalRows: number;
  missingCount: number;
  missingPercentage: number;
  nonMissingCount: number;
  recommendedMethod: CleaningOperationType | null;
}

export function isNumericColumn(dataType: string): boolean {
  return dataType === "integer" || dataType === "decimal";
}

export function recommendMethod(
  dataType: string,
  missingPercentage: number
): CleaningOperationType | null {
  if (missingPercentage >= 50) return null;
  if (isNumericColumn(dataType)) return "impute_median";
  return "impute_mode";
}

export function detectMissingValues(
  rows: Array<Record<string, string>>,
  columns: Array<{ name: string; dataType: string }>,
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): MissingColumnReport[] {
  return columns.map((col) => {
    const values = rows.map((r) => r[col.name] ?? "");
    let missingCount = 0;
    for (const v of values) {
      if (isMissingValue(v, policy)) missingCount++;
    }
    const totalRows = rows.length;
    const missingPercentage =
      totalRows > 0 ? (missingCount / totalRows) * 100 : 0;
    return {
      column: col.name,
      dataType: col.dataType,
      totalRows,
      missingCount,
      missingPercentage,
      nonMissingCount: totalRows - missingCount,
      recommendedMethod: recommendMethod(col.dataType, missingPercentage),
    };
  });
}

type ImputeFn = () => string | null;

/** Formats an imputed number without floating-point noise (3.3333333333333335 -> 3.33333333333). */
function formatImputed(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function meanOf(values: string[]): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (isMissingValue(v)) continue;
    const n = parseNumber(v);
    if (n) {
      sum += n.value;
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

function medianOf(values: string[]): number | null {
  const nums: number[] = [];
  for (const v of values) {
    if (isMissingValue(v)) continue;
    const n = parseNumber(v);
    if (n) nums.push(n.value);
  }
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0
    ? (nums[mid - 1] + nums[mid]) / 2
    : nums[mid];
}

function modeOf(values: string[]): string | null {
  const freq = new Map<string, number>();
  for (const v of values) {
    if (isMissingValue(v)) continue;
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of freq) {
    if (c > bestCount || (c === bestCount && best !== null && v < best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function imputeColumn(
  values: string[],
  method: CleaningOperationType,
  constant?: string
): { replaced: number; result: string[] } {
  const imputeFn: ImputeFn | null = (() => {
    switch (method) {
      case "impute_mean": {
        const m = meanOf(values);
        return m !== null ? () => formatImputed(m) : null;
      }
      case "impute_median": {
        const m = medianOf(values);
        return m !== null ? () => formatImputed(m) : null;
      }
      case "impute_mode": {
        const m = modeOf(values);
        return m !== null ? () => m : null;
      }
      case "impute_constant": {
        return constant !== undefined && constant.trim() !== "" ? () => constant : null;
      }
      default:
        return null;
    }
  })();

  if (!imputeFn) return { replaced: 0, result: values };

  let replaced = 0;
  const result = values.map((v) => {
    if (isMissingValue(v)) {
      replaced++;
      return imputeFn()!;
    }
    return v;
  });
  return { replaced, result };
}

export interface MissingOperation {
  type: CleaningOperationType;
  targetColumns: string[];
  parameters: Record<string, unknown>;
}

const IMPUTE_TYPES: CleaningOperationType[] = [
  "impute_mean",
  "impute_median",
  "impute_mode",
  "impute_constant",
];

/** Previews every operation of the "missing values" family: imputation, row removal and column removal. */
export function previewMissingCleaning(
  rows: Array<Record<string, string>>,
  columns: Array<{ name: string; dataType: string }>,
  op: MissingOperation
): CleaningPreview {
  if (op.type === "remove_rows_missing") return previewRowRemoval(rows, columns, op);
  if (op.type === "remove_column") return previewColumnRemoval(rows, columns, op);
  return previewImputation(rows, columns, op);
}

function previewImputation(
  rows: Row[],
  columns: Array<{ name: string; dataType: string }>,
  op: MissingOperation
): CleaningPreview {
  const targetSet = new Set(op.targetColumns);
  const warnings: string[] = [];
  const constant = typeof op.parameters.constant === "string" ? op.parameters.constant : undefined;

  if (!IMPUTE_TYPES.includes(op.type)) warnings.push(`${op.type} is not a missing-value operation.`);
  if (targetSet.size === 0) warnings.push("No column selected.");
  if (op.type === "impute_constant" && (constant === undefined || constant.trim() === "")) {
    warnings.push("Enter a constant value to fill the missing cells with.");
  }

  const columnResults = new Map<string, string[]>();
  for (const col of columns) {
    if (!targetSet.has(col.name)) continue;
    if ((op.type === "impute_mean" || op.type === "impute_median") && !isNumericColumn(col.dataType)) {
      warnings.push(`${col.name} is not numeric; ${op.type} not applicable.`);
      continue;
    }
    const values = rows.map((r) => r[col.name] ?? "");
    const { result, replaced } = imputeColumn(values, op.type, constant);
    if (replaced === 0 && values.some((v) => isMissingValue(v))) {
      warnings.push(`${col.name}: there is no value to fill the missing cells with.`);
    }
    if (op.type === "impute_mean" && col.dataType === "integer" && replaced > 0) {
      warnings.push(`${col.name} is an integer column; mean imputation can introduce decimal values.`);
    }
    if (op.type === "impute_constant" && isNumericColumn(col.dataType) && constant !== undefined && constant.trim() !== "" && !parseNumber(constant)) {
      warnings.push(`"${constant}" is not a number, so ${col.name} would contain invalid values.`);
    }
    columnResults.set(col.name, result);
  }

  const collector = new ChangeCollector();
  const previewRows = rows.map((row, rowIndex) => {
    let next: Row | null = null;
    for (const [name, result] of columnResults) {
      const before = row[name] ?? "";
      const after = result[rowIndex];
      if (before === after) continue;
      next = next ?? { ...row };
      next[name] = after;
    }
    if (next) {
      const updated = next;
      for (const [name, result] of columnResults) {
        const before = row[name] ?? "";
        if (before !== result[rowIndex]) collector.record(rowIndex, name, before, result[rowIndex], row, updated);
      }
      return updated;
    }
    return row;
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

function previewRowRemoval(
  rows: Row[],
  columns: Array<{ name: string; dataType: string }>,
  op: MissingOperation
): CleaningPreview {
  const removal = removeRowsWithMissing(rows, columns, op);
  const removedRows = removal.removedIndices
    .slice(0, REMOVED_SAMPLE_LIMIT)
    .map((index) => ({ rowNumber: index + 1, row: rows[index] }));
  const warnings: string[] = [];
  if (removal.previewRows.length === 0 && rows.length > 0) warnings.push("This would remove every row.");
  return assemblePreview({
    type: op.type,
    originalRowCount: rows.length,
    previewRows: removal.previewRows,
    affectedRowCount: removal.removedRowCount,
    affectedCellCount: removal.removedRowCount,
    removedRows,
    beforeSample: removedRows.slice(0, 5).map((r) => r.row),
    afterSample: removal.previewRows.slice(0, 5),
    warnings,
    targetColumns: op.targetColumns,
    parameters: op.parameters,
  });
}

function previewColumnRemoval(
  rows: Row[],
  columns: Array<{ name: string; dataType: string }>,
  op: MissingOperation
): CleaningPreview {
  const known = new Set(columns.map((c) => c.name));
  const targets = [...new Set(op.targetColumns)];
  if (targets.length === 0) throw new Error("Select at least one column to remove.");
  const unknown = targets.filter((t) => !known.has(t));
  if (unknown.length > 0) throw new Error(`Unknown column: ${unknown.join(", ")}`);
  if (targets.length >= columns.length) throw new Error("At least one column must remain in the dataset.");

  const { previewRows } = removeColumn(rows, { targetColumns: targets });
  return assemblePreview({
    type: op.type,
    originalRowCount: rows.length,
    previewRows,
    affectedRowCount: rows.length,
    affectedCellCount: rows.length * targets.length,
    removedColumns: targets,
    beforeSample: rows.slice(0, 5),
    afterSample: previewRows.slice(0, 5),
    targetColumns: targets,
    parameters: op.parameters,
  });
}

export function removeRowsWithMissing(
  rows: Array<Record<string, string>>,
  columns: Array<{ name: string }>,
  op: {
    type: CleaningOperationType;
    targetColumns: string[];
    parameters: Record<string, unknown>;
  },
  policy: MissingValuePolicy = DEFAULT_MISSING_VALUE_POLICY
): {
  removedRowCount: number;
  removedIndices: number[];
  previewRows: Array<Record<string, string>>;
} {
  const targetSet = new Set(op.targetColumns);
  const checked = columns.filter((c) => !targetSet.size || targetSet.has(c.name));
  const kept: Row[] = [];
  const removedIndices: number[] = [];
  rows.forEach((row, i) => {
    const hasMissing = checked.some((c) => isMissingValue(row[c.name] ?? "", policy));
    if (hasMissing) removedIndices.push(i);
    else kept.push(row);
  });
  return {
    removedRowCount: removedIndices.length,
    removedIndices,
    previewRows: kept,
  };
}

export function removeColumn(
  rows: Array<Record<string, string>>,
  op: { targetColumns: string[] }
): {
  removedColumnCount: number;
  previewRows: Array<Record<string, string>>;
} {
  const targetSet = new Set(op.targetColumns);
  if (targetSet.size === 0) return { removedColumnCount: 0, previewRows: rows.map((row) => ({ ...row })) };
  const previewRows = rows.map((row) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!targetSet.has(k)) next[k] = v;
    }
    return next;
  });
  return { removedColumnCount: targetSet.size, previewRows };
}
