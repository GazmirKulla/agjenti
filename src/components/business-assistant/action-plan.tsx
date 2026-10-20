"use client";
import { useId, useRef, useState } from "react";
import type { ActionPlan, ActionPlanStep } from "@/lib/business-assistant/action-plan";
import "./action-plan.css";
import { CapabilityActivationDialog } from "./catalog-activation";
import type { CapabilityAssessment } from "@/lib/capabilities/registry";
import { isUnsupportedStep, planStepLabel, type ActivationFeedback } from "./presentation";

type Decision = "approved" | "rejected";
export function ApprovalCard({ step, decision, busy = false, feedback, onDecision, onRequest, onConfigure, onNext }: {
  step: ActionPlanStep; decision?: Decision; busy?: boolean; feedback?: ActivationFeedback;
  onDecision: (decision: Decision | undefined) => void;
  onRequest: (message: string) => void;
  onConfigure?: () => void;
  onNext?: () => void;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [change, setChange] = useState("");
  const changeButton = useRef<HTMLButtonElement>(null);
  const canInclude = step.supported && step.approvalRequired && step.readiness === "READY" && !feedback?.unverified;
  const unsupported = isUnsupportedStep(step);
  const label = planStepLabel(step, decision, feedback?.unverified);
  return <article tabIndex={-1} className="action-plan-card" aria-labelledby={titleId} data-status={step.readiness}>
    <header><span className="action-plan-status" role="status">{label}</span><h4 id={titleId}>{step.title}</h4></header>
    <p>{step.description}</p>
    {unsupported && <p className="action-plan-blocker">{step.requiredCapability === "customer.create"
      ? "Regjistrimi automatik i klientit nuk konfigurohet nga Migo. Mbledhja e të dhënave në bisedë nuk krijon një klient në CRM."
      : "Ky hap nuk mund të konfigurohet nga Migo. Mund të vazhdosh me pjesën e mbështetur të planit."}</p>}
    {step.readiness === "DISABLED" && <p className="action-plan-blocker">Funksioni është i çaktivizuar ose nuk lejohet nga paketa. Ky plan nuk aktivizon module dhe nuk ndryshon leje.</p>}
    {step.missingConfiguration.length > 0 && <div className="action-plan-blocker"><strong>Çfarë na duhet</strong><ul>{step.missingConfiguration.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {step.requiredDecision && <p>{step.requiredDecision}</p>}
    {feedback && <div className="action-plan-outcome" role="status"><strong>{feedback.label}</strong><p>{feedback.message}</p></div>}
    {decision === "approved" && canInclude && <p className="action-plan-note">E përfshimë në plan. Nuk u aktivizua apo publikua asgjë nga kjo zgjedhje.</p>}
    <div className="action-plan-actions">
      {(decision === "rejected" || decision === "approved" && canInclude) && !feedback?.unverified ? onNext && <button type="button" className="action-plan-primary" disabled={busy} onClick={onNext}>Hapi tjetër</button> :
        onConfigure ? <button type="button" className="action-plan-primary" disabled={busy} onClick={onConfigure}>Konfiguro</button> :
          canInclude ? <button type="button" className="action-plan-primary" disabled={busy} onClick={() => onDecision("approved")}>Përfshi në plan</button> : null}
      <button type="button" disabled={busy} onClick={() => onDecision(decision ? undefined : "rejected")}>{decision ? "Rikthe në shqyrtim" : "Jo tani"}</button>
      <button ref={changeButton} type="button" className={!canInclude && !onConfigure && !decision ? "action-plan-primary" : undefined} disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>{unsupported ? "Kërko alternativë" : "Kërko ndryshime"}</button>
    </div>
    {editing && <div className="action-plan-edit">
      <label>Çfarë dëshiron të ndryshosh?
        <textarea autoFocus value={change} maxLength={1000} rows={3} disabled={busy} onChange={event => setChange(event.target.value)} placeholder="Shpjego ndryshimin me fjalët e tua." />
      </label>
      <div className="action-plan-actions">
        <button type="button" disabled={busy || !change.trim()} onClick={() => { onRequest(change.trim()); setEditing(false); }}>Vazhdo në chat</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); changeButton.current?.focus(); }}>Anulo</button>
      </div>
    </div>}
    <details><summary>Detaje teknike</summary><dl>
      <dt>Kërkesa</dt><dd>{step.requestedBehavior}</dd>
      <dt>Aftësia</dt><dd>{step.requiredCapability ?? "E paidentifikuar"}</dd>
      <dt>Gatishmëria në server</dt><dd>{step.capabilityReadiness ?? "E paverifikuar"}</dd>
      <dt>Gjendja e hapit</dt><dd>{step.readiness}</dd>
      <dt>Arsyeja</dt><dd>{step.reasonCode}</dd>
      <dt>Propozimi</dt><dd>{step.proposedAction}</dd>
    </dl></details>
  </article>;
}

