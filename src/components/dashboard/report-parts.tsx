import { groupDigits, shortDate, type MetricSummary, type ReportMetric } from "@/lib/reports/model";
import type { ModuleId } from "@/lib/dashboard/modules/types";
import "@/app/b/[slug]/reports/reports.css";

/** The report cards' pieces, shared by the Raportet page and the Home summary. */
export const REPORT_METRICS: { metric: ReportMetric; label: string; hint: string; module?: ModuleId }[] = [
  { metric: "inbound", label: "Mesazhe hyrëse", hint: "Mesazhet që shkruan klientët në kanalet e lidhura." },
  { metric: "aiReplies", label: "Përgjigje të agjentit", hint: "Përgjigjet që agjenti u dërgoi klientëve." },
  { metric: "orders", label: "Porosi", hint: "Porositë e krijuara.", module: "orders" },
  { metric: "bookings", label: "Rezervime", hint: "Rezervimet e krijuara.", module: "bookings" },
  { metric: "customers", label: "Klientë të rinj", hint: "Klientët e regjistruar për herë të parë." },
];

export function ReportChange({ summary, range }: { summary: MetricSummary; range: number }) {
  if (summary.change === null) return <span className="report-change">{summary.total ? `S'ka të dhëna për ${range} ditët e mëparshme` : "—"}</span>;
  const tone = summary.change > 0 ? "up" : summary.change < 0 ? "down" : "flat";
  // The arrow carries the direction; the number stays unsigned.
  return <span className={`report-change report-change-${tone}`}>{Math.abs(summary.change)}% {tone === "flat" ? "njësoj si" : "kundrejt"} {range} ditëve të mëparshme</span>;
}

export function ReportBars({ summary, label }: { summary: MetricSummary; label: string }) {
  const max = Math.max(1, ...summary.days.map((d) => d.value));
  const first = summary.days[0]?.day;
  const last = summary.days.at(-1)?.day;
  return (
    <figure className="report-chart">
      <div className={`report-bars${summary.days.length > 31 ? " report-bars-dense" : ""}`} role="img"
        aria-label={`${label}: ${groupDigits(summary.total)} gjithsej, sipas ditëve`}>
        {summary.days.map((d) => (
          <span key={d.day} className="report-col" title={`${shortDate(d.day)}: ${groupDigits(d.value)}`}>
            <span className="report-bar" style={{ height: d.value ? `${Math.max(4, (d.value / max) * 100)}%` : 0 }} />
          </span>
        ))}
      </div>
      {first && last && <figcaption className="report-axis"><span>{shortDate(first)}</span><span>{summary.total ? `maks. ${groupDigits(max)} në ditë` : "Asnjë në këtë periudhë"}</span><span>{shortDate(last)}</span></figcaption>}
    </figure>
  );
}

