import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Download, Redo, RefreshCw, RotateCcw, Undo } from "lucide-react";
import { useDataset } from "@/hooks/useDataset";
import { PageHeader } from "@components/common/PageHeader";
import { LoadingState } from "@components/common/LoadingState";
import { DatasetEmptyState } from "@components/datasets/DatasetEmptyState";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@components/ui/Card";
import { Button } from "@components/ui/Button";
import { Tabs } from "@components/ui/Tabs";
import { Table } from "@components/ui/Table";
import { Badge } from "@components/ui/Badge";
import { Modal } from "@components/ui/Modal";
import { Input } from "@components/ui/Input";
import { Select } from "@components/ui/Select";
import { downloadFile } from "@/lib/download";
import { cleanedFilename, rowsToCsv } from "@/lib/csv/csvExport";
import { addToast } from "@/lib/toast-state";
import type { CleaningOperationType, CleaningParameters, CleaningPreview } from "@/types/dataset.types";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "missing", label: "Missing Values" },
  { value: "duplicates", label: "Duplicates" },
  { value: "types", label: "Type Validation" },
  { value: "strings", label: "String Cleaning" },
  { value: "columns", label: "Columns" },
  { value: "history", label: "Cleaning History" },
];

const HEADER_DESCRIPTION = "Clean your data with preview, undo, and redo";

const formatPct = (value: number | null | undefined): string =>
  value === undefined || value === null ? "—" : `${value.toFixed(1)}%`;

const capitalize = (label: string): string => label.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

const IMPUTE_LABEL: Partial<Record<CleaningOperationType, string>> = {
  impute_median: "Fill with median",
  impute_mean: "Fill with mean",
  impute_mode: "Fill with most frequent value",
  impute_constant: "Fill with a constant",
  remove_rows_missing: "Remove rows",
  remove_column: "Remove column",
};

