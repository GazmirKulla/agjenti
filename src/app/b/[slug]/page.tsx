import { Suspense } from "react";
import Link from "next/link";
import { DashboardLoading } from "@/components/dashboard/loading";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { Overview } from "@/components/dashboard/overview";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { DailyBriefing } from "@/components/business-assistant/daily-briefing";
import { REPORT_METRICS, ReportBars, ReportChange } from "@/components/dashboard/report-parts";
import { loadBusinessReport } from "@/lib/reports/service";
import { groupDigits, summarize } from "@/lib/reports/model";
import "./home.css";

const WEEK = 7;

/** The last seven days of the reports, small, under the day's summary. */
async function WeekReports({ slug, businessId, modules }: { slug: string; businessId: string; modules: string[] }) {
  const report = await loadBusinessReport(businessId, WEEK).catch(() => null);
  if (!report) return null;
  const metrics = REPORT_METRICS.filter((metric) => !metric.module || modules.includes(metric.module));
  return (
    <section className="home-reports" aria-labelledby="home-reports-title">
      <header>
        <h2 id="home-reports-title">7 ditët e fundit</h2>
        <Link className="soft-link" href={`/b/${slug}/reports`}>Të gjitha raportet →</Link>
      </header>
      <div className="report-grid">
        {metrics.map(({ metric, label }) => {
          const summary = summarize(report.days, WEEK, metric);
          return (
            <article key={metric} className="panel report-card">
              <header><h2>{label}</h2></header>
              <strong className="report-total">{groupDigits(summary.total)}</strong>
              <ReportChange summary={summary} range={WEEK} />
              <ReportBars summary={summary} label={label} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Home: the business summary, a combination of the reports. The assistant
 * opens from the header on every page; until the agent is live, the
 * "Gati për klientët" card sits above this. */
export default async function BusinessDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const dashboardProfile = await loadDashboardProfile(access.business.id);
  const reports = dashboardProfile.enabledModules.includes("reports");
  return (
    <div className="home-summary">
      <DailyBriefing slug={access.business.slug} active />
      {reports && (
        <Suspense fallback={<DashboardLoading />}>
          <WeekReports slug={access.business.slug} businessId={access.business.id} modules={dashboardProfile.enabledModules} />
        </Suspense>
      )}
      <details className="assistant-first-home business-hub-overview">
        <summary>Pasqyra e biznesit dhe veprimet manuale</summary>
        <Suspense fallback={<DashboardLoading />}>
          <Overview
            compact
            business={access.business}
            dashboardProfile={dashboardProfile}
          />
        </Suspense>
      </details>
    </div>
  );
}