/** Transient presentation only: local selection is never a server approval ticket. */
export function ActionPlanReview({ plan, busy, onRequest, slug, businessName, onAssessment }: {
  plan: ActionPlan; busy: boolean; onRequest: (message: string) => void;
  slug?: string; businessName?: string; onAssessment?: (assessment: CapabilityAssessment) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision | undefined>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [configuring, setConfiguring] = useState<"product.search" | "knowledge.answer" | null>(null);
  // Last server outcomes for display; never keep approval tokens here.
  const [outcomes, setOutcomes] = useState<Record<string, ActivationFeedback>>({});
  const section = useRef<HTMLElement>(null);
  const focused = plan.steps.find(step => step.id === selectedId) ?? plan.steps[0];
  const included = plan.steps.filter(step => decisions[step.id] === "approved" && step.supported && step.readiness === "READY" && !outcomes[step.requiredCapability ?? ""]?.unverified).length;
  const omitted = plan.steps.filter(step => decisions[step.id] === "rejected").length;
  const unsupported = plan.steps.filter(isUnsupportedStep);
  const next = focused && plan.steps.find(step => step.id !== focused.id && !decisions[step.id]);
  return <section ref={section} tabIndex={-1} className="action-plan" aria-label="Plani i veprimeve">
    <header className="action-plan-heading"><h3>Ta përgatisim bashkë</h3>{businessName && <p>Për biznesin <strong>{businessName}</strong></p>}</header>
    <p>Zgjedhim hapat, pastaj konfigurojmë çfarë mungon. “Përfshi në plan” nuk ruan, aktivizon apo publikon asgjë.</p>
    {unsupported.length > 0 && <p className="action-plan-blocker"><strong>Nuk mbështetet</strong>: {unsupported.map(step => step.title).join(", ")}. Mund të vazhdosh me hapat e tjerë.</p>}
    {plan.questions.length > 0 && <div><strong>Para se të vazhdojmë</strong><ul>{plan.questions.map((q, index) => <li key={index}>{q}</li>)}</ul></div>}
    {configuring && slug && onAssessment ? <CapabilityActivationDialog key={`${slug}:${configuring}`} capability={configuring} slug={slug} businessName={businessName ?? slug}
      onClose={() => { setConfiguring(null); requestAnimationFrame(() => section.current?.focus()); }}
      onAssessment={onAssessment} onOutcome={outcome => setOutcomes(current => ({ ...current, [configuring]: outcome }))} /> :
      <>
        {plan.steps.length > 1 && <details className="action-plan-outline">
        <summary>Hapi {plan.steps.indexOf(focused) + 1} nga {plan.steps.length} · Shiko hapat</summary>
        <ol className="action-plan-steps" aria-label="Hapat e planit">
          {plan.steps.map((step, index) => <li key={step.id}><button type="button" disabled={busy} aria-current={step.id === focused?.id ? "step" : undefined}
            onClick={event => {
              setSelectedId(step.id); event.currentTarget.closest("details")?.removeAttribute("open");
              requestAnimationFrame(() => section.current?.querySelector("article")?.focus());
            }}><span className="action-plan-step-number" aria-hidden="true">{index + 1}</span><span>{step.title}<small>{planStepLabel(step, decisions[step.id], outcomes[step.requiredCapability ?? ""]?.unverified)}</small></span></button></li>)}
        </ol>
        </details>}
        {focused ? <ApprovalCard key={focused.id} step={focused} decision={decisions[focused.id]} feedback={outcomes[focused.requiredCapability ?? ""]} busy={busy}
          onConfigure={slug && onAssessment && focused.supported && (focused.requiredCapability === "product.search" || focused.requiredCapability === "knowledge.answer") &&
            (["NEEDS_CONFIGURATION", "DISABLED", "BLOCKED"].includes(focused.readiness) || outcomes[focused.requiredCapability]?.unverified)
            ? () => setConfiguring(focused.requiredCapability as "product.search" | "knowledge.answer") : undefined}
          onNext={next ? () => { setSelectedId(next.id); section.current?.focus(); } : undefined}
          onDecision={decision => setDecisions(current => ({ ...current, [focused.id]: decision }))}
          onRequest={message => onRequest(`Përditëso vetëm planin për këtë kërkesë, pa ruajtur ose aktivizuar asgjë: ${plan.request}\nHapi: ${focused.requestedBehavior}\nNdryshimi që kërkoj: ${message}`)} /> : <p>Nuk ka ende hapa. Sqaro rezultatin që dëshiron në chat.</p>}
        <p role="status" className="action-plan-note">{included} të përfshirë · {omitted} të lënë jashtë · Asgjë e publikuar</p>
        <details><summary>Rishiko planin</summary>
          {plan.assumptions.length > 0 && <><strong>Supozimet</strong><ul>{plan.assumptions.map((a, index) => <li key={index}>{a}</li>)}</ul></>}
          <div className="action-plan-actions">
            <button type="button" disabled={busy} onClick={() => setDecisions(Object.fromEntries(plan.steps.map(step => [step.id, "rejected"])))}>Lëre planin për më vonë</button>
            <button type="button" disabled={busy} onClick={() => onRequest(`Rivlerëso vetëm planin dhe gatishmërinë aktuale, pa ruajtur ose aktivizuar asgjë: ${plan.request}`)}>Kërko rivlerësim në chat</button>
          </div>
        </details>
      </>}
    <p className="action-plan-note">Zgjedhjet nuk ruhen pas ringarkimit ose një plani të ri. Publikimi mbetet veprim më vete te Workflow Designer.</p>
  </section>;
}
