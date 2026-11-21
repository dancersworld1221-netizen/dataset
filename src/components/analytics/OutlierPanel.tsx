import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Select } from "@components/ui/Select";
import { Input } from "@components/ui/Input";
import { Badge } from "@components/ui/Badge";
import { buttonStyles } from "@components/ui/button-styles";
import { formatPercent } from "@/lib/format";
import { useAnalysis } from "@/hooks/useAnalysis";
import { DEFAULT_IQR_MULTIPLIER, DEFAULT_MODIFIED_Z_THRESHOLD, DEFAULT_Z_THRESHOLD } from "@/lib/analytics/outliers";
import type { OutlierMethod, OutlierResult } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";
import { Metric, MetricLabel } from "./MetricLabel";
import { AsyncView, ColumnSelect, EmptyNote, Notes } from "./shared";
import { fmt, isNumericColumn, outlierPreviewLink } from "./helpers";

interface Props {
  columns: ColumnMetadata[];
  column: string;
  onColumnChange: (name: string) => void;
}

const METHODS: Array<{ value: OutlierMethod; label: string }> = [
  { value: "iqr", label: "IQR (Tukey fences)" },
  { value: "zscore", label: "Z-score" },
  { value: "modified-zscore", label: "Modified Z-score (MAD)" },
];

const KIND_TEXT: Record<OutlierResult["kind"], { label: string; variant: "info" | "warning" | "default" }> = {
  "statistical-outliers": { label: "Statistical outlier candidates", variant: "info" },
  "rare-values": { label: "Rare values (degenerate spread)", variant: "warning" },
  "not-applicable": { label: "Not applicable", variant: "default" },
};

