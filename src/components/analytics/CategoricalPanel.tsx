import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Badge } from "@components/ui/Badge";
import { formatPercent } from "@/lib/format";
import { useAnalysis } from "@/hooks/useAnalysis";
import type { ImbalanceSeverity } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";
import { Metric } from "./MetricLabel";
import { BarList } from "./charts";
import { AsyncView, ColumnSelect, EmptyNote, Notes } from "./shared";
import { fmt, isCategoricalColumn } from "./helpers";

interface Props {
  columns: ColumnMetadata[];
  target: string;
  onTargetChange: (name: string) => void;
}

const SEVERITY: Record<ImbalanceSeverity, { label: string; variant: "success" | "info" | "warning" | "destructive" | "default" }> = {
  balanced: { label: "Balanced", variant: "success" },
  mild: { label: "Mild imbalance", variant: "info" },
  moderate: { label: "Moderate imbalance", variant: "warning" },
  severe: { label: "Severe imbalance", variant: "destructive" },
  extreme: { label: "Extreme imbalance", variant: "destructive" },
  "single-class": { label: "Single class", variant: "default" },
  empty: { label: "No usable values", variant: "default" },
};

function ClassImbalance({ target }: { target: string }) {
  const request = useMemo(() => ({ kind: "classImbalance" as const, target }), [target]);
  const state = useAnalysis(request);
  return (
    <AsyncView state={state} loadingText="Analysing class distribution…">
      {(r) => {
        const sev = SEVERITY[r.severity];
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={sev.variant}>{sev.label}</Badge>
              {!r.suitableAsTarget && <Badge variant="warning">may not be a classification target</Badge>}
            </div>
            {r.classes.length > 0 && <BarList items={r.classes.map((c) => ({ label: c.label, value: c.count, percentage: c.percentage }))} />}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Metric label="Rows with a target" help="count" value={r.validCount.toLocaleString()} emphasis />
              <Metric label="Missing target" help="missing" value={r.missingCount.toLocaleString()} />
              <Metric label="Classes" help="uniqueCount" value={r.classCount.toLocaleString()} />
              <Metric label="Imbalance ratio" help="imbalanceRatio" value={r.ratio === null ? "n/a" : `${fmt(r.ratio, 2)} : 1`} emphasis />
              <Metric label="Majority class" help="Class with the most rows." value={r.majority ? `${r.majority.label} (${formatPercent(r.majority.percentage)})` : "n/a"} />
              <Metric label="Minority class" help="Class with the fewest rows." value={r.minority ? `${r.minority.label} (${formatPercent(r.minority.percentage)})` : "n/a"} />
            </dl>
            <p className="text-xs text-muted-foreground">{r.definition}</p>
            {r.classesTruncated && <Notes items={[`Only the ${r.classes.length} largest of ${r.classCount.toLocaleString()} classes are listed.`]} />}
            <Notes items={r.warnings} tone="warning" />
            <p className="text-xs text-muted-foreground">No resampling or model training is performed; this only describes the class distribution.</p>
          </div>
        );
      }}
    </AsyncView>
  );
}

function CategoricalOverview() {
  const state = useAnalysis({ kind: "categoricalSummary" } as const);
  return (
    <AsyncView state={state} loadingText="Summarising categorical columns…">
      {(list) =>
        list.length === 0 ? (
          <EmptyNote>No categorical or Boolean columns.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Categorical columns summary">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-2">Column</th>
                  <th scope="col" className="px-3 py-2 text-right">Categories</th>
                  <th scope="col" className="px-3 py-2">Cardinality</th>
                  <th scope="col" className="px-3 py-2">Dominant</th>
                  <th scope="col" className="px-3 py-2">Least frequent</th>
                  <th scope="col" className="px-3 py-2 text-right">Missing</th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ column, frequency: f }) => (
                  <tr key={column} className="border-b border-border">
                    <td dir="auto" className="px-3 py-2 font-medium text-foreground">{column}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.uniqueCount.toLocaleString()}</td>
                    <td className="px-3 py-2"><Badge variant="default">{f.cardinality}</Badge></td>
                    <td dir="auto" className="px-3 py-2">{f.mostFrequent ? `${f.mostFrequent.label} (${formatPercent(f.mostFrequent.percentage, 1)})` : "n/a"}</td>
                    <td dir="auto" className="px-3 py-2">{f.leastFrequent[0] ? `${f.leastFrequent[0].label} (${formatPercent(f.leastFrequent[0].percentage, 1)})` : "n/a"}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.missingCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </AsyncView>
  );
}

export function CategoricalPanel({ columns, target, onTargetChange }: Props) {
  const candidates = useMemo(() => columns.filter((c) => c.dataType !== "empty" && c.dataType !== "date" && c.dataType !== "datetime"), [columns]);
  const hasTarget = candidates.some((c) => c.name === target);
  const categorical = columns.filter(isCategoricalColumn);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Class imbalance</CardTitle>
          <CardDescription>Choose the target column yourself — no column is assumed to be the target.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm">
            <ColumnSelect label="Target column" columns={candidates} value={hasTarget ? target : ""} onChange={onTargetChange} placeholder="Select a target column…" />
          </div>
          {hasTarget ? <ClassImbalance key={target} target={target} /> : <EmptyNote>Select a target column to see its class distribution and imbalance.</EmptyNote>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categorical columns</CardTitle>
          <CardDescription>Cardinality, dominant and least frequent categories. Open Distributions for the full frequency chart of one column.</CardDescription>
        </CardHeader>
        <CardContent>{categorical.length === 0 ? <EmptyNote>No categorical or Boolean columns.</EmptyNote> : <CategoricalOverview />}</CardContent>
      </Card>
    </div>
  );
}
