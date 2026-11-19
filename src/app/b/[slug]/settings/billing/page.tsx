import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { billingState, loadBillingUsage, loadUsageBreakdown, plans } from "@/lib/billing/service";
import { isPaidPlan, loadPaymentCard, loadPaymentHistory } from "@/lib/billing/payments";
import { pokConfigured, pokEnvironment } from "@/lib/billing/pok";
import { BillingCheckout } from "@/components/dashboard/billing-checkout";

const planFeatures = {
  // Every plan has every feature; plans differ only in AI messages per month.
  free: ["1,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Rinovim më datë 1 të muajit"],
  starter: ["10,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Rinovim në datën e abonimit"],
  professional: ["50,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Rinovim në datën e abonimit"],
  enterprise: ["200,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Suport prioritar"],
} as const;
const planTaglines = { free: "Për të nisur", starter: "Për biznese të vogla", professional: "Për biznese në rritje", enterprise: "Për volum të lartë" } as const;
const tabs = [["plans", "Paketat"], ["usage", "Përdorimi"], ["billing", "Faturimi"]] as const;
type Tab = (typeof tabs)[number][0];
const statusLabels = { paid: "Paguar", pending: "Në përpunim", failed: "Nuk u krye" } as const;

const dateLabel = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Tirane" }).format(new Date(value));
const money = (amount: number, currency: string) => `${amount.toLocaleString("sq-AL")} ${currency === "ALL" ? "lekë" : currency}`;

/**
 * Cilësimet → Paketa dhe pagesat, in three parts like the AI platforms: the plans side by side, the usage of
 * this period, and billing (the saved card, the next payment, every payment with its receipt).
 */
