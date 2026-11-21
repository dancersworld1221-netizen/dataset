import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDataset } from "@hooks/useDataset";
import { PageHeader } from "@components/common/PageHeader";
import { LoadingState } from "@components/common/LoadingState";
import { DatasetEmptyState } from "@components/datasets/DatasetEmptyState";
import { ColumnAnalysisCard } from "@components/analysis/ColumnAnalysisCard";
import { Tabs } from "@components/ui/Tabs";
import { Input } from "@components/ui/Input";
import { Button } from "@components/ui/Button";
import { StatisticsPanel } from "@components/analytics/StatisticsPanel";
import { DistributionPanel } from "@components/analytics/DistributionPanel";
import { OutlierPanel } from "@components/analytics/OutlierPanel";
import { CorrelationPanel } from "@components/analytics/CorrelationPanel";
import { CategoricalPanel } from "@components/analytics/CategoricalPanel";
import { ComparePanel } from "@components/analytics/ComparePanel";
import { ReportPanel } from "@components/analytics/ReportPanel";
import type { ColumnDataType } from "@/types/dataset.types";

const HEADER_DESCRIPTION = "Statistics, distributions, outliers, correlations and feature relationships";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "statistics", label: "Statistics" },
  { value: "distributions", label: "Distributions" },
  { value: "outliers", label: "Outliers" },
  { value: "correlation", label: "Correlation" },
  { value: "categorical", label: "Categorical" },
  { value: "compare", label: "Compare" },
  { value: "report", label: "Report" },
];

const TYPE_FILTERS: Array<{ value: "all" | ColumnDataType; label: string }> = [
  { value: "all", label: "All" },
  { value: "integer", label: "Integer" },
  { value: "decimal", label: "Decimal" },
  { value: "string", label: "Text" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "empty", label: "Empty" },
];

export function FeatureAnalysis() {
  const navigate = useNavigate();
  const { dataset, records, isLoading, isRecordsLoading, error, loadRecords } = useDataset();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ColumnDataType>("all");

  const datasetId = dataset?.id;
  useEffect(() => {
    // The analysis engine needs the rows; they are read from IndexedDB on demand.
    if (datasetId) void loadRecords();
  }, [datasetId, loadRecords]);

  const columns = useMemo(() => dataset?.profile?.columnMetadata ?? dataset?.columns ?? [], [dataset]);
  const tab = TABS.some((t) => t.value === params.get("tab")) ? (params.get("tab") as string) : "overview";
  const column = params.get("col") ?? "";
  const target = params.get("target") ?? "";

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const presentTypes = useMemo(() => new Set(columns.map((c) => c.dataType)), [columns]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return columns.filter((c) => (typeFilter === "all" || c.dataType === typeFilter) && (!q || c.name.toLowerCase().includes(q)));
  }, [columns, query, typeFilter]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Feature Analysis" description={HEADER_DESCRIPTION} />
        <LoadingState text="Loading dataset…" />
      </div>
    );
  }

  if (!dataset || columns.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Feature Analysis" description={HEADER_DESCRIPTION} />
        {error && !dataset ? (
          <DatasetEmptyState variant="error" message={error} onRetry={() => navigate("/upload")} onUpload={() => navigate("/upload")} />
        ) : (
          <DatasetEmptyState variant="no-dataset" onUpload={() => navigate("/upload")} />
        )}
      </div>
    );
  }

  const needsRows = tab !== "overview";
  const rowsReady = records !== null && !isRecordsLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature Analysis"
        description={`${dataset.filename} — ${columns.length} columns, ${dataset.recordCount.toLocaleString()} records`}
      />

      {dataset.truncated && (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          Only the first {dataset.recordCount.toLocaleString()} rows of the file were kept, so all results describe those rows only.
        </p>
      )}

      <Tabs tabs={TABS} value={tab} onChange={(value) => update({ tab: value === "overview" ? "" : value })} variant="underline" />

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by data type">
              {TYPE_FILTERS.filter((f) => f.value === "all" || presentTypes.has(f.value)).map((f) => (
                <Button key={f.value} size="sm" variant={typeFilter === f.value ? "primary" : "outline"} aria-pressed={typeFilter === f.value} onClick={() => setTypeFilter(f.value)}>
                  {f.label}
                </Button>
              ))}
            </div>
            <Input placeholder="Search columns…" aria-label="Search columns" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full sm:w-64" />
          </div>
          {visible.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No columns match your filters.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((c) => (
                <ColumnAnalysisCard key={c.id} column={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {needsRows && !rowsReady && <LoadingState text="Loading rows for analysis…" />}

      {needsRows && rowsReady && (
        <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label}>
          {tab === "statistics" && <StatisticsPanel columns={columns} column={column} onColumnChange={(c) => update({ col: c })} />}
          {tab === "distributions" && <DistributionPanel columns={columns} column={column} onColumnChange={(c) => update({ col: c })} />}
          {tab === "outliers" && <OutlierPanel columns={columns} column={column} onColumnChange={(c) => update({ col: c })} />}
          {tab === "correlation" && <CorrelationPanel columns={columns} />}
          {tab === "categorical" && <CategoricalPanel columns={columns} target={target} onTargetChange={(t) => update({ target: t })} />}
          {tab === "compare" && <ComparePanel columns={columns} />}
          {tab === "report" && <ReportPanel dataset={dataset} target={target} />}
        </div>
      )}
    </div>
  );
}
