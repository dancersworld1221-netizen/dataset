import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Select } from "@components/ui/Select";
import { Input } from "@components/ui/Input";
import { Badge } from "@components/ui/Badge";
import { formatPercent } from "@/lib/format";
import { useAnalysis } from "@/hooks/useAnalysis";
import { ANALYTICS_LIMITS, type BinMethod } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";
import { Metric, MetricLabel } from "./MetricLabel";
import { BarList, HistogramChart, VerticalBars } from "./charts";
import { AsyncView, ColumnSelect, EmptyNote, Notes } from "./shared";
import { fmt, isCategoricalColumn, isDateColumn, isNumericColumn } from "./helpers";

interface Props {
  columns: ColumnMetadata[];
  column: string;
  onColumnChange: (name: string) => void;
}

const METHOD_OPTIONS = [
  { value: "auto", label: "Automatic (Freedman-Diaconis, Sturges fallback)" },
  { value: "freedman-diaconis", label: "Freedman-Diaconis" },
  { value: "sturges", label: "Sturges" },
  { value: "fixed", label: "Fixed number of bins" },
];

const SHAPE_TEXT: Record<string, string> = {
  empty: "no data",
  constant: "constant (single value)",
  "approximately-symmetric": "approximately symmetric",
  "right-skewed": "right-skewed (long tail of large values)",
  "left-skewed": "left-skewed (long tail of small values)",
};

