import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { plans } from "@/lib/billing/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

const details = {
  free: "Për çdo biznes të ri",
  starter: "Për ekipe të vogla",
  professional: "Për bizneset në rritje",
  enterprise: "Për volum të lartë",
} as const;

export default async function AdminPricingPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");

  return <>
    <PageHeading
      eyebrow="MONETIZIMI"
      title="Çmimet"
      description="Paketa i përket përdoruesit që paguan dhe vlen për të gjitha bizneset e tij. Të gjitha funksionet janë në çdo paketë; paketat ndryshojnë vetëm në mesazhet AI."
    />
    <section className="panel section-pad admin-pricing-note">
      <strong>Matja e përdorimit</strong>
      <p>Çdo përgjigje AI numërohet si një mesazh: përgjigjet automatike te klientët dhe përgjigjet e asistentit për pronarin. Mesazhet hyrëse dhe përgjigjet manuale të stafit nuk numërohen.</p>
    </section>
    <section className="billing-plans" aria-label="Paketat e platformës">
      {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
        const plan = plans[key];
        return <article className="panel billing-plan" key={key}>
          <div className="billing-plan-head"><h2>{plan.name}</h2></div>
          <p className="billing-price">
            {plan.monthlyPrice === 0 ? "Falas" : `${plan.monthlyPrice.toLocaleString("sq-AL")} lekë`}
            <small>{plan.monthlyPrice === 0 ? "" : " / muaj"}</small>
          </p>
          <p className="muted-copy">{plan.monthlyLimit.toLocaleString("sq-AL")} mesazhe AI / muaj · të gjitha modulet</p>
          <p className="billing-plan-status">{details[key]}</p>
        </article>;
      })}
    </section>
    <p className="muted-copy mt-5">Ndryshimi i planit dhe blerja e mesazheve shtesë do të aktivizohen kur të lidhet Stripe.</p>
  </>;
}
