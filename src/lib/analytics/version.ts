import type { DatasetRecord } from "@/types/dataset.types";

/**
 * Version of a dataset's content. Every processed upload gets a new id and timestamp, and every cleaning step
 * (apply, undo, redo) renews the timestamp and the revision, so any change of the underlying rows produces a
 * different version and invalidates cached analysis results.
 */
export function getDatasetVersion(
  dataset: Pick<DatasetRecord, "lastProcessedAt" | "createdAt" | "recordCount" | "columnCount"> & { cleaningRevision?: number }
): string {
  return `${dataset.lastProcessedAt ?? dataset.createdAt}:${dataset.recordCount}x${dataset.columnCount}:r${dataset.cleaningRevision ?? 0}`;
}