export function OutlierPanel({ columns, column, onColumnChange }: Props) {
  const numeric = useMemo(() => columns.filter(isNumericColumn), [columns]);
  const [method, setMethod] = useState<OutlierMethod>("iqr");
  const [multiplier, setMultiplier] = useState(DEFAULT_IQR_MULTIPLIER);
  const [zThreshold, setZThreshold] = useState(DEFAULT_Z_THRESHOLD);
  const [modifiedThreshold, setModifiedThreshold] = useState(DEFAULT_MODIFIED_Z_THRESHOLD);
  const [ignoreZeros, setIgnoreZeros] = useState(false);

  const selected = numeric.find((c) => c.name === column)?.name ?? numeric[0]?.name ?? "";
  const request = useMemo(
    () => (selected ? ({ kind: "outlierOverview" as const, column: selected, multiplier, zThreshold, modifiedThreshold, ignoreZeros }) : null),
    [selected, multiplier, zThreshold, modifiedThreshold, ignoreZeros]
  );
  const state = useAnalysis(request);

  if (numeric.length === 0) return <EmptyNote>This dataset has no numerical columns.</EmptyNote>;

  const numberInput = (label: string, value: number, set: (n: number) => void, min: number, step: number, help: string) => (
    <Input
      label={label}
      type="number"
      min={min}
      step={step}
      value={value}
      helperText={help}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n >= min) set(n);
      }}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outlier candidates</CardTitle>
        <CardDescription>Records are never changed or removed. A statistical outlier is not necessarily a data error.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ColumnSelect label="Column" columns={numeric} value={selected} onChange={onColumnChange} />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value as OutlierMethod)} options={METHODS} />
          {method === "iqr" && numberInput("IQR multiplier", multiplier, setMultiplier, 0.1, 0.1, "Fences: Q1 − k × IQR and Q3 + k × IQR (default 1.5).")}
          {method === "zscore" && numberInput("|z| threshold", zThreshold, setZThreshold, 0.5, 0.5, "Distance from the mean in standard deviations (default 3).")}
          {method === "modified-zscore" && numberInput("|modified z| threshold", modifiedThreshold, setModifiedThreshold, 0.5, 0.5, "Default 3.5 (Iglewicz & Hoaglin).")}
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={ignoreZeros} onChange={(e) => setIgnoreZeros(e.target.checked)} />
          <span>
            Ignore zeros — judge only the non-zero values and never flag zeros. Useful for zero-inflated columns, where an IQR of 0 would otherwise flag every non-zero value.
          </span>
        </label>

        <AsyncView state={state} loadingText="Detecting outliers…">
          {(overview) => {
            const result = method === "iqr" ? overview.iqr : method === "zscore" ? overview.zscore : overview.modifiedZScore;
            const kind = KIND_TEXT[result.kind];
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={kind.variant}>{kind.label}</Badge>
                  {result.zeroInflated && <Badge variant="warning">zero-inflated column ({formatPercent(result.zeroPercentage, 0)} zeros)</Badge>}
                </div>
                <p className="text-sm text-foreground">{result.explanation}</p>

                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <Metric label="Candidates" help="Observations flagged by the selected method." value={`${result.outlierCount.toLocaleString()} (${formatPercent(result.outlierPercentage, 2)})`} emphasis />
                  <Metric label="Below lower bound" help="Flagged values under the lower limit." value={result.lowCount.toLocaleString()} />
                  <Metric label="Above upper bound" help="Flagged values over the upper limit." value={result.highCount.toLocaleString()} />
                  <Metric label="Valid observations" help="count" value={result.validCount.toLocaleString()} />
                  <Metric label="Lower bound" help="Values below this are flagged." value={fmt(result.lowerBound)} />
                  <Metric label="Upper bound" help="Values above this are flagged." value={fmt(result.upperBound)} />
                  <Metric label="Invalid values" help="invalid" value={result.invalidCount.toLocaleString()} />
                  <Metric label="Missing" help="missing" value={result.missingCount.toLocaleString()} />
                </dl>

                <Notes items={result.notes} tone="warning" />

                <div className="rounded-lg border border-border p-3">
                  <h4 className="mb-2 text-sm font-medium text-foreground">All three methods on this column</h4>
                  <table className="w-full text-sm" aria-label="Outlier methods comparison">
                    <tbody>
                      {[["IQR", overview.iqr], ["Z-score", overview.zscore], ["Modified Z-score", overview.modifiedZScore]].map(([name, r]) => (
                        <tr key={name as string} className="border-b border-border last:border-0">
                          <th scope="row" className="py-1.5 pr-4 text-left font-normal text-muted-foreground">{name as string}</th>
                          <td className="py-1.5 font-mono">{(r as OutlierResult).outlierCount.toLocaleString()} candidates</td>
                        </tr>
                      ))}
                      <tr>
                        <th scope="row" className="py-1.5 pr-4 text-left font-normal text-muted-foreground">
                          <MetricLabel label="Potential anomalies" help="Rows flagged by at least two of the three methods. Still only candidates: check them before drawing conclusions." />
                        </th>
                        <td className="py-1.5 font-mono">{overview.consensusRowIndices.length.toLocaleString()} (flagged by ≥ 2 methods)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {result.outlierCount > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-foreground">
                        Affected rows {result.examples.length < result.outlierCount && `(first ${result.examples.length} of ${result.outlierCount.toLocaleString()})`}
                      </h4>
                      <Link to={outlierPreviewLink(selected, method, { multiplier, zThreshold, modifiedThreshold, ignoreZeros })} className={buttonStyles({ variant: "outline", size: "sm" })}>
                        Show affected rows in Data Preview
                      </Link>
                    </div>
                    <div className="max-h-64 overflow-auto rounded-lg border border-border">
                      <table className="w-full text-sm" aria-label="Affected rows">
                        <thead className="sticky top-0 bg-card">
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <th scope="col" className="px-3 py-2">Row</th>
                            <th scope="col" className="px-3 py-2 text-right">Value</th>
                            <th scope="col" className="px-3 py-2 text-right">{method === "iqr" ? "Side" : "Score"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.examples.map((e) => (
                            <tr key={e.rowNumber} className="border-b border-border">
                              <td className="px-3 py-1.5 font-mono text-xs">{e.rowNumber.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmt(e.value)}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{method === "iqr" ? e.direction : fmt(e.score, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground">Row 1 is the first data row (the header is not counted).</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No candidates with these settings.</p>
                )}

                <div>
                  <h4 className="mb-1 text-sm font-medium text-foreground">Limitations of this method</h4>
                  <Notes items={result.limitations} />
                </div>
              </div>
            );
          }}
        </AsyncView>
      </CardContent>
    </Card>
  );
}
