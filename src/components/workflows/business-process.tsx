"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveBusinessProcess } from "@/lib/discovery/process-actions";
import type { BusinessProcess } from "@/lib/discovery/business-process";
import "./business-process.css";
const starter: BusinessProcess = { version: 1, source: "manual", enabled: true, name: "Si funksionon biznesi", summary: "", steps: [{ key: "business_step_1", title: "", description: "", evidence: "", sourceRef: "manual" }], unknowns: [] };
export function BusinessProcessView({ slug, initialProcess, initialRevision }: { slug: string; initialProcess: BusinessProcess | null; initialRevision: number }) {
  const router = useRouter();
  const [process, setProcess] = useState(initialProcess), [revision, setRevision] = useState(initialRevision);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<BusinessProcess>(starter);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setProcess(initialProcess); setRevision(initialRevision); }, [initialProcess, initialRevision]);
  useEffect(() => {
    if (!editing) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setEditing(false);
      if (event.key !== "Tab") return;
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled])') ?? [])];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [editing, busy]);
  async function save(next: BusinessProcess) {
    setBusy(true); setError("");
    try {
      const result = await saveBusinessProcess(slug, revision, next);
      if (result.error) { setError(result.error); return; }
      if (result.process) { setProcess(result.process); setRevision(result.revision!); setEditing(false); router.refresh(); }
    } catch { setError("Rrjedha nuk u ruajt. Provo përsëri."); }
    finally { setBusy(false); }
  }
  const edit = () => { setDraft(structuredClone(process ?? starter)); setError(""); setEditing(true); };
  return <section className="business-process" aria-labelledby="business-process-title">
    <header className="business-process-header"><div><p className="business-process-eyebrow">RRJEDHA E BIZNESIT</p><h2 id="business-process-title">{process?.name ?? "Si funksionon biznesi yt"}</h2></div><button ref={trigger} type="button" className="btn btn-ghost" onClick={edit} disabled={busy}>{process ? "Përshtat rrjedhën ↗" : "Përshkruaj rrjedhën ↗"}</button></header>
    {process ? <><p className="business-process-summary">{process.summary}</p><div className="business-process-status"><span className={process.enabled ? "is-enabled" : ""}>{process.enabled ? "● Agjenti e përdor në përgjigje" : "○ Nuk përdoret nga Agjenti"}</span><span>{process.source === "generated" ? process.basis === "onboarding" ? "Pikënisje nga onboarding-u" : "Përgatitur nga analiza" : "Përshtatur nga biznesi"}</span></div>
    <ol className="business-process-timeline">{process.steps.map((step, index) => <li key={step.key}><span className="business-process-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.description}</p>{step.evidence && <details><summary>{step.sourceRef.startsWith("onboarding:") ? "Udhëzim nga onboarding-u" : "Burimi i këtij hapi"}</summary><blockquote>{step.evidence}</blockquote><small>{step.sourceRef.startsWith("onboarding:") ? "Bazuar në ofertën, qëllimet dhe aftësitë e biznesit." : step.sourceRef}</small></details>}</div></li>)}</ol>
    {Boolean(process.publishedSteps?.length) && <details className="business-process-unknowns"><summary>Mënyra e biznesit · {process.publishedSteps!.length} hapa {process.source === "manual" ? "të përshtatur" : "nga burimet"}</summary><ol className="business-process-timeline">{process.publishedSteps!.map((step, index) => <li key={step.key}><span className="business-process-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.description}</p>{step.evidence && <details><summary>Burimi i këtij hapi</summary><blockquote>{step.evidence}</blockquote><small>{step.sourceRef}</small></details>}</div></li>)}</ol></details>}
    {process.unknowns.length > 0 && <details className="business-process-unknowns"><summary>{process.unknowns.length === 1 ? "1 detaj mund të plotësohet më vonë" : `${process.unknowns.length} detaje mund të plotësohen më vonë`}</summary><ul>{process.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    <footer><p>Rrjedha lidh mënyrën e bisedës me informacionin e biznesit. Mund ta ndryshosh gjatë përdorimit.</p><button type="button" className="soft-link" disabled={busy} onClick={() => void save({ ...process, enabled: !process.enabled })}>{process.enabled ? "Mos e përdor këtë rrjedhë" : "Përdor këtë rrjedhë"}</button></footer></> : <p className="business-process-summary">Analiza e Instagram-it dhe website-it përgatit këtu hapat që klientët ndjekin në biznesin tënd. Detajet e paqarta mund t’i plotësosh gjatë përdorimit.</p>}
    {!editing && error && <p className="business-process-error" role="alert">{error}</p>}
    {editing && <div className="business-process-overlay"><div ref={dialog} className="business-process-editor" role="dialog" aria-modal="true" aria-labelledby="process-editor-title"><header><div><p className="business-process-eyebrow">PËRSHTAT RRJEDHËN</p><h2 id="process-editor-title">Në mënyrën e biznesit tënd.</h2></div><button className="btn btn-ghost" type="button" aria-label="Mbyll përshtatjen" disabled={busy} onClick={() => setEditing(false)}>×</button></header>
    <form onSubmit={event => { event.preventDefault(); void save(draft); }}><fieldset disabled={busy}><label className="form-label">Emri<input className="field" required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label className="form-label">Përshkrimi<textarea className="field" required maxLength={1000} value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></label>
    <div className="business-process-edit-steps">{draft.steps.map((step, index) => <div key={step.key}><header><span>HAPI {index + 1}</span>{draft.steps.length > 1 && <button type="button" className="soft-link" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}>Hiq hapin</button>}</header><label className="form-label">Titulli<input className="field" required maxLength={100} value={step.title} onChange={event => setDraft({ ...draft, steps: draft.steps.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></label><label className="form-label">Çfarë ndodh në këtë hap?<textarea className="field" required maxLength={1000} value={step.description} onChange={event => setDraft({ ...draft, steps: draft.steps.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })} /></label></div>)}</div>
    {draft.steps.length < 8 && <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { key: crypto.randomUUID(), title: "", description: "", evidence: "", sourceRef: "manual" }] })}>+ Shto hap</button>}
    {Boolean(draft.publishedSteps?.length) && <details className="business-process-unknowns"><summary>Përshtat edhe hapat e biznesit nga burimet</summary>{draft.publishedSteps!.map((step, index) => <div key={step.key}><header><span>HAPI I BIZNESIT {index + 1}</span><button type="button" className="soft-link" onClick={() => setDraft({ ...draft, publishedSteps: draft.publishedSteps!.filter((_, i) => i !== index) })}>Hiq hapin</button></header><label className="form-label">Titulli i hapit të biznesit<input className="field" required maxLength={100} value={step.title} onChange={event => setDraft({ ...draft, publishedSteps: draft.publishedSteps!.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></label><label className="form-label">Si funksionon në biznes<textarea className="field" required maxLength={1000} value={step.description} onChange={event => setDraft({ ...draft, publishedSteps: draft.publishedSteps!.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })} /></label></div>)}</details>}
    <label className="form-label">Detaje për t’u plotësuar më vonë · deri në 6 rreshta<textarea className="field" maxLength={1800} value={draft.unknowns.join("\n")} onChange={event => setDraft({ ...draft, unknowns: event.target.value.split("\n") })} /></label>
    <label className="business-process-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Agjenti ta përdorë këtë rrjedhë</label></fieldset>
    {error && <p className="business-process-error" role="alert">{error}</p>}<div className="business-process-editor-actions"><span>{busy ? "Po ruajmë rrjedhën…" : "Përshtatjet ruhen për këtë biznes."}</span><button className="btn btn-primary" disabled={busy}>{busy ? "Duke ruajtur…" : "Ruaj rrjedhën →"}</button></div></form></div></div>}
  </section>;
}
