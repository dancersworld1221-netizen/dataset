import { AlertCircle, Info } from "lucide-react";
import { Button } from "@components/ui/Button";
import { Card, CardContent } from "@components/ui/Card";

/** What leaves the browser when an AI feature is used. Shown next to every AI action. */
export function AiPrivacyNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Only a compact summary is sent to the AI service: file name, column names, statistics, quality issues,
        correlations, and the most frequent values of low-cardinality text columns. Raw rows are never sent.
      </span>
    </p>
  );
}

export function AiErrorCard({ title, message, onRetry }: { title: string; message: string | null; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-destructive">{title}</p>
            {message && <p className="mt-1 text-sm text-destructive/80">{message}</p>}
          </div>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function AiAnalysisNote({ preparing, failed }: { preparing: boolean; failed: boolean }) {
  if (preparing) return <p className="text-xs text-muted-foreground">Preparing the correlation and outlier analysis…</p>;
  if (failed) {
    return (
      <p className="text-xs text-warning">
        The correlation analysis could not be prepared, so the AI will only see per-column statistics.
      </p>
    );
  }
  return null;
}
