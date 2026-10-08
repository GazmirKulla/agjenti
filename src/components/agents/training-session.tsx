"use client";
import { useEffect, useId, useRef, useState } from "react";
import { changeAgentTraining, listAgentTraining, saveAgentTraining } from "@/lib/agents/training/actions";
import type { TrainingInput, TrainingKind, TrainingMemory, TrainingTarget, TrainingWorkflow } from "@/lib/agents/training/model";
import "./training-session.css";

export type TrainingFeedback = { receipt: string; question: string; response: string; workflowId: string | null; stepKey: string | null };
const labels: Record<TrainingKind, string> = { style: "Stili i përgjigjeve", example: "Shembull përgjigjeje", workflow: "Udhëzim për workflow" };
const blank = (): TrainingInput => ({ kind: "style", instruction: "", customerMessage: "", desiredResponse: "", workflowId: null, stepKey: null });

export function TrainingSession({ target, feedback, busy = false, onBusyChange, onChanged }: {
  target: TrainingTarget; feedback?: TrainingFeedback | null; busy?: boolean;
  onBusyChange?: (busy: boolean) => void; onChanged?: () => void;
}) {
  const id = useId();
  const [memories, setMemories] = useState<TrainingMemory[]>([]);
  const [workflows, setWorkflows] = useState<TrainingWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<TrainingInput | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const targetKey = "slug" in target ? `slug:${target.slug}` : `id:${target.businessId}`;
  useEffect(() => {
    let stale = false;
    const resolved: TrainingTarget = targetKey.startsWith("slug:") ? { slug: targetKey.slice(5) } : { businessId: targetKey.slice(3) };
    listAgentTraining(resolved).then(result => {
      if (stale) return;
      if ("error" in result) setError(result.error);
      else { setMemories(result.memories); setWorkflows(result.workflows); }
    }).catch(() => { if (!stale) setError("Memoria nuk u ngarkua. Provo rifreskimin e faqes."); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [targetKey]);
  const locked = pending || busy || loading;
  const selectedWorkflow = workflows.find(w => w.id === editor?.workflowId);
  const activeCount = memories.filter(m => m.is_active).length;
  async function mutate(operation: () => Promise<{ success: true } | { error: string }>) {
    if (locked || inFlight.current) return;
    inFlight.current = true;
    let saved = false;
    setPending(true); onBusyChange?.(true); setError(""); setNotice("");
    try {
      const result = await operation();
      if ("error" in result) { setError(result.error); return; }
      saved = true;
      setEditor(null); setRemoveId(null);
      setNotice("Memoria u përditësua për këtë biznes. Mësimet aktive do të përdoren në përgjigjet e ardhshme të provës dhe në bisedat reale. Biseda e provës u rifillua për ta kontrolluar.");
      onChanged?.();
      const next = await listAgentTraining(target);
      if ("error" in next) setError(next.error); else { setMemories(next.memories); setWorkflows(next.workflows); }
    } catch { setError(saved ? "Ndryshimi u ruajt, por lista nuk u rifreskua. Rifresko faqen për ta parë." : "Ndryshimi nuk u ruajt. Provo përsëri."); }
    finally { inFlight.current = false; setPending(false); onBusyChange?.(false); }
  }
  function fromFeedback(approve: boolean) {
    if (!feedback) return;
    setNotice(""); setError("");
    setEditor({ kind: "example", instruction: approve ? "Përdor këtë shembull si model për formulimin e përgjigjeve ndaj pyetjeve të ngjashme." : "", customerMessage: feedback.question, desiredResponse: feedback.response.slice(0, 3000), receipt: feedback.receipt, workflowId: null, stepKey: null });
  }
  return <section className="training-session" aria-labelledby={`${id}-heading`} aria-busy={pending}>
    <header><div><span className="training-eyebrow">TRAJNO AGJENTIN</span><h2 id={`${id}-heading`}>Mësoji si të përgjigjet për biznesin tënd</h2><p>Ruaj preferenca, korrigjo përgjigje dhe përshtat mënyrën si shpjegon hapat e workflow-t. Mësimet ruhen vetëm pasi t’i konfirmosh.</p></div><span className="training-count">{activeCount} mësime aktive</span></header>
    {loading && <p role="status">Duke ngarkuar memorien…</p>}
    {feedback && <div className="training-feedback"><strong>Përgjigjja që po trajnon</strong><blockquote>{feedback.response}</blockquote><div className="training-controls"><button className="btn btn-ghost" type="button" disabled={locked} onClick={() => fromFeedback(true)}>✓ Përgjigje e mirë</button><button className="btn btn-primary" type="button" disabled={locked} onClick={() => fromFeedback(false)}>✎ Korrigjo përgjigjen</button></div><small>Vlerësimi hap një propozim për ta kontrolluar. Ruajtja e konfirmuar përshtat edhe përgjigjet për klientët e këtij biznesi.</small></div>}
    <button className="btn btn-ghost" type="button" disabled={locked} onClick={() => { setEditor(blank()); setNotice(""); }}>＋ Shto një preferencë ose udhëzim</button>
    {editor && <form className="training-editor" onSubmit={e => { e.preventDefault(); void mutate(() => saveAgentTraining(target, editor)); }}>
      <h3>{editor.id ? "Ndrysho mësimin" : "Çfarë duhet të mbajë mend Agjenti?"}</h3>
      <label htmlFor={`${id}-kind`}>Lloji i mësimit</label><select id={`${id}-kind`} value={editor.kind} disabled={locked} onChange={e => { const kind = e.target.value as TrainingKind; setEditor({ ...editor, kind, ...(kind === "style" ? { workflowId: null, stepKey: null } : {}) }); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor={`${id}-instruction`}>Udhëzimi që do të mbajë mend</label><textarea id={`${id}-instruction`} required rows={3} maxLength={1500} disabled={locked} placeholder="P.sh. Përgjigju shkurt, pa shumë emoji. Shpjego pse na duhet fotoja para se ta kërkosh." value={editor.instruction} onChange={e => setEditor({ ...editor, instruction: e.target.value })} />
      {editor.kind === "example" && <><label htmlFor={`${id}-question`}>Pyetja e klientit</label><textarea id={`${id}-question`} required rows={2} maxLength={2000} readOnly={Boolean(editor.receipt)} disabled={locked} value={editor.customerMessage} onChange={e => setEditor({ ...editor, customerMessage: e.target.value })} /><label htmlFor={`${id}-response`}>Si duhet të përgjigjet?</label><textarea id={`${id}-response`} required rows={4} maxLength={3000} disabled={locked} value={editor.desiredResponse} onChange={e => setEditor({ ...editor, desiredResponse: e.target.value })} /><small>Shembulli mëson formulimin. Çmimet, stoku dhe të dhënat e klientit merren nga informacioni aktual i biznesit.</small></>}
      {editor.kind !== "style" && <><label htmlFor={`${id}-workflow`}>Ku përdoret?</label><select id={`${id}-workflow`} disabled={locked} required={editor.kind === "workflow"} value={editor.workflowId ?? ""} onChange={e => setEditor({ ...editor, workflowId: e.target.value || null, stepKey: null })}><option value="">{editor.kind === "workflow" ? "Zgjidh workflow-n" : "Në të gjithë biznesin"}</option>{workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>{selectedWorkflow && <><label htmlFor={`${id}-step`}>Hapi i workflow-t</label><select id={`${id}-step`} disabled={locked} value={editor.stepKey ?? ""} onChange={e => setEditor({ ...editor, stepKey: e.target.value || null })}><option value="">Në të gjithë workflow-n</option>{selectedWorkflow.steps.map(step => <option key={step.key} value={step.key}>{step.label}</option>)}</select></>}{feedback?.workflowId && workflows.some(w => w.id === feedback.workflowId) && <button className="btn btn-ghost" disabled={locked} type="button" onClick={() => setEditor({ ...editor, workflowId: feedback.workflowId, stepKey: workflows.find(w => w.id === feedback.workflowId)?.steps.some(s => s.key === feedback.stepKey) ? feedback.stepKey : null })}>Përdor workflow-n e kësaj përgjigjeje</button>}</>}
      <p className="training-note">Udhëzimet përshtatin përgjigjen. Hapat e detyrueshëm dhe të dhënat që kërkon workflow nuk ndryshohen nga një shembull.</p>
      <div className="training-controls"><button className="btn btn-primary" disabled={locked} type="submit">{pending ? "Duke ruajtur…" : "Ruaj për këtë biznes"}</button><button className="btn btn-ghost" type="button" disabled={locked} onClick={() => setEditor(null)}>Anulo</button></div>
    </form>}
    {notice && <p className="training-notice" role="status">{notice}</p>}{error && <p className="training-error" role="alert">{error}</p>}
    <details className="training-memories"><summary>Memoria e biznesit ({memories.length})</summary>{!memories.length && !loading && <p>Ende nuk ka mësime të ruajtura. Shto një preferencë ose korrigjo një përgjigje gjatë provës.</p>}
      {memories.map(memory => <article key={memory.id} className={memory.is_active ? "" : "is-disabled"}><div><strong>{labels[memory.kind]}</strong><span>{memory.is_active ? "Aktiv" : "Joaktiv"} · v{memory.revision}</span></div><p>{memory.instruction}</p><small>{memory.workflow_id ? `${workflows.find(w => w.id === memory.workflow_id)?.name ?? "Workflow"}${memory.step_key ? ` → ${memory.step_key}` : ""}` : "Për të gjithë biznesin"}</small>{memory.kind === "example" && <details><summary>Shiko shembullin</summary><p><strong>Klienti:</strong> {memory.customer_message}</p><p><strong>Agjenti:</strong> {memory.desired_response}</p></details>}<div className="training-controls"><button className="btn btn-ghost" disabled={locked} onClick={() => setEditor({ id: memory.id, revision: memory.revision, kind: memory.kind, instruction: memory.instruction, customerMessage: memory.customer_message, desiredResponse: memory.desired_response, workflowId: memory.workflow_id, stepKey: memory.step_key })}>Ndrysho</button><button className="btn btn-ghost" disabled={locked} onClick={() => void mutate(() => changeAgentTraining(target, { id: memory.id, revision: memory.revision, action: memory.is_active ? "disable" : "enable" }))}>{memory.is_active ? "Çaktivizo" : "Aktivizo"}</button><button className="btn btn-ghost" disabled={locked} onClick={() => setRemoveId(memory.id)}>Hiq</button></div>{removeId === memory.id && <div className="training-remove"><p>Ta heqësh këtë mësim nga memoria e biznesit?</p><button className="btn btn-ghost" disabled={locked} onClick={() => setRemoveId(null)}>Anulo</button><button className="btn btn-primary" disabled={locked} onClick={() => void mutate(() => changeAgentTraining(target, { id: memory.id, revision: memory.revision, action: "delete" }))}>Po, hiqe</button></div>}</article>)}
    </details>
  </section>;
}
