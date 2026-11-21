import type {
  CleaningOperationType,
  CleaningPreview,
} from "@/types/dataset.types";
import { ChangeCollector, assemblePreview, type Row } from "./shared";

export const STRING_OPERATIONS: CleaningOperationType[] = [
  "trim_whitespace",
  "normalize_whitespace",
  "lowercase",
  "uppercase",
];

export function transformString(type: CleaningOperationType, value: string): string {
  switch (type) {
    case "trim_whitespace":
      return value.trim();
    case "normalize_whitespace":
      return value.replace(/\s+/g, " ").trim();
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    default:
      return value;
  }
}

export function previewStringCleaning(
  rows: Array<Record<string, string>>,
  columns: Array<{ name: string }>,
  op: {
    type: CleaningOperationType;
    targetColumns: string[];
    parameters: Record<string, unknown>;
  }
): CleaningPreview {
  const warnings: string[] = [];
  const known = new Set(columns.map((c) => c.name));
  const targets = op.targetColumns.filter((name) => known.has(name));
  if (!STRING_OPERATIONS.includes(op.type)) warnings.push(`${op.type} is not a text operation.`);
  if (targets.length === 0) warnings.push("No column selected.");

  const collector = new ChangeCollector();
  const previewRows = rows.map((row, rowIndex) => {
    let next: Row | null = null;
    for (const name of targets) {
      const original = row[name] ?? "";
      const value = transformString(op.type, original);
      if (value === original) continue;
      next = next ?? { ...row };
      next[name] = value;
    }
    if (!next) return row;
    for (const name of targets) {
      const before = row[name] ?? "";
      if (before !== next[name]) collector.record(rowIndex, name, before, next[name], row, next);
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
