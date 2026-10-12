import Link from "next/link";
import { billingState, plans, type BillingUsage } from "@/lib/billing/service";

export function BillingUsageNotice({ slug, usage }: { slug: string; usage: BillingUsage }) {
  const state = billingState(usage);
  if (state.level === "normal") return null;
  const plan = plans[usage.plan];
  const message = state.exhausted
    ? "Ke arritur kapacitetin e paketës. Përgjigjet automatike janë ndalur; mesazhet hyrëse dhe përgjigjet e stafit vazhdojnë normalisht."
    : state.level === "urgent"
      ? `Ke përdorur ${state.percentage}% të kapacitetit mujor.`
      : `Ke përdorur ${state.percentage}% të kapacitetit mujor.`;

  return (
    <aside className={`billing-notice billing-notice-${state.level}`} role={state.exhausted ? "alert" : "status"}>
      <div>
        <strong>{state.exhausted ? "Kapaciteti u arrit" : "Përdorimi i paketës"}</strong>
        <p>{message}</p>
      </div>
      <Link className="btn btn-ghost" href={`/b/${slug}/billing`}>
        {state.exhausted ? "Shiko paketat" : `${state.counted.toLocaleString("sq-AL")} / ${plan.monthlyLimit.toLocaleString("sq-AL")} mesazhe`}
      </Link>
    </aside>
  );
}
