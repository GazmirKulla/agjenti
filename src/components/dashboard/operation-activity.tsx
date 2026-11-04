import Link from "next/link";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { CommandActor } from "@/lib/actions/command-actor";
import type { PreparedOperation } from "@/lib/actions/operations/service";
import { OperationButton } from "./operation-button";

export async function OperationActivity({ actor }: { actor: CommandActor }) {
  const db = createServiceSupabase();
  const [plans, events] = await Promise.all([
    db.from("business_operation_plans").select("id,title,state,steps").eq("business_id", actor.business.id).eq("user_id", actor.userId).order("updated_at", { ascending: false }).limit(20),
    db.from("business_attention_events").select("id,title,detail,href,created_at").eq("business_id", actor.business.id).eq("user_id", actor.userId).order("created_at", { ascending: false }).limit(20),
  ]);
  const ids = (plans.data ?? []).flatMap(plan => (plan.steps as PreparedOperation[]).map(step => step.requestId));
  const receipts = ids.length ? await db.from("business_operation_receipts").select("id,state").eq("business_id", actor.business.id).eq("user_id", actor.userId).in("id", ids) : { data: [], error: null };
  const progress = new Map((receipts.data ?? []).map(row => [row.id, row.state]));
  return <>
    <section className="panel section-pad mt-5"><h2>Punët e tua me asistentin</h2>
      {plans.error || receipts.error ? <p role="alert">Progresi nuk u ngarkua. Rifresko faqen përpara një veprimi tjetër.</p> : plans.data?.length ? plans.data.map(plan => <article key={plan.id} className="border-t py-4">
        <h3>{plan.title}</h3><p>{plan.state === "completed" ? "Përfunduar" : plan.state === "blocked" ? "Kërkon kontroll" : "Në pritje të konfirmimit"}</p>
        <ol className="list-decimal pl-5">{(plan.steps as PreparedOperation[]).map(step => <li key={step.requestId}>{step.preview.title}{step.preview.subject ? ` · ${step.preview.subject}` : ""} — {progress.get(step.requestId) === "completed" ? "Përfunduar" : progress.has(step.requestId) ? "Rezultat për t’u verifikuar" : "Në pritje"}</li>)}</ol>
        {plan.state !== "completed" && <OperationButton slug={actor.business.slug} operation="plan.resume" input={{ id: plan.id }}>Rishqyrto dhe vazhdo</OperationButton>}
      </article>) : <p>Ende nuk ke plane me disa hapa.</p>}
    </section>
    <section className="panel section-pad mt-5"><h2>Njoftimet e ndjekjes</h2>
      {events.error ? <p role="alert">Njoftimet nuk u ngarkuan.</p> : events.data?.length ? events.data.map(event => <article key={event.id} className="border-t py-4"><h3>{event.title}</h3><p>{event.detail}</p><p className="muted-copy">{new Date(event.created_at).toLocaleString("sq-AL")} · Gjendja në çastin e kontrollit</p><Link className="soft-link" href={event.href}>Kontrollo gjendjen →</Link></article>) : <p>Ende nuk ka njoftime. Ndjekjen ditore e aktivizon te <Link href={`/b/${actor.business.slug}/settings/preferences`}>Preferencat</Link>.</p>}
    </section>
  </>;
}
