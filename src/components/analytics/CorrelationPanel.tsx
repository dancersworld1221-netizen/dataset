import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Select } from "@components/ui/Select";
import { Button } from "@components/ui/Button";
import { Badge } from "@components/ui/Badge";
import { useAnalysis } from "@/hooks/useAnalysis";
import { ANALYTICS_LIMITS, type CorrelationMethod, type CorrelationPair } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";
import { Metric, MetricLabel } from "./MetricLabel";
import { Heatmap, ScatterPlot } from "./charts";
import { AsyncView, EmptyNote, Notes } from "./shared";
import { fmt, isNumericColumn } from "./helpers";

interface Props {
  columns: ColumnMetadata[];
}

function PairList({ title, pairs, onSelect }: { title: string; pairs: CorrelationPair[]; onSelect: (a: string, b: string) => void }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-foreground">{title}</h4>
      {pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1">
          {pairs.map((p) => (
            <li key={`${p.a}-${p.b}`}>
              <button type="button" onClick={() => onSelect(p.a, p.b)} className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span dir="auto">{p.a} / {p.b}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">r = {p.r.toFixed(3)} · {p.strength} · n = {p.n.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PairDetail({ x, y }: { x: string; y: string }) {
  const request = useMemo(() => ({ kind: "pairDetail" as const, x, y }), [x, y]);
  const state = useAnalysis(request);
  return (
    <AsyncView state={state} loadingText="Loading pair details…">
      {(d) => (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground" dir="auto">{x} vs {y}</h4>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Pearson r" help="pearson" value={d.pearson.r === null ? `n/a (${d.pearson.reason})` : d.pearson.r.toFixed(6)} emphasis />
            <Metric label="Spearman ρ" help="spearman" value={d.spearman.r === null ? `n/a (${d.spearman.reason})` : d.spearman.r.toFixed(6)} emphasis />
            <Metric label="Paired observations" help="pairedN" value={d.pairedCount.toLocaleString()} />
            <Metric label="Plotted points" help="Points drawn in the scatter plot." value={d.points.length.toLocaleString()} />
          </dl>
          <ScatterPlot points={d.points} xLabel={x} yLabel={y} />
          <Notes items={d.notes} />
        </div>
      )}
    </AsyncView>
  );
}

export function CorrelationPanel({ columns }: Props) {
  const numeric = useMemo(() => columns.filter(isNumericColumn), [columns]);
  const [method, setMethod] = useState<CorrelationMethod>("pearson");
  const [selection, setSelection] = useState<string[] | null>(null); // null = all numeric features
  const [pair, setPair] = useState<[string, string] | null>(null);

  const request = useMemo(
    () => (numeric.length >= 2 ? ({ kind: "correlation" as const, method, columns: selection ?? undefined }) : null),
    [numeric.length, method, selection]
  );
  const state = useAnalysis(request);

  if (numeric.length < 2) return <EmptyNote>At least two numerical columns are needed for a correlation analysis.</EmptyNote>;
  const chosen = selection ?? numeric.map((c) => c.name);
  const toggle = (name: string) => {
    const set = new Set(chosen);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    setSelection(numeric.map((c) => c.name).filter((n) => set.has(n)));
    setPair(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Correlation matrix</CardTitle>
        <CardDescription>
          Pairwise complete observations: each coefficient uses only the rows where both features have a valid value. Correlation does not imply causation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Method"
            value={method}
            onChange={(e) => { setMethod(e.target.value as CorrelationMethod); setPair(null); }}
            options={[
              { value: "pearson", label: "Pearson (linear)" },
              { value: "spearman", label: "Spearman (rank, monotonic)" },
            ]}
          />
          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">
              Features: {chosen.length} of {numeric.length} selected
            </summary>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setSelection(null); setPair(null); }}>All</Button>
              <Button size="sm" variant="outline" onClick={() => { setSelection([]); setPair(null); }}>None</Button>
            </div>
            <ul className="mt-2 grid max-h-40 gap-1 overflow-auto sm:grid-cols-2">
              {numeric.map((c) => (
                <li key={c.name}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={chosen.includes(c.name)} onChange={() => toggle(c.name)} />
                    <span dir="auto" className="truncate" title={c.name}>{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {numeric.length > ANALYTICS_LIMITS.maxMatrixFeatures && (
              <p className="mt-2 text-xs text-muted-foreground">At most {ANALYTICS_LIMITS.maxMatrixFeatures} features are shown at once.</p>
            )}
          </details>
        </div>

        <AsyncView state={state} loadingText="Calculating correlations…">
          {(result) =>
            result.features.length < 2 ? (
              <div className="space-y-3">
                <EmptyNote>Select at least two usable numerical features.</EmptyNote>
                <Notes items={result.excluded.map((e) => `${e.name}: ${e.reason}`)} />
              </div>
            ) : (
              <div className="space-y-5">
                <Notes items={result.warnings} tone="warning" />
                <Heatmap features={result.features} cells={result.cells} selected={pair} onSelect={(a, b) => setPair([a, b])} />
                <p className="text-xs text-muted-foreground">
                  <MetricLabel label="Strength scale (|r|)" help="Negligible below 0.1, weak 0.1–0.3, moderate 0.3–0.5, strong 0.5–0.7, very strong 0.7 and above." /> Select a cell to inspect a feature pair.
                </p>
                <div className="grid gap-5 md:grid-cols-2">
                  <PairList title="Strongest positive relationships" pairs={result.strongestPositive} onSelect={(a, b) => setPair([a, b])} />
                  <PairList title="Strongest negative relationships" pairs={result.strongestNegative} onSelect={(a, b) => setPair([a, b])} />
                </div>
                {result.excluded.length > 0 && (
                  <div>
                    <h4 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">Left out <Badge variant="default">{result.excluded.length}</Badge></h4>
                    <Notes items={result.excluded.map((e) => `${e.name}: ${e.reason}`)} />
                  </div>
                )}
                {pair && result.features.includes(pair[0]) && result.features.includes(pair[1]) && <PairDetail x={pair[0]} y={pair[1]} />}
                <p className="text-xs text-muted-foreground">Coefficient shown: {method === "pearson" ? "Pearson r" : "Spearman ρ"}. Undefined coefficients (constant column, fewer than 3 paired rows) are shown as “—”, never as 0. Largest pair: {result.pairs[0] ? `${fmt(result.pairs[0].r, 3)} (${result.pairs[0].a} / ${result.pairs[0].b})` : "n/a"}.</p>
              </div>
            )
          }
        </AsyncView>
      </CardContent>
    </Card>
  );
}