function NumericDistribution({ column }: { column: string }) {
  const [method, setMethod] = useState<BinMethod>("auto");
  const [bins, setBins] = useState(10);
  const request = useMemo(() => ({ kind: "histogram" as const, column, method, bins: method === "fixed" ? bins : undefined }), [column, method, bins]);
  const state = useAnalysis(request);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Bin selection" value={method} onChange={(e) => setMethod(e.target.value as BinMethod)} options={METHOD_OPTIONS} />
        <Input
          label="Number of bins"
          type="number"
          min={1}
          max={ANALYTICS_LIMITS.maxHistogramBins}
          value={bins}
          helperText={`1 to ${ANALYTICS_LIMITS.maxHistogramBins}. Editing this switches to a fixed number of bins.`}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n >= 1) {
              setBins(Math.min(ANALYTICS_LIMITS.maxHistogramBins, n));
              setMethod("fixed");
            }
          }}
        />
      </div>
      <AsyncView state={state} loadingText="Building histogram…">
        {(h) =>
          h.totalIncluded === 0 ? (
            <EmptyNote>No valid numeric observations to plot.</EmptyNote>
          ) : (
            <div className="space-y-4">
              <HistogramChart bins={h.bins} unit={column} />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Metric label="Observations plotted" help="count" value={h.totalIncluded.toLocaleString()} emphasis />
                <Metric label="Missing" help="missing" value={h.missingCount.toLocaleString()} />
                <Metric label="Invalid numeric" help="invalid" value={h.invalidCount.toLocaleString()} />
                <Metric label="Bins" help="Number of bins and the rule that produced it." value={`${h.binCount} (${h.appliedMethod})`} />
                <Metric label="Bin width" help="Width of every bin (equal-width bins)." value={fmt(h.binWidth)} />
                <Metric label="Range" help="range" value={fmt(h.range)} />
                <Metric label="Zero values" help="zeros" value={`${h.zeroCount.toLocaleString()} (${formatPercent(h.zeroPercentage)})`} />
                <Metric label="Positive / negative" help="Counts of values above and below zero." value={`${h.positiveCount.toLocaleString()} / ${h.negativeCount.toLocaleString()}`} />
                <Metric label="Shape" help="Judged from the adjusted skewness: beyond ±0.5 the distribution is called skewed." value={SHAPE_TEXT[h.shape]} />
              </dl>
              <Notes items={h.notes} />
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm" aria-label="Frequency distribution">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th scope="col" className="px-3 py-2">Bin [from, to)</th>
                      <th scope="col" className="px-3 py-2 text-right">Frequency</th>
                      <th scope="col" className="px-3 py-2 text-right">Percentage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.bins.map((b, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {fmt(b.start)} – {fmt(b.end)}{i === h.bins.length - 1 ? " (inclusive)" : ""}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{b.count.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{formatPercent(b.percentage)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td className="px-3 py-1.5">Total</td>
                      <td className="px-3 py-1.5 text-right font-mono">{h.totalIncluded.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right font-mono">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )
        }
      </AsyncView>
    </div>
  );
}

function CategoricalDistribution({ column }: { column: string }) {
  const [topN, setTopN] = useState(10);
  const [rare, setRare] = useState(1);
  const request = useMemo(() => ({ kind: "frequency" as const, column, topN, rareThresholdPercentage: rare }), [column, topN, rare]);
  const state = useAnalysis(request);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Categories shown"
          value={String(topN)}
          onChange={(e) => setTopN(Number(e.target.value))}
          options={[5, 10, 20, 50].map((n) => ({ value: String(n), label: `Top ${n}` }))}
        />
        <Input label="Rare category threshold (%)" type="number" min={0.1} max={50} step={0.5} value={rare} onChange={(e) => setRare(Math.max(0.1, Math.min(50, Number(e.target.value) || 1)))} />
      </div>
      <AsyncView state={state} loadingText="Counting categories…">
        {(f) =>
          f.validCount === 0 ? (
            <EmptyNote>No non-missing values in this column.</EmptyNote>
          ) : (
            <div className="space-y-4">
              <BarList
                items={[
                  ...f.categories.map((c) => ({ label: c.label, value: c.count, percentage: c.percentage })),
                  ...(f.otherCount > 0 ? [{ label: `Other (${f.otherCategoryCount.toLocaleString()} categories)`, value: f.otherCount, percentage: (f.otherCount / f.validCount) * 100, muted: true }] : []),
                ]}
              />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Metric label="Non-missing values" help="count" value={f.validCount.toLocaleString()} emphasis />
                <Metric label="Missing" help="missing" value={f.missingCount.toLocaleString()} />
                <Metric label="Unique categories" help="uniqueCount" value={f.uniqueCount.toLocaleString()} />
                <Metric label="Cardinality" help="cardinality" value={f.cardinality} />
                <Metric label="Most frequent" help="The category with the largest count." value={f.mostFrequent ? `${f.mostFrequent.label} (${formatPercent(f.mostFrequent.percentage)})` : "n/a"} />
                <Metric label="Rare categories" help="rare" value={`${f.rareCategoryTotal.toLocaleString()} (< ${f.rareThresholdPercentage}%)`} />
              </dl>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-medium text-foreground">Least frequent</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {f.leastFrequent.map((c) => (
                      <li key={c.label} dir="auto">{c.label}: {c.count.toLocaleString()} ({formatPercent(c.percentage, 2)})</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-medium text-foreground">Rare categories</h4>
                  {f.rareCategories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None below {f.rareThresholdPercentage}%.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {f.rareCategories.map((c) => (
                        <li key={c.label} dir="auto">{c.label}: {c.count.toLocaleString()} ({formatPercent(c.percentage, 2)})</li>
                      ))}
                      {f.rareCategoryTotal > f.rareCategories.length && <li>and {(f.rareCategoryTotal - f.rareCategories.length).toLocaleString()} more</li>}
                    </ul>
                  )}
                </div>
              </div>
              <Notes items={f.notes} />
            </div>
          )
        }
      </AsyncView>
    </div>
  );
}

function DateDistribution({ column }: { column: string }) {
  const request = useMemo(() => ({ kind: "dateDistribution" as const, column }), [column]);
  const state = useAnalysis(request);
  return (
    <AsyncView state={state} loadingText="Grouping dates…">
      {(d) => (
        <div className="space-y-4">
          <Notes items={d.notes} tone="warning" />
          {d.validCount === 0 ? (
            <EmptyNote>No valid dates could be read from this column.</EmptyNote>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Metric label="Valid dates" help="count" value={d.validCount.toLocaleString()} emphasis />
                <Metric label="Missing" help="missing" value={d.missingCount.toLocaleString()} />
                <Metric label="Not a valid date" help="Non-missing cells that could not be read as a date unambiguously." value={d.invalidCount.toLocaleString()} />
                <Metric label="Earliest" help="Earliest valid date." value={d.earliest ?? "n/a"} />
                <Metric label="Latest" help="Latest valid date." value={d.latest ?? "n/a"} />
                <Metric label="Span" help="Days between the earliest and latest date." value={d.spanDays === null ? "n/a" : `${Math.round(d.spanDays).toLocaleString()} days`} />
              </dl>
              <div>
                <h4 className="mb-2 text-sm font-medium text-foreground">By year</h4>
                <VerticalBars points={d.byYear} label="Observations by year" />
              </div>
              {d.byMonth && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-foreground">By month</h4>
                  <VerticalBars points={d.byMonth} label="Observations by calendar month" />
                </div>
              )}
              {d.byDay && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-foreground">By day of month</h4>
                  <VerticalBars points={d.byDay} label="Observations by day of month" />
                </div>
              )}
              <div>
                <h4 className="mb-2 text-sm font-medium text-foreground">
                  Frequency over time ({d.timelineGranularity === "day" ? "daily" : d.timelineGranularity === "month" ? "monthly" : "yearly"})
                </h4>
                <VerticalBars points={d.timeline} label="Observations over time" />
              </div>
            </>
          )}
        </div>
      )}
    </AsyncView>
  );
}

export function DistributionPanel({ columns, column, onColumnChange }: Props) {
  const usable = useMemo(() => columns.filter((c) => c.dataType !== "empty"), [columns]);
  if (usable.length === 0) return <EmptyNote>Every column is empty.</EmptyNote>;
  const selected = usable.find((c) => c.name === column) ?? usable[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <MetricLabel label="Distribution" help="How the values of the selected column are spread. The view depends on the column type." />
        </CardTitle>
        <CardDescription>
          <Badge variant="info">{selected.dataType}</Badge> Every chart is calculated from the uploaded data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm">
          <ColumnSelect label="Column" columns={usable} value={selected.name} onChange={onColumnChange} />
        </div>
        {isNumericColumn(selected) && <NumericDistribution key={selected.name} column={selected.name} />}
        {isCategoricalColumn(selected) && <CategoricalDistribution key={selected.name} column={selected.name} />}
        {isDateColumn(selected) && <DateDistribution key={selected.name} column={selected.name} />}
      </CardContent>
    </Card>
  );
}
