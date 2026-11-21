import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Download, RefreshCw } from "lucide-react";
import { useDataset } from "@hooks/useDataset";
import { useAiContext } from "@/hooks/useAiContext";
import { PageHeader } from "@components/common/PageHeader";
import { LoadingState } from "@components/common/LoadingState";
import { DatasetEmptyState } from "@components/datasets/DatasetEmptyState";
import { Markdown } from "@components/common/Markdown";
import { AiAnalysisNote, AiErrorCard, AiPrivacyNote } from "@components/ai/AiNotes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@components/ui/Card";
import { Button } from "@components/ui/Button";
import { generateAiReport } from "@/lib/api";
import { isValidAiReportResponse } from "@/lib/ai/contextBuilder";
import { aiResultStore } from "@/lib/ai/resultStore";
import { copyText, downloadFile } from "@/lib/download";
import { addToast } from "@/lib/toast-state";

const HEADER_DESCRIPTION = "A comprehensive, AI-generated report about your dataset";

export function AIReport() {
  const navigate = useNavigate();
  const { dataset, isLoading, error } = useDataset();
  const { context, ready, analysisFailed, version } = useAiContext();
  const [report, setReport] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const datasetId = dataset?.id;
  useEffect(() => {
    abortRef.current?.abort();
    const cached = datasetId && version ? aiResultStore.get<string>(datasetId, version, "report") : undefined;
    setReport(cached ?? null);
    setStatus(cached ? "ready" : "idle");
    setErrorMessage(null);
  }, [datasetId, version]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(async () => {
    if (!context || !datasetId || !version) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await generateAiReport(context, controller.signal);
      if (controller.signal.aborted) return;
      if (!isValidAiReportResponse(response)) throw new Error("The AI returned an unrecognized report format.");
      aiResultStore.set(datasetId, version, "report", response.report);
      setReport(response.report);
      setStatus("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to generate the AI report.");
    }
  }, [context, datasetId, version]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="AI Report" description={HEADER_DESCRIPTION} />
        <LoadingState text="Loading dataset…" />
      </div>
    );
  }

  if (!dataset || dataset.columns.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="AI Report" description={HEADER_DESCRIPTION} />
        {error && !dataset ? (
          <DatasetEmptyState variant="error" message={error} onRetry={() => navigate("/upload")} onUpload={() => navigate("/upload")} />
        ) : (
          <DatasetEmptyState variant="no-dataset" onUpload={() => navigate("/upload")} />
        )}
      </div>
    );
  }

  const baseName = dataset.filename.replace(/\.[^.]+$/, "") || "dataset";
  const busy = status === "loading";

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Report"
        description={`${dataset.filename} — comprehensive AI-generated analysis`}
        badge={status === "ready" ? "Generated" : undefined}
        badgeVariant="info"
        action={
          status === "ready" ? (
            <Button variant="outline" size="sm" onClick={() => void generate()} disabled={busy || !ready}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate
            </Button>
          ) : undefined
        }
      />

      {status === "error" && <AiErrorCard title="Failed to generate report" message={errorMessage} onRetry={() => void generate()} />}

      {busy && <LoadingState text="Writing the report… this can take up to a minute." />}

      {status === "ready" && report && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Card className="min-w-0 flex-1">
            <CardHeader>
              <CardTitle>Report</CardTitle>
              <CardDescription>Generated from your dataset’s real analytical results.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[70vh] overflow-y-auto p-6">
              <Markdown markdown={report} />
            </CardContent>
          </Card>
          <div className="w-full lg:max-w-sm">
            <Card>
              <CardContent className="space-y-4 p-5">
                <p className="text-sm text-muted-foreground">
                  This report interprets your dataset’s actual profiling, quality and analysis results. It distinguishes
                  measured facts from AI interpretation and never states correlation as proof of causation.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    const ok = await copyText(report);
                    addToast({
                      title: ok ? "Report copied" : "Could not copy",
                      description: ok ? undefined : "Your browser blocked clipboard access. Use Download instead.",
                      variant: ok ? "success" : "destructive",
                      duration: 3000,
                    });
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy report
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => downloadFile(`${baseName}-ai-report.md`, report, "text/markdown;charset=utf-8")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Markdown
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {status === "idle" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Button variant="primary" onClick={() => void generate()} disabled={!ready} className="w-full sm:w-auto">
              Generate AI report
            </Button>
            <AiAnalysisNote preparing={!ready} failed={analysisFailed} />
            <p className="max-w-xl text-sm text-muted-foreground">
              The report includes an executive summary, dataset overview, data-quality observations, statistical findings,
              relationships, anomalies, recommendations, and limitations.
            </p>
            <div className="max-w-xl">
              <AiPrivacyNote />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
