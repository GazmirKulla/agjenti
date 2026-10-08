"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { changeAgentTraining, listAgentTraining } from "@/lib/agents/training/actions";
import type { TrainingInput, TrainingMemory, TrainingTarget, TrainingWorkflow } from "@/lib/agents/training/model";
import { TrainingEditor, TrainingSpark, emptyTraining, trainingLabels } from "./training-editor";
import "./training-session.css";

const PAGE_SIZE = 15;
export function TrainingMemory({ target }: { target: TrainingTarget }) {
  const [memories, setMemories] = useState<TrainingMemory[]>([]);
  const [workflows, setWorkflows] = useState<TrainingWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<TrainingInput | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const targetKey = "slug" in target ? `slug:${target.slug}` : `id:${target.businessId}`;
  useEffect(() => {
    let stale = false;
    const resolved: TrainingTarget = targetKey.startsWith("slug:") ? { slug: targetKey.slice(5) } : { businessId: targetKey.slice(3) };
    setLoading(true); setError("");
    listAgentTraining(resolved).then(result => {
      if (stale) return;
      if ("error" in result) setError(result.error);
      else { setMemories(result.memories); setWorkflows(result.workflows); }
    }).catch(() => { if (!stale) setError("Memoria nuk u ngarkua. Provo përsëri."); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [targetKey, refresh]);
  const locked = loading || pending;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = memories.filter(memory => (!kind || memory.kind === kind) && (!status || memory.is_active === (status === "active")) && (!normalizedQuery || [memory.instruction, memory.customer_message, memory.desired_response, workflows.find(w => w.id === memory.workflow_id)?.name ?? ""].join(" ").toLocaleLowerCase().includes(normalizedQuery)));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  async function change(memory: TrainingMemory, action: "enable" | "disable" | "delete") {
    if (locked || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(""); setNotice("");
    try {
      const result = await changeAgentTraining(target, { id: memory.id, revision: memory.revision, action });
      if ("error" in result) { setError(result.error); return; }
      setRemoveId(null);
      setNotice(action === "delete" ? "Mësimi u hoq nga memoria." : action === "disable" ? "Mësimi u çaktivizua. Agjenti nuk do ta përdorë." : "Mësimi është sërish aktiv.");
      setRefresh(value => value + 1);
    } catch { setError("Ndryshimi nuk u ruajt. Provo përsëri."); }
    finally { inFlight.current = false; setPending(false); }
  }
  function edit(memory: TrainingMemory) {
    setEditor({ id: memory.id, revision: memory.revision, kind: memory.kind, instruction: memory.instruction, customerMessage: memory.customer_message, desiredResponse: memory.desired_response, workflowId: memory.workflow_id, stepKey: memory.step_key });
  }
  return <section className="training-memory" aria-label="Mësimet e ruajtura" aria-busy={loading || pending}>
    <header className="training-library-heading"><div><h2>Gjithçka që i ke mësuar.</h2><p>{memories.filter(memory => memory.is_active).length} mësime aktive · Ti vendos çfarë përdor Agjenti.</p></div><button className="training-action" disabled={locked} onClick={() => setEditor(emptyTraining())}>Mësim i ri <span aria-hidden>＋</span></button></header>
    <div className="training-library-filters"><label className="training-library-search"><span aria-hidden>⌕</span><span className="sr-only">Kërko në memorie</span><input type="search" placeholder="Kërko një mësim…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><select aria-label="Filtro sipas llojit" value={kind} onChange={event => { setKind(event.target.value); setPage(0); }}><option value="">Të gjitha llojet</option>{Object.entries(trainingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Filtro sipas statusit" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">Çdo status</option><option value="active">Aktive</option><option value="inactive">Joaktive</option></select><button className="training-text-action" disabled={locked} onClick={() => setRefresh(value => value + 1)}>↻ Rifresko</button></div>
    {error && <p role="alert" className="training-error">{error}<button className="training-text-action" disabled={locked} onClick={() => setRefresh(value => value + 1)}>Provo përsëri</button></p>}
    {notice && <p className="training-library-notice" role="status">{notice}</p>}
    {loading ? <div className="training-library-empty" role="status"><TrainingSpark working /><p>Duke hapur memorien…</p></div> : !visible.length ? <div className="training-library-empty"><TrainingSpark /><h3>{memories.length ? "Nuk u gjetën mësime." : "Nis me diçka që ka rëndësi."}</h3><p>{memories.length ? "Provo një kërkim tjetër ose ndrysho filtrat." : "Një preferencë e vogël për tonin, një përgjigje e korrigjuar apo një udhëzim për workflow-n. Mësimet e ruajtura do të jenë këtu."}</p></div> : <div className="training-library-list">{visible.map((memory, index) => {
      const workflow = workflows.find(w => w.id === memory.workflow_id);
      const scope = workflow ? `${workflow.name}${memory.step_key ? ` · ${workflow.steps.find(step => step.key === memory.step_key)?.label ?? memory.step_key}` : ""}` : "Në të gjithë biznesin";
      return <Fragment key={memory.id}><article className={`training-memory-row ${memory.is_active ? "" : "is-disabled"}`}><span className="training-memory-index">{String(currentPage * PAGE_SIZE + index + 1).padStart(2, "0")}</span><button className="training-memory-copy" disabled={locked} onClick={() => edit(memory)} aria-label={`Ndrysho mësimin: ${memory.instruction}`}><span>{trainingLabels[memory.kind].toUpperCase()}</span><p>{memory.instruction}</p><small>{scope}</small></button><span className={`training-memory-status ${memory.is_active ? "is-active" : ""}`}>{memory.is_active ? "Aktiv" : "Joaktiv"}</span><div className="training-memory-row-actions"><button disabled={locked} onClick={() => edit(memory)}>Ndrysho</button><button disabled={locked} onClick={() => void change(memory, memory.is_active ? "disable" : "enable")}>{memory.is_active ? "Çaktivizo" : "Aktivizo"}</button><button disabled={locked} onClick={() => setRemoveId(memory.id)}>Hiq</button></div></article>{removeId === memory.id && <div className="training-delete"><p>Ta heqësh këtë mësim përgjithmonë? Mund ta çaktivizosh nëse dëshiron ta ruash.</p><div><button className="training-text-action" disabled={locked} onClick={() => setRemoveId(null)}>Anulo</button><button className="training-text-action" disabled={locked} onClick={() => void change(memory, "delete")}>Po, hiqe</button></div></div>}</Fragment>;
    })}</div>}
    {filtered.length > PAGE_SIZE && <nav className="training-library-pagination" aria-label="Faqet e memories"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Para</button><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} nga {filtered.length}</span><button disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Më tej →</button></nav>}
    {editor && <TrainingEditor target={target} initial={editor} onClose={() => setEditor(null)} onBusyChange={setPending} onSaved={() => { setNotice("Mësimi u ruajt."); setRefresh(value => value + 1); }} />}
  </section>;
}
