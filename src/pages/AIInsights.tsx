import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useDataset } from "@hooks/useDataset";
import { useAiContext } from "@/hooks/useAiContext";
import { PageHeader } from "@components/common/PageHeader";
import { LoadingState } from "@components/common/LoadingState";
import { DatasetEmptyState } from "@components/datasets/DatasetEmptyState";
import { AiAnalysisNote, AiErrorCard, AiPrivacyNote } from "@components/ai/AiNotes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@components/ui/Card";
import { Badge } from "@components/ui/Badge";
import { Button } from "@components/ui/Button";
import { generateAiInsights, generateAiRecommendations } from "@/lib/api";
import { aiResultStore } from "@/lib/ai/resultStore";
import { isValidAiInsightsResponse, isValidAiRecommendationsResponse } from "@/lib/ai/contextBuilder";
import type { AiInsight, AiInsightsResponse, AiRecommendation, AiRecommendationsResponse } from "@/types";

const HEADER_DESCRIPTION = "AI-generated insights grounded in your dataset’s real analytical results";

interface InsightsResult {
  insights: AiInsightsResponse | null;
  recommendations: AiRecommendationsResponse | null;
  /** Set when only one of the two requests succeeded. */
  warning: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  statistical: "Statistical",
  "data-quality": "Data quality",
  correlation: "Correlation",
  anomaly: "Anomaly",
  business: "Business",
};

const CATEGORY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  statistical: "default",
  "data-quality": "warning",
  correlation: "info",
  anomaly: "destructive",
  business: "success",
};

function SeverityBadge({ severity }: { severity: AiInsight["severity"] }) {
  const variant: BadgeProps["variant"] =
    severity === "high" ? "destructive" : severity === "medium" ? "warning" : "info";
  return <Badge variant={variant}>{severity}</Badge>;
}

interface BadgeProps {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
}

function EvidenceItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground" title={String(value)}>
        {String(value)}
      </span>
    </div>
  );
}

