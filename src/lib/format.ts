/** Significant digits shown for statistics: enough to be exact for practical purposes, short enough to read. */
export const SIGNIFICANT_DIGITS = 10;

/**
 * Formats a number for display.
 * - Without `maxFractionDigits` the number keeps up to 10 SIGNIFICANT digits, so small values such as
 *   0.000123456 are not rounded away (a fixed number of decimals would show them as 0.0001) and large
 *   values keep their integer digits. Integers are shown in full with grouping.
 * - With `maxFractionDigits` the fraction is rounded to that many digits (ratios, scores, percentages).
 * - Magnitudes outside [1e-6, 1e15) use exponential notation.
 */
export function formatNumber(value: number | undefined | null, maxFractionDigits?: number, locale?: string): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  if (maxFractionDigits !== undefined) {
    return Number.isInteger(value) ? value.toLocaleString(locale) : value.toLocaleString(locale, { maximumFractionDigits: maxFractionDigits });
  }
  const magnitude = Math.abs(value);
  if (value === 0) return "0";
  if (magnitude >= 1e15 || magnitude < 1e-6) return value.toExponential(SIGNIFICANT_DIGITS - 1).replace(/\.?0+e/, "e");
  if (Number.isInteger(value)) return value.toLocaleString(locale);
  return value.toLocaleString(locale, { maximumSignificantDigits: SIGNIFICANT_DIGITS });
}

export function formatPercent(value: number | undefined | null, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDate(value: Date | string | undefined | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  const iso = d.toISOString();
  return hasTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}
