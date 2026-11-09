import Link from "next/link";
import { billingState, plans, type BillingPlan, type BillingUsage } from "@/lib/billing/service";

const nextPlan: Partial<Record<BillingPlan, BillingPlan>> = { free: "starter", starter: "professional", professional: "enterprise" };

/** Shown from 80% of the monthly messages. Only the person who pays sees the
 * upgrade button; everyone else is told who can change the plan. */
export function BillingUsageNotice({ slug, usage, canUpgrade }: { slug: string; usage: BillingUsage; canUpgrade: boolean }) {
  const state = billingState(usage);
  if (state.level === "normal") return null;
  const plan = plans[usage.plan];
  const next = nextPlan[usage.plan];
  const message = state.exhausted
    ? "Mesazhet e paketës mbaruan. Përgjigjet automatike dhe asistenti janë ndalur; mesazhet hyrëse dhe përgjigjet e stafit vazhdojnë normalisht."
    : `Ke përdorur ${state.percentage}% të mesazheve mujore (${state.counted.toLocaleString("sq-AL")} / ${plan.monthlyLimit.toLocaleString("sq-AL")}).`;
  const advice = canUpgrade
    ? next
      ? ` Paketa ${plans[next].name} ka ${plans[next].monthlyLimit.toLocaleString("sq-AL")} mesazhe në muaj.`
      : ""
    : " Paketën e ndryshon pronari i biznesit.";

  return (
    <aside className={`billing-notice billing-notice-${state.level}`} role={state.exhausted ? "alert" : "status"}>
      <div>
        <strong>{state.exhausted ? "Mesazhet mbaruan" : "Përdorimi i paketës"}</strong>
        <p>{message}{advice}</p>
      </div>
      <Link className={canUpgrade ? "btn btn-primary" : "btn btn-ghost"} href={`/b/${slug}/billing`}>
        {canUpgrade ? (next ? "Kalo te paketa tjetër" : "Shiko paketën") : "Shiko paketën"}
      </Link>
    </aside>
  );
}
