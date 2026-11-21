import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { LoadingState } from "@components/common/LoadingState";
import { Select } from "@components/ui/Select";
import type { AnalysisState } from "@/hooks/useAnalysis";
import type { AnalysisRequest, AnalysisResultFor } from "@/lib/analytics/types";
import type { ColumnMetadata } from "@/types/dataset.types";

interface AsyncViewProps<R extends AnalysisRequest> {
  state: AnalysisState<R>;
  loadingText?: string;
  children: (data: AnalysisResultFor<R>) => ReactNode;
}

/** Loading, error and result states of one analysis. */
export function AsyncView<R extends AnalysisRequest>({ state, loadingText = "Calculating…", children }: AsyncViewProps<R>) {
  if (state.status === "error") {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <p className="text-sm text-foreground">The analysis failed: {state.error}</p>
      </div>
    );
  }
  if (state.status !== "ready" || state.data === null) {
    return <LoadingState text={loadingText} />;
  }
  return <>{children(state.data)}</>;
}

export function Notes({ items, tone = "muted" }: { items: string[]; tone?: "muted" | "warning" }) {
  if (items.length === 0) return null;
  return (
    <ul className={tone === "warning" ? "space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground" : "space-y-1 text-sm text-muted-foreground"}>
      {items.map((n, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden="true">•</span>
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );
}

interface ColumnSelectProps {
  label: string;
  columns: ColumnMetadata[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}

export function ColumnSelect({ label, columns, value, onChange, placeholder }: ColumnSelectProps) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      options={columns.map((c) => ({ value: c.name, label: `${c.name} (${c.dataType})` }))}
    />
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
