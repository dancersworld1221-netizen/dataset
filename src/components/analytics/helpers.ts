import { formatNumber } from "@/lib/format";
import type { OutlierMethod } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";

export { formatNumber };

/** Number for display; null (an undefined statistic) is shown as "n/a", never as 0. */
export const fmt = (n: number | null | undefined, maxFractionDigits?: number): string =>
  n === null || n === undefined || Number.isNaN(n) ? "n/a" : formatNumber(n, maxFractionDigits);

export const isNumericColumn = (c: ColumnMetadata): boolean => c.dataType === "integer" || c.dataType === "decimal";
export const isCategoricalColumn = (c: ColumnMetadata): boolean => c.dataType === "string" || c.dataType === "boolean";
export const isDateColumn = (c: ColumnMetadata): boolean => c.dataType === "date" || c.dataType === "datetime";

/** Query string that makes the Data Preview show only the rows flagged with these settings. */
export function outlierPreviewLink(
  column: string,
  method: OutlierMethod,
  p: { multiplier: number; zThreshold: number; modifiedThreshold: number; ignoreZeros: boolean }
): string {
  const q = new URLSearchParams({ outlier: column, method });
  if (method === "iqr") q.set("k", String(p.multiplier));
  if (method === "zscore") q.set("t", String(p.zThreshold));
  if (method === "modified-zscore") q.set("t", String(p.modifiedThreshold));
  if (p.ignoreZeros) q.set("nz", "1");
  return `/preview?${q.toString()}`;
}
