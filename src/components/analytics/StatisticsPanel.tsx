import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Badge } from "@components/ui/Badge";
import { useAnalysis } from "@/hooks/useAnalysis";
import type { NumericSummary } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";
import { Metric, MetricLabel } from "./MetricLabel";
import { AsyncView, ColumnSelect, EmptyNote, Notes } from "./shared";
import { fmt, isNumericColumn } from "./helpers";

interface Props {
  columns: ColumnMetadata[];
  column: string;
  onColumnChange: (name: string) => void;
}

function modeText(s: NumericSummary): string {
  if (s.modes.length === 0) return "none (no repeated value)";
  const shown = s.modes.slice(0, 3).map((m) => fmt(m)).join(", ");
  return `${shown}${s.modes.length > 3 ? ", …" : ""} (×${s.modeFrequency})`;
}

function Detail({ s }: { s: NumericSummary }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Valid observations" help="count" value={s.count.toLocaleString()} emphasis />
        <Metric label="Missing" help="missing" value={s.missingCount.toLocaleString()} />
        <Metric label="Invalid numeric" help="invalid" value={s.invalidCount.toLocaleString()} />
        <Metric label="Minimum" help="min" value={fmt(s.min)} />
        <Metric label="Maximum" help="max" value={fmt(s.max)} />
        <Metric label="Range" help="range" value={fmt(s.range)} />
        <Metric label="Sum" help="sum" value={fmt(s.sum)} />
        <Metric label="Mean" help="mean" value={fmt(s.mean)} emphasis />
        <Metric label="Median (Q2)" help="median" value={fmt(s.median)} emphasis />
        <Metric label="Mode" help="mode" value={modeText(s)} />
        <Metric label="Variance (sample)" help="variance" value={fmt(s.variance)} />
        <Metric label="Std deviation (sample)" help="stdDev" value={fmt(s.stdDev)} emphasis />
        <Metric label="Variance (population)" help="populationVariance" value={fmt(s.populationVariance)} />
        <Metric label="Std deviation (population)" help="populationStdDev" value={fmt(s.populationStdDev)} />
        <Metric label="Q1" help="q1" value={fmt(s.q1)} />
        <Metric label="Q3" help="q3" value={fmt(s.q3)} />
        <Metric label="IQR" help="iqr" value={fmt(s.iqr)} />
        <Metric label="MAD" help="mad" value={fmt(s.mad)} />
        <Metric label="Coefficient of variation" help="cv" value={fmt(s.coefficientOfVariation)} />
        <Metric label="Skewness" help="skewness" value={fmt(s.skewness)} />
        <Metric label="Excess kurtosis" help="kurtosis" value={fmt(s.excessKurtosis)} />
        <Metric label="Zeros" help="zeros" value={s.zeroCount.toLocaleString()} />
        <Metric label="Positive" help="positive" value={s.positiveCount.toLocaleString()} />
        <Metric label="Negative" help="negative" value={s.negativeCount.toLocaleString()} />
      </dl>
      <Notes items={s.warnings} tone="warning" />
      <p className="text-xs text-muted-foreground">
        Variance and standard deviation are SAMPLE statistics (divisor n − 1); population versions (divisor n) are listed separately. Quantiles use linear interpolation (type 7). Nothing is rounded before display.
      </p>
    </div>
  );
}

export function StatisticsPanel({ columns, column, onColumnChange }: Props) {
  const numeric = useMemo(() => columns.filter(isNumericColumn), [columns]);
  const state = useAnalysis(numeric.length > 0 ? ({ kind: "numericSummary" } as const) : null);

  if (numeric.length === 0) return <EmptyNote>This dataset has no numerical columns.</EmptyNote>;
  const selected = numeric.some((c) => c.name === column) ? column : numeric[0].name;

  return (
    <AsyncView state={state} loadingText="Calculating statistics…">
      {(summaries) => {
        const current = summaries.find((s) => s.column === selected) ?? summaries[0];
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Descriptive statistics</CardTitle>
                <CardDescription>Calculated from the valid numeric observations of the selected column.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-sm">
                  <ColumnSelect label="Column" columns={numeric} value={current.column} onChange={onColumnChange} />
                </div>
                <Detail s={current} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>All numerical columns</CardTitle>
                <CardDescription>Select a row to inspect it above.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Numerical columns summary">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th scope="col" className="px-3 py-2">Column</th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Valid" help="count" /></th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Missing" help="missing" /></th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Invalid" help="invalid" /></th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Mean" help="mean" /></th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Median" help="median" /></th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Std dev" help="stdDev" /></th>
                        <th scope="col" className="px-3 py-2 text-right"><MetricLabel label="Skew" help="skewness" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map((s) => (
                        <tr key={s.column} className={s.column === current.column ? "border-b border-border bg-primary/5" : "border-b border-border"}>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => onColumnChange(s.column)} className="text-left font-medium text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              {s.column}
                            </button>
                            {s.invalidCount > 0 && <Badge variant="warning" className="ml-2">invalid values</Badge>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{s.count.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.missingCount.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.invalidCount.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(s.mean)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(s.median)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(s.stdDev)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(s.skewness)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }}
    </AsyncView>
  );
}
