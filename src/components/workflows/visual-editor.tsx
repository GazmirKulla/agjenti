"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useWorkflowAssistantContext, useAssistantWorkspace } from "@/components/business-assistant/workspace";
import { Icon } from "@/components/dashboard/icon";
import { saveVisualWorkflow, publishVisualWorkflow, setVisualWorkflowEnabled } from "@/lib/workflows/visual/actions";
import { simulateVisualWorkflow } from "@/lib/workflows/visual/test-actions";
import { nodeLabels, outputPorts, validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph, VisualNode, VisualNodeKind, VisualPort, VisualTrace, VisualWorkspace } from "@/lib/workflows/visual/types";
import { FlowIcon, VisualGraphView } from "./visual-graph";

const descriptions: Record<VisualNodeKind, string> = {
  start: "Çdo bisedë e re nis këtu.", condition: "Zgjidh rrugën sipas mesazhit ose të dhënave.",
  knowledge: "Përgjigjet nga njohuritë dhe katalogu i biznesit.", collect: "Pret përgjigjen dhe e ruan në fushën e zgjedhur.",
  confirm: "Pret Po ose Jo, pastaj ndjek degën përkatëse.", product: "Ndjek workflow-n e produktit të zgjedhur. Pa konfigurim, kërkesa i kalon stafit.",
  handoff: "Ndalon përgjigjet automatike në këtë bisedë.", end: "Mbyll rrjedhën. Mesazhi tjetër nis një rrjedhë të re.",
};
const addKinds: VisualNodeKind[] = ["condition", "knowledge", "collect", "confirm", "product", "handoff", "end"];
type Problem = { nodeId?: string; message: string };

