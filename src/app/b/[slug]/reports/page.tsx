import Link from "next/link";
import { PageHeading } from "@/components/dashboard/ui";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { loadBusinessReport } from "@/lib/reports/service";
import { groupDigits, REPORT_RANGES, reportRange, shortDate, summarize, type MetricSummary, type ReportMetric } from "@/lib/reports/model";
import type { ModuleId } from "@/lib/dashboard/modules/types";
import "./reports.css";

const METRICS: { metric: ReportMetric; label: string; hint: string; module?: ModuleId }[] = [
  { metric: "inbound", label: "Mesazhe hyrëse", hint: "Mesazhet që shkruan klientët në kanalet e lidhura." },
  { metric: "aiReplies", label: "Përgjigje të agjentit", hint: "Përgjigjet që agjenti u dërgoi klientëve." },
  { metric: "orders", label: "Porosi", hint: "Porositë e krijuara.", module: "orders" },
  { metric: "bookings", label: "Rezervime", hint: "Rezervimet e krijuara.", module: "bookings" },
  { metric: "customers", label: "Klientë të rinj", hint: "Klientët e regjistruar për herë të parë." },
];

function Change({ summary, range }: { summary: MetricSummary; range: number }) {
  if (summary.change === null) return <span className="report-change">{summary.total ? `S'ka të dhëna për ${range} ditët e mëparshme` : "—"}</span>;
  const tone = summary.change > 0 ? "up" : summary.change < 0 ? "down" : "flat";
  // The arrow carries the direction; the number stays unsigned.
  return <span className={`report-change report-change-${tone}`}>{Math.abs(summary.change)}% {tone === "flat" ? "njësoj si" : "kundrejt"} {range} ditëve të mëparshme</span>;
}

function Bars({ summary, label }: { summary: MetricSummary; label: string }) {
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

export default async function ReportsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { access, profile } = await requireEnabledModule(slug, "reports");
  const query = await searchParams;
  const range = reportRange(typeof query.range === "string" ? query.range : undefined);
  const report = await loadBusinessReport(access.business.id, range);
  const metrics = METRICS.filter((m) => !m.module || profile.enabledModules.includes(m.module));
  const summaries = metrics.map((m) => ({ ...m, summary: summarize(report.days, range, m.metric) }));
  const current = report.days.slice(-range);

  return <>
    <PageHeading title="Raportet" description="Si ka ecur biznesi në kanalet e lidhura, ditë pas dite.">
      <nav className="report-ranges" aria-label="Periudha">
        {REPORT_RANGES.map((r) => (
          <Link key={r} href={`/b/${slug}/reports?range=${r}`} className={r === range ? "is-active" : undefined}
            aria-current={r === range ? "page" : undefined}>{r} ditë</Link>
        ))}
      </nav>
    </PageHeading>

    <section className="report-grid" aria-label={`Numrat e ${range} ditëve të fundit`}>
      {summaries.map(({ metric, label, hint, summary }) => (
        <article key={metric} className="panel report-card">
          <header>
            <h2>{label}</h2>
            <p>{hint}</p>
          </header>
          <strong className="report-total">{groupDigits(summary.total)}</strong>
          <Change summary={summary} range={range} />
          <Bars summary={summary} label={label} />
        </article>
      ))}
      <article className="panel report-card report-card-usage">
        <header>
          <h2>Mesazhe AI këtë muaj</h2>
          <p>Përgjigjet e agjentit dhe të asistentit që ky biznes ka zbritur nga paketa në periudhën aktuale.</p>
        </header>
        <strong className="report-total">{groupDigits(report.aiMessagesThisPeriod)}</strong>
        <Link className="soft-link" href={`/b/${slug}/billing`}>Shiko paketën →</Link>
      </article>
    </section>

    <details className="panel report-table">
      <summary>Shiko numrat sipas ditëve</summary>
      <div className="report-table-scroll">
        <table>
          <thead><tr><th scope="col">Dita</th>{metrics.map((m) => <th scope="col" key={m.metric}>{m.label}</th>)}</tr></thead>
          <tbody>
            {[...current].reverse().map((day) => (
              <tr key={day.day}><th scope="row">{shortDate(day.day)}</th>{metrics.map((m) => <td key={m.metric}>{groupDigits(day[m.metric])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  </>;
}
