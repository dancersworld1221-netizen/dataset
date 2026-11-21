import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Badge } from "@components/ui/Badge";
import { Button } from "@components/ui/Button";
import { formatPercent } from "@/lib/format";
import { useAnalysis } from "@/hooks/useAnalysis";
import type { ColumnMetadata } from "@/types/dataset.types";
import { MetricLabel } from "./MetricLabel";
import { AsyncView, EmptyNote, Notes } from "./shared";
import { fmt } from "./helpers";

interface Props {
  columns: ColumnMetadata[];
}

function Relationships() {
  const state = useAnalysis({ kind: "relationships" } as const);
  return (
    <AsyncView state={state} loadingText="Looking for redundant features…">
      {(r) => (
        <div className="space-y-5">
          <div>
            <h4 className="mb-1 text-sm font-medium text-foreground">Exact duplicate columns</h4>
            <p className="mb-2 text-xs text-muted-foreground">Identical values in every row (after trimming). This is an exact statement, not a statistical one.</p>
            {r.exactDuplicates.length === 0 ? (
              <p className="text-sm text-muted-foreground">None found.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {r.exactDuplicates.map((g) => (
                  <li key={g.columns.join("|")} dir="auto"><Badge variant="destructive">identical</Badge> {g.columns.join(" = ")}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1 text-sm font-medium text-foreground">Highly correlated numerical features (|r| ≥ {r.correlationThreshold})</h4>
            <p className="mb-2 text-xs text-muted-foreground">Potentially redundant, but NOT identical: they carry the same signal on a different scale or with noise. Nothing is removed or merged.</p>
            {r.highlyCorrelated.length === 0 ? (
              <p className="text-sm text-muted-foreground">None found.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {r.highlyCorrelated.map((p) => (
                  <li key={`${p.a}-${p.b}`} dir="auto"><Badge variant="warning">similar signal</Badge> {p.a} / {p.b} <span className="font-mono text-xs text-muted-foreground">r = {p.r.toFixed(3)}, n = {p.n.toLocaleString()}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1 text-sm font-medium text-foreground">Similar distributions (KS distance ≤ {r.ksThreshold})</h4>
            <p className="mb-2 text-xs text-muted-foreground">Features whose values are distributed almost identically (needs at least 30 values each). Similar distributions do not mean the features are related.</p>
            {r.similarDistributions.length === 0 ? (
              <p className="text-sm text-muted-foreground">None found.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {r.similarDistributions.map((p) => (
                  <li key={`${p.a}-${p.b}`} dir="auto">{p.a} / {p.b} <span className="font-mono text-xs text-muted-foreground">D = {p.ksDistance.toFixed(3)}</span></li>
                ))}
              </ul>
            )}
          </div>
          <Notes items={r.warnings} />
        </div>
      )}
    </AsyncView>
  );
}

function Comparison({ names }: { names: string[] }) {
  const request = useMemo(() => ({ kind: "compare" as const, columns: names }), [names]);
  const state = useAnalysis(request);
  return (
    <AsyncView state={state} loadingText="Comparing features…">
      {(c) => (
        <div className="space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Feature comparison">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-2">Feature</th>
                  <th scope="col" className="px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2 text-right">Missing</th>
                  <th scope="col" className="px-3 py-2 text-right">Unique</th>
                  <th scope="col" className="px-3 py-2">Summary</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.column} className="border-b border-border align-top">
                    <td dir="auto" className="px-3 py-2 font-medium text-foreground">{i.column}</td>
                    <td className="px-3 py-2">{i.dataType}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatPercent(i.missingPercentage)}</td>
                    <td className="px-3 py-2 text-right font-mono">{i.uniqueCount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {i.numeric
                        ? `mean ${fmt(i.numeric.mean)}, median ${fmt(i.numeric.median)}, std ${fmt(i.numeric.stdDev)}, range ${fmt(i.numeric.min)} to ${fmt(i.numeric.max)}`
                        : i.topCategories.map((t) => `${t.label} ${formatPercent(t.percentage, 0)}`).join(", ") || "no values"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Pairwise comparison">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-2">Pair</th>
                  <th scope="col" className="px-3 py-2">Relationship</th>
                  <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Pearson" help="pearson" /></th>
                  <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Spearman" help="spearman" /></th>
                  <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="n" help="pairedN" /></th>
                  <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="KS D" help="ksDistance" /></th>
                  <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Cramér V" help="cramersV" /></th>
                </tr>
              </thead>
              <tbody>
                {c.pairs.map((p) => (
                  <tr key={`${p.a}-${p.b}`} className="border-b border-border">
                    <td dir="auto" className="px-3 py-2">{p.a} / {p.b}</td>
                    <td className="px-3 py-2">{p.exactDuplicate ? <Badge variant="destructive">exact duplicate</Badge> : <Badge variant="default">{p.kind}</Badge>}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.pearson ? fmt(p.pearson.r, 3) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.spearman ? fmt(p.spearman.r, 3) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.pearson ? p.pearson.n.toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.ksDistance === null ? "—" : fmt(p.ksDistance, 3)}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.cramersV === null ? "—" : fmt(p.cramersV, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notes items={c.pairs.flatMap((p) => p.notes.filter((n) => !n.startsWith("Identical")).map((n) => `${p.a} / ${p.b}: ${n}`))} />
        </div>
      )}
    </AsyncView>
  );
}

export function ComparePanel({ columns }: Props) {
  const usable = useMemo(() => columns.filter((c) => c.dataType !== "empty"), [columns]);
  const [selected, setSelected] = useState<string[]>([]);
  if (usable.length < 2) return <EmptyNote>At least two non-empty columns are needed to compare features.</EmptyNote>;
  const toggle = (name: string) => setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  const ordered = usable.map((c) => c.name).filter((n) => selected.includes(n));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compare features</CardTitle>
          <CardDescription>Select two or more features for a detailed side-by-side comparison.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {usable.map((c) => (
              <li key={c.name}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggle(c.name)} />
                  <span dir="auto" className="truncate" title={c.name}>{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.dataType}</span>
                </label>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" onClick={() => setSelected([])} disabled={selected.length === 0}>Clear selection</Button>
          {ordered.length < 2 ? <EmptyNote>Select at least two features.</EmptyNote> : <Comparison names={ordered} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Redundant and similar features</CardTitle>
          <CardDescription>Exact duplicates are separated from statistical similarity. Features are never removed or merged automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <Relationships />
        </CardContent>
      </Card>
    </div>
  );
}
