import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading, StatCard } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { loadPlatformUsage } from "@/lib/admin/usage";
import { plans } from "@/lib/billing/service";

const num = (value: number) => value.toLocaleString("sq-AL");
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("sq-AL", { month: "long", year: "numeric", timeZone: "Europe/Tirane" }).format(new Date(`${value}T12:00:00Z`));
const dayLabel = (value: string) =>
  new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", timeZone: "Europe/Tirane" }).format(new Date(`${value}T12:00:00Z`));

export default async function AdminUsagePage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const usage = await loadPlatformUsage();
  const { totals } = usage;
  const perMessage = totals.messages ? Math.round(totals.tokens / totals.messages) : 0;

  return <>
    <PageHeading
      eyebrow="PLATFORMA"
      title="Statistikat"
      description={`Mesazhet AI të numëruara në paketat e klientëve dhe tokenat e OpenAI pas tyre · ${monthLabel(usage.monthStart)}. Tokenat i sheh vetëm administratori.`}
    />
    <div className="stats-grid">
      <StatCard label="Mesazhe AI" value={num(totals.messages)} hint="Përgjigje te klientët dhe te pronarët, këtë muaj" icon="inbox" />
      <StatCard label="Tokena" value={num(totals.tokens)} hint={`${num(totals.calls)} thirrje te OpenAI`} icon="spark" />
      <StatCard label="Tokena për mesazh" value={num(perMessage)} hint="Mesatarja e këtij muaji" icon="billing" />
      <StatCard label="Përdorues aktivë" value={num(totals.activeUsers)} hint="Me mesazhe ose tokena këtë muaj" icon="customers" />
    </div>

    <section className="panel section-pad usage-section" aria-labelledby="usage-users">
      <h2 id="usage-users">Sipas përdoruesit</h2>
      <p className="muted-copy">Përdoruesi që paguan: të gjitha bizneset e tij ndajnë të njëjtën paketë.</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Përdoruesi</th><th>Paketa</th><th>Biznese</th><th>Mesazhe</th><th>Tokena</th><th>Thirrje</th></tr></thead>
          <tbody>
            {usage.users.map((u) => {
              const share = u.limit ? Math.min(100, Math.round((u.messages / u.limit) * 100)) : 0;
              return <tr key={u.userId}>
                <td><strong>{u.name || u.email || u.userId}</strong>{u.name && u.email ? <><br /><small className="muted-copy">{u.email}</small></> : null}</td>
                <td>{plans[u.plan].name}</td>
                <td>{num(u.businesses)}</td>
                <td>{num(u.messages)} / {num(u.limit)} <small className="muted-copy">· {share}%</small></td>
                <td>{num(u.tokens)}</td>
                <td>{num(u.calls)}</td>
              </tr>;
            })}
            {!usage.users.length && <tr><td colSpan={6} className="muted-copy">Ende nuk ka përdorues me paketë.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel section-pad usage-section" aria-labelledby="usage-businesses">
      <h2 id="usage-businesses">Sipas biznesit</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Biznesi</th><th>Paguan</th><th>Mesazhe</th><th>Tokena</th><th>Thirrje</th></tr></thead>
          <tbody>
            {usage.businesses.filter((b) => b.messages || b.tokens).map((b) => (
              <tr key={b.businessId}>
                <td><Link className="soft-link" href={`/b/${b.slug}`}>{b.name}</Link></td>
                <td>{b.billingUserId ? usage.users.find((u) => u.userId === b.billingUserId)?.email ?? "Pronari" : "Biznesi (pa pronar)"}</td>
                <td>{num(b.messages)}</td>
                <td>{num(b.tokens)}</td>
                <td>{num(b.calls)}</td>
              </tr>
            ))}
            {!usage.businesses.some((b) => b.messages || b.tokens) && <tr><td colSpan={5} className="muted-copy">Ende nuk ka konsum këtë muaj.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <div className="usage-columns">
      <section className="panel section-pad usage-section" aria-labelledby="usage-days">
        <h2 id="usage-days">Tokena sipas ditës</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Dita</th><th>Tokena</th><th>Thirrje</th></tr></thead>
            <tbody>
              {[...usage.days].reverse().map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{num(d.tokens)}</td><td>{num(d.calls)}</td></tr>)}
              {!usage.days.length && <tr><td colSpan={3} className="muted-copy">Asnjë thirrje këtë muaj.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel section-pad usage-section" aria-labelledby="usage-models">
        <h2 id="usage-models">Tokena sipas modelit</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Modeli</th><th>Tokena</th><th>Thirrje</th></tr></thead>
            <tbody>
              {usage.models.map((m) => <tr key={m.model}><td>{m.model}</td><td>{num(m.tokens)}</td><td>{num(m.calls)}</td></tr>)}
              {!usage.models.length && <tr><td colSpan={3} className="muted-copy">Asnjë thirrje këtë muaj.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </>;
}
