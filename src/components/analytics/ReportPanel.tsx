import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/Card";
import { Badge } from "@components/ui/Badge";
import { Button } from "@components/ui/Button";
import { formatPercent } from "@/lib/format";
import { useAnalysis } from "@/hooks/useAnalysis";
import { getDatasetVersion } from "@/lib/analytics/version";
import { reportToMarkdown } from "@/lib/analytics/report";
import type { AnalyticalReport } from "@/lib/analytics/types";
import type { DatasetRecord } from "@/types/dataset.types";
import { AsyncView } from "./shared";
import { fmt } from "./helpers";
import { downloadFile } from "@/lib/download";

interface Props {
  dataset: DatasetRecord;
  target: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ReportView({ report, filename }: { report: AnalyticalReport; filename: string }) {
  const [copied, setCopied] = useState(false);
  const markdown = useMemo(() => reportToMarkdown(report), [report]);
  const o = report.overview;
  const base = filename.replace(/\.[^.]+$/, "") || "dataset";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(markdown);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy as Markdown"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadFile(`${base}-analytical-report.md`, markdown, "text/markdown")}>Download Markdown</Button>
        <Button size="sm" variant="outline" onClick={() => downloadFile(`${base}-analytical-report.json`, JSON.stringify(report, null, 2), "application/json")}>Download JSON</Button>
      </div>

      <Section title="Dataset overview">
        <p className="text-sm text-muted-foreground">
          {o.rows.toLocaleString()} rows × {o.columns} columns — {o.numericColumns} numeric, {o.categoricalColumns} categorical, {o.dateColumns} date, {o.emptyColumns} empty
          {o.completenessPercentage !== null && `; completeness ${formatPercent(o.completenessPercentage)}`}.
        </p>
      </Section>

      <Section title="Numerical features">
        {report.numeric.length === 0 ? (
          <p className="text-sm text-muted-foreground">No numerical features.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Report numerical features">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  {["Column", "Valid", "Missing", "Invalid", "Min", "Max", "Mean", "Median", "Std dev", "Skew"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.numeric.map((s) => (
                  <tr key={s.column} className="border-b border-border font-mono text-xs">
                    <td dir="auto" className="px-3 py-1.5 font-sans text-sm text-foreground">{s.column}</td>
                    <td className="px-3 py-1.5">{s.count.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{s.missingCount.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{s.invalidCount.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{fmt(s.min)}</td>
                    <td className="px-3 py-1.5">{fmt(s.max)}</td>
                    <td className="px-3 py-1.5">{fmt(s.mean)}</td>
                    <td className="px-3 py-1.5">{fmt(s.median)}</td>
                    <td className="px-3 py-1.5">{fmt(s.stdDev)}</td>
                    <td className="px-3 py-1.5">{fmt(s.skewness)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Categorical features">
        {report.categorical.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categorical features.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.categorical.map((c) => (
              <li key={c.column} dir="auto">
                <span className="font-medium text-foreground">{c.column}</span>: {c.uniqueCount.toLocaleString()} distinct ({c.cardinality}), {c.missingCount.toLocaleString()} missing
                {c.mostFrequent && `, most frequent “${c.mostFrequent.label}” (${formatPercent(c.mostFrequent.percentage)})`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Distribution observations">
        {report.distributionObservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing notable.</p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm">{report.distributionObservations.map((x, i) => <li key={i}>{x}</li>)}</ul>
        )}
      </Section>

      <Section title="Outlier candidates (IQR, 1.5 × IQR)">
        {report.outliers.filter((x) => x.count > 0).length === 0 ? (
          <p className="text-sm text-muted-foreground">No outlier candidates.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.outliers.filter((x) => x.count > 0).map((x) => (
              <li key={x.column} dir="auto">
                {x.column}: {x.count.toLocaleString()} ({formatPercent(x.percentage, 2)}) {x.kind === "rare-values" && <Badge variant="warning">rare values: IQR is 0</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Strong correlations (${report.correlationMethod}, |r| ≥ 0.7)`}>
        {report.strongCorrelations.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.strongCorrelations.map((p) => (
              <li key={`${p.a}-${p.b}`} dir="auto">{p.a} / {p.b}: r = {p.r.toFixed(3)} ({p.strength}, n = {p.n.toLocaleString()})</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Correlation does not imply causation.</p>
      </Section>

      <Section title="Class imbalance">
        {!report.classImbalance ? (
          <p className="text-sm text-muted-foreground">No target column selected. Choose one on the Categorical tab to include class imbalance.</p>
        ) : report.classImbalance.ratio === null ? (
          <p className="text-sm">Target “{report.classImbalance.target}”: {report.classImbalance.severity}.</p>
        ) : (
          <p className="text-sm" dir="auto">
            Target “{report.classImbalance.target}”: majority “{report.classImbalance.majority?.label}” ({formatPercent(report.classImbalance.majority?.percentage)}), minority “{report.classImbalance.minority?.label}” ({formatPercent(report.classImbalance.minority?.percentage)}), ratio {fmt(report.classImbalance.ratio, 2)} : 1 ({report.classImbalance.severity}).
          </p>
        )}
      </Section>

      <Section title="Potentially redundant features">
        {report.redundancy.exactDuplicates.length === 0 && report.redundancy.highlyCorrelated.length === 0 ? (
          <p className="text-sm text-muted-foreground">None found.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.redundancy.exactDuplicates.map((g) => <li key={g.columns.join("|")} dir="auto"><Badge variant="destructive">exact duplicates</Badge> {g.columns.join(" = ")}</li>)}
            {report.redundancy.highlyCorrelated.map((p) => <li key={`${p.a}-${p.b}`} dir="auto"><Badge variant="warning">statistically similar</Badge> {p.a} / {p.b} (r = {p.r.toFixed(3)})</li>)}
          </ul>
        )}
      </Section>

      <Section title="Warnings">
        <ul className="space-y-1 text-sm">
          {report.warnings.map((w, i) => (
            <li key={i} className="flex gap-2">
              <Badge variant={w.severity === "warning" ? "warning" : "default"}>{w.severity === "warning" ? "warning" : "note"}</Badge>
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function ReportPanel({ dataset, target }: Props) {
  const targetName = dataset.columns.some((c) => c.name === target && c.dataType !== "empty") ? target : undefined;
  const request = useMemo(
    () => ({
      kind: "report" as const,
      target: targetName,
      meta: {
        datasetId: dataset.id,
        filename: dataset.filename,
        version: getDatasetVersion(dataset),
        completenessPercentage: dataset.profile?.completenessPercentage ?? null,
        truncated: dataset.truncated ?? false,
      },
    }),
    [dataset, targetName]
  );
  const state = useAnalysis(request);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytical report</CardTitle>
        <CardDescription>
          Generated from deterministic calculations on this dataset — no AI-written text. {targetName ? `Target: ${targetName}.` : "No target selected."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AsyncView state={state} loadingText="Generating report…">{(report) => <ReportView report={report} filename={dataset.filename} />}</AsyncView>
      </CardContent>
    </Card>
  );
}
