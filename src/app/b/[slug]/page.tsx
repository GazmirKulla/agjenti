import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { Icon } from "@/components/dashboard/icon";
import { loadHomeSummary } from "@/lib/home/summary";
import { HOME_PERIOD_LABELS, HOME_PERIODS, homePeriod, type HomeMessages } from "@/lib/home/model";
import { groupDigits, shortDate } from "@/lib/reports/model";
import "./home.css";

function MessagesCard({ messages, href, period }: { messages: HomeMessages; href: string; period: string }) {
  const max = Math.max(1, ...messages.days.map((day) => day.value));
  const parts = [`${groupDigits(messages.agentReplies)} përgjigje nga Agjenti`, messages.handoffs ? `${groupDigits(messages.handoffs)} te stafi tani` : ""].filter(Boolean);
  return (
    <Link href={href} className="panel home-messages">
      <div className="home-card-main">
        <span className="home-card-label"><Icon name="inbox" size={16} />Mesazhe hyrëse · {period}</span>
        <strong className="home-card-value">{groupDigits(messages.inbound)}</strong>
        <span className="home-card-detail">{parts.join(" · ")}</span>
      </div>
      {messages.days.length > 0 && (
        <div className="home-bars" role="img" aria-label={`Mesazhe hyrëse sipas ditëve, deri në ${groupDigits(max)} në ditë`}>
          {messages.days.map((day) => (
            <span key={day.day} title={`${shortDate(day.day)}: ${groupDigits(day.value)}`}>
              <span style={{ height: day.value ? `${Math.max(6, (day.value / max) * 100)}%` : 0 }} />
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

/** Kreu: what is happening in the business. Incoming messages, then one card
 * per module that is on: its count, what was added in the period and one
 * thing to act on. The assistant opens from the header; until the agent is
 * live, the "Gati për klientët" card sits above this. */
export default async function BusinessDashboard({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const period = homePeriod((await searchParams).period);
  const profile = await loadDashboardProfile(access.business.id);
  const summary = await loadHomeSummary(access.business, profile.enabledModules, period);
  const base = `/b/${encodeURIComponent(access.business.slug)}`;
  const label = HOME_PERIOD_LABELS[period].toLowerCase();

  return (
    <div className="home-summary">
      <header className="home-head">
        <div>
          <h1>Përmbledhja e biznesit</h1>
          <p>Çfarë po ndodh në {access.business.name}.</p>
        </div>
        <nav className="home-periods" aria-label="Periudha">
          {HOME_PERIODS.map((value) => (
            <Link key={value} href={value === "today" ? base : `${base}?period=${value}`} aria-current={value === period ? "page" : undefined}
              className={value === period ? "is-active" : undefined}>{HOME_PERIOD_LABELS[value]}</Link>
          ))}
        </nav>
      </header>
      {summary.messages && <MessagesCard messages={summary.messages} href={`${base}/inbox`} period={label} />}
      {summary.cards.length > 0 && (
        <section className="home-cards" aria-label="Modulet">
          {summary.cards.map((card) => (
            <article key={card.id} className="panel home-card">
              <Link href={card.href} className="home-card-main">
                <span className="home-card-label"><Icon name={card.icon} size={16} />{card.label}</span>
                <strong className="home-card-value">{groupDigits(card.value)}</strong>
                <span className="home-card-detail">
                  {card.caption}
                  {card.detail ? <> · <span className={card.detailTone === "up" ? "is-up" : undefined}>{card.detail}</span></> : null}
                </span>
              </Link>
              {card.attention && <Link href={card.attention.href} className={`home-card-attention is-${card.attention.tone}`}>{card.attention.text} →</Link>}
            </article>
          ))}
        </section>
      )}
      {!summary.messages && !summary.cards.length && <p className="muted-copy">Asnjë modul nuk është aktiv. Zgjidh modulet te Cilësimet.</p>}
    </div>
  );
}
