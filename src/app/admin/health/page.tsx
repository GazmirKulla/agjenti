import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadAttention, loadCapabilityHealth, loadRecentFailures, type CapabilityHealth } from "@/lib/tracking/health";
import { capabilityName, exitLabel, failureKind, failureKindLabels, groupOf, moduleLabels } from "@/lib/tracking/labels";
import { capabilities } from "@/lib/tracking/capabilities";
import type { AgentKind } from "@/lib/tracking/capabilities";
import { HealthTabs } from "./tabs";
import s from "./health.module.css";

export const metadata = { title: "Shëndeti i Agjentit | Agjenti.app" };
const periods = [1, 7, 30] as const;
const agents: Record<AgentKind, { title: string; hint: string }> = {
  customer: { title: "Agjenti i klientëve", hint: "Bisedat me klientët në Instagram dhe WhatsApp" },
  assistant: { title: "Asistenti i biznesit", hint: "Kërkesat e pronarëve te paneli" },
  system: { title: "Platforma", hint: "Punët në sfond dhe integrimet: Instagram, WhatsApp, Google, POK" },
};
const num = (value: number) => value.toLocaleString("sq-AL");
const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const when = (value: string | null) => value ? new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" }).format(new Date(value)) : "asnjëherë";
const dayShort = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", timeZone: "Europe/Tirane" }).format(new Date(`${value}T12:00:00Z`));

const Legend = ({ handoff = true }: { handoff?: boolean }) => <div className={s.legend} aria-label="Legjenda">
  <span><i className={`${s.swatch} ${s.success}`} />Shkoi mirë</span>
  <span><i className={`${s.swatch} ${s.failure}`} />Shkoi keq</span>
  {handoff && <span><i className={`${s.swatch} ${s.handoff}`} />Te stafi</span>}
  <span><i className={`${s.swatch} ${s.neutral}`} />Pa gjykim: mbaroi pa rezultat për t’u gjykuar (p.sh. pa përgjigje sepse përgjigjet automatike janë të fikura, ose një propozim që pret konfirmim)</span>
</div>;

/** Outcomes as one bar: each segment sized by its count, with the figures as hover text. */
function OutcomeBar({ item }: { item: Pick<CapabilityHealth, "success" | "failure" | "handoff" | "neutral"> }) {
  const parts = [["success", item.success, "Mirë"], ["failure", item.failure, "Keq"], ["handoff", item.handoff, "Te stafi"], ["neutral", item.neutral, "Pa gjykim"]] as const;
  const total = parts.reduce((sum, [, n]) => sum + n, 0);
  const text = parts.map(([, n, label]) => `${label} ${num(n)}`).join(" · ");
  return <div className={`${s.bar} ${total ? "" : s.barEmpty}`} title={total ? text : "Asnjë dalje"} role="img" aria-label={total ? text : "Asnjë dalje"}>
    {parts.filter(([, n]) => n > 0).map(([key, n]) => <i key={key} className={s[key]} style={{ flexGrow: n }} />)}
  </div>;
}

/** Stacked daily columns for one agent: good, bad and to staff; hover a day for its figures. */
function DailyChart({ days, value }: { days: string[]; value: (day: string, outcome: string) => number }) {
  const W = 720, H = 180, top = 14, bottom = 26, left = 8;
  const totals = days.map(d => value(d, "success") + value(d, "failure") + value(d, "handoff"));
  const max = Math.max(1, ...totals);
  const step = (W - left * 2) / Math.max(days.length, 1), width = Math.min(36, step * 0.6);
  const y = (n: number) => (H - bottom - top) * n / max;
  return <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rezultatet ditë pas dite">
    <line className="gridline" x1={0} x2={W} y1={top} y2={top} />
    <text x={W - 4} y={top - 3} textAnchor="end">{num(max)}</text>
    <line className="axis" x1={0} x2={W} y1={H - bottom} y2={H - bottom} />
    {days.map((d, i) => {
      const x = left + i * step + (step - width) / 2;
      let base = H - bottom;
      const segments = (["success", "failure", "handoff"] as const).map(outcome => {
        const height = y(value(d, outcome)); base -= height;
        return height > 0 ? <rect key={outcome} className={outcome[0]} x={x} y={base + 1} width={width} height={Math.max(height - 2, 1)} rx={3} /> : null;
      });
      return <g key={d}>
        <title>{`${dayShort(d)} · Mirë ${num(value(d, "success"))} · Keq ${num(value(d, "failure"))} · Te stafi ${num(value(d, "handoff"))}`}</title>
        <rect className="hit" x={left + i * step} y={top} width={step} height={H - bottom - top} />
        {segments}
        {(days.length <= 10 || i % Math.ceil(days.length / 10) === 0) && <text x={x + width / 2} y={H - 8} textAnchor="middle">{dayShort(d)}</text>}
      </g>;
    })}
  </svg>;
}

