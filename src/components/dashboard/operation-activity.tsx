import Link from "next/link";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { CommandActor } from "@/lib/actions/command-actor";
import { readActivitySteps } from "@/lib/actions/operations/activity-steps";
import { formatActivityTime } from "@/lib/integrations/activity-log";
import { OperationButton } from "./operation-button";
import "./activity.css";

const planState: Record<string, string> = { completed: "Përfunduar", blocked: "U ndal — kërkon vazhdim" };
const order = (state: string) => state === "completed" ? 1 : 0;

export async function OperationActivity({ actor }: { actor: CommandActor }) {
  const db = createServiceSupabase();
  const slug = actor.business.slug;
  const [plans, events] = await Promise.all([
    db.from("business_operation_plans").select("id,title,state,steps,created_at,updated_at").eq("business_id", actor.business.id).eq("user_id", actor.userId).order("updated_at", { ascending: false }).limit(20),
    db.from("business_attention_events").select("id,title,detail,href,created_at").eq("business_id", actor.business.id).eq("user_id", actor.userId).order("created_at", { ascending: false }).limit(20),
  ]);
  const activityPlans = (plans.data ?? []).map(plan => ({ ...plan, activity: readActivitySteps(plan.steps) }))
    .sort((a, b) => order(a.state) - order(b.state));
  const ids = activityPlans.flatMap(plan => plan.activity?.steps.map(step => step.requestId) ?? []);
  const receipts = ids.length ? await db.from("business_operation_receipts").select("id,state").eq("business_id", actor.business.id).eq("user_id", actor.userId).in("id", ids) : { data: [], error: null };
  const progress = new Map((receipts.data ?? []).map(row => [row.id, row.state]));
  return <>
    <section className="panel section-pad"><h2>Punët e tua me asistentin</h2>
      {plans.error || receipts.error ? <p role="alert">Progresi nuk u ngarkua. Rifresko faqen përpara një veprimi tjetër.</p> : activityPlans.length ? activityPlans.map(plan => {
        const steps = plan.activity?.steps ?? [];
        const done = steps.filter(step => progress.get(step.requestId) === "completed").length;
        const stopped = steps.findIndex(step => progress.get(step.requestId) !== "completed");
        const stoppedStep = plan.state === "blocked" && stopped >= 0 ? steps[stopped] : null;
        // When every step is the same kind of action, its name says nothing per row.
        const sameKind = new Set(steps.map(step => step.title)).size === 1;
        return <article key={plan.id} className="activity-plan">
          <header className="activity-plan-head">
            <h3>{plan.title}</h3>
            <span className={`activity-pill is-${plan.state === "completed" ? "success" : plan.state === "blocked" ? "warning" : "neutral"}`}>{planState[plan.state] ?? "Në pritje të konfirmimit"}</span>
          </header>
          {steps.length > 0 && <div className="activity-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Hapat e kryer">
            <span className={`activity-progress-fill is-${plan.state}`} style={{ width: `${Math.round(done / steps.length * 100)}%` }} />
          </div>}
          <p className="muted-copy">{steps.length ? `${done}/${steps.length} hapa të kryer` : ""}{plan.updated_at ? ` · përditësuar ${formatActivityTime(plan.updated_at)}` : ""}</p>
          {stoppedStep && <div className="activity-callout is-warning" role="status">
            <span className="activity-icon is-warning" aria-hidden="true">!</span>
            <p>Konfigurimi u ndal te hapi {stopped + 1}: <strong>{stoppedStep.subject ?? stoppedStep.title}</strong>. Hapat e kryer janë ruajtur dhe nuk përsëriten.</p>
          </div>}
          {!plan.activity && <p role="alert">Hapat e planit nuk u ngarkuan. Progresi i ruajtur nuk ka ndryshuar.</p>}
          {steps.length > 0 && <details className="activity-steps" open={plan.state !== "completed" && steps.length <= 6}>
            <summary>{sameKind ? `${steps[0].title} · ${steps.length} hapa` : `Shiko ${steps.length} hapat`}</summary>
            <ol>{steps.map(step => {
              const state = progress.get(step.requestId);
              const tone = state === "completed" ? "success" : state ? "warning" : step === stoppedStep ? "danger" : "neutral";
              return <li key={step.requestId} className={`is-${tone}`}>
                <span className={`activity-icon is-${tone}`} aria-hidden="true">{tone === "success" ? "✓" : tone === "neutral" ? "" : "!"}</span>
                <span className="activity-step-label">{sameKind ? step.subject ?? step.title : step.subject ? `${step.title} · ${step.subject}` : step.title}</span>
                <span className={`activity-pill is-${tone}`}>{state === "completed" ? "Përfunduar" : state ? "Për t’u verifikuar" : step === stoppedStep ? "Nuk u krye" : "Në pritje"}</span>
              </li>;
            })}</ol>
          </details>}
          {plan.state !== "completed" && plan.activity && (plan.activity.version === 1
            ? <OperationButton slug={slug} operation="plan.resume" input={{ id: plan.id }}>Rishqyrto dhe vazhdo</OperationButton>
            : <p>Për ta vazhduar, kërkoji <Link className="inline-link" href={`/b/${slug}`}>Asistentit AI</Link> të vazhdojë konfigurimin e biznesit.</p>)}
        </article>;
      }) : <p>Ende nuk ke plane me disa hapa.</p>}
    </section>
    <section className="panel section-pad"><h2>Njoftimet e ndjekjes</h2>
      {events.error ? <p role="alert">Njoftimet nuk u ngarkuan.</p> : events.data?.length ? events.data.map(event => <article key={event.id} className="activity-plan"><h3>{event.title}</h3><p>{event.detail}</p><p className="muted-copy">{formatActivityTime(event.created_at)} · Gjendja në çastin e kontrollit</p><Link className="inline-link" href={event.href}>Kontrollo gjendjen →</Link></article>) : <p>Ende nuk ka njoftime. Ndjekjen ditore e aktivizon te <Link className="inline-link" href={`/b/${slug}/settings/preferences`}>Preferencat</Link>.</p>}
    </section>
  </>;
}
