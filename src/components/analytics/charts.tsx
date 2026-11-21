import { useState } from "react";
import { cn } from "@lib/utils";
import { formatNumber, formatPercent } from "@/lib/format";
import type { CorrelationCell } from "@/lib/analytics/types";

interface Bin {
  start: number;
  end: number;
  count: number;
  percentage: number;
}

/** Histogram drawn from computed bins. Hover or focus a bar to read its exact range and frequency. */
export function HistogramChart({ bins, unit, className }: { bins: Bin[]; unit?: string; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (bins.length === 0) return null;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const width = 600;
  const height = 220;
  const pad = { top: 12, right: 12, bottom: 34, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const barW = innerW / bins.length;
  const shown = active !== null ? bins[active] : null;
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));

  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Histogram with ${bins.length} bins`}>
        {ticks.map((t) => {
          const y = pad.top + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="currentColor" className="text-border" strokeDasharray="3 3" />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
                {t.toLocaleString()}
              </text>
            </g>
          );
        })}
        {bins.map((b, i) => {
          const h = (b.count / max) * innerH;
          return (
            <rect
              key={i}
              x={pad.left + i * barW + 1}
              y={pad.top + innerH - h}
              width={Math.max(1, barW - 2)}
              height={h}
              rx={2}
              tabIndex={0}
              className={cn("cursor-pointer fill-primary/70 outline-none", active === i && "fill-primary")}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <title>{`${formatNumber(b.start)} to ${formatNumber(b.end)}: ${b.count.toLocaleString()} (${formatPercent(b.percentage)})`}</title>
            </rect>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="currentColor" className="text-border" />
        <text x={pad.left} y={height - 16} className="fill-muted-foreground" fontSize="10">{formatNumber(bins[0].start)}</text>
        <text x={width - pad.right} y={height - 16} textAnchor="end" className="fill-muted-foreground" fontSize="10">{formatNumber(bins[bins.length - 1].end)}</text>
        <text x={pad.left + innerW / 2} y={height - 3} textAnchor="middle" className="fill-muted-foreground" fontSize="10">{unit ?? "Value"} (bin ranges)</text>
        <text transform={`translate(10 ${pad.top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted-foreground" fontSize="10">Frequency</text>
      </svg>
      <figcaption className="min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
        {shown
          ? `${formatNumber(shown.start)} to ${formatNumber(shown.end)}: ${shown.count.toLocaleString()} observations (${formatPercent(shown.percentage)})`
          : "Hover or focus a bar to see its range and frequency."}
      </figcaption>
    </figure>
  );
}

export interface BarItem {
  label: string;
  value: number;
  /** Optional share (0-100) shown next to the count. */
  percentage?: number;
  muted?: boolean;
}

/** Horizontal bar list for categorical frequencies. */
export function BarList({ items, className }: { items: BarItem[]; className?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className={cn("space-y-1.5", className)}>
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} className="grid grid-cols-[minmax(4rem,10rem)_1fr_auto] items-center gap-2 text-sm">
          <span dir="auto" className="truncate text-foreground" title={item.label}>{item.label}</span>
          <div className="h-4 overflow-hidden rounded bg-muted">
            <div
              className={cn("h-full rounded", item.muted ? "bg-muted-foreground/40" : "bg-primary/70")}
              style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }}
              title={`${item.label}: ${item.value.toLocaleString()}${item.percentage !== undefined ? ` (${formatPercent(item.percentage)})` : ""}`}
            />
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {item.value.toLocaleString()}
            {item.percentage !== undefined && ` · ${formatPercent(item.percentage)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars for ordered counts (years, months, days, timeline). */
export function VerticalBars({ points, label, className }: { points: Array<{ label: string; count: number }>; label: string; className?: string }) {
  const max = Math.max(...points.map((p) => p.count), 1);
  const denseStep = Math.ceil(points.length / 12);
  return (
    <figure className={className}>
      <div className="flex h-32 items-end gap-0.5" role="img" aria-label={label}>
        {points.map((p, i) => (
          <div key={`${p.label}-${i}`} className="flex h-full flex-1 flex-col justify-end" title={`${p.label}: ${p.count.toLocaleString()}`}>
            <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(p.count > 0 ? 3 : 0, (p.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-muted-foreground">
        {points.map((p, i) => (
          <span key={`${p.label}-${i}`} className="flex-1 overflow-hidden text-center">{i % denseStep === 0 ? p.label : ""}</span>
        ))}
      </div>
    </figure>
  );
}

function heatColor(r: number | null): string {
  if (r === null) return "transparent";
  const alpha = 0.12 + 0.88 * Math.abs(r);
  return r >= 0 ? `rgba(37, 99, 235, ${alpha.toFixed(3)})` : `rgba(220, 38, 38, ${alpha.toFixed(3)})`;
}

interface HeatmapProps {
  features: string[];
  cells: CorrelationCell[][];
  selected?: [string, string] | null;
  onSelect?: (a: string, b: string) => void;
}

/** Correlation heatmap: blue = positive, red = negative, intensity = |r|. Cells are buttons. */
export function Heatmap({ features, cells, selected, onSelect }: HeatmapProps) {
  const showValues = features.length <= 12;
  return (
    <div className="overflow-x-auto">
      <div
        role="grid"
        aria-label="Correlation matrix"
        className="inline-grid gap-px"
        style={{ gridTemplateColumns: `minmax(5rem,9rem) repeat(${features.length}, minmax(${showValues ? "2.75rem" : "1.5rem"}, 1fr))` }}
      >
        <div />
        {features.map((f) => (
          <div key={`h-${f}`} className="flex items-end justify-center pb-1">
            <span dir="auto" className="max-h-28 truncate text-[11px] text-muted-foreground" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }} title={f}>{f}</span>
          </div>
        ))}
        {features.map((rowName, i) => (
          <div key={`row-${rowName}`} role="row" className="contents">
            <div dir="auto" className="truncate pr-2 text-right text-[11px] text-muted-foreground self-center" title={rowName}>{rowName}</div>
            {features.map((colName, j) => {
              const cell = cells[i][j];
              const isSel = selected && ((selected[0] === rowName && selected[1] === colName) || (selected[0] === colName && selected[1] === rowName));
              const text = cell.r === null ? "—" : cell.r.toFixed(2);
              const title = cell.r === null
                ? `${rowName} / ${colName}: undefined (${cell.reason === "constant" ? "constant column" : cell.reason === "overflow" ? "values too large" : "too few paired observations"}), n = ${cell.n}`
                : `${rowName} / ${colName}: r = ${cell.r.toFixed(3)}, n = ${cell.n}`;
              return (
                <button
                  key={`${rowName}-${colName}`}
                  type="button"
                  role="gridcell"
                  title={title}
                  aria-label={title}
                  disabled={i === j}
                  onClick={() => onSelect?.(rowName, colName)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-sm text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    cell.r === null && "bg-muted text-muted-foreground",
                    cell.r !== null && Math.abs(cell.r) > 0.55 ? "text-white" : "text-foreground",
                    isSel && "ring-2 ring-foreground"
                  )}
                  style={cell.r === null ? undefined : { backgroundColor: heatColor(cell.r) }}
                >
                  {showValues ? text : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
        <span>−1</span>
        <div className="h-2 w-40 rounded" style={{ background: "linear-gradient(90deg, rgba(220,38,38,1), rgba(127,127,127,0.12), rgba(37,99,235,1))" }} />
        <span>+1</span>
      </div>
    </div>
  );
}

/** Scatter plot of paired observations (already sampled by the engine). */
export function ScatterPlot({ points, xLabel, yLabel, className }: { points: Array<[number, number]>; xLabel: string; yLabel: string; className?: string }) {
  if (points.length === 0) return null;
  const width = 480;
  const height = 280;
  const pad = { top: 10, right: 12, bottom: 34, left: 52 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
  const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad.left + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * (width - pad.left - pad.right);
  const sy = (y: number) => height - pad.bottom - (yMax === yMin ? 0.5 : (y - yMin) / (yMax - yMin)) * (height - pad.top - pad.bottom);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-auto w-full", className)} role="img" aria-label={`Scatter plot of ${yLabel} against ${xLabel}`}>
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="currentColor" className="text-border" />
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} stroke="currentColor" className="text-border" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={sx(x)} cy={sy(y)} r={2.5} className="fill-primary/50" />
      ))}
      <text x={pad.left} y={height - 18} fontSize="10" className="fill-muted-foreground">{formatNumber(xMin)}</text>
      <text x={width - pad.right} y={height - 18} fontSize="10" textAnchor="end" className="fill-muted-foreground">{formatNumber(xMax)}</text>
      <text x={pad.left - 6} y={height - pad.bottom} fontSize="10" textAnchor="end" className="fill-muted-foreground">{formatNumber(yMin)}</text>
      <text x={pad.left - 6} y={pad.top + 8} fontSize="10" textAnchor="end" className="fill-muted-foreground">{formatNumber(yMax)}</text>
      <text x={(pad.left + width - pad.right) / 2} y={height - 3} fontSize="11" textAnchor="middle" className="fill-muted-foreground">{xLabel}</text>
      <text transform={`translate(12 ${(height - pad.bottom + pad.top) / 2}) rotate(-90)`} fontSize="11" textAnchor="middle" className="fill-muted-foreground">{yLabel}</text>
    </svg>
  );
}