/**
 * Platform Admin: what the agents did and how it ended. Per agent a headline success rate, per day a chart,
 * per module the capabilities with their outcomes, reasons and example conversations; then the capabilities
 * that recorded nothing and the ones not tracked at all.
 */
export default async function AgentHealthPage({ searchParams }: { searchParams: Promise<{ days?: string; business?: string; outcome?: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const query = await searchParams;
  const failuresOnly = query.outcome === "failure";
  const days = periods.find(p => String(p) === query.days) ?? 7;
  const { data: businesses } = await createServiceSupabase().from("businesses").select("id,name,slug").order("name").limit(500);
  const business = businesses?.find(b => b.id === query.business) ?? null;
  const [report, failures, attention] = await Promise.all([loadCapabilityHealth(days, business?.id ?? null), loadRecentFailures(days, business?.id ?? null), loadAttention(business?.id ?? null)]);
  const nameOf = new Map((businesses ?? []).map(b => [b.id, b.name]));
  const slugOf = new Map((businesses ?? []).map(b => [b.id, b.slug]));
  const link = (params: Record<string, string | undefined>) => `/admin/health?${new URLSearchParams(Object.entries({ days: String(days), business: business?.id, outcome: failuresOnly ? "failure" : undefined, ...params }).filter((e): e is [string, string] => Boolean(e[1])))}`;

  const heading = <PageHeading eyebrow="PLATFORMA" title="Shëndeti i Agjentit"
    description="Çfarë bënë agjentët, si përfundoi dhe pse. Vetëm bisedat reale, pa Chat Lab. Kërkesat që nisin dhe nuk vazhdojnë shënohen “të lëna në mes” pas 24 orësh." />;
  if (!report.available) return <div className={s.page}>{heading}<HealthTabs current="health" /><section className="panel section-pad"><p className="muted-copy">Regjistri i aftësive nuk u lexua. Kontrollo që migrimi 20261119140000_capability_events.sql është ekzekutuar.</p></section></div>;

  const sum = (items: CapabilityHealth[], key: "entries" | "success" | "failure" | "handoff" | "neutral" | "abandoned") => items.reduce((n, h) => n + h[key], 0);
  const allDays = [...new Set(report.daily.map(d => d.day))].sort();
  const dailyValue = (agent: AgentKind) => (d: string, outcome: string) => report.daily.filter(r => r.day === d && r.agent === agent && r.outcome === outcome).reduce((n, r) => n + r.events, 0);

  return <div className={s.page}>
    {heading}
    <HealthTabs current="health" />
    <section className={`panel section-pad ${s.filters}`}>
      <nav className={s.segments} aria-label="Periudha">
        {periods.map(p => <Link key={p} href={link({ days: String(p) })} aria-current={p === days ? "page" : undefined}>{p === 1 ? "24 orë" : `${p} ditë`}</Link>)}
      </nav>
      <nav className={`${s.segments} ${s.outcomeFilter}`} aria-label="Rezultati">
        <Link href={link({ outcome: undefined })} aria-current={!failuresOnly ? "page" : undefined}>Të gjitha</Link>
        <Link href={link({ outcome: "failure" })} aria-current={failuresOnly ? "page" : undefined}>Vetëm ato që shkuan keq</Link>
      </nav>
      <form action="/admin/health" className={s.filters}>
        <input type="hidden" name="days" value={days} />
        {failuresOnly && <input type="hidden" name="outcome" value="failure" />}
        <select className="field" name="business" defaultValue={business?.id ?? ""} aria-label="Biznesi">
          <option value="">Të gjitha bizneset</option>
          {(businesses ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn btn-ghost" type="submit">Shfaq</button>
      </form>
    </section>

    {!failuresOnly && <><div className={s.agents}>
      {(["customer", "assistant", "system"] as const).map(agent => {
        const items = report.health.filter(h => h.agent === agent);
        const success = sum(items, "success"), failure = sum(items, "failure");
        return <section key={agent} className={`panel section-pad ${s.agent}`} aria-labelledby={`agent-${agent}`}>
          <div><h2 id={`agent-${agent}`}>{agents[agent].title}</h2><small className="muted-copy">{agents[agent].hint}</small></div>
          <div className={s.hero}><span className={s.heroValue}>{percent(success + failure ? success / (success + failure) : null)}</span><span className={s.heroLabel}>shkuan mirë, nga ato që mund të shkonin mirë ose keq</span></div>
          <OutcomeBar item={{ success, failure, handoff: sum(items, "handoff"), neutral: sum(items, "neutral") }} />
          <div className={s.counts}>
            <div className={s.count}><strong>{num(sum(items, "entries"))}</strong><span>Të nisura</span></div>
            <div className={s.count}><strong>{num(success)}</strong><span><i className={`${s.swatch} ${s.success}`} />Mirë</span></div>
            <div className={s.count}><strong>{num(failure)}</strong><span><i className={`${s.swatch} ${s.failure}`} />Keq</span></div>
            {agent === "customer" && <div className={s.count}><strong>{num(sum(items, "handoff"))}</strong><span><i className={`${s.swatch} ${s.handoff}`} />Te stafi</span></div>}
            {agent === "customer" && <div className={s.count}><strong>{num(sum(items, "abandoned"))}</strong><span>Të lëna në mes</span></div>}
          </div>
          {allDays.length > 0 && <><h3 className="font-semibold">Ditë pas dite</h3><DailyChart days={allDays} value={dailyValue(agent)} /></>}
        </section>;
      })}
    </div>
    <Legend /></>}
    {failuresOnly && <p className="muted-copy">Shfaqen vetëm aftësitë me dështime dhe shkaqet e dështimeve. Shifrat e çdo aftësie ruajnë kontekstin e plotë të periudhës.</p>}

    {(["customer", "assistant", "system"] as const).map(agent => {
      const items = report.health.filter(h => h.agent === agent && (!failuresOnly || h.failure > 0));
      const groups = [...new Set(items.map(h => groupOf(h.capability, h.module)))].sort((a, b) => (moduleLabels[a] ?? a).localeCompare(moduleLabels[b] ?? b));
      return <section key={agent} className="panel section-pad grid gap-3">
        <h2>{agents[agent].title}: aftësitë</h2>
        {!items.length && <p className="muted-copy">{failuresOnly ? "Asnjë dështim në këtë periudhë." : "Asnjë ngjarje në këtë periudhë."}</p>}
        {groups.map(group => {
          const rows = items.filter(h => groupOf(h.capability, h.module) === group).sort((a, b) => (b.success + b.failure + b.handoff + b.neutral) - (a.success + a.failure + a.handoff + a.neutral));
          return <div key={group} className={s.group}>
            <div className={s.groupTitle}><h3>{moduleLabels[group] ?? group}</h3><small>{rows.length} {rows.length === 1 ? "aftësi" : "aftësi"}</small></div>
            {rows.map(item => <div key={item.capability} className={s.row}>
              <div className={s.name}><strong>{capabilityName(item.capability, item.label)}</strong>
                <small>{num(item.entries)} të nisura · {num(item.success)} mirë · {num(item.failure)} keq{item.handoff ? ` · ${num(item.handoff)} te stafi` : ""}{item.neutral ? ` · ${num(item.neutral)} pa gjykim` : ""}</small></div>
              <OutcomeBar item={item} />
              <div className={s.rate}><strong>{percent(item.rate)}</strong>
                <small>{item.previousRate === null ? "pa krahasim" : item.rate === null ? `më parë ${percent(item.previousRate)}` : `${item.rate >= item.previousRate ? "▲" : "▼"} ${Math.abs(Math.round((item.rate - item.previousRate) * 100))} pikë`}</small></div>
              {item.reasons.length > 0 && <div className={s.reasons}>{item.reasons.filter(r => !failuresOnly || r.outcome === "failure").slice(0, 8).map(r => <span key={`${r.point}:${r.reason}`} className={`${s.reason} ${r.outcome === "neutral" ? s.reasonNeutral : ""}`}>
                {r.outcome === "neutral" && "Pa gjykim · "}
                {exitLabel(r.point, r.reason)} <strong>× {num(r.events)}</strong>
                {r.examples.map((e, i) => slugOf.get(e.businessId) ? <Link key={e.conversationId} href={`/b/${slugOf.get(e.businessId)}/inbox/${e.conversationId}`}>biseda {i + 1}</Link> : null)}
              </span>)}</div>}
            </div>)}
          </div>;
        })}
      </section>;
    })}

    <section className="panel section-pad grid gap-3" aria-labelledby="attention">
      <h2 id="attention">Kërkon vëmendje tani · {attention.length}</h2>
      <p className="muted-copy">Lidhje që duken aktive, por nuk punojnë, dhe punë në sfond që kanë ngecur më shumë se 30 minuta.</p>
      {!attention.length ? <p>✓ Asgjë e ngecur dhe asnjë lidhje me gabim.</p> : <ul className={s.failures}>
        {attention.map((a, i) => <li key={i}>
          <span className={`${s.kind} ${a.kind === "stuck" ? s.kind_check : s.kind_external}`}>{a.kind === "stuck" ? "E ngecur" : "Lidhje"}</span>
          <div className={s.failureText}><strong>{a.title}</strong><small>{nameOf.get(a.businessId) ?? "Biznes"} · {a.detail}</small></div>
          {a.href && slugOf.get(a.businessId) ? <Link className="btn btn-ghost" href={`/b/${slugOf.get(a.businessId)}/${a.href}`}>Hap</Link> : <span />}
        </li>)}
      </ul>}
    </section>

    <section className="panel section-pad grid gap-3" aria-labelledby="failures">
      <h2 id="failures">Dështimet e fundit · {failures.length}</h2>
      <p className="muted-copy">Çdo dështim me shkakun e tij. “Gabim në kod” do të thotë diçka që kodi nuk e priste; “Shërbim i jashtëm” që Meta, POK, Google ose AI e refuzoi; “Kontroll” që serveri e ndaloi me qëllim. Hap një për të parë çfarë ndodhi.</p>
      {!failures.length ? <p>✓ Asnjë dështim në këtë periudhë.</p> : <ul className={s.failures}>
        {failures.map(f => <li key={f.id}>
          <span className={`${s.kind} ${s[`kind_${failureKind(f.reason)}`]}`}>{failureKindLabels[failureKind(f.reason)]}</span>
          <div className={s.failureText}><strong>{capabilityName(f.capability, capabilities[f.capability]?.label ?? f.capability)}</strong>
            <small>{exitLabel(f.point, f.reason)} · {f.businessId ? nameOf.get(f.businessId) ?? "Biznes" : "Platforma"} · {when(f.createdAt)}</small></div>
          <Link className="btn btn-ghost" href={`/admin/health/failure/${f.id}`}>Hap</Link>
        </li>)}
      </ul>}
    </section>

    {!failuresOnly && <><section className="panel section-pad grid gap-3">
      <h2>Pa të dhëna në këtë periudhë · {report.silent.length}</h2>
      <p className="muted-copy">Aftësi që ndiqen, por nuk regjistruan asnjë ngjarje. Mund të mos jenë përdorur, ose diçka i pengon. Hap një grup për t’i parë.</p>
      {(["customer", "assistant", "system"] as const).map(agent => {
        const silent = report.silent.filter(x => x.agent === agent);
        if (!silent.length) return null;
        const groups = [...new Set(silent.map(x => groupOf(x.capability, x.module)))].sort((a, b) => (moduleLabels[a] ?? a).localeCompare(moduleLabels[b] ?? b));
        return <div key={agent} className="grid gap-2"><h3 className="font-semibold">{agents[agent].title} · {silent.length}</h3>
          {groups.map(group => {
            const list = silent.filter(x => groupOf(x.capability, x.module) === group);
            return <details key={group} className={s.silentGroup}><summary>{moduleLabels[group] ?? group} · {list.length}</summary>
              <div className={s.chips}>{list.map(x => <span key={x.capability} className={s.chip} title={x.capability}>{capabilityName(x.capability, x.label)} · e fundit: {when(x.lastAt)}</span>)}</div>
            </details>;
          })}
        </div>;
      })}
    </section>

    <section className="panel section-pad grid gap-2">
      <h2>Pa ndjekje · {report.untracked.length}</h2>
      <p className="muted-copy">Aftësi që kodi i njeh, por që nuk regjistrojnë hyrje dhe dalje. Testi i mbulimit dështon kur shtohet një aftësi e re pa ndjekje, ndaj kjo listë duhet të mbetet bosh.</p>
      {report.untracked.length ? <div className={s.chips}>{report.untracked.map(u => <span key={u.capability} className={s.chip}>{capabilityName(u.capability, u.label)}</span>)}</div> : <p>✓ Të gjitha aftësitë ndiqen.</p>}
    </section></>}
  </div>;
}
