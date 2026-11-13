import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { billingState, loadBillingUsage, loadUsageBreakdown, plans } from "@/lib/billing/service";
import { isPaidPlan, loadPaymentCard } from "@/lib/billing/payments";
import { pokConfigured, pokEnvironment } from "@/lib/billing/pok";
import { BillingCheckout } from "@/components/dashboard/billing-checkout";

const planFeatures = {
  // Every plan has every feature; plans differ only in AI messages per month.
  free: ["1,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Rinovim më datë 1 të muajit"],
  starter: ["10,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Rinovim në datën e abonimit"],
  professional: ["50,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Rinovim në datën e abonimit"],
  enterprise: ["200,000 mesazhe AI në muaj", "Të gjitha modulet dhe kanalet", "Biznese pa kufi", "Suport prioritar"],
} as const;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

export default async function BillingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: requestedSlug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requestedSlug);
  if (!access) redirect("/auth/continue");
  const usage = await loadBillingUsage(access.business.id);
  const state = billingState(usage);
  const payer = usage.scope === "account" && usage.billingUserId === user.id;
  const breakdown = payer && usage.billingUserId ? await loadUsageBreakdown(usage.billingUserId, usage.periodStart).catch(() => []) : [];
  const currentPlan = plans[usage.plan];
  // Only the person who pays sees card payments; POK must be configured first.
  const canPay = payer && pokConfigured();
  const card = canPay ? await loadPaymentCard(user.id).catch(() => null) : null;
  const paidOptions = (Object.keys(plans) as Array<keyof typeof plans>).filter(isPaidPlan).map((key) => ({ key, name: plans[key].name, price: plans[key].monthlyPrice }));

  return <>
    <PageHeading
      eyebrow="Paketa dhe përdorimi"
      title="Mesazhet e paketës"
      description="Çdo përgjigje AI numërohet si një mesazh: përgjigjet automatike te klientët dhe përgjigjet e asistentit për ty. Mesazhet hyrëse dhe përgjigjet manuale nuk numërohen."
    />
    <section className="panel section-pad billing-summary">
      <div className="billing-summary-copy">
        <p className="page-eyebrow">{usage.scope === "account" ? (payer ? "Paketa jote" : "Paketa e pronarit të biznesit") : "Paketa e biznesit"}</p>
        <h2>{currentPlan.name}</h2>
        {usage.scope === "account" && <p className="muted-copy">{payer
          ? "Paketa vlen për të gjitha bizneset e tua. Mesazhet e çdo biznesi zbriten nga e njëjta kuotë."
          : "Mesazhet e këtij biznesi zbriten nga paketa e pronarit që e krijoi."}</p>}
        <p className="muted-copy">Rinovimi i kapacitetit: {dateLabel(usage.periodEnd)}</p>
      </div>
      <div className="billing-total" aria-label={`${state.counted} nga ${usage.limit} mesazhe të përdorura`}>
        <strong>{state.counted.toLocaleString("sq-AL")}</strong>
        <span>nga {usage.limit.toLocaleString("sq-AL")} mesazhe</span>
      </div>
      <div className="billing-meter" aria-hidden="true"><span style={{ width: `${state.percentage}%` }} /></div>
      <p className="billing-availability">
        {state.exhausted
          ? "Mesazhet e paketës janë përdorur. Përgjigjet automatike dhe asistenti janë në pauzë deri në rinovim."
          : `Kanë mbetur ${state.monthlyRemaining.toLocaleString("sq-AL")} mesazhe në këtë periudhë.`}
        {usage.extra > 0 && ` Ke ${Math.max(0, usage.extra - usage.extraReserved).toLocaleString("sq-AL")} mesazhe shtesë.`}
      </p>
    </section>

    {breakdown.length > 1 && <section className="panel section-pad billing-breakdown" aria-label="Mesazhet sipas biznesit">
      <h2>Sipas biznesit</h2>
      <ul>{breakdown.map((row) => <li key={row.id}><span>{row.name}</span><strong>{row.used.toLocaleString("sq-AL")}</strong></li>)}</ul>
    </section>}

    {canPay && <BillingCheckout env={pokEnvironment()} card={card ? { label: card.label } : null} currentPlan={usage.plan} paidUntil={usage.paidUntil} plans={paidOptions} />}

    <section className="billing-plans" aria-label="Paketat e disponueshme">
      {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
        const plan = plans[key];
        const current = key === usage.plan;
        return <article className={`panel billing-plan ${current ? "is-current" : ""}`} key={key}>
          <div className="billing-plan-head">
            <h2>{plan.name}</h2>
            {current && <span className="billing-current">Aktual</span>}
          </div>
          <p className="billing-price">{plan.monthlyPrice === 0 ? "Falas" : `${plan.monthlyPrice.toLocaleString("sq-AL")} lekë`}<small>{plan.monthlyPrice === 0 ? "" : " / muaj"}</small></p>
          <p className="muted-copy">{plan.monthlyLimit.toLocaleString("sq-AL")} mesazhe/muaj</p>
          <ul>{planFeatures[key].map((feature) => <li key={feature}>{feature}</li>)}</ul>
          {current ? <span className="billing-plan-status">Në përdorim</span> : <span className="billing-plan-status muted">{key === "free"
            ? "Paketa kthehet në Free kur mbaron koha e paguar."
            : canPay ? "Paguaj me kartë te seksioni më sipër." : payer ? "Pagesat me kartë do të aktivizohen së shpejti." : "Paketën e ndryshon pronari që paguan."}</span>}
        </article>;
      })}
    </section>
  </>;
}
