import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading, StatCard } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadCapabilityHealth, type CapabilityHealth } from "@/lib/tracking/health";
import type { AgentKind } from "@/lib/tracking/capabilities";

export const metadata = { title: "Shëndeti i Agjentit | Agjenti.app" };
const periods = [1, 7, 30] as const;
const agents: Record<AgentKind, string> = { customer: "Agjenti i klientëve", assistant: "Asistenti i biznesit" };
const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const num = (value: number) => value.toLocaleString("sq-AL");
const when = (value: string | null) => value ? new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" }).format(new Date(value)) : "asnjëherë";
const day = (value: string) => new Intl.DateTimeFormat("sq-AL", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Tirane" }).format(new Date(`${value}T12:00:00Z`));

/**
 * Platform Admin: what the agents did and how it ended, per capability, per day, with the reasons for each
 * failure and example conversations; and which capabilities recorded nothing or are not tracked at all.
 */
export default async function AgentHealthPage({ searchParams }: { searchParams: Promise<{ days?: string; business?: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const query = await searchParams;
  const days = periods.find(p => String(p) === query.days) ?? 7;
  const { data: businesses } = await createServiceSupabase().from("businesses").select("id,name,slug").order("name").limit(500);
  const business = businesses?.find(b => b.id === query.business) ?? null;
  const report = await loadCapabilityHealth(days, business?.id ?? null);
  const slugOf = new Map((businesses ?? []).map(b => [b.id, b.slug]));
  const link = (params: Record<string, string | undefined>) => `/admin/health?${new URLSearchParams(Object.entries({ days: String(days), business: business?.id, ...params }).filter((e): e is [string, string] => Boolean(e[1])))}`;

  const heading = <PageHeading eyebrow="PLATFORMA" title="Shëndeti i Agjentit"
    description="Çdo hyrje dhe dalje e aftësive të Agjentit të klientëve dhe të Asistentit: çfarë shkoi mirë, çfarë jo dhe pse. Vetëm bisedat reale, pa Chat Lab." />;
  if (!report.available) return <>{heading}<section className="panel section-pad"><p className="muted-copy">Regjistri i aftësive nuk u lexua. Kontrollo që migrimi 20261119140000_capability_events.sql është ekzekutuar.</p></section></>;

  const total = (agent: AgentKind, key: keyof Pick<CapabilityHealth, "entries" | "success" | "failure" | "handoff" | "abandoned">) =>
    report.health.filter(h => h.agent === agent).reduce((sum, h) => sum + h[key], 0);
  const days7 = [...new Set(report.daily.map(d => d.day))].sort().reverse();
  const dayCount = (d: string, agent: AgentKind, outcome: string) => report.daily.filter(r => r.day === d && r.agent === agent && r.outcome === outcome).reduce((s, r) => s + r.events, 0);

  return <>
    {heading}
    <section className="panel section-pad" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      <span>Periudha:</span>
      {periods.map(p => <Link key={p} className={p === days ? "inline-link" : "muted-copy"} href={link({ days: String(p) })}>{p === 1 ? "24 orët e fundit" : `${p} ditët e fundit`}</Link>)}
      <form action="/admin/health" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="hidden" name="days" value={days} />
        <select className="field" name="business" defaultValue={business?.id ?? ""} aria-label="Biznesi">
          <option value="">Të gjitha bizneset</option>
          {(businesses ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn btn-ghost" type="submit">Shfaq</button>
      </form>
    </section>

    {(["customer", "assistant"] as const).map(agent => {
      const items = report.health.filter(h => h.agent === agent).sort((a, b) => (b.failure + b.success + b.entries) - (a.failure + a.success + a.entries));
      return <section key={agent} className="grid gap-3">
        <h2>{agents[agent]}</h2>
        <div className="stats-grid stats-compact">
          <StatCard label="Hyrje" value={num(total(agent, "entries"))} hint="Aftësi të nisura" icon="spark" />
          <StatCard label="Shkuan mirë" value={num(total(agent, "success"))} hint="Dalje me sukses" icon="orders" />
          <StatCard label="Shkuan keq" value={num(total(agent, "failure"))} hint={`Prej tyre të lëna në mes: ${num(total(agent, "abandoned"))}`} icon="history" />
          {agent === "customer" && <StatCard label="Te stafi" value={num(total(agent, "handoff"))} hint="Biseda të kaluara te një person" icon="inbox" />}
        </div>
        {items.length ? <div className="panel section-pad" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Aftësia</th><th>Hyrje</th><th>Mirë</th><th>Keq</th><th>Stafi</th><th>Pa gjykim</th><th>Suksesi</th><th>Më parë</th><th>Arsyet kryesore</th></tr></thead>
            <tbody>{items.map(item => <tr key={item.capability}>
              <td><strong>{item.label}</strong><br /><small className="muted-copy">{item.capability} · {item.module}</small></td>
              <td>{num(item.entries)}</td><td>{num(item.success)}</td><td>{num(item.failure)}</td><td>{num(item.handoff)}</td><td>{num(item.neutral)}</td>
              <td><strong>{percent(item.rate)}</strong></td>
              <td>{percent(item.previousRate)}{item.rate !== null && item.previousRate !== null && <small className="muted-copy"> ({item.rate >= item.previousRate ? "+" : ""}{Math.round((item.rate - item.previousRate) * 100)})</small>}</td>
              <td>{item.reasons.length ? <ul className="grid gap-1">{item.reasons.slice(0, 4).map(r => <li key={`${r.point}:${r.reason}`}>
                <code>{r.point}{r.reason ? ` · ${r.reason}` : ""}</code> × {num(r.events)}
                {r.examples.map((e, i) => slugOf.get(e.businessId) ? <span key={e.conversationId}> · <Link className="inline-link" href={`/b/${slugOf.get(e.businessId)}/inbox/${e.conversationId}`}>biseda {i + 1}</Link></span> : null)}
              </li>)}</ul> : <span className="muted-copy">—</span>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="muted-copy">Asnjë ngjarje në këtë periudhë.</p>}
      </section>;
    })}

    <section className="panel section-pad grid gap-2">
      <h2>Ditë pas dite</h2>
      {days7.length ? <table className="data-table">
        <thead><tr><th>Dita</th><th>Klientët: mirë</th><th>Klientët: keq</th><th>Klientët: te stafi</th><th>Asistenti: mirë</th><th>Asistenti: keq</th></tr></thead>
        <tbody>{days7.map(d => <tr key={d}><td>{day(d)}</td><td>{num(dayCount(d, "customer", "success"))}</td><td>{num(dayCount(d, "customer", "failure"))}</td>
          <td>{num(dayCount(d, "customer", "handoff"))}</td><td>{num(dayCount(d, "assistant", "success"))}</td><td>{num(dayCount(d, "assistant", "failure"))}</td></tr>)}</tbody>
      </table> : <p className="muted-copy">Asnjë ngjarje në këtë periudhë.</p>}
    </section>

    <section className="panel section-pad grid gap-2">
      <h2>Pa të dhëna në këtë periudhë · {report.silent.length}</h2>
      <p className="muted-copy">Aftësi që ekzistojnë dhe ndiqen, por nuk regjistruan asnjë ngjarje. Mund të mos jenë përdorur, ose diçka i pengon.</p>
      <ul className="grid gap-1">{report.silent.map(s => <li key={s.capability}>{s.label} <small className="muted-copy">· {agents[s.agent]} · {s.capability} · e fundit: {when(s.lastAt)}</small></li>)}</ul>
    </section>

    <section className="panel section-pad grid gap-2">
      <h2>Pa ndjekje · {report.untracked.length}</h2>
      <p className="muted-copy">Aftësi që kodi i njeh, por që nuk regjistrojnë hyrje dhe dalje. Testi i mbulimit dështon kur shtohet një aftësi e re pa ndjekje, ndaj kjo listë duhet të mbetet bosh.</p>
      {report.untracked.length ? <ul>{report.untracked.map(u => <li key={u.capability}>{u.label} <small className="muted-copy">· {u.capability}</small></li>)}</ul> : <p>Të gjitha aftësitë ndiqen.</p>}
    </section>
  </>;
}
