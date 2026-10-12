import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { billingState, loadBillingUsage, plans } from "@/lib/billing/service";

const planFeatures = {
  free: ["1,000 mesazhe automatike", "Inbox dhe përgjigje manuale", "Rinovim më datë 1 të muajit"],
  starter: ["10,000 mesazhe automatike", "1 platformë", "Analitika bazë"],
  professional: ["50,000 mesazhe automatike", "WhatsApp, Instagram dhe Messenger", "AI e avancuar dhe webhook-e"],
  enterprise: ["200,000 mesazhe automatike", "Të gjitha platformat", "Trajnim i pakufizuar dhe suport prioritar"],
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
  const currentPlan = plans[usage.plan];

  return <>
    <PageHeading
      eyebrow="Paketa dhe përdorimi"
      title="Kapaciteti i agjentit"
      description="Numërohen vetëm përgjigjet automatike të dërguara nga agjenti. Mesazhet hyrëse dhe përgjigjet manuale nuk konsumojnë kapacitet."
    />
    <section className="panel section-pad billing-summary">
      <div className="billing-summary-copy">
        <p className="page-eyebrow">Paketa aktuale</p>
        <h2>{currentPlan.name}</h2>
        <p className="muted-copy">Rinovimi i kapacitetit: {dateLabel(usage.periodEnd)}</p>
      </div>
      <div className="billing-total" aria-label={`${state.counted} nga ${usage.limit} mesazhe të përdorura`}>
        <strong>{state.counted.toLocaleString("sq-AL")}</strong>
        <span>nga {usage.limit.toLocaleString("sq-AL")} mesazhe</span>
      </div>
      <div className="billing-meter" aria-hidden="true"><span style={{ width: `${state.percentage}%` }} /></div>
      <p className="billing-availability">
        {state.exhausted
          ? "Kapaciteti i paketës është përdorur. Përgjigjet automatike janë në pauzë."
          : `Kanë mbetur ${state.monthlyRemaining.toLocaleString("sq-AL")} mesazhe në këtë periudhë.`}
        {usage.extra > 0 && ` Ke ${Math.max(0, usage.extra - usage.extraReserved).toLocaleString("sq-AL")} mesazhe shtesë.`}
      </p>
    </section>

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
          {current ? <span className="billing-plan-status">Në përdorim</span> : <span className="billing-plan-status muted">Pagesat me Stripe do të aktivizohen së shpejti.</span>}
        </article>;
      })}
    </section>
  </>;
}