export function Cleaning() {
  const navigate = useNavigate();
  const { dataset, records, isLoading, isRecordsLoading, loadRecords, cleaning } = useDataset();
  const {
    preview: contextPreview,
    missingStats,
    duplicateStats,
    typeValidation,
    history,
    canUndo,
    canRedo,
    isCleaning,
    error: cleaningError,
    undo,
    redo,
    resetToOriginal,
    detectMissingValues,
    detectDuplicates,
    validateTypes,
    previewMissingCleaning,
    previewDuplicateRemoval,
    previewStringCleaning,
    previewTypeValidation,
    executeMissingCleaning,
    executeDuplicateRemoval,
    executeStringCleaning,
    executeTypeValidation,
  } = cleaning;

  const [tab, setTab] = useState<string>("overview");
  const [pendingOp, setPendingOp] = useState<CleaningParameters | null>(null);
  const [pendingPreview, setPendingPreview] = useState<CleaningPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const datasetId = dataset?.id;
  const hasColumns = (dataset?.columns.length ?? 0) > 0;
  useEffect(() => {
    if (datasetId && hasColumns) void loadRecords();
  }, [datasetId, hasColumns, loadRecords]);

  // Detection runs by itself once the rows are there, and again whenever the rows change (cleaning, undo, redo).
  const rowsVersion = dataset?.lastProcessedAt ?? dataset?.createdAt;
  const rowsReady = records !== null;
  const runDetection = useCallback(async () => {
    setDetecting(true);
    try {
      await detectMissingValues();
      await detectDuplicates();
      await validateTypes();
    } finally {
      setDetecting(false);
    }
    // The detect functions are stable for a given dataset; listing them would re-run detection on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);
  useEffect(() => {
    if (datasetId && rowsReady) void runDetection();
  }, [datasetId, rowsReady, rowsVersion, runDetection]);

  const missingRows = useMemo(() => missingStats.filter((m) => m.missingCount > 0), [missingStats]);
  const typeIssues = useMemo(() => typeValidation.filter((t) => t.needsChange), [typeValidation]);
  const columns = useMemo(
    () => (dataset?.columns ?? []).map((c) => ({ name: c.name, dataType: c.dataType as string })),
    [dataset]
  );

  const openPreview = useCallback(
    async (op: CleaningParameters) => {
      const run =
        op.type === "remove_duplicates"
          ? previewDuplicateRemoval
          : op.type === "validate_type"
            ? previewTypeValidation
            : ["trim_whitespace", "normalize_whitespace", "lowercase", "uppercase"].includes(op.type)
              ? previewStringCleaning
              : previewMissingCleaning;
      try {
        const result = await run(op);
        setPendingPreview(result);
        setPendingOp(op);
        setPreviewOpen(true);
      } catch {
        // The provider already put the reason into `cleaning.error`, which is shown below.
      }
    },
    [previewDuplicateRemoval, previewMissingCleaning, previewStringCleaning, previewTypeValidation]
  );

  const applyPending = useCallback(async () => {
    if (!pendingOp) return;
    const run =
      pendingOp.type === "remove_duplicates"
        ? executeDuplicateRemoval
        : pendingOp.type === "validate_type"
          ? executeTypeValidation
          : ["trim_whitespace", "normalize_whitespace", "lowercase", "uppercase"].includes(pendingOp.type)
            ? executeStringCleaning
            : executeMissingCleaning;
    const ok = await run(pendingOp);
    if (ok) {
      setPreviewOpen(false);
      setPendingOp(null);
      setPendingPreview(null);
    }
  }, [pendingOp, executeDuplicateRemoval, executeMissingCleaning, executeStringCleaning, executeTypeValidation]);

  const exportCsv = useCallback(() => {
    if (!dataset || !records) return;
    downloadFile(
      cleanedFilename(dataset.filename),
      rowsToCsv(records, dataset.columns.map((c) => c.name)),
      "text/csv;charset=utf-8"
    );
    addToast({ title: "CSV exported", description: `${records.length.toLocaleString()} rows`, variant: "success", duration: 3000 });
  }, [dataset, records]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Data Cleaning" description={HEADER_DESCRIPTION} />
        <LoadingState text="Loading dataset…" />
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="space-y-8">
        <PageHeader title="Data Cleaning" description={HEADER_DESCRIPTION} />
        <DatasetEmptyState variant="no-dataset" onUpload={() => navigate("/upload")} />
      </div>
    );
  }

  const totalMissing = missingStats.reduce((s, m) => s + m.missingCount, 0);
  const revision = dataset.cleaningRevision ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Data Cleaning"
        description={`${dataset.filename} — ${dataset.recordCount.toLocaleString()} records × ${dataset.columnCount} columns`}
        badge={revision > 0 ? `${revision} step${revision === 1 ? "" : "s"} applied` : undefined}
        badgeVariant="info"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!canUndo || isCleaning} onClick={() => void undo()}>
              <Undo className="mr-2 h-4 w-4" />
              Undo
            </Button>
            <Button variant="outline" size="sm" disabled={!canRedo || isCleaning} onClick={() => void redo()}>
              <Redo className="mr-2 h-4 w-4" />
              Redo
            </Button>
            <Button variant="outline" size="sm" disabled={!canUndo || isCleaning} onClick={() => void resetToOriginal()}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Undo all
            </Button>
            <Button size="sm" disabled={!records || isCleaning} onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>
        }
      />

      {cleaningError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-foreground">{cleaningError}</p>
        </div>
      )}

      {(isRecordsLoading || !rowsReady) && <LoadingState text="Loading rows…" />}

      {rowsReady && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Records" value={dataset.recordCount.toLocaleString()} />
            <SummaryCard label="Columns" value={dataset.columnCount.toLocaleString()} />
            <SummaryCard label="Missing cells" value={detecting && missingStats.length === 0 ? "…" : totalMissing.toLocaleString()} />
            <SummaryCard
              label="Duplicate rows"
              value={detecting && !duplicateStats ? "…" : (duplicateStats?.totalDuplicateRecords ?? 0).toLocaleString()}
            />
          </div>

          <Tabs tabs={TABS} value={tab} onChange={setTab} variant="underline" />

          {tab === "overview" && (
            <OverviewPanel
              missingColumns={missingRows.length}
              duplicates={duplicateStats?.totalDuplicateRecords ?? 0}
              typeIssues={typeIssues.length}
              detecting={detecting}
              onRefresh={() => void runDetection()}
              onGo={setTab}
            />
          )}
          {tab === "missing" && <MissingPanel stats={missingRows} busy={isCleaning} onPreview={openPreview} />}
          {tab === "duplicates" && (
            <DuplicatePanel
              groups={duplicateStats?.groups ?? []}
              totalDuplicates={duplicateStats?.totalDuplicateRecords ?? 0}
              columns={columns}
              busy={isCleaning}
              onPreview={openPreview}
            />
          )}
          {tab === "types" && <TypePanel issues={typeIssues} busy={isCleaning} onPreview={openPreview} />}
          {tab === "strings" && <StringPanel columns={columns} busy={isCleaning} onPreview={openPreview} />}
          {tab === "columns" && <ColumnsPanel columns={columns} busy={isCleaning} onPreview={openPreview} />}
          {tab === "history" && <HistoryPanel history={history} />}
        </>
      )}

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview cleaning result" size="full">
        <PreviewPanel
          preview={pendingPreview ?? contextPreview}
          busy={isCleaning}
          onApply={() => void applyPending()}
          onCancel={() => setPreviewOpen(false)}
        />
      </Modal>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function OverviewPanel({
  missingColumns,
  duplicates,
  typeIssues,
  detecting,
  onRefresh,
  onGo,
}: {
  missingColumns: number;
  duplicates: number;
  typeIssues: number;
  detecting: boolean;
  onRefresh: () => void;
  onGo: (tab: string) => void;
}) {
  const items = [
    { tab: "missing", label: "Columns with missing values", value: missingColumns },
    { tab: "duplicates", label: "Duplicate rows", value: duplicates },
    { tab: "types", label: "Columns with invalid values", value: typeIssues },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <button
            key={item.tab}
            type="button"
            onClick={() => onGo(item.tab)}
            className="rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
            <p className="text-2xl font-bold text-foreground">{item.value.toLocaleString()}</p>
          </button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Detection</CardTitle>
          <CardDescription>
            The dataset is analysed automatically and again after every change. Nothing is modified until you apply a previewed operation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={detecting} onClick={onRefresh}>
            <RefreshCw className={`mr-2 h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            {detecting ? "Analysing…" : "Re-run detection"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type PreviewFn = (op: CleaningParameters) => void | Promise<void>;

function MissingPanel({
  stats,
  busy,
  onPreview,
}: {
  stats: Array<{ column: string; dataType: string; totalRows: number; missingCount: number; missingPercentage: number; recommendedMethod: string | null }>;
  busy: boolean;
  onPreview: PreviewFn;
}) {
  const [constants, setConstants] = useState<Record<string, string>>({});
  if (stats.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">No missing values detected.</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {stats.map((s) => {
        const numeric = s.dataType === "integer" || s.dataType === "decimal";
        const actions: CleaningOperationType[] = numeric
          ? ["impute_median", "impute_mean", "impute_mode"]
          : ["impute_mode"];
        return (
          <Card key={s.column}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 dir="auto" className="truncate font-medium text-foreground">{s.column}</h4>
                  <p className="text-xs text-muted-foreground">
                    {s.dataType} — {s.missingCount.toLocaleString()} of {s.totalRows.toLocaleString()} missing ({formatPct(s.missingPercentage)})
                    {s.recommendedMethod && <> · suggested: {capitalize(s.recommendedMethod)}</>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {actions.map((type) => (
                    <Button
                      key={type}
                      size="sm"
                      variant={s.recommendedMethod === type ? "primary" : "outline"}
                      disabled={busy}
                      onClick={() => void onPreview({ type, targetColumns: [s.column], parameters: {} })}
                    >
                      {IMPUTE_LABEL[type]}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onPreview({ type: "remove_rows_missing", targetColumns: [s.column], parameters: {} })}
                  >
                    {IMPUTE_LABEL.remove_rows_missing}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-48">
                  <Input
                    aria-label={`Constant for ${s.column}`}
                    placeholder="Constant value"
                    value={constants[s.column] ?? ""}
                    onChange={(e) => setConstants((c) => ({ ...c, [s.column]: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !(constants[s.column] ?? "").trim()}
                  onClick={() =>
                    void onPreview({ type: "impute_constant", targetColumns: [s.column], parameters: { constant: constants[s.column] } })
                  }
                >
                  {IMPUTE_LABEL.impute_constant}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Remove every row that has a missing value in any column.</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void onPreview({ type: "remove_rows_missing", targetColumns: [], parameters: {} })}>
            Preview remove all incomplete rows
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DuplicatePanel({
  groups,
  totalDuplicates,
  columns,
  busy,
  onPreview,
}: {
  groups: Array<{ id: string; keyValues: Record<string, string>; rowIndices: number[]; rowCount: number }>;
  totalDuplicates: number;
  columns: Array<{ name: string; dataType: string }>;
  busy: boolean;
  onPreview: PreviewFn;
}) {
  const [keep, setKeep] = useState<"first" | "last">("first");
  const [keyColumn, setKeyColumn] = useState("");
  const keys = keyColumn ? [keyColumn] : [];
  const shown = groups.slice(0, 50);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Remove duplicate rows</CardTitle>
          <CardDescription>
            {totalDuplicates === 0
              ? "No duplicate rows detected (comparing every column)."
              : `${totalDuplicates.toLocaleString()} duplicate row(s) in ${groups.length.toLocaleString()} group(s) when comparing every column.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Compare rows by"
              value={keyColumn}
              onChange={(e) => setKeyColumn(e.target.value)}
              options={[{ value: "", label: "All columns" }, ...columns.map((c) => ({ value: c.name, label: c.name }))]}
            />
            <Select
              label="Keep"
              value={keep}
              onChange={(e) => setKeep(e.target.value as "first" | "last")}
              options={[
                { value: "first", label: "First occurrence" },
                { value: "last", label: "Last occurrence" },
              ]}
            />
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void onPreview({
                type: "remove_duplicates",
                targetColumns: keys,
                parameters: keep === "last" ? { keepLast: true } : { keepFirst: true },
              })
            }
          >
            Preview duplicate removal
          </Button>
        </CardContent>
      </Card>

      {shown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Largest duplicate groups</CardTitle>
            <CardDescription>Showing {shown.length} of {groups.length.toLocaleString()} (all columns compared)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table
              columns={[
                { key: "rows", header: "Identical rows", accessor: (r: { rowCount: number }) => r.rowCount.toLocaleString(), align: "right" as const },
                {
                  key: "at",
                  header: "Row numbers",
                  accessor: (r: { rowIndices: number[] }) =>
                    r.rowIndices.slice(0, 6).map((i) => i + 1).join(", ") + (r.rowIndices.length > 6 ? ", …" : ""),
                },
                {
                  key: "values",
                  header: "Values",
                  accessor: (r: { keyValues: Record<string, string> }) => (
                    <span dir="auto" className="block max-w-md truncate" title={Object.values(r.keyValues).join(" | ")}>
                      {Object.values(r.keyValues).slice(0, 4).join(" | ")}
                    </span>
                  ),
                },
              ]}
              data={shown}
              keyAccessor={(r) => r.id}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TypePanel({
  issues,
  busy,
  onPreview,
}: {
  issues: Array<{ column: string; currentType: string; suggestedType: string; validCount: number; invalidCount: number; invalidExamples: string[] }>;
  busy: boolean;
  onPreview: PreviewFn;
}) {
  const withInvalid = issues.filter((i) => i.invalidCount > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Type validation</CardTitle>
        <CardDescription>
          Cells that do not fit their column's type (for example text in a numeric column). Clearing them makes them missing values, which you can then fill or remove.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every value matches its column type.</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "column", header: "Column", accessor: (r: { column: string }) => <span dir="auto">{r.column}</span> },
                { key: "current", header: "Type", accessor: (r: { currentType: string }) => r.currentType },
                { key: "invalid", header: "Invalid cells", accessor: (r: { invalidCount: number }) => r.invalidCount.toLocaleString(), align: "right" as const },
                {
                  key: "examples",
                  header: "Examples",
                  accessor: (r: { invalidExamples: string[] }) => (
                    <span dir="auto" className="block max-w-xs truncate">{r.invalidExamples.map((e) => `“${e}”`).join(", ") || "—"}</span>
                  ),
                },
                {
                  key: "action",
                  header: "",
                  accessor: (r: { column: string; invalidCount: number }) =>
                    r.invalidCount > 0 ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void onPreview({ type: "validate_type", targetColumns: [r.column], parameters: {} })}>
                        Clear invalid
                      </Button>
                    ) : null,
                  align: "right" as const,
                },
              ]}
              data={issues}
              keyAccessor={(r) => r.column}
            />
            {withInvalid.length > 1 && (
              <Button size="sm" disabled={busy} onClick={() => void onPreview({ type: "validate_type", targetColumns: [], parameters: {} })}>
                Preview clearing invalid values in all columns
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STRING_ACTIONS: Array<{ type: CleaningOperationType; label: string }> = [
  { type: "trim_whitespace", label: "Trim whitespace" },
  { type: "normalize_whitespace", label: "Normalize whitespace" },
  { type: "lowercase", label: "Lowercase" },
  { type: "uppercase", label: "Uppercase" },
];

function StringPanel({
  columns,
  busy,
  onPreview,
}: {
  columns: Array<{ name: string; dataType: string }>;
  busy: boolean;
  onPreview: PreviewFn;
}) {
  const textColumns = columns.filter((c) => c.dataType === "string");
  const [selected, setSelected] = useState<string>("__all__");
  const targets = selected === "__all__" ? textColumns.map((c) => c.name) : [selected];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic string cleaning</CardTitle>
        <CardDescription>Trim, normalise whitespace and change case in text columns.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {textColumns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No text columns detected.</p>
        ) : (
          <>
            <div className="max-w-sm">
              <Select
                label="Columns"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                options={[{ value: "__all__", label: `All text columns (${textColumns.length})` }, ...textColumns.map((c) => ({ value: c.name, label: c.name }))]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {STRING_ACTIONS.map((a) => (
                <Button key={a.type} size="sm" variant="outline" disabled={busy} onClick={() => void onPreview({ type: a.type, targetColumns: targets, parameters: {} })}>
                  {a.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ColumnsPanel({
  columns,
  busy,
  onPreview,
}: {
  columns: Array<{ name: string; dataType: string }>;
  busy: boolean;
  onPreview: PreviewFn;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Remove columns</CardTitle>
        <CardDescription>Drop columns you do not need. The statistics and quality report are recalculated afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table
          columns={[
            { key: "name", header: "Column", accessor: (r: { name: string }) => <span dir="auto">{r.name}</span> },
            { key: "type", header: "Type", accessor: (r: { dataType: string }) => r.dataType },
            {
              key: "action",
              header: "",
              align: "right" as const,
              accessor: (r: { name: string }) => (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || columns.length <= 1}
                  onClick={() => void onPreview({ type: "remove_column", targetColumns: [r.name], parameters: {} })}
                >
                  Remove
                </Button>
              ),
            },
          ]}
          data={columns}
          keyAccessor={(r) => r.name}
        />
      </CardContent>
    </Card>
  );
}

function HistoryPanel({ history }: { history: Array<{ id: string; type: string; title: string; description: string; affectedRowCount: number; affectedCellCount: number; status: string; createdAt: string }> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cleaning history</CardTitle>
        <CardDescription>Steps applied in this session. Use Undo and Redo above to move through them.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No cleaning operations applied yet.</p>
        ) : (
          <Table
            columns={[
              { key: "title", header: "Operation", accessor: (r: { title: string }) => r.title },
              { key: "desc", header: "Details", accessor: (r: { description: string }) => <span dir="auto">{r.description}</span> },
              { key: "rows", header: "Rows affected", accessor: (r: { affectedRowCount: number }) => r.affectedRowCount.toLocaleString(), align: "right" as const },
              {
                key: "status",
                header: "Status",
                accessor: (r: { status: string }) => <Badge variant={r.status === "undone" ? "default" : "success"}>{r.status}</Badge>,
              },
              { key: "time", header: "Time", accessor: (r: { createdAt: string }) => new Date(r.createdAt).toLocaleString() },
            ]}
            data={history}
            keyAccessor={(r) => r.id}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PreviewPanel({
  preview,
  busy,
  onApply,
  onCancel,
}: {
  preview: CleaningPreview | null;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  if (!preview) return <p className="py-8 text-center text-sm text-muted-foreground">No preview available.</p>;
  const changes = preview.changes ?? [];
  const removedRows = preview.removedRows ?? [];
  const removedColumns = preview.removedColumns ?? [];
  const nothing = preview.affectedRowCount === 0 && preview.affectedCellCount === 0 && removedColumns.length === 0;
  const previewColumns = Object.keys(removedRows[0]?.row ?? {}).slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-foreground">{capitalize(preview.type)}</h4>
        <span className="text-xs text-muted-foreground">
          {preview.affectedRowCount.toLocaleString()} row(s) affected · {preview.originalRowCount.toLocaleString()} → {preview.previewRowCount.toLocaleString()} rows
        </span>
      </div>

      {preview.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          {preview.warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}

      {changes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            Changed cells ({changes.length < preview.affectedCellCount ? `first ${changes.length} of ${preview.affectedCellCount.toLocaleString()}` : changes.length})
          </p>
          <Table
            columns={[
              { key: "row", header: "Row", accessor: (r: { rowNumber: number }) => r.rowNumber.toLocaleString(), align: "right" as const },
              { key: "col", header: "Column", accessor: (r: { column: string }) => <span dir="auto">{r.column}</span> },
              { key: "before", header: "Before", accessor: (r: { before: string }) => <span dir="auto" className="block max-w-[14rem] truncate font-mono text-xs">{r.before === "" ? "(empty)" : `“${r.before}”`}</span> },
              { key: "after", header: "After", accessor: (r: { after: string }) => <span dir="auto" className="block max-w-[14rem] truncate font-mono text-xs">{r.after === "" ? "(empty)" : `“${r.after}”`}</span> },
            ]}
            data={changes}
            keyAccessor={(r) => `${r.rowNumber}-${r.column}`}
          />
        </div>
      )}

      {removedRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            Rows that will be removed ({removedRows.length < preview.affectedRowCount ? `first ${removedRows.length} of ${preview.affectedRowCount.toLocaleString()}` : removedRows.length})
          </p>
          <Table
            columns={[
              { key: "row", header: "Row", accessor: (r: { rowNumber: number }) => r.rowNumber.toLocaleString(), align: "right" as const },
              ...previewColumns.map((name) => ({
                key: name,
                header: name,
                accessor: (r: { row: Record<string, string> }) => <span dir="auto" className="block max-w-[10rem] truncate">{r.row[name] ?? ""}</span>,
              })),
            ]}
            data={removedRows}
            keyAccessor={(r) => String(r.rowNumber)}
          />
        </div>
      )}

      {removedColumns.length > 0 && (
        <p className="text-sm text-foreground" dir="auto">
          Columns that will be removed: <strong>{removedColumns.join(", ")}</strong>
        </p>
      )}

      {nothing && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">This operation would not change the data.</p>}

      <p className="text-xs text-muted-foreground">Applying creates a new version; you can undo it afterwards. Statistics and the quality report are recalculated and the result is saved in this browser.</p>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onApply} disabled={busy || nothing}>
          {busy ? "Applying…" : "Apply changes"}
        </Button>
      </div>
    </div>
  );
}
