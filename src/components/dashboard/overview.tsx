import { getDashboardStats } from "@/lib/dashboard/stats";
import Link from "next/link";
import { createServiceSupabase } from "@/lib/supabase/service";
import { Icon } from "./icon";
import {
  EmptyState,
  PageHeading,
  SectionTitle,
  StatCard,
  StatusBadge,
} from "./ui";
import { TrendChart } from "./trend-chart";
import type { DashboardProfile } from "@/lib/dashboard/modules/types";
import { legacyDashboardProfile } from "@/lib/dashboard/profile/legacy";
import { resolveWidgets } from "@/lib/dashboard/widgets/resolver";

export async function Overview({
  business,
  dashboardProfile = legacyDashboardProfile,
  compact = false,
}: {
  business?: { id: string; name: string; slug: string; auto_reply: boolean };
  dashboardProfile?: DashboardProfile;
  compact?: boolean;
}) {
  const db = createServiceSupabase();
  const base = business ? `/b/${business.slug}` : "/admin";
  let recentQuery = db
    .from("conversations")
    .select(
      "id,business_id,last_message_preview,status,customers(display_name,username),businesses(name,slug)",
    )
    .order("last_message_at", { ascending: false })
    .limit(5);
  if (business) recentQuery = recentQuery.eq("business_id", business.id);
  const [stats, recentResult, businessesResult] = await Promise.all([
    getDashboardStats(business?.id),
    recentQuery,
    business
      ? Promise.resolve({ data: null, error: null })
      : db
          .from("businesses")
          .select("id,name,slug,auto_reply")
          .order("created_at", { ascending: false })
          .limit(5),
  ]);
  if (recentResult.error || businessesResult.error)
    throw new Error("Nuk u ngarkuan të dhënat e panelit.");
  const recent = recentResult.data;
  const businesses = businessesResult.data;
  const { agents, paused, trend } = stats;
  const widgets = resolveWidgets(dashboardProfile, stats, {
    business: Boolean(business),
  });
  const primaryActions = dashboardProfile.primaryActions;
  const operationalOverview = <>
      <div className="overview-primary">
        <section className="panel section-pad">
          <SectionTitle title="Biseda dhe aktiviteti" />
          <p className="muted-copy">
            Të krijuara gjatë 7 ditëve të fundit · sipas UTC
          </p>
          <TrendChart data={trend} />
        </section>
        <section className="panel section-pad agent-summary">
          <SectionTitle title="Agjenti AI" />
          <div className="agent-illustration">
            <Icon name="agents" size={66} />
          </div>
          <p className="muted-copy">
            {business
              ? "Agjenti përdor katalogun, njohuritë dhe workflow-t e biznesit për t’iu përgjigjur klientëve."
              : "Ndiq aktivizimin e agjentëve dhe bisedat që janë pauzuar në platformë."}
          </p>
          <div className="summary-line">
            <span>Agjentë aktivë</span>
            <strong className="status-badge status-connected">{agents}</strong>
          </div>
          <div className="summary-line">
            <span>Biseda të pauzuara</span>
            <strong>{paused}</strong>
          </div>
          {business && (
            <div className="summary-line">
              <span>Përgjigje automatike</span>
              <StatusBadge
                status={business.auto_reply ? "connected" : "paused"}
              />
            </div>
          )}
          <Link
            className="soft-link"
            href={`${base}/${business ? "agents" : "businesses"}`}
          >
            {business ? "Konfiguro Agjentin AI" : "Menaxho bizneset"}
            <Icon name="arrow" size={17} />
          </Link>
        </section>
      </div>
      <div className="overview-secondary">
        <section className="panel section-pad">
          <SectionTitle
            title="Bisedat e fundit"
            href={business ? `${base}/inbox` : undefined}
          />
          {recent?.length ? (
            recent.map((c) => {
              const customer = c.customers as unknown as {
                display_name: string | null;
                username: string | null;
              };
              const tenant = c.businesses as unknown as {
                name: string;
                slug: string;
              };
              return (
                <Link
                  className="recent-row"
                  key={c.id}
                  href={`/b/${tenant.slug}/inbox/${c.id}`}
                >
                  <span className="profile-avatar">
                    {(customer?.display_name || customer?.username || "K")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div>
                    <strong>
                      {customer?.display_name ||
                        customer?.username ||
                        "Klient Instagram"}
                    </strong>
                    <p>{c.last_message_preview || "Pa mesazh"}</p>
                    {!business && <small>{tenant.name}</small>}
                  </div>
                  <StatusBadge status={c.status} />
                </Link>
              );
            })
          ) : (
            <EmptyState
              title="Ende nuk ka biseda"
              description="Bisedat do të shfaqen kur të mbërrijnë mesazhet nga Instagram."
            />
          )}
        </section>
        <section className="panel section-pad">
          <SectionTitle
            title={business ? "Veprime të shpejta" : "Bizneset e fundit"}
          />
          {business ? (
            <div className="quick-actions">
              {primaryActions.map((action) => (
                <Link key={action.id} href={`${base}/${action.href}`}>
                  <Icon name={action.icon} size={25} />
                  <span>{action.label}</span>
                  <Icon name="arrow" size={16} />
                </Link>
              ))}
            </div>
          ) : businesses?.length ? (
            businesses.map((b) => (
              <Link className="recent-row" key={b.id} href={`/b/${b.slug}`}>
                <span className="workspace-avatar">{b.name.slice(0, 2)}</span>
                <div>
                  <strong>{b.name}</strong>
                  <p>/{b.slug}</p>
                </div>
                <Icon name="arrow" size={16} />
              </Link>
            ))
          ) : (
            <EmptyState
              title="Nuk ka biznese"
              description="Shto biznesin e parë për të nisur."
            />
          )}
        </section>
      </div>
  </>;
  return (
    <div className="overview-page">
      {!compact && <PageHeading
        eyebrow={business ? "Mirë se erdhe," : "PLATFORMA"}
        title={business ? business.name : "Përmbledhja e platformës"}
        description={
          business
            ? "Ja si po ecën biznesi yt me Agjentin AI."
            : "Bizneset, bisedat dhe porositë në një vend."
        }
      >
        {business && primaryActions[0] && (
          <Link
            className="btn btn-primary"
            href={`${base}/${primaryActions[0].href}`}
          >
            <Icon name={primaryActions[0].icon} size={17} />
            {primaryActions[0].label}
          </Link>
        )}
        {!business && (
          <span className="date-label">
            <Icon name="calendar" size={17} />
            Gjendja aktuale
          </span>
        )}
      </PageHeading>}
      {compact && <h2 className="assistant-overview-title">Biznesi yt sot</h2>}
      <div className="stats-grid">
        {widgets.map((widget) => (
          <StatCard
            key={widget.id}
            label={widget.label}
            value={widget.value}
            hint={widget.hint}
            icon={widget.icon}
            tone={widget.tone}
          />
        ))}
      </div>
      {compact && business && <div className="assistant-attention">
        <span><StatusBadge status={business.auto_reply ? "connected" : "paused"}/> Përgjigjet automatike</span>
        {paused > 0 && <Link href={`${base}/inbox`}>{paused} biseda të pauzuara →</Link>}
        {!business.auto_reply && <Link href={`${base}/agents`}>Rishiko konfigurimin e Agjentit →</Link>}
      </div>}
      {compact ? <details className="assistant-overview-details"><summary>Aktiviteti dhe hollësitë e biznesit</summary>{operationalOverview}</details> : operationalOverview}
    </div>
  );
}
