"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { listAgentTraining, saveAgentTraining } from "@/lib/agents/training/actions";
import type { TrainingInput, TrainingKind, TrainingTarget, TrainingWorkflow } from "@/lib/agents/training/model";
import type { TrainingFeedback } from "./training-session";
import "./training-session.css";

export const trainingLabels: Record<TrainingKind, string> = { style: "Stili", example: "Përgjigje", workflow: "Workflow" };
export const emptyTraining = (): TrainingInput => ({ kind: "style", instruction: "", customerMessage: "", desiredResponse: "", workflowId: null, stepKey: null });

export function TrainingSpark({ working = false, complete = false }: { working?: boolean; complete?: boolean }) {
  return <span className={`training-spark ${working ? "is-working" : ""} ${complete ? "is-complete" : ""}`} aria-hidden="true"><span className="training-spark-orbit" /><svg viewBox="0 0 32 32" fill="none">{complete ? <path className="training-check" d="m8 16 5 5 11-11" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /> : <><path d="m16 5 2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8L16 5Z" fill="currentColor" /><circle cx="26" cy="6" r="2" fill="currentColor" /></>}</svg></span>;
}

export function TrainingEditor({ target, initial, feedback, memoryHref, onClose, onBusyChange, onSaved }: {
  target: TrainingTarget; initial: TrainingInput; feedback?: TrainingFeedback; memoryHref?: string;
  onClose: () => void; onBusyChange?: (busy: boolean) => void; onSaved?: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [input, setInput] = useState(initial);
  const [workflows, setWorkflows] = useState<TrainingWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"editing" | "saving" | "saved">("editing");
  const targetKey = "slug" in target ? `slug:${target.slug}` : `id:${target.businessId}`;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let stale = false;
    setLoading(true); setLoadError("");
    const resolved: TrainingTarget = targetKey.startsWith("slug:") ? { slug: targetKey.slice(5) } : { businessId: targetKey.slice(3) };
    listAgentTraining(resolved).then(result => {
      if (stale) return;
      if ("error" in result) setLoadError(result.error);
      else setWorkflows(result.workflows);
    }).catch(() => { if (!stale) setLoadError("Nuk u ngarkuan udhëzimet. Provo përsëri."); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [targetKey, attempt]);
  const locked = phase !== "editing";
  const workflow = workflows.find(w => w.id === input.workflowId);
  const change = (values: Partial<TrainingInput>) => setInput(previous => ({ ...previous, ...values }));
  function close() { if (!saving.current) onClose(); }
  async function save() {
    if (saving.current || locked || loading || loadError) return;
    saving.current = true; setPhase("saving"); setError(""); onBusyChange?.(true);
    try {
      const result = await saveAgentTraining(target, input);
      if ("error" in result) { setError(result.error); setPhase("editing"); }
      else { setPhase("saved"); onSaved?.(); }
    } catch { setError("Mësimi nuk u ruajt. Provo përsëri."); setPhase("editing"); }
    finally { saving.current = false; onBusyChange?.(false); }
  }
  return <dialog ref={dialog} className="training-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <button className="training-close" type="button" aria-label="Mbyll trajnimin" disabled={phase === "saving"} onClick={close}>×</button>
    <div className="training-dialog-body">
      {phase === "editing" ? <>
        <header className="training-editor-heading"><TrainingSpark /><span className="training-eyebrow">NJË AGJENT QË TË KUPTON</span><h2 id={`${id}-title`}>{initial.id ? "Përsos këtë mësim." : feedback ? "Përgjigjja, në mënyrën tënde." : "Mësoji diçka të re."}</h2><p>Ti njeh biznesin tënd. Tregoji Agjentit si dëshiron të komunikojë.</p></header>
        <form className="training-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="training-segments" role="group" aria-label="Lloji i mësimit">{Object.entries(trainingLabels).map(([kind, label]) => <button key={kind} type="button" aria-pressed={input.kind === kind} onClick={() => change({ kind: kind as TrainingKind, ...(kind === "style" ? { workflowId: null, stepKey: null } : {}) })}>{label}</button>)}</div>
          {feedback && input.kind === "example" && <div className="training-source"><span>PËRGJIGJJA E PROVËS</span><blockquote>{feedback.response}</blockquote><button type="button" className="training-text-action" onClick={() => change({ instruction: "Përdor këtë shembull si model për formulimin e përgjigjeve ndaj pyetjeve të ngjashme.", desiredResponse: feedback.response.slice(0, 3000) })}>✓ Kjo përgjigje është e mirë</button></div>}
          {input.kind === "example" && <>
            {feedback ? <details className="training-question"><summary>Pyetja e klientit</summary><p>{input.customerMessage}</p></details> : <div className="training-field"><label htmlFor={`${id}-question`}>Pyetja e klientit</label><textarea id={`${id}-question`} required rows={2} maxLength={2000} readOnly={Boolean(input.receipt)} value={input.customerMessage} onChange={event => change({ customerMessage: event.target.value })} /></div>}
            <div className="training-field training-response"><label htmlFor={`${id}-response`}>Si do të doje të përgjigjej?</label><textarea id={`${id}-response`} autoFocus={Boolean(feedback)} required rows={4} maxLength={3000} value={input.desiredResponse} onChange={event => change({ desiredResponse: event.target.value })} /><small>Shembulli përshtat formulimin. Çmimet dhe stoku përdorin të dhënat aktuale.</small></div>
          </>}
          <div className="training-field"><label htmlFor={`${id}-instruction`}>{input.kind === "example" ? "Çfarë duhet të mësojë nga ky korrigjim?" : "Çfarë dëshiron të mbajë mend?"}</label><textarea id={`${id}-instruction`} autoFocus={!feedback} required rows={2} maxLength={1500} placeholder={input.kind === "workflow" ? "P.sh. Shpjego pse na duhet fotoja para se ta kërkosh." : "P.sh. Përgjigju shkurt dhe ngrohtë, pa shumë emoji."} value={input.instruction} onChange={event => change({ instruction: event.target.value })} /></div>
          {!input.instruction && <div className="training-suggestions">{["Përgjigju më shkurt.", "Përdor një ton më profesional.", "Përgjigju pa emoji."].map(suggestion => <button type="button" key={suggestion} onClick={() => change({ instruction: suggestion })}>{suggestion}</button>)}</div>}
          {input.kind !== "style" && <details className="training-scope" open={input.kind === "workflow" || Boolean(input.workflowId)}><summary>Ku zbatohet ky mësim?<span>{workflow?.name ?? "Në të gjithë biznesin"}</span></summary><div className="training-scope-fields"><div className="training-field"><label htmlFor={`${id}-workflow`}>Workflow</label><select id={`${id}-workflow`} disabled={loading} required={input.kind === "workflow"} value={input.workflowId ?? ""} onChange={event => change({ workflowId: event.target.value || null, stepKey: null })}><option value="">{input.kind === "workflow" ? "Zgjidh workflow-n" : "Në të gjithë biznesin"}</option>{workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>{workflow && <div className="training-field"><label htmlFor={`${id}-step`}>Hapi</label><select id={`${id}-step`} value={input.stepKey ?? ""} onChange={event => change({ stepKey: event.target.value || null })}><option value="">Në të gjithë workflow-n</option>{workflow.steps.map(step => <option key={step.key} value={step.key}>{step.label}</option>)}</select></div>}</div>{feedback?.workflowId && workflows.some(w => w.id === feedback.workflowId) && <button className="training-text-action" type="button" onClick={() => change({ workflowId: feedback.workflowId, stepKey: workflows.find(w => w.id === feedback.workflowId)?.steps.some(step => step.key === feedback.stepKey) ? feedback.stepKey : null })}>Lidhe me hapin e kësaj përgjigjeje →</button>}<small>Mësimi përshtat komunikimin; hapat e detyrueshëm të workflow-t mbeten të njëjtë.</small></details>}
          {loading && <p className="training-muted" role="status">Duke përgatitur sesionin…</p>}
          {loadError && <div className="training-error" role="alert">{loadError}<button className="training-text-action" type="button" onClick={() => setAttempt(value => value + 1)}>Provo përsëri</button></div>}
          {error && <p className="training-error" role="alert">{error}</p>}
          <footer className="training-editor-footer"><span>Vetëm për këtë biznes · ruhet me konfirmimin tënd</span><button className="training-action" type="submit" disabled={loading || Boolean(loadError)}>Ruaj mësimin <span aria-hidden>↗</span></button></footer>
        </form>
      </> : <div className={`training-result ${phase === "saved" ? "is-saved" : ""}`} role="status" aria-live="polite"><div className="training-result-glow" /><TrainingSpark working={phase === "saving"} complete={phase === "saved"} /><span className="training-eyebrow">MEMORIA E BIZNESIT</span><h2 id={`${id}-title`}>{phase === "saving" ? "Një hap më pranë teje…" : "Mësimi u ruajt."}</h2><p>{phase === "saving" ? "Po ruajmë udhëzimin tënd për përgjigjet e ardhshme." : "Mësimi është në memorien e biznesit. Mësimet aktive përdoren në përgjigjet e ardhshme, edhe me klientët."}</p>{phase === "saved" && <div className="training-result-actions"><button className="training-action" onClick={close}>Vazhdo <span aria-hidden>→</span></button>{memoryHref && <Link className="training-memory-link" href={memoryHref}>Shiko memorien</Link>}</div>}</div>}
    </div>
  </dialog>;
}