export function VisualWorkflowEditor({ slug, initialWorkspace }: { slug: string; initialWorkspace: VisualWorkspace }) {
  const assistant=useAssistantWorkspace();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [graph, setGraph] = useState(initialWorkspace.graph);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [tab, setTab] = useState<"edit" | "test">("edit");
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [trace, setTrace] = useState<VisualTrace | undefined>();
  const [session, setSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState(false);
  const [testing, setTesting] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const selected = graph.nodes.find(n => n.id === selectedId);
  const dirty = JSON.stringify(graph) !== JSON.stringify(workspace.graph);
  const locked = pending || testing;
  useWorkflowAssistantContext({ nodeId: selectedId, revision: workspace.revision, dirty });

  useEffect(() => {
    if (initialWorkspace.revision === workspace.revision) return;
    if (dirty) {
      setNotice({ text: "Rrjedha u ndryshua nga Agjenti ose në një dritare tjetër. Ndryshimet e tua lokale janë ruajtur në editor; rifresko faqen për versionin e ri.", error: true });
      return;
    }
    setWorkspace(initialWorkspace); setGraph(initialWorkspace.graph);
    setSession(null); setMessages([]); setTrace(undefined); setProblems([]);
    setNotice({ text: "Editori u përditësua me rrjedhën e ruajtur." });
  }, [initialWorkspace, workspace.revision, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages, testing]);

  function resetTest() { setTrace(undefined); setSession(null); setMessages([]); }
  function edit(next: VisualGraph) {
    if (locked) return;
    setGraph(next); setNotice(null); setProblems([]); resetTest();
  }
  function updateNode(patch: Partial<VisualNode>) {
    edit({ ...graph, nodes: graph.nodes.map(n => n.id === selectedId ? { ...n, ...patch } : n) });
  }
  function updateConfig(patch: Partial<VisualNode["config"]>) {
    if (selected) updateNode({ config: { ...selected.config, ...patch } });
  }
  function connect(port: VisualPort, target: string) {
    if (!selected) return;
    const edges = graph.edges.filter(e => !(e.source === selected.id && e.port === port));
    if (target) edges.push({ id: `edge_${selected.id}_${port}`, source: selected.id, target, port });
    edit({ ...graph, edges });
  }
  function add(kind: VisualNodeKind) {
    const id = `step_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const anchor = selected?.position ?? { x: 620, y: 300 };
    const node: VisualNode = { id, kind, label: nodeLabels[kind], position: { x: Math.min(4000, anchor.x + 280), y: Math.min(4000, anchor.y + 140) },
      config: kind === "condition" ? { condition: "intent_order" } : kind === "collect" ? { fieldType: "text", fieldKey: `fusha_${graph.nodes.length}` } : {} };
    edit({ ...graph, nodes: [...graph.nodes, node] }); setSelectedId(id); setAdding(false); setTab("edit");
  }
  function remove() {
    if (!selected || selected.kind === "start") return;
    edit({ ...graph, nodes: graph.nodes.filter(n => n.id !== selected.id), edges: graph.edges.filter(e => e.source !== selected.id && e.target !== selected.id) });
    setSelectedId(undefined);
  }
  function validate() {
    const result = validateVisualGraph(graph);
    setProblems(result.errors);
    if (!result.graph) { setSelectedId(result.errors.find(e => e.nodeId)?.nodeId); setTab("edit"); }
    return Boolean(result.graph);
  }
  function save(publish = false) {
    if (publish && !validate()) return;
    startTransition(async () => {
      try {
        const result = await (publish ? publishVisualWorkflow : saveVisualWorkflow)(slug, workspace.revision, graph);
        if (result.error) { setNotice({ text: result.error, error: true }); setProblems(result.errors ?? []); return; }
        if (result.workspace) { setWorkspace(result.workspace); setGraph(result.workspace.graph); }
        setNotice({ text: publish ? "Rrjedha u aktivizua për bisedat e reja." : "Drafti u ruajt." });
      } catch { setNotice({ text: "Ruajtja dështoi. Provo përsëri.", error: true }); }
    });
  }
  function toggle() {
    startTransition(async () => {
      try {
        const result = await setVisualWorkflowEnabled(slug, workspace.revision, !workspace.enabled);
        if (result.error) { setNotice({ text: result.error, error: true }); return; }
        if (result.workspace) setWorkspace(result.workspace);
        setNotice({ text: workspace.enabled ? "E çaktivizuar për bisedat e reja. Bisedat në proces ruajnë versionin e tyre." : "Versioni i publikuar u aktivizua." });
      } catch { setNotice({ text: "Veprimi dështoi. Provo përsëri.", error: true }); }
    });
  }
  async function send() {
    if ((!message.trim() && !photo) || locked || !validate()) return;
    setTab("test"); setNotice(null); setTesting(true);
    const text = message.trim(), submittedGraph = graph;
    try {
      const result = await simulateVisualWorkflow(slug, graph, text, session, photo);
      if (result.error) { setNotice({ text: result.error, error: true }); return; }
      if (result.turn && graphRef.current === submittedGraph) {
        setSession(result.session ?? null); setTrace(result.turn.visualWorkflow);
        setMessages(items => [...items, { role: "user", text: text || "Foto e simuluar" }, { role: "agent", text: result.turn!.reply }]);
        setMessage(""); setPhoto(false);
      }
    } catch { setNotice({ text: "Prova dështoi. Provo përsëri.", error: true }); }
    finally { setTesting(false); }
  }

  return <section className="vf-editor" aria-label="Editor i rrjedhës">
    <header className="vf-header">
      <div className="vf-heading"><span className="vf-heading-icon"><Icon name="workflows" size={21} /></span><div><div className="vf-eyebrow">WORKFLOW <span className={`vf-status ${workspace.enabled ? "is-live" : ""}`}><i />{workspace.enabled ? "Aktive" : "Draft"}</span></div><input aria-label="Emri i rrjedhës" value={graph.name} maxLength={120} disabled={locked} onChange={e => edit({ ...graph, name: e.target.value })} /></div></div>
      <div className="vf-header-actions"><span className="vf-save-state">{dirty ? "Pa ruajtur" : workspace.hasUnpublishedChanges ? "Draft i papublikuar" : workspace.generated ? "Pikënisje" : "E ruajtur"}</span><button type="button" className="vf-button" disabled={locked} onClick={() => save()}>Ruaj draft</button><button type="button" className="vf-button vf-primary" disabled={locked} onClick={() => save(true)}>{pending ? "Duke ruajtur…" : workspace.publishedVersionId ? "Publiko" : "Aktivizo"}<Icon name="arrow" size={16} /></button></div>
    </header>
    <div className="vf-workbench">
      <div className="vf-diagram-area">
        <div className="vf-toolbar"><div className="vf-add-wrap"><button type="button" className={`vf-button vf-add ${adding ? "is-open" : ""}`} aria-expanded={adding} disabled={locked || graph.nodes.length >= 32} onClick={() => setAdding(!adding)}><span>+</span> Shto hap</button>{adding && <><button className="vf-menu-dismiss" aria-label="Mbyll menunë" onClick={() => setAdding(false)} /><div className="vf-palette" role="menu" aria-label="Llojet e hapave">{addKinds.map(kind => <button role="menuitem" type="button" key={kind} onClick={() => add(kind)}><span className={`vf-palette-icon vf-kind-${kind}`}><FlowIcon kind={kind} size={17} /></span>{nodeLabels[kind]}<span className="vf-palette-plus">+</span></button>)}</div></>}</div>
          <button type="button" className={`vf-button ${tab === "test" ? "is-open" : ""}`} onClick={() => { if (validate()) { setTab("test"); setAdding(false); } }}><span aria-hidden="true">▷</span> Provo rrjedhën</button>
        </div>
        <VisualGraphView graph={graph} selectedNodeId={selectedId} onSelect={id => { setSelectedId(id); setTab("edit"); setAdding(false); }} onMove={(id, position) => edit({ ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, position } : n) })} invalidNodeIds={problems.flatMap(p => p.nodeId ? [p.nodeId] : [])} currentNodeId={trace?.state.nodeId} visitedNodeIds={trace?.state.visited} traversedNodeIds={trace?.traversedNodeIds} />
      </div>
      <aside className="vf-inspector">
        <div className="vf-inspector-tabs"><button type="button" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>Hapi</button><button type="button" aria-pressed={tab === "test"} onClick={() => { if (validate()) setTab("test"); }}>Prova{messages.length > 0 && <i />}</button></div>
        {tab === "edit" ? <div className="vf-inspector-content">{selected ? <>
          <div className={`vf-detail-icon vf-kind-${selected.kind}`}><FlowIcon kind={selected.kind} size={24} /></div><h2>{nodeLabels[selected.kind]}</h2><p className="vf-help">{descriptions[selected.kind]}</p>
          <div className="vf-assistant-actions"><button type="button" className="vf-button" disabled={locked||dirty} onClick={()=>assistant?.launch(`Dua të ndryshoj hapin “${selected.label}” (${selected.id}) me AI.`)}>Ndrysho me AI</button><button type="button" className="vf-button" disabled={locked||dirty||!["next","yes","no"].some(p=>outputPorts(selected.kind).includes(p as VisualPort))} onClick={()=>assistant?.launch(`Dua të shtoj një hap pas “${selected.label}” (${selected.id}).`)}>Shto hap pas këtij</button></div>{dirty&&<p className="vf-field-hint">Ruaj draftin që Agjenti të përdorë ndryshimet e fundit.</p>}
          <fieldset disabled={locked} className="vf-fields"><label>Emri<input value={selected.label} maxLength={100} onChange={e => updateNode({ label: e.target.value })} /></label>
            {selected.kind === "condition" && <><label>Kushti<select value={selected.config.condition ?? "intent_order"} onChange={e => updateConfig({ condition: e.target.value as VisualNode["config"]["condition"] })}><option value="intent_order">Mesazhi kërkon porosi</option><option value="intent_support">Mesazhi kërkon ndihmë</option><option value="field_present">Fusha është plotësuar</option><option value="field_equals">Fusha ka vlerën…</option></select></label>{selected.config.condition?.startsWith("intent_") && <p className="vf-field-hint">Njihet nga fjalët e mesazhit. Provoje me shprehjet e klientëve të tu.</p>}</>}
            {(selected.kind === "collect" || (selected.kind === "condition" && selected.config.condition?.startsWith("field_"))) && <label>Fusha<input placeholder="email_klienti" value={selected.config.fieldKey ?? ""} maxLength={60} onChange={e => updateConfig({ fieldKey: e.target.value, ...(e.target.value === "customer_phone" ? { fieldType: "phone" as const } : e.target.value === "customer_email" ? { fieldType: "email" as const } : {}) })} list="visual-field-keys" /><datalist id="visual-field-keys">{[["customer_name","Emri i klientit"],["customer_phone","Telefoni i klientit"],["customer_email","Email i klientit"],["customer_city","Qyteti"],["customer_address","Adresa"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}{graph.nodes.filter(n => n.kind === "collect").map(n => <option key={n.id} value={n.config.fieldKey}>{n.label}</option>)}</datalist></label>}
            {selected.kind === "condition" && selected.config.condition === "field_equals" && <label>Vlera<input value={selected.config.value ?? ""} maxLength={300} onChange={e => updateConfig({ value: e.target.value })} /></label>}
            {selected.kind === "collect" && <label>Lloji i përgjigjes<select value={selected.config.fieldType ?? "text"} onChange={e => updateConfig({ fieldType: e.target.value as VisualNode["config"]["fieldType"] })}><option value="text">Tekst</option><option value="email">Email</option><option value="phone">Telefon</option><option value="number">Numër</option><option value="photo">Foto</option></select></label>}
            {["collect", "confirm", "knowledge", "handoff", "end"].includes(selected.kind) && <label>{selected.kind === "knowledge" ? "Udhëzim për përgjigjen" : ["collect", "confirm"].includes(selected.kind) ? "Pyetja për klientin" : "Mesazhi"}{["knowledge", "end", "handoff"].includes(selected.kind) && <small>Opsionale</small>}<textarea rows={4} maxLength={1500} placeholder={selected.kind === "collect" ? "Në cilin email ta dërgojmë?" : selected.kind === "confirm" ? "Dëshironi të vazhdoni?" : "Shkruaj shkurt…"} value={selected.config.prompt ?? ""} onChange={e => updateConfig({ prompt: e.target.value })} /></label>}
            {outputPorts(selected.kind).length > 0 && <div className="vf-routes"><h3>Vazhdo te</h3>{outputPorts(selected.kind).map(port => <label key={port}><span className={`vf-route-label is-${port}`}><i />{port === "yes" ? "Po" : port === "no" ? "Jo" : "Hapi tjetër"}</span><select aria-label={`Dalja ${port}`} value={graph.edges.find(e => e.source === selected.id && e.port === port)?.target ?? ""} onChange={e => connect(port, e.target.value)}><option value="">Zgjidh hapin</option>{graph.nodes.filter(n => n.kind !== "start" && n.id !== selected.id).map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>)}</div>}
          </fieldset>
          {problems.filter(p => p.nodeId === selected.id).map((p, i) => <p className="vf-inline-error" key={i}>{p.message}</p>)}
          {selected.kind !== "start" && <button type="button" className="vf-remove" disabled={locked} onClick={remove}>Hiq hapin</button>}
        </> : <div className="vf-inspector-empty"><span className="vf-detail-icon"><Icon name="workflows" size={26} /></span><h2>Çdo hap, në vendin e vet.</h2><p>Zgjidh një hap për ta përshtatur, ose provo një bisedë.</p><div className="vf-legend"><span><i />Hapi i zgjedhur</span><span><i />Rruga e ndjekur</span></div><button className="vf-button" type="button" onClick={() => setSelectedId(graph.nodes.find(n => n.kind === "start")?.id)}>Nis nga fillimi <Icon name="arrow" size={15} /></button></div>}</div> : <div className="vf-test">
          <div className="vf-test-heading"><span><i className="vf-live-dot" />Bisedë prove</span><button type="button" disabled={testing} onClick={() => { resetTest(); setNotice(null); }} aria-label="Rifillo provën">↻</button></div>
          <div className="vf-chat" aria-live="polite">{!messages.length && <div className="vf-test-empty"><span className="vf-detail-icon"><Icon name="inbox" size={24} /></span><h3>Provoje si klient.</h3><p>Diagrami ndriçon hapat që ndjek Agjenti.</p>{["Dua të porosis", "Çfarë ofroni?", "Dua të flas me stafin"].map(text => <button type="button" key={text} onClick={() => setMessage(text)}>{text}<span>↗</span></button>)}</div>}{messages.map((m, i) => <div key={i} className={`vf-chat-message is-${m.role}`}><small>{m.role === "user" ? "Ti" : "Agjenti"}</small><p>{m.text}</p></div>)}{testing && <div className="vf-typing" aria-label="Agjenti po përgjigjet"><i /><i /><i /></div>}<div ref={chatEnd} /></div>
          {trace && <div className="vf-test-state"><i /><span>{trace.state.status === "handoff" ? "Në pritje të stafit" : trace.state.status === "completed" ? "Rrjedha përfundoi" : "Në pritje të përgjigjes"}</span></div>}
          <form className="vf-composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea rows={2} aria-label="Mesazhi i provës" maxLength={2000} value={message} placeholder="Shkruaj si klient…" disabled={testing || trace?.state.status === "handoff"} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} /><div><label><input type="checkbox" checked={photo} disabled={testing} onChange={e => setPhoto(e.target.checked)} />Simulo foto</label><button type="submit" className="vf-send" aria-label="Dërgo mesazhin e provës" disabled={locked || (!message.trim() && !photo) || trace?.state.status === "handoff"}><Icon name="arrow" size={19} /></button></div></form><p className="vf-test-disclaimer">Prova nuk dërgon mesazhe te klientët.</p>
        </div>}
      </aside>
    </div>
    <footer className="vf-footer"><span>{graph.nodes.length} hapa <i />{graph.edges.length} lidhje</span><div>{workspace.publishedVersionId && <button type="button" disabled={locked} onClick={toggle}>{workspace.enabled ? "Çaktivizo" : "Aktivizo versionin e publikuar"}</button>}<span>Ndryshimet hyjnë në fuqi pas publikimit.</span></div></footer>
    {notice && <div className={`vf-notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? "!" : "✓"}<span>{notice.text}</span><button type="button" aria-label="Mbyll njoftimin" onClick={() => setNotice(null)}>×</button></div>}
    {problems.length > 0 && <div className="vf-problems" role="alert"><strong>{problems.length} {problems.length === 1 ? "detaj për të plotësuar" : "detaje për të plotësuar"}</strong>{problems.map((problem, i) => <button key={i} type="button" onClick={() => { setSelectedId(problem.nodeId); setTab("edit"); }}>{problem.nodeId ? `${graph.nodes.find(n => n.id === problem.nodeId)?.label}: ` : ""}{problem.message}<span>↗</span></button>)}</div>}
  </section>;
}
