import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useDataset } from "@hooks/useDataset";
import { DatasetTable } from "@components/datasets/DatasetTable";
import { DatasetSummary } from "@components/datasets/DatasetSummary";
import { DatasetEmptyState } from "@components/datasets/DatasetEmptyState";
import { PageHeader } from "@components/common/PageHeader";
import { LoadingState } from "@components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@components/ui/Card";
import { Button } from "@components/ui/Button";
import { buttonStyles } from "@components/ui/button-styles";
import { useAnalysis } from "@/hooks/useAnalysis";
import type { AnalysisRequest, OutlierMethod } from "@/lib/analytics/types";
import type { ColumnDataType } from "@/types/dataset.types";

const OUTLIER_METHODS: OutlierMethod[] = ["iqr", "zscore", "modified-zscore"];
const METHOD_LABEL: Record<OutlierMethod, string> = { iqr: "IQR", zscore: "Z-score", "modified-zscore": "Modified Z-score" };

const numberParam = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const HEADER_DESCRIPTION = "Explore your dataset structure and sample data";

export function Preview() {
  const navigate = useNavigate();
  const { dataset, records, isLoading, isRecordsLoading, error, clearDataset, loadRecords } =
    useDataset();

  const datasetId = dataset?.id;
  useEffect(() => {
    if (datasetId) void loadRecords();
  }, [datasetId, loadRecords]);

  // Optional filter: show only the rows flagged as outlier candidates (see the Outliers tab).
  const [searchParams] = useSearchParams();
  const outlierColumn = searchParams.get("outlier");
  const rawMethod = searchParams.get("method") as OutlierMethod | null;
  const outlierMethod: OutlierMethod = rawMethod && OUTLIER_METHODS.includes(rawMethod) ? rawMethod : "iqr";
  const outlierRequest = useMemo<Extract<AnalysisRequest, { kind: "outliers" }> | null>(() => {
    if (!outlierColumn) return null;
    return {
      kind: "outliers",
      column: outlierColumn,
      params: {
        method: outlierMethod,
        multiplier: outlierMethod === "iqr" ? numberParam(searchParams.get("k")) : undefined,
        threshold: outlierMethod !== "iqr" ? numberParam(searchParams.get("t")) : undefined,
        ignoreZeros: searchParams.get("nz") === "1",
      },
    };
  }, [outlierColumn, outlierMethod, searchParams]);
  const outlierState = useAnalysis(outlierRequest);
  const outlierResult = outlierState.status === "ready" ? outlierState.data : null;
  const filtered = useMemo(() => {
    if (!outlierResult || !records) return null;
    const rows = outlierResult.rowIndices.map((i) => records[i]);
    const numbers = new Map<Record<string, string>, number>();
    outlierResult.rowIndices.forEach((index, k) => numbers.set(rows[k], index + 1));
    return { rows, numbers };
  }, [outlierResult, records]);

  const columns = useMemo(() => dataset?.columns?.map((c) => c.name) ?? [], [dataset]);
  const columnTypes = useMemo(() => {
    const types: Record<string, ColumnDataType> = {};
    for (const c of dataset?.columns ?? []) types[c.name] = c.dataType;
    return types;
  }, [dataset]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Data Preview" description={HEADER_DESCRIPTION} />
        <LoadingState text="Loading dataset…" />
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="space-y-8">
        <PageHeader title="Data Preview" description={HEADER_DESCRIPTION} />
        {error ? (
          <DatasetEmptyState
            variant="error"
            message={error}
            onRetry={() => navigate("/upload")}
            onUpload={() => navigate("/upload")}
          />
        ) : (
          <DatasetEmptyState variant="no-dataset" onUpload={() => navigate("/upload")} />
        )}
      </div>
    );
  }

  const hasWarnings = dataset.status === "warning";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Data Preview"
        description={`Viewing ${dataset.filename} — ${dataset.recordCount.toLocaleString()} records × ${dataset.columnCount} columns`}
        badge={hasWarnings ? "Has warnings" : "Ready"}
        badgeVariant={hasWarnings ? "warning" : "success"}
      />

      {dataset.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-sm text-foreground">
            The file was larger than the processing limit, so only the first{" "}
            {dataset.recordCount.toLocaleString()} rows are shown and analysed.
          </p>
        </div>
      )}

      {outlierRequest && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/5 p-3" role="status">
          <p className="text-sm text-foreground">
            {outlierState.status === "error" ? (
              <>Could not apply the outlier filter: {outlierState.error}</>
            ) : outlierResult ? (
              <>
                Showing the {outlierResult.outlierCount.toLocaleString()} row(s) flagged as outlier candidates in “{outlierResult.column}” ({METHOD_LABEL[outlierResult.method]}). Candidates are not necessarily errors; no data was changed.
              </>
            ) : (
              <>Applying the outlier filter…</>
            )}
          </p>
          <div className="flex gap-2">
            <Link to={`/analysis?tab=outliers&col=${encodeURIComponent(outlierRequest.column)}`} className={buttonStyles({ variant: "outline", size: "sm" })}>
              Back to analysis
            </Link>
            <Link to="/preview" className={buttonStyles({ variant: "outline", size: "sm" })}>
              Show all rows
            </Link>
          </div>
        </div>
      )}

      <DatasetSummary
        dataset={{
          filename: dataset.filename,
          fileSize: dataset.fileSize,
          recordCount: dataset.recordCount,
          columnCount: dataset.columnCount,
          lastProcessedAt: dataset.lastProcessedAt,
          status: dataset.status,
          completenessPercentage: dataset.profile?.completenessPercentage,
          duplicateRecords: dataset.profile?.duplicateRecords,
          parsingWarningCount: dataset.profile?.parsingWarningCount,
          parsingErrorCount: dataset.profile?.parsingErrorCount,
          columns: dataset.columns,
        }}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Dataset Records</CardTitle>
            <CardDescription>Real data from your uploaded CSV file</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Removing deletes the stored copy too, so ask first.
              if (window.confirm(`Remove "${dataset.filename}" from this browser? This cannot be undone.`)) void clearDataset();
            }}
          >
            Remove Dataset
          </Button>
        </CardHeader>
        <CardContent>
          {records === null || isRecordsLoading || (outlierRequest && !filtered && outlierState.status !== "error") ? (
            <LoadingState text="Loading records…" />
          ) : columns.length > 0 ? (
            <DatasetTable
              key={filtered ? "filtered" : "all"}
              columns={columns}
              columnTypes={columnTypes}
              rows={filtered ? filtered.rows : records}
              rowNumber={filtered ? (row) => filtered.numbers.get(row) ?? 0 : undefined}
              totalRecords={filtered ? filtered.rows.length : dataset.recordCount}
              totalColumns={dataset.columnCount}
            />
          ) : (
            <DatasetEmptyState variant="no-results" message="No data available" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
