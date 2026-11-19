import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { billingState, loadBillingUsage, loadUsageBreakdown, plans, type BillingPlan } from "@/lib/billing/service";
import { isPaidPlan, loadPaymentHistory, syncPlanPayment } from "@/lib/billing/payments";
import { pokConfigured, pokEnvironment } from "@/lib/billing/pok";
import { createServiceSupabase } from "@/lib/supabase/service";
import { PokPayButton } from "@/components/dashboard/pok-pay-button";
import s from "./billing.module.css";

// Every plan has every feature; plans differ only in AI messages per month (and priority support).
const planOrder: BillingPlan[] = ["free", "starter", "professional", "enterprise"];
const planCopy: Record<BillingPlan, { tag: string; icon: string; includes: string[] }> = {
  free: { tag: "Për të nisur", icon: "F", includes: ["1,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi"] },
  starter: { tag: "Për biznese të vogla", icon: "S", includes: ["10,000 mesazhe AI në muaj", "Rinovim në datën e pagesës"] },
  professional: { tag: "Për biznese në rritje", icon: "P", includes: ["50,000 mesazhe AI në muaj", "Për disa biznese me shumë biseda"] },
  enterprise: { tag: "Për volum të lartë", icon: "E", includes: ["200,000 mesazhe AI në muaj", "Suport prioritar"] },
};
const tabs = [["usage", "Përdorimi"], ["plans", "Paketat"], ["billing", "Faturimi"]] as const;
type Tab = (typeof tabs)[number][0];
const statusLabels = { paid: "Paguar", pending: "Në përpunim", failed: "Nuk u krye" } as const;
const day = 86400000;

const dateLabel = (value: string | number) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", timeZone: "Europe/Tirane" }).format(new Date(value));
const fullDate = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Tirane" }).format(new Date(value));
const money = (amount: number) => `${amount.toLocaleString("sq-AL")} lekë`;
const meterClass = (pct: number) => `${s.meter} ${pct >= 100 ? s.full : pct >= 80 ? s.warn : ""}`;

/**
 * Cilësimet → Paketa dhe pagesat, like the AI platforms: Përdorimi (how much of this period is used, at what
 * pace, per business), Paketat (the plans side by side, each with its button) and Faturimi (card, payment,
 * every payment with its receipt). Only the person who pays the plan changes it.
 */