export default async function BillingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug: requestedSlug } = await params;
  const requestedTab = (await searchParams).tab;
  const tab: Tab = tabs.some(([id]) => id === requestedTab) ? requestedTab as Tab : "plans";
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requestedSlug);
  if (!access) redirect("/auth/continue");
  const base = `/b/${access.business.slug}/settings/billing`;
  const usage = await loadBillingUsage(access.business.id);
  const state = billingState(usage);
  const payer = usage.scope === "account" && usage.billingUserId === user.id;
  const currentPlan = plans[usage.plan];
  // Only the person who pays sees card payments; POK must be configured first.
  const canPay = payer && pokConfigured();
  const [breakdown, card, history] = await Promise.all([
    tab === "usage" && payer && usage.billingUserId ? loadUsageBreakdown(usage.billingUserId, usage.periodStart).catch(() => []) : Promise.resolve([]),
    canPay ? loadPaymentCard(user.id).catch(() => null) : Promise.resolve(null),
    tab === "billing" && payer ? loadPaymentHistory(user.id).catch(() => null) : Promise.resolve([]),
  ]);
  const paidOptions = (Object.keys(plans) as Array<keyof typeof plans>).filter(isPaidPlan).map((key) => ({ key, name: plans[key].name, price: plans[key].monthlyPrice }));
  const renewal = usage.paidUntil ? `Paguar deri më ${dateLabel(usage.paidUntil)}; pastaj kthehet në Free nëse nuk paguhet muaji tjetër.` : usage.plan === "free" ? "Paketa falas rifillon çdo muaj." : "Paketa e vendosur nga administratori.";

  return <>
    <PageHeading eyebrow="Cilësimet" title="Paketa dhe pagesat"
      description="Paketa që përdor, sa mesazhe AI ke përdorur këtë periudhë dhe pagesat e tua. Çdo përgjigje AI numërohet si një mesazh: te klientët dhe nga asistenti për ty." />
    <nav className="billing-tabs" aria-label="Paketa dhe pagesat" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
      {tabs.map(([id, label]) => <Link key={id} href={`${base}?tab=${id}`} aria-current={tab === id ? "page" : undefined}
        style={{ padding: "8px 14px", borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === id ? "var(--ink)" : "var(--ink-muted)", fontWeight: tab === id ? 600 : 500, textDecoration: "none" }}>{label}</Link>)}
    </nav>

    {tab === "plans" && <>
      <section className="panel section-pad billing-summary">
        <div className="billing-summary-copy">
          <p className="page-eyebrow">{usage.scope === "account" ? (payer ? "Paketa jote" : "Paketa e pronarit të biznesit") : "Paketa e biznesit"}</p>
          <h2>{currentPlan.name}</h2>
          <p className="muted-copy">{renewal}</p>
          {usage.scope === "account" && <p className="muted-copy">{payer ? "Vlen për të gjitha bizneset e tua, me një kuotë të përbashkët." : "Paketën e menaxhon pronari që paguan."}</p>}
        </div>
      </section>
      <section className="billing-plans" aria-label="Paketat">
        {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
          const plan = plans[key];
          const current = key === usage.plan;
          const higher = plan.monthlyPrice > currentPlan.monthlyPrice;
          return <article className={`panel billing-plan ${current ? "is-current" : ""}`} key={key}>
            <div className="billing-plan-head"><h2>{plan.name}</h2>{current && <span className="billing-current">Aktual</span>}</div>
            <p className="muted-copy">{planTaglines[key]}</p>
            <p className="billing-price">{plan.monthlyPrice === 0 ? "Falas" : `${plan.monthlyPrice.toLocaleString("sq-AL")} lekë`}<small>{plan.monthlyPrice === 0 ? "" : " / muaj"}</small></p>
            <ul>{planFeatures[key].map((feature) => <li key={feature}>{feature}</li>)}</ul>
            {current ? <span className="billing-plan-status">Në përdorim</span>
              : key === "free" ? <span className="billing-plan-status muted">Kthehesh këtu kur mbaron koha e paguar.</span>
              : canPay ? <Link className={higher ? "btn btn-primary" : "btn btn-ghost"} href={`${base}?tab=billing&plan=${key}`}>{higher ? `Kalo në ${plan.name}` : `Zgjidh ${plan.name}`}</Link>
              : <span className="billing-plan-status muted">{payer ? "Pagesat me kartë do të aktivizohen së shpejti." : "Paketën e ndryshon pronari që paguan."}</span>}
          </article>;
        })}
      </section>
    </>}

    {tab === "usage" && <>
      <section className="panel section-pad billing-summary">
        <div className="billing-summary-copy">
          <p className="page-eyebrow">Mesazhe AI në këtë periudhë</p>
          <h2>{state.percentage}% e përdorur</h2>
          <p className="muted-copy">Rifillon më {dateLabel(usage.periodEnd)}.</p>
        </div>
        <div className="billing-total" aria-label={`${state.counted} nga ${usage.limit} mesazhe të përdorura`}>
          <strong>{state.counted.toLocaleString("sq-AL")}</strong><span>nga {usage.limit.toLocaleString("sq-AL")} mesazhe</span>
        </div>
        <div className="billing-meter" aria-hidden="true"><span style={{ width: `${state.percentage}%` }} /></div>
        <p className="billing-availability">
          {state.exhausted ? "Mesazhet e paketës janë përdorur. Përgjigjet automatike dhe asistenti janë në pauzë deri në rinovim ose deri sa të kalosh në një paketë më të madhe."
            : state.percentage >= 80 ? `Po afrohesh te kufiri: kanë mbetur ${state.monthlyRemaining.toLocaleString("sq-AL")} mesazhe.`
            : `Kanë mbetur ${state.monthlyRemaining.toLocaleString("sq-AL")} mesazhe në këtë periudhë.`}
          {usage.extra > 0 && ` Ke edhe ${Math.max(0, usage.extra - usage.extraReserved).toLocaleString("sq-AL")} mesazhe shtesë.`}
        </p>
      </section>
      {breakdown.length > 0 && <section className="panel section-pad billing-breakdown" aria-label="Mesazhet sipas biznesit">
        <h2>Sipas biznesit</h2>
        <ul>{breakdown.map((row) => <li key={row.id}><span>{row.name}</span><strong>{row.used.toLocaleString("sq-AL")}</strong></li>)}</ul>
      </section>}
      <p className="muted-copy">Numërohen përgjigjet AI te klientët dhe përgjigjet e asistentit për ty. Mesazhet hyrëse dhe përgjigjet që shkruan vetë nuk numërohen.</p>
    </>}

    {tab === "billing" && <>
      {!payer ? <section className="panel section-pad"><p className="muted-copy">Pagesat i menaxhon pronari që paguan paketën. Ti sheh paketën dhe përdorimin.</p></section> : <>
        {canPay ? <BillingCheckout env={pokEnvironment()} card={card ? { label: card.label } : null} currentPlan={usage.plan} paidUntil={usage.paidUntil} plans={paidOptions} />
          : <section className="panel section-pad"><h2>Mënyra e pagesës</h2><p className="muted-copy">Pagesat me kartë (POK) do të aktivizohen së shpejti. Deri atëherë paketën e vendos administratori.</p></section>}
        <section className="panel section-pad grid gap-3" aria-labelledby="billing-history">
          <h2 id="billing-history">Pagesat</h2>
          {history === null ? <p className="muted-copy">Pagesat nuk u lexuan. Rifresko faqen.</p>
            : !history.length ? <p className="muted-copy">Ende nuk ke pagesa.</p>
            : <div style={{ overflowX: "auto" }}><table className="data-table">
              <thead><tr><th>Data</th><th>Paketa</th><th>Periudha</th><th>Shuma</th><th>Gjendja</th><th /></tr></thead>
              <tbody>{history.map(p => <tr key={p.id}>
                <td>{dateLabel(p.paidAt ?? p.createdAt)}</td><td>{plans[p.plan].name}</td>
                <td>{p.periodStart && p.periodEnd ? `${dateLabel(p.periodStart)} – ${dateLabel(p.periodEnd)}` : "—"}</td>
                <td>{money(p.amount, p.currency)}</td><td>{statusLabels[p.status]}</td>
                <td>{p.status === "paid" && <Link className="inline-link" href={`${base}/receipt/${p.id}`}>Mandati</Link>}</td>
              </tr>)}</tbody>
            </table></div>}
        </section>
      </>}
    </>}
  </>;
}
