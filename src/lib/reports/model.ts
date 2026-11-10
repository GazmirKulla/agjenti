/** Daily numbers of one business, as returned by the business_report function. */
export type ReportDay = { day: string; inbound: number; aiReplies: number; orders: number; bookings: number; customers: number };
export type ReportMetric = Exclude<keyof ReportDay, "day">;
export type MetricSummary = { metric: ReportMetric; total: number; previous: number; change: number | null; days: { day: string; value: number }[] };

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export function reportRange(value: string | undefined): ReportRange {
  const n = Number(value);
  return (REPORT_RANGES as readonly number[]).includes(n) ? (n as ReportRange) : 30;
}

/** Splits the 2×range days into the current period (last `range` days) and the
 * one before it, and sums each. `change` is null when there is nothing to compare. */
export function summarize(days: ReportDay[], range: number, metric: ReportMetric): MetricSummary {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const current = sorted.slice(-range);
  const before = sorted.slice(-range * 2, -range);
  const total = current.reduce((sum, day) => sum + day[metric], 0);
  const previous = before.reduce((sum, day) => sum + day[metric], 0);
  return {
    metric, total, previous,
    change: previous > 0 ? Math.round(((total - previous) / previous) * 100) : null,
    days: current.map((day) => ({ day: day.day, value: day[metric] })),
  };
}

/** "2026-11-09" → "09.11", the same on the server and in every browser. */
export function shortDate(day: string) {
  const [, month, date] = day.split("-");
  return `${date}.${month}`;
}

export function groupDigits(value: number) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
