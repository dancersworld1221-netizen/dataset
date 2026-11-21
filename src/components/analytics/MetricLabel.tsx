import { Info } from "lucide-react";
import { Tooltip } from "@components/ui/Tooltip";
import { cn } from "@lib/utils";
import { METRIC_HELP } from "./metricHelp";

interface MetricLabelProps {
  label: string;
  /** Key in METRIC_HELP, or a custom explanation. */
  help: string;
  className?: string;
}

export function MetricLabel({ label, help, className }: MetricLabelProps) {
  const text = METRIC_HELP[help] ?? help;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {label}
      <Tooltip content={text}>
        <span tabIndex={0} role="img" aria-label={`${label}: ${text}`} className="cursor-help text-muted-foreground/70 hover:text-foreground">
          <Info className="h-3 w-3" aria-hidden="true" />
        </span>
      </Tooltip>
    </span>
  );
}

interface MetricProps {
  label: string;
  help: string;
  value: string;
  emphasis?: boolean;
}

export function Metric({ label, help, value, emphasis }: MetricProps) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <dt className="text-xs text-muted-foreground">
        <MetricLabel label={label} help={help} />
      </dt>
      <dd className={cn("mt-1 font-mono text-sm text-foreground", emphasis && "text-base font-semibold")}>{value}</dd>
    </div>
  );
}
