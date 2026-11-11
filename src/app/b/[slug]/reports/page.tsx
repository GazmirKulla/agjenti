import Link from "next/link";
import { PageHeading } from "@/components/dashboard/ui";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { loadBusinessReport } from "@/lib/reports/service";
import { groupDigits, REPORT_RANGES, reportRange, shortDate, summarize } from "@/lib/reports/model";
import { REPORT_METRICS as METRICS, ReportBars as Bars, ReportChange as Change } from "@/components/dashboard/report-parts";
import "./reports.css";

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