export default async function BillingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; plan?: string; payment?: string; return?: string }> }) {
  const { slug: requestedSlug } = await params;
  const query = await searchParams;
  const tab: Tab = tabs.some(([id]) => id === query.tab) ? query.tab as Tab : "usage";
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requestedSlug);
  if (!access) redirect("/auth/continue");
  const base = `/b/${access.business.slug}/settings/billing`;
  // Back from POK's page: the return is only a signal; POK is asked for the order's real state.
  const returned = query.payment && /^[0-9a-f-]{36}$/i.test(query.payment)
    ? await syncPlanPayment(query.payment, user.id).catch(() => "unverified" as const) : null;
  const usage = await loadBillingUsage(access.business.id);
  const state = billingState(usage);
  const payer = usage.scope === "account" && usage.billingUserId === user.id;
  const current = plans[usage.plan];
  const canPay = payer && pokConfigured();
  const [breakdown, history, payerEmail] = await Promise.all([
    tab === "usage" && usage.billingUserId ? loadUsageBreakdown(usage.billingUserId, usage.periodStart).catch(() => []) : Promise.resolve([]),
    tab === "billing" && payer ? loadPaymentHistory(user.id).catch(() => null) : Promise.resolve([]),
    !payer && usage.billingUserId ? createServiceSupabase().from("profiles").select("email").eq("id", usage.billingUserId).maybeSingle().then(r => r.data?.email ?? null, () => null) : Promise.resolve(null),
  ]);
  const selected = isPaidPlan(query.plan) ? query.plan : null;
  const higher = planOrder.find(key => plans[key].monthlyPrice > current.monthlyPrice);

  // At this pace, will the messages last until the period renews?
  const start = Date.parse(usage.periodStart), end = Date.parse(usage.periodEnd), now = Date.now();
  const elapsed = Math.max(day / 4, now - start), pace = state.counted / elapsed;
  const runsOutAt = pace > 0 ? now + state.monthlyRemaining / pace : null;
  const heading = state.exhausted ? "Mesazhet e kësaj periudhe janë përdorur. Përgjigjet automatike dhe asistenti janë në pauzë deri në rinovim."
    : runsOutAt && runsOutAt < end ? `Kujdes: me këtë ritëm mesazhet mbarojnë rreth ${dateLabel(runsOutAt)}, para rinovimit më ${dateLabel(end)}.`
    : state.counted ? `Me këtë ritëm, mesazhet të mjaftojnë deri në rinovimin më ${dateLabel(end)}.` : `Mesazhet rifillojnë më ${dateLabel(end)}.`;
  const who = payer ? null : payerEmail ? `Paketën e menaxhon ${payerEmail}, që e paguan.` : "Paketën e menaxhon pronari që e paguan.";

  return <div className={s.panel}>
    <div><p className="page-eyebrow">Cilësimet</p><h1 style={{ margin: 0 }}>Paketa dhe pagesat</h1></div>
    <nav className={s.tabs} aria-label="Paketa dhe pagesat">
      {tabs.map(([id, label]) => <Link key={id} href={`${base}?tab=${id}`} aria-current={tab === id ? "page" : undefined}>{label}</Link>)}
    </nav>

    {tab === "usage" && <section className={s.panel} aria-label="Përdorimi">
      <h2 className={s.title}>Përdorimi yt <span className={s.badge}>{current.name}</span></h2>
      <p className={s.notice}>{heading}</p>
      <div className={s.actions}>
        {higher && <Link className="btn btn-primary" href={`${base}?tab=plans`}>Kalo në një paketë më të madhe</Link>}
        <button type="button" className="btn btn-ghost" disabled title="Së shpejti">Bli mesazhe shtesë · së shpejti</button>
      </div>
      {who && <p className="muted-copy" style={{ margin: 0 }}>{who}</p>}
      <div className={s.rows}>
        <div className={s.row}>
          <span><strong>Këtë periudhë</strong><small>Rifillon më {dateLabel(end)}</small></span>
          <div className={meterClass(state.percentage)} role="img" aria-label={`${state.percentage}% e përdorur`}><span style={{ width: `${Math.min(100, state.percentage)}%` }} /></div>
          <span className={s.pct}>{state.percentage}% e përdorur</span>
        </div>
        <div className={s.row}>
          <span><strong>Mesazhe AI</strong><small>Përgjigjet te klientët dhe nga asistenti</small></span>
          <span style={{ color: "var(--ink-muted)" }}>{state.counted.toLocaleString("sq-AL")} nga {usage.limit.toLocaleString("sq-AL")}</span>
          <span className={s.pct}>{state.monthlyRemaining.toLocaleString("sq-AL")} mbetur</span>
        </div>
        <div className={s.row}>
          <span><strong>Mesazhe shtesë</strong><small>Përdoren kur mbarojnë mesazhet e paketës</small></span>
          <span />
          <span className={s.pct}>{Math.max(0, usage.extra - usage.extraReserved).toLocaleString("sq-AL")}</span>
        </div>
      </div>
      {breakdown.length > 0 && <>
        <h3 className={s.section}>Përdorimi sipas biznesit</h3>
        <div className={s.rows}>{breakdown.map(row => {
          const share = state.counted ? Math.round(row.used / Math.max(1, state.counted) * 100) : 0;
          return <div key={row.id} className={s.row}>
            <span><strong>{row.name}</strong><small>{row.used.toLocaleString("sq-AL")} mesazhe</small></span>
            <div className={s.meter} role="img" aria-label={`${share}% e përdorimit`}><span style={{ width: `${share}%` }} /></div>
            <span className={s.pct}>{share}%</span>
          </div>;
        })}</div>
      </>}
    </section>}

    {tab === "plans" && <section className={s.upgrade} aria-label="Paketat">
      <h2 className={s.upgradeTitle}>Paketa që rriten me biznesin tënd</h2>
      {who && <p className="muted-copy" style={{ margin: 0 }}>{who}</p>}
      <div className={s.cards}>
        {planOrder.map((key, index) => {
          const plan = plans[key], isCurrent = key === usage.plan, up = plan.monthlyPrice > current.monthlyPrice;
          const previous = index > 0 ? plans[planOrder[index - 1]].name : null;
          return <article key={key} className={`${s.card} ${isCurrent ? s.current : ""}`}>
            <span className={s.icon} aria-hidden>{planCopy[key].icon}</span>
            <div><h3 className={s.cardName}>{plan.name}</h3><p className={s.cardTag}>{planCopy[key].tag}</p></div>
            <div className={s.price}><strong>{plan.monthlyPrice ? plan.monthlyPrice.toLocaleString("sq-AL") : "0"}</strong><span>lekë / muaj{plan.monthlyPrice ? <><br />paguhet çdo muaj</> : <><br />falas</>}</span></div>
            {isCurrent ? <button type="button" className={`btn btn-ghost ${s.cta}`} disabled>Paketa jote</button>
              : key === "free" ? <button type="button" className={`btn btn-ghost ${s.cta}`} disabled>Kthehesh këtu kur mbaron koha e paguar</button>
              : !payer ? <button type="button" className={`btn btn-ghost ${s.cta}`} disabled>E ndryshon pronari që paguan</button>
              : <Link className={`btn ${up ? "btn-primary" : "btn-ghost"} ${s.cta}`} href={`${base}?tab=billing&plan=${key}`}>{up ? `Kalo në ${plan.name}` : `Zgjidh ${plan.name}`}</Link>}
            {!isCurrent && key !== "free" && payer && <p className={s.ctaNote}>{canPay ? "Pa angazhim · paguan muaj për muaj" : "Pagesat me kartë aktivizohen së shpejti"}</p>}
            <ul className={s.includes}>
              <li className={s.includesHead} style={{ display: "block" }}>{previous ? `Gjithçka te ${previous}, plus:` : "Përfshin:"}</li>
              {planCopy[key].includes.map(item => <li key={item}>{item}</li>)}
            </ul>
          </article>;
        })}
      </div>
      <p className={s.footnote}>Çdo përgjigje AI numërohet si një mesazh: te klientët dhe nga asistenti për ty. Mesazhet hyrëse dhe përgjigjet që shkruan vetë nuk numërohen. Paketa vlen për të gjitha bizneset e pronarit që paguan.</p>
    </section>}

    {tab === "billing" && <section className={s.panel} aria-label="Faturimi">
      <h2 className={s.title}>Faturimi <span className={s.badge}>{current.name}</span></h2>
      {!payer ? <p className="muted-copy">{who} Ti sheh paketën dhe përdorimin.</p> : <>
        <div className={s.rows}>
          <div className={s.row}><span><strong>Paketa</strong><small>{current.monthlyPrice ? `${money(current.monthlyPrice)} / muaj` : "Falas"}</small></span><span />
            <span className={s.pct}><Link className="inline-link" href={`${base}?tab=plans`}>Ndrysho</Link></span></div>
          <div className={s.row}><span><strong>{usage.paidUntil ? "Paguar deri më" : "Rinovimi"}</strong><small>{usage.paidUntil ? "Paguaj sërish para kësaj date që të vazhdojë; përndryshe kthehet në Free." : usage.plan === "free" ? "Paketa falas rifillon çdo muaj." : "Paketa e vendosur nga administratori."}</small></span><span />
            <span className={s.pct}>{usage.paidUntil ? fullDate(usage.paidUntil) : fullDate(usage.periodEnd)}</span></div>
        </div>
        {returned && <p className={`form-feedback ${returned === "paid" ? "" : "form-feedback-error"}`} role="status">{returned === "paid" ? `Pagesa u krye. Paketa jote tani është ${current.name}.`
          : returned === "pending" ? "Pagesa po përpunohet nga POK. Rifresko faqen pas pak." : returned === "failed" ? "Pagesa nuk u krye. Mund të provosh përsëri." : "Pagesa nuk u verifikua ende me POK. Rifresko faqen pas pak."}</p>}
        {canPay ? (() => {
          const chosen = selected ?? (usage.paidUntil && isPaidPlan(usage.plan) ? usage.plan : null);
          return chosen ? <div className="grid gap-2">
            <p className={s.notice}>{chosen === usage.plan ? `Rinovo ${plans[chosen].name}` : `Po kalon në ${plans[chosen].name}`} · {money(plans[chosen].monthlyPrice)} / muaj</p>
            <p className="muted-copy" style={{ margin: 0 }}>Paguan në faqen e sigurt të POK me kartë ose me llogarinë POK, dhe kthehesh këtu. Paketa vlen një muaj nga pagesa.{pokEnvironment() === "staging" ? " Mjedis prove: përdor vetëm kartat e provës së POK." : ""}</p>
            <PokPayButton slug={access.business.slug} plan={chosen} label={`Paguaj me POK · ${money(plans[chosen].monthlyPrice)}`} />
          </div> : <p className="muted-copy">Zgjidh një paketë te <Link className="inline-link" href={`${base}?tab=plans`}>Paketat</Link> për ta paguar me POK.</p>;
        })() : <p className="muted-copy">Pagesat me POK aktivizohen së shpejti. Deri atëherë paketën e vendos administratori.</p>}
        <h3 className={s.section}>Pagesat</h3>
        {history === null ? <p className="muted-copy">Pagesat nuk u lexuan. Rifresko faqen.</p>
          : !history.length ? <p className="muted-copy">Ende nuk ke pagesa.</p>
          : <div style={{ overflowX: "auto" }}><table className="data-table">
            <thead><tr><th>Data</th><th>Paketa</th><th>Periudha</th><th>Shuma</th><th>Gjendja</th><th /></tr></thead>
            <tbody>{history.map(p => <tr key={p.id}>
              <td>{fullDate(p.paidAt ?? p.createdAt)}</td><td>{plans[p.plan].name}</td>
              <td>{p.periodStart && p.periodEnd ? `${dateLabel(p.periodStart)} – ${dateLabel(p.periodEnd)}` : "—"}</td>
              <td>{money(p.amount)}</td><td>{statusLabels[p.status]}</td>
              <td>{p.status === "paid" && <Link className="inline-link" href={`${base}/receipt/${p.id}`}>Mandati</Link>}</td>
            </tr>)}</tbody>
          </table></div>}
      </>}
    </section>}
  </div>;
}