export function AIInsights() {
  const navigate = useNavigate();
  const { dataset, isLoading, error } = useDataset();
  const { context, ready, analysisFailed, version } = useAiContext();
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const datasetId = dataset?.id;
  // Results of an earlier visit are shown again; they are discarded automatically when the data changes.
  useEffect(() => {
    abortRef.current?.abort();
    const cached = datasetId && version ? aiResultStore.get<InsightsResult>(datasetId, version, "insights") : undefined;
    setResult(cached ?? null);
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

    const [insightsOutcome, recommendationsOutcome] = await Promise.allSettled([
      generateAiInsights(context, controller.signal),
      generateAiRecommendations(context, controller.signal),
    ]);
    if (controller.signal.aborted) return;

    const insights =
      insightsOutcome.status === "fulfilled" && isValidAiInsightsResponse(insightsOutcome.value) ? insightsOutcome.value : null;
    const recommendations =
      recommendationsOutcome.status === "fulfilled" && isValidAiRecommendationsResponse(recommendationsOutcome.value)
        ? recommendationsOutcome.value
        : null;

    if (!insights && !recommendations) {
      const reason = insightsOutcome.status === "rejected" ? insightsOutcome.reason : recommendationsOutcome.status === "rejected" ? recommendationsOutcome.reason : null;
      setStatus("error");
      setErrorMessage(reason instanceof Error ? reason.message : "The AI returned an unrecognized format.");
      return;
    }
    const warning = !insights
      ? "The insights could not be generated; only recommendations are shown."
      : !recommendations
        ? "The recommendations could not be generated; only insights are shown."
        : null;
    const next: InsightsResult = { insights, recommendations, warning };
    aiResultStore.set(datasetId, version, "insights", next);
    setResult(next);
    setStatus("ready");
  }, [context, datasetId, version]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="AI Insights" description={HEADER_DESCRIPTION} />
        <LoadingState text="Loading dataset…" />
      </div>
    );
  }

  if (!dataset || dataset.columns.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="AI Insights" description={HEADER_DESCRIPTION} />
        {error && !dataset ? (
          <DatasetEmptyState variant="error" message={error} onRetry={() => navigate("/upload")} onUpload={() => navigate("/upload")} />
        ) : (
          <DatasetEmptyState variant="no-dataset" onUpload={() => navigate("/upload")} />
        )}
      </div>
    );
  }

  const insights: AiInsight[] | null = result?.insights?.insights ?? null;
  const recommendations: AiRecommendation[] | null = result?.recommendations?.recommendations ?? null;
  const summary = result?.insights?.summary ?? null;
  const limitations = result?.insights?.limitations ?? null;
  const insightCount = insights?.length ?? 0;
  const highSeverityCount = insights?.filter((i) => i.severity === "high").length ?? 0;
  const busy = status === "loading";

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Insights"
        description={`${dataset.filename} — ${dataset.recordCount.toLocaleString()} records × ${dataset.columnCount} columns`}
        badge={status === "ready" ? `${insightCount} insight${insightCount !== 1 ? "s" : ""}` : undefined}
        badgeVariant={highSeverityCount > 0 ? "destructive" : "info"}
        action={
          status === "ready" ? (
            <Button variant="outline" size="sm" onClick={() => void generate()} disabled={busy || !ready}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Insights generated</p>
            <p className="text-2xl font-bold text-foreground">{insightCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">High severity</p>
            <p className="text-2xl font-bold text-foreground">{highSeverityCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Columns analysed</p>
            <p className="text-2xl font-bold text-foreground">{dataset.columnCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <p className="text-2xl font-bold text-foreground">
              {status === "ready" ? "Ready" : status === "error" ? "Error" : busy ? "Working…" : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {status === "error" && <AiErrorCard title="Failed to generate insights" message={errorMessage} onRetry={() => void generate()} />}

      {result?.warning && <p className="text-sm text-warning">{result.warning}</p>}

      {status === "ready" && summary && (
        <Card>
          <CardHeader>
            <CardTitle>Overall summary</CardTitle>
            <CardDescription>AI interpretation of the dataset, grounded in real analytical results.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground" dir="auto">{summary}</p>
          </CardContent>
        </Card>
      )}

      {(busy || insights) && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Insights</h3>
          {busy ? (
            <LoadingState text="Generating AI insights…" />
          ) : insights && insights.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No insights were generated for this dataset.</p>
          ) : insights ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {limitations && limitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Limitations</CardTitle>
            <CardDescription>Known analytical limitations to keep in mind.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {limitations.map((limitation, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  {limitation}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {status === "ready" && recommendations && recommendations.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Recommendations</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((rec) => (
              <RecommendationCard key={rec.id} recommendation={rec} />
            ))}
          </div>
        </div>
      )}

      {status === "idle" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Button variant="primary" onClick={() => void generate()} disabled={!ready}>
              Generate AI insights
            </Button>
            <AiAnalysisNote preparing={!ready} failed={analysisFailed} />
            <div className="max-w-xl">
              <AiPrivacyNote />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: AiInsight }) {
  return (
    <Card className="hover:border-primary/20 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <Badge variant={CATEGORY_VARIANT[insight.category] ?? "default"} className="text-xs">
            {CATEGORY_LABEL[insight.category] ?? insight.category}
          </Badge>
          <SeverityBadge severity={insight.severity} />
        </div>
        <h4 className="font-semibold text-foreground">{insight.title}</h4>
        <p className="mt-2 text-sm text-foreground leading-relaxed">{insight.description}</p>
        {insight.evidence.length > 0 && (
          <div className="mt-4 space-y-1">
            {insight.evidence.map((item, i) => (
              <EvidenceItem key={i} label={item.label} value={item.value} />
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border flex items-start gap-2">
          <p className="text-xs font-medium text-muted-foreground shrink-0">Recommended next step:</p>
          <p className="text-sm text-foreground flex-1">{insight.recommendation}</p>
          <Badge variant="outline" className="ml-auto shrink-0 text-xs">
            Confidence: {insight.confidence}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationCard({ recommendation }: { recommendation: AiRecommendation }) {
  const variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" =
    recommendation.priority === "high" ? "destructive" : recommendation.priority === "medium" ? "warning" : "info";
  return (
    <Card className="hover:border-primary/20 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <Badge variant={variant} className="text-xs">
            {recommendation.priority} priority
          </Badge>
        </div>
        <h4 className="font-semibold text-foreground">{recommendation.title}</h4>
        <p className="mt-2 text-sm text-foreground leading-relaxed">{recommendation.explanation}</p>
        <p className="mt-3 text-xs font-medium text-foreground">Why: {recommendation.reason}</p>
        {recommendation.evidence.length > 0 && (
          <div className="mt-3 space-y-1">
            {recommendation.evidence.map((item, i) => (
              <EvidenceItem key={i} label={item.label} value={item.value} />
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border text-sm">
          <p className="text-foreground">{recommendation.suggestedNextStep}</p>
        </div>
      </CardContent>
    </Card>
  );
}

