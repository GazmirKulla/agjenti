"use client";
import { useId, useRef, useState } from "react";
import type { ActionPlan, ActionPlanReadiness, ActionPlanStep } from "@/lib/business-assistant/action-plan";
import "./action-plan.css";
import { CatalogActivationDialog } from "./catalog-activation";
import type { CapabilityAssessment } from "@/lib/capabilities/registry";

type Decision = "approved" | "rejected";
const labels: Record<ActionPlanReadiness | "APPROVED", string> = {
  READY: "Gati për shqyrtim", NEEDS_CONFIGURATION: "Kërkon konfigurim", DISABLED: "I çaktivizuar",
  UNSUPPORTED: "Nuk mbështetet", BLOCKED: "Kërkon verifikim / sqarim", APPROVED: "Miratuar vetëm në plan",
};

export function ApprovalCard({ step, decision, busy = false, onDecision, onRequest, onConfigure }: {
  step: ActionPlanStep; decision?: Decision; busy?: boolean;
  onDecision: (decision: Decision | undefined) => void;
  onRequest: (message: string) => void;
  onConfigure?: () => void;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [change, setChange] = useState("");
  const canApprove = step.supported && step.approvalRequired && step.readiness === "READY";
  const status = decision === "approved" && canApprove ? "APPROVED" : step.readiness;
  return <article className="action-plan-card" aria-labelledby={titleId} data-status={status}>
    <header><h4 id={titleId}>{step.title}</h4><span className="action-plan-status" role="status">{decision === "rejected" ? "Refuzuar në këtë shqyrtim" : labels[status]}</span></header>
    <p className="action-plan-request">Kërkesa jote: {step.requestedBehavior}</p>
    <p>{step.description}</p>
    {step.missingConfiguration.length > 0 && <div><strong>Çfarë mungon</strong><ul>{step.missingConfiguration.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {step.requiredDecision && <p><strong>Duhet vendimi yt: </strong>{step.requiredDecision}</p>}
    <p><strong>Hapi i propozuar: </strong>{step.proposedAction}</p>
    {onConfigure && <button type="button" disabled={busy} onClick={onConfigure}>Kontrollo konfigurimin e katalogut</button>}
    <div className="action-plan-actions">
      <button type="button" disabled={busy || !canApprove || decision === "approved"} onClick={() => onDecision("approved")}>Mirato hapin</button>
      <button type="button" disabled={busy} onClick={() => onDecision(decision === "rejected" ? undefined : "rejected")}>{decision === "rejected" ? "Rikthe në shqyrtim" : "Refuzo"}</button>
      <button type="button" disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>Kërko ndryshime</button>
    </div>
    {editing && <div className="action-plan-edit">
      <label>Çfarë dëshiron të ndryshosh?
        <textarea autoFocus value={change} maxLength={1000} rows={3} disabled={busy} onChange={event => setChange(event.target.value)} placeholder="Shpjego vendimin ose ndryshimin me fjalët e tua." />
      </label>
      <button type="button" disabled={busy || !change.trim()} onClick={() => { onRequest(change.trim()); setEditing(false); }}>Vazhdo në chat</button>
    </div>}
    <details><summary>Hollësi teknike</summary><dl>
      <dt>Aftësia</dt><dd>{step.requiredCapability ?? "E paidentifikuar"}</dd>
      <dt>Gatishmëria e aftësisë në server</dt><dd>{step.capabilityReadiness ?? "E paverifikuar"}</dd>
      <dt>Gjendja e hapit në plan</dt><dd>{step.readiness}</dd>
      <dt>Arsyeja</dt><dd>{step.reasonCode}</dd>
      <dt>Miratim i hapit</dt><dd>{step.approvalRequired ? "Kërkohet; nuk autorizon ekzekutim" : "Nuk mund të miratohet për ekzekutim"}</dd>
    </dl></details>
  </article>;
}

/** Decisions are transient UI preferences. Never send them as authorization or persist a ticket. */
export function ActionPlanReview({ plan, busy, onRequest, slug, onAssessment }: {
  plan: ActionPlan; busy: boolean; onRequest: (message: string) => void;
  slug?: string; onAssessment?: (assessment: CapabilityAssessment) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision | undefined>>({});
  const [configuring, setConfiguring] = useState(false);
  const section = useRef<HTMLElement>(null);
  const approved = plan.steps.filter(step => decisions[step.id] === "approved" && step.readiness === "READY").length;
  const rejected = plan.steps.filter(step => decisions[step.id] === "rejected").length;
  return <section ref={section} tabIndex={-1} className="action-plan" aria-label="Plani i veprimeve">
    <h3>Çfarë do të bëjë agjenti yt</h3>
    <p>Shqyrto hapat një nga një. Miratimi këtu shënon vetëm preferencën tënde në këtë plan; nuk ruan, aktivizon apo publikon konfigurim.</p>
    {slug && <p className="action-plan-note">Konfigurimi i katalogut hap një dialog të veçantë me miratim të shprehur për ndryshimin real.</p>}
    <p className="action-plan-note">Gatishmëria pasqyron kontrollin e fundit. Konfigurimi dhe lejet duhen rivlerësuar para çdo ndryshimi. Zgjedhjet nuk ruhen pas një plani të ri ose ringarkimit.</p>
    {plan.questions.length > 0 && <div><strong>Para se të vazhdojmë</strong><ul>{plan.questions.map((q, index) => <li key={index}>{q}</li>)}</ul></div>}
    {plan.assumptions.length > 0 && <details><summary>Supozimet e planit</summary><ul>{plan.assumptions.map((a, index) => <li key={index}>{a}</li>)}</ul></details>}
    {plan.steps.map(step => <ApprovalCard key={step.id} step={step} decision={decisions[step.id]} busy={busy}
      onConfigure={slug && onAssessment && step.supported && step.requiredCapability === "product.search" && ["NEEDS_CONFIGURATION", "DISABLED", "BLOCKED"].includes(step.readiness) ? () => setConfiguring(true) : undefined}
      onDecision={decision => setDecisions(current => ({ ...current, [step.id]: decision }))}
      onRequest={message => onRequest(`Përditëso vetëm planin për këtë kërkesë, pa ruajtur ose aktivizuar asgjë: ${plan.request}\nHapi: ${step.requestedBehavior}\nNdryshimi që kërkoj: ${message}`)} />)}
    <p role="status">{approved} hapa të miratuar · {rejected} të refuzuar · Asgjë e publikuar</p>
    <div className="action-plan-actions">
      <button type="button" disabled={busy} onClick={() => setDecisions(Object.fromEntries(plan.steps.map(step => [step.id, "rejected"])))}>Refuzo planin</button>
      <button type="button" disabled={busy} onClick={() => onRequest(`Rivlerëso vetëm planin dhe gatishmërinë aktuale, pa ruajtur ose aktivizuar asgjë: ${plan.request}`)}>Rivlerëso me AI</button>
    </div>
    {configuring && slug && onAssessment && <CatalogActivationDialog slug={slug} onClose={() => {
      setConfiguring(false); requestAnimationFrame(() => section.current?.focus());
    }} onAssessment={onAssessment} />}
  </section>;
}
