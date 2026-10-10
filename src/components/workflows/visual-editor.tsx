"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useWorkflowAssistantContext, useAssistantWorkspace } from "@/components/business-assistant/workspace";
import { Icon } from "@/components/dashboard/icon";
import { saveWorkflowFromEditor } from "@/lib/workflows/visual/save-client";
import { unconfirmedSaveMessage } from "@/lib/workflows/visual/save-result";
import { clearSavedWorkflowDraft, clearWorkflowDraft, persistWorkflowDraft, readWorkflowDraftRecovery, type WorkflowDraftRecovery } from "@/lib/workflows/visual/local-draft";
import { simulateVisualWorkflow } from "@/lib/workflows/visual/test-actions";
import { nodeLabels, outputPorts, validateVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph, VisualNode, VisualNodeKind, VisualPort, VisualTrace, VisualWorkspace } from "@/lib/workflows/visual/types";
import { FlowIcon, VisualGraphView } from "./visual-graph";
import { WorkflowHub, WorkflowContextPanel } from "./workflow-hub";
import { addFlowTemplate, flowTemplateLabels, type FlowTemplate } from "./flow-templates";
import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";

const descriptions: Record<VisualNodeKind, string> = {
  start: "Çdo mesazh i ri rivlerëson kërkesën e klientit.", condition: "Zgjidh rrugën sipas mesazhit ose të dhënave.",
  knowledge: "Përgjigjet nga njohuritë dhe katalogu i biznesit.", collect: "Pret përgjigjen dhe e ruan në fushën e zgjedhur.",
  order_status: "Lexon statusin e ruajtur të porosive të këtij klienti. Nuk ndryshon porositë dhe nuk shpik përditësime.",
  confirm: "Pret Po ose Jo, pastaj ndjek degën përkatëse.", product: "Ndjek workflow-n e produktit të zgjedhur. Pa konfigurim, kërkesa i kalon stafit.",
  booking: "Kontrollon shërbimet dhe oraret e lira. Rezervimi ruhet vetëm pas konfirmimit të klientit.",
  handoff: "Orienton klientin te stafi. Agjenti mund të vazhdojë kur klienti ndryshon kërkesën.", end: "Përfundon këtë rrugë. Biseda mund të vazhdojë ose të kthehet te një hap i mëparshëm.",
};
const addKinds: VisualNodeKind[] = ["condition", "knowledge", "order_status", "collect", "confirm", "product", "booking", "handoff", "end"];
type Problem = { nodeId?: string; message: string };

export function VisualWorkflowEditor({ slug, initialWorkspace, bookingEnabled = false, readiness }: { slug: string; initialWorkspace: VisualWorkspace; bookingEnabled?: boolean; readiness?: { ready: boolean; blockers: string[] } }) {
  const assistant=useAssistantWorkspace();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [graph, setGraph] = useState(initialWorkspace.graph);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [tab, setTab] = useState<"edit" | "context" | "test">("edit");
  const [view, setView] = useState("hub");
  const [turn, setTurn] = useState<AgentTurnResult>();
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
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [recovery, setRecovery] = useState<Extract<WorkflowDraftRecovery, { draft: unknown }> | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const recoverySlug = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const definition = upgradeVisualGraph(graph);
  const activeFlow = definition.flows.find(flow => flow.id === view);
  const visibleIds = activeFlow ? new Set([...activeFlow.nodeIds, ...graph.edges.filter(edge => activeFlow.nodeIds.includes(edge.source)).map(edge => edge.target)]) : null;
  const displayGraph: VisualGraph = visibleIds ? { ...graph, nodes: graph.nodes.filter(node => visibleIds.has(node.id)), edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)) } : graph;
  const selected = graph.nodes.find(n => n.id === selectedId);
  const selectedFlow = definition.flows.find(flow => flow.nodeIds.includes(selectedId ?? "")) ?? activeFlow;
  const dirty = JSON.stringify(graph) !== JSON.stringify(workspace.graph);
  const canRestoreRecovery = recovery?.status === "recoverable" && recovery.draft.baseRevision === workspace.revision;
  const locked = pending || testing || refreshRequired || Boolean(recovery);
  useWorkflowAssistantContext({ nodeId: selectedId ?? activeFlow?.entryNodeId, revision: workspace.revision, dirty });

  useEffect(() => {
    if (recoverySlug.current === slug) return;
    recoverySlug.current = slug;
    const stored = readWorkflowDraftRecovery(slug, workspace);
    if (stored.status === "recoverable" || stored.status === "conflict") setRecovery(stored);
    else if (stored.status === "saved") clearSavedWorkflowDraft(slug, workspace);
    setRecoveryChecked(true);
  }, [slug, workspace]);
  useEffect(() => {
    if (!recoveryChecked || recovery || !dirty) return;
    setBackupAvailable(persistWorkflowDraft(slug, workspace.revision, graph).status === "saved");
  }, [slug, workspace.revision, graph, dirty, recoveryChecked, recovery]);

  useEffect(() => {
    if (initialWorkspace.revision <= workspace.revision) return;
    if (dirty) {
      setNotice({ text: "Rrjedha u ndryshua nga Agjenti ose në një dritare tjetër. Ndryshimet e tua lokale janë ruajtur në editor; rifresko faqen për versionin e ri.", error: true });
      return;
    }
    setWorkspace(initialWorkspace); setGraph(initialWorkspace.graph); setView("hub"); setSelectedId(undefined);
    setSession(null); setMessages([]); setTrace(undefined); setTurn(undefined); setProblems([]);
    setNotice({ text: "Editori u përditësua me rrjedhën e ruajtur." });
  }, [initialWorkspace, workspace.revision, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages, testing]);

  function resetTest() { setTurn(undefined); setTrace(undefined); setSession(null); setMessages([]); }
  function edit(next: VisualGraph) {
    if (locked) return;
    setGraph(next); setNotice(null); setProblems([]); resetTest();
  }
  function selectNode(id?: string) {
    setSelectedId(id); setTab("edit"); setAdding(false);
    if (id && view !== "all") setView(definition.flows.find(flow => flow.nodeIds.includes(id))?.id ?? "all");
  }
  function openFlow(flowId: string) {
    if (!definition.flows.some(flow => flow.id === flowId)) return;
    setView(flowId); setSelectedId(undefined); setTab("edit"); setAdding(false);
  }
  function openProcess(kind: FlowTemplate, createNew = false) {
    const existing = definition.flows.find(flow => kind === "order_status" ? graph.nodes.find(node => node.id === flow.entryNodeId)?.kind === "order_status" : flow.kind === kind);
    if (existing && !createNew) { openFlow(existing.id); return; }
    if (locked || (kind === "booking" && !bookingEnabled)) return;
    if (graph.nodes.length > 30 || definition.flows.length >= 16) { setNotice({ text: "Workflow ka arritur kufirin e hapave ose rrjedhave. Përshtat një rrjedhë ekzistuese.", error: true }); return; }
    const id = `step_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const { graph: next, flow } = addFlowTemplate(graph, kind, id);
    edit(next);
    setView(flow.id); setSelectedId(undefined); setTab("edit"); setAdding(false);
  }
  function moveToFlow(flowId: string) {
    if (!selected || ["start", "end"].includes(selected.kind)) return;
    const owner = definition.flows.find(flow => flow.entryNodeId === selected.id);
    if (owner && owner.id !== flowId) { setNotice({ error: true, text: "Zgjidh një pikënisje tjetër për rrjedhën përpara zhvendosjes së këtij hapi." }); return; }
    edit({ ...definition, flows: definition.flows.map(flow => ({ ...flow, nodeIds: [...flow.nodeIds.filter(id => id !== selected.id), ...(flow.id === flowId ? [selected.id] : [])] })) });
    setView(flowId || "all");
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
    edit({ ...definition, nodes: [...graph.nodes, node], flows: definition.flows.map(flow => flow.id === activeFlow?.id && kind !== "end" ? { ...flow, nodeIds: [...flow.nodeIds, id] } : flow) }); setSelectedId(id); setAdding(false); setTab("edit");
  }
  function remove() {
    if (!selected || selected.kind === "start") return;
    const flows = definition.flows.map(flow => ({ ...flow, nodeIds: flow.nodeIds.filter(id => id !== selected.id) })).filter(flow => flow.nodeIds.length).map(flow => ({ ...flow, entryNodeId: flow.entryNodeId === selected.id ? flow.nodeIds[0] : flow.entryNodeId }));
    edit({ ...definition, flows, nodes: graph.nodes.filter(n => n.id !== selected.id), edges: graph.edges.filter(e => e.source !== selected.id && e.target !== selected.id) });
    if (!flows.some(flow => flow.id === view)) setView("hub");
    setSelectedId(undefined);
  }
  function validate() {
    const result = validateVisualGraph(graph);
    setProblems(result.errors);
    if (!result.graph) { selectNode(result.errors.find(e => e.nodeId)?.nodeId); }
    return Boolean(result.graph);
  }
  function save(publish = false) {
    if (publish && !validate()) return;
    startTransition(async () => {
      try {
        const result = await saveWorkflowFromEditor(slug, workspace.revision, publish ? "publish" : "draft", graph);
        if (result.error) { setNotice({ text: result.error, error: true }); setProblems(result.errors ?? []); return; }
        if (result.savedRevision !== undefined && result.savedGraph) clearSavedWorkflowDraft(slug, { revision: result.savedRevision, graph: result.savedGraph });
        if (result.workspace) { setWorkspace(result.workspace); setGraph(result.workspace.graph); }
        setRefreshRequired(Boolean(result.refreshRequired));
        setNotice({ text: result.warning ?? (publish ? "Rrjedha u aktivizua për bisedat e reja." : "Drafti u ruajt.") });
      } catch { setNotice({ text: unconfirmedSaveMessage, error: true }); }
    });
  }
  function toggle() {
    startTransition(async () => {
      try {
        const result = await saveWorkflowFromEditor(slug, workspace.revision, workspace.enabled ? "disable" : "enable");
        if (result.error) { setNotice({ text: result.error, error: true }); return; }
        if (result.workspace) { setWorkspace(result.workspace); setGraph(result.workspace.graph); }
        setRefreshRequired(Boolean(result.refreshRequired));
        setNotice({ text: result.warning ?? (workspace.enabled ? "E çaktivizuar për bisedat e reja. Bisedat në proces ruajnë versionin e tyre." : "Versioni i publikuar u aktivizua.") });
      } catch { setNotice({ text: unconfirmedSaveMessage, error: true }); }
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
        setSession(result.session ?? null); setTrace(result.turn.visualWorkflow); setTurn(result.turn);
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
    {recovery && <div className="vf-notice" role="status"><span>{canRestoreRecovery ? "Ka ndryshime të paruajtura nga kjo dritare. Mund t’i rikthesh." : "Ka një kopje lokale, por workflow është ndryshuar ndërkohë. Shkarkoje për ta krahasuar me versionin e ruajtur."}</span>{canRestoreRecovery && <button className="vf-button" type="button" onClick={() => { setGraph(recovery.draft.graph); setRecovery(null); resetTest(); }}>Rikthe ndryshimet</button>}<button className="vf-button" type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(recovery.draft.graph, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "workflow-kopje.json"; link.click(); URL.revokeObjectURL(url); }}>Shkarko kopjen</button><button className="vf-button" type="button" onClick={() => { if (clearWorkflowDraft(slug)) setRecovery(null); }}>Përdor versionin e ruajtur</button></div>}
    {readiness && <div className={`vf-readiness ${readiness.ready ? "is-ready" : ""}`}><Icon name={readiness.ready ? "check" : "settings"} size={15} /><span>{readiness.ready ? "Gati për aktivizim" : "Aktivizimi kërkon konfigurim"}</span>{!readiness.ready && <details><summary>Shiko çfarë mungon</summary><ul>{readiness.blockers.map(item => <li key={item}>{item}</li>)}</ul></details>}</div>}
    <nav className="vf-navigation" aria-label="Navigimi i workflow-t"><button type="button" className={view === "hub" ? "is-active" : ""} onClick={() => { setView("hub"); setSelectedId(undefined); setAdding(false); }}><Icon name="inbox" size={15} />Qendra e mesazhit</button><span>/</span>{activeFlow ? <select aria-label="Rrjedha e hapur" value={view} onChange={event => { setView(event.target.value); setSelectedId(undefined); setAdding(false); }}>{definition.flows.map(flow => <option key={flow.id} value={flow.id}>{flow.label}</option>)}</select> : <span>{view === "all" ? "Të gjithë hapat" : "Zgjidh një proces"}</span>}<button className={view === "all" ? "is-active" : ""} type="button" onClick={() => { setView("all"); setSelectedId(undefined); setAdding(false); }}>Të gjithë hapat</button></nav>
    <div className="vf-workbench">
      <div className="vf-diagram-area">
        <div className="vf-toolbar"><div className="vf-add-wrap">{view === "hub" && <select className="vf-button" aria-label="Shto rrjedhë" value="" disabled={locked || graph.nodes.length > 30 || definition.flows.length >= 16} onChange={event => openProcess(event.target.value as FlowTemplate, true)}><option value="" disabled>+ Shto rrjedhë</option>{(["information", "order", "order_status", "booking", "support", "custom"] as const).filter(kind => kind !== "booking" || bookingEnabled).map(kind => <option key={kind} value={kind}>{flowTemplateLabels[kind]}</option>)}</select>}{view !== "hub" && <button type="button" className={`vf-button vf-add ${adding ? "is-open" : ""}`} aria-expanded={adding} disabled={locked || graph.nodes.length >= 32} onClick={() => setAdding(!adding)}><span>+</span> Shto hap</button>}{adding && <><button className="vf-menu-dismiss" aria-label="Mbyll menunë" onClick={() => setAdding(false)} /><div className="vf-palette" role="menu" aria-label="Llojet e hapave">{addKinds.filter(kind => kind !== "booking" || bookingEnabled).map(kind => <button role="menuitem" type="button" key={kind} onClick={() => add(kind)}><span className={`vf-palette-icon vf-kind-${kind}`}><FlowIcon kind={kind} size={17} /></span>{nodeLabels[kind]}<span className="vf-palette-plus">+</span></button>)}</div></>}</div>
          <button type="button" className={`vf-button ${tab === "test" ? "is-open" : ""}`} onClick={() => { if (validate()) { setTab("test"); setAdding(false); } }}><span aria-hidden="true">▷</span> Provo rrjedhën</button>
        </div>
        {view === "hub" ? <WorkflowHub graph={graph} trace={trace} state={turn?.nextState} routing={turn?.conversationRouting} message={messages.filter(item => item.role === "user").at(-1)?.text} bookingEnabled={bookingEnabled} onOpen={openProcess} onOpenFlow={openFlow} onContext={() => setTab("context")} /> : <VisualGraphView key={view} graph={displayGraph} selectedNodeId={selectedId} onSelect={selectNode} onMove={(id, position) => edit({ ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, position } : n) })} invalidNodeIds={problems.flatMap(p => p.nodeId ? [p.nodeId] : [])} currentNodeId={trace?.state.nodeId} visitedNodeIds={trace?.state.visited} traversedNodeIds={trace?.traversedNodeIds} />}
        {activeFlow && <div className="vf-flow-caption"><Icon name="refresh" size={14} />Pas përgjigjes, mesazhi tjetër rivlerëson kërkesën.</div>}
      </div>
      <aside className="vf-inspector">
        <div className="vf-inspector-tabs"><button type="button" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>{activeFlow ? "Rrjedha / hapi" : "Hapi"}</button><button type="button" aria-pressed={tab === "context"} onClick={() => setTab("context")}>Konteksti</button><button type="button" aria-pressed={tab === "test"} onClick={() => { if (validate()) setTab("test"); }}>Prova{messages.length > 0 && <i />}</button></div>
        {tab === "context" ? <div className="vf-inspector-content"><WorkflowContextPanel state={turn?.nextState} routing={turn?.conversationRouting} /></div> : tab === "edit" ? <div className="vf-inspector-content">{selected ? <>
          <div className={`vf-detail-icon vf-kind-${selected.kind}`}><FlowIcon kind={selected.kind} size={24} /></div><h2>{nodeLabels[selected.kind]}</h2><p className="vf-help">{descriptions[selected.kind]}</p>
          <div className="vf-assistant-actions"><button type="button" className="vf-button" disabled={locked||dirty} onClick={()=>assistant?.launch(`Dua të ndryshoj hapin “${selected.label}” (${selected.id}) në procesin “${selectedFlow?.label ?? "Lidhjet e përgjithshme"}” me AI.`)}>Ndrysho me AI</button><button type="button" className="vf-button" disabled={locked||dirty||!["next","yes","no"].some(p=>outputPorts(selected.kind).includes(p as VisualPort))} onClick={()=>assistant?.launch(`Dua të shtoj një hap pas “${selected.label}” (${selected.id}) në procesin “${selectedFlow?.label ?? "Lidhjet e përgjithshme"}”.`)}>Shto hap pas këtij</button></div>{dirty&&<p className="vf-field-hint">Ruaj draftin që Agjenti të përdorë ndryshimet e fundit.</p>}
          <fieldset disabled={locked} className="vf-fields"><label>Emri<input value={selected.label} maxLength={100} onChange={e => updateNode({ label: e.target.value })} /></label>
            {!["start", "end"].includes(selected.kind) && <label>Procesi<select value={definition.flows.find(flow => flow.nodeIds.includes(selected.id))?.id ?? ""} onChange={event => moveToFlow(event.target.value)}><option value="">Lidhjet e përgjithshme</option>{definition.flows.map(flow => <option key={flow.id} value={flow.id}>{flow.label}</option>)}</select></label>}
            {selected.kind === "booking" && <p className="vf-help">{bookingEnabled ? "Përdor shërbimet, disponueshmërinë dhe rregullat e konfirmimit të kalendarit." : "Aktivizo rezervimet e agjentit dhe të paktën një shërbim në kalendar për të përdorur këtë rrjedhë."} <a href={`/b/${slug}/calendar`} className="soft-link">Hap kalendarin →</a></p>}
            {selected.kind === "order_status" && <p className="vf-help">Përdor vetëm porositë e lidhura me klientin e kësaj bisede. Nëse porosia nuk gjendet, e sqaron me klientin. Prova nuk lexon apo ndryshon porositë reale. <a href={`/b/${slug}/orders`} className="soft-link">Hap porositë →</a></p>}
            {selected.kind === "condition" && <><label>Kushti<select value={selected.config.condition ?? "intent_order"} onChange={e => { edit({ ...definition, nodes: graph.nodes.map(node => node.id === selected.id ? { ...node, config: { ...node.config, condition: e.target.value as VisualNode["config"]["condition"] } } : node) }); }}><option value="intent_order">Mesazhi kërkon porosi</option><option value="intent_booking">Mesazhi kërkon rezervim</option><option value="intent_support">Mesazhi kërkon ndihmë</option><option value="field_present">Fusha është plotësuar</option><option value="field_equals">Fusha ka vlerën…</option></select></label>{selected.config.condition?.startsWith("intent_") && <p className="vf-field-hint">Njihet nga fjalët e mesazhit. Provoje me shprehjet e klientëve të tu.</p>}</>}
            {(selected.kind === "collect" || (selected.kind === "condition" && selected.config.condition?.startsWith("field_"))) && <label>Fusha<input placeholder="email_klienti" value={selected.config.fieldKey ?? ""} maxLength={60} onChange={e => updateConfig({ fieldKey: e.target.value, ...(e.target.value === "customer_phone" ? { fieldType: "phone" as const } : e.target.value === "customer_email" ? { fieldType: "email" as const } : {}) })} list="visual-field-keys" /><datalist id="visual-field-keys">{[["customer_name","Emri i klientit"],["customer_phone","Telefoni i klientit"],["customer_email","Email i klientit"],["customer_city","Qyteti"],["customer_address","Adresa"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}{graph.nodes.filter(n => n.kind === "collect").map(n => <option key={n.id} value={n.config.fieldKey}>{n.label}</option>)}</datalist></label>}
            {selected.kind === "condition" && selected.config.condition === "field_equals" && <label>Vlera<input value={selected.config.value ?? ""} maxLength={300} onChange={e => updateConfig({ value: e.target.value })} /></label>}
            {selected.kind === "collect" && <label>Lloji i përgjigjes<select value={selected.config.fieldType ?? "text"} onChange={e => updateConfig({ fieldType: e.target.value as VisualNode["config"]["fieldType"] })}><option value="text">Tekst</option><option value="email">Email</option><option value="phone">Telefon</option><option value="number">Numër</option><option value="photo">Foto</option></select></label>}
            {["collect", "confirm", "knowledge", "handoff", "end"].includes(selected.kind) && <label>{selected.kind === "knowledge" ? "Udhëzim për përgjigjen" : ["collect", "confirm"].includes(selected.kind) ? "Pyetja për klientin" : "Mesazhi"}{["knowledge", "end", "handoff"].includes(selected.kind) && <small>Opsionale</small>}<textarea rows={4} maxLength={1500} placeholder={selected.kind === "collect" ? "Në cilin email ta dërgojmë?" : selected.kind === "confirm" ? "Dëshironi të vazhdoni?" : "Shkruaj shkurt…"} value={selected.config.prompt ?? ""} onChange={e => updateConfig({ prompt: e.target.value })} /></label>}
            {outputPorts(selected.kind).length > 0 && <div className="vf-routes"><h3>Vazhdo te</h3>{outputPorts(selected.kind).map(port => <label key={port}><span className={`vf-route-label is-${port}`}><i />{port === "yes" ? "Po" : port === "no" ? "Jo" : "Hapi tjetër"}</span><select aria-label={`Dalja ${port}`} value={graph.edges.find(e => e.source === selected.id && e.port === port)?.target ?? ""} onChange={e => connect(port, e.target.value)}><option value="">Zgjidh hapin</option>{graph.nodes.filter(n => n.kind !== "start" && n.id !== selected.id).map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>)}</div>}
          </fieldset>
          {problems.filter(p => p.nodeId === selected.id).map((p, i) => <p className="vf-inline-error" key={i}>{p.message}</p>)}
          {selected.kind !== "start" && <button type="button" className="vf-remove" disabled={locked} onClick={remove}>Hiq hapin</button>}
        </> : <div className="vf-inspector-empty"><span className="vf-detail-icon"><Icon name={activeFlow ? "workflows" : "inbox"} size={26} /></span><h2>{activeFlow?.label ?? "Një bisedë. Shumë rrugë."}</h2><p>{activeFlow ? "Zgjidh një hap në diagram për ta ndryshuar. Të dhënat ruhen kur klienti kalon në një proces tjetër." : "Çdo mesazh mund të vazhdojë, të korrigjojë ose të rifillojë një proces. Hap një rrjedhë për të përshtatur hapat."}</p>{activeFlow && <fieldset className="vf-fields" disabled={locked}><label>Emri i rrjedhës<input maxLength={100} value={activeFlow.label} onChange={event => edit({ ...definition, flows: definition.flows.map(flow => flow.id === activeFlow.id ? { ...flow, label: event.target.value } : flow) })} /></label><label>Pikënisja<select value={activeFlow.entryNodeId} onChange={event => edit({ ...definition, flows: definition.flows.map(flow => flow.id === activeFlow.id ? { ...flow, entryNodeId: event.target.value } : flow) })}>{graph.nodes.filter(node => activeFlow.nodeIds.includes(node.id) && !["start", "end"].includes(node.kind)).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label><button className="vf-button" type="button" disabled={dirty} onClick={() => assistant?.launch(`Dua të ndryshoj rrjedhën “${activeFlow.label}” (${activeFlow.id}) me AI. Ruaj rrjedhat e tjera.`)}>Ndrysho rrjedhën me AI</button></fieldset>}<div className="vf-legend"><span><i />Hapi i zgjedhur</span><span><i />Rruga e mesazhit të fundit</span></div></div>}</div> : <div className="vf-test">
          <div className="vf-test-heading"><span><i className="vf-live-dot" />Bisedë prove</span><button type="button" disabled={testing} onClick={() => { resetTest(); setNotice(null); }} aria-label="Rifillo provën">↻</button></div>
          <div className="vf-chat" aria-live="polite">{!messages.length && <div className="vf-test-empty"><span className="vf-detail-icon"><Icon name="inbox" size={24} /></span><h3>Provoje si klient.</h3><p>Diagrami ndriçon hapat që ndjek Agjenti.</p>{["Dua të porosis", "Çfarë ofroni?", "Dua të flas me stafin"].map(text => <button type="button" key={text} onClick={() => setMessage(text)}>{text}<span>↗</span></button>)}</div>}{messages.map((m, i) => <div key={i} className={`vf-chat-message is-${m.role}`}><small>{m.role === "user" ? "Ti" : "Agjenti"}</small><p>{m.text}</p></div>)}{testing && <div className="vf-typing" aria-label="Agjenti po përgjigjet"><i /><i /><i /></div>}<div ref={chatEnd} /></div>
          {trace && <div className="vf-test-state"><i /><span>{turn?.conversationRouting?.reason ?? (trace.state.status === "handoff" ? "Orientim te stafi · mund të vazhdosh" : trace.state.status === "completed" ? "Në pritje të mesazhit tjetër" : "Në pritje të përgjigjes")}</span></div>}
          <form className="vf-composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea rows={2} aria-label="Mesazhi i provës" maxLength={2000} value={message} placeholder="Shkruaj si klient…" disabled={testing} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} /><div><label><input type="checkbox" checked={photo} disabled={testing} onChange={e => setPhoto(e.target.checked)} />Simulo foto</label><button type="submit" className="vf-send" aria-label="Dërgo mesazhin e provës" disabled={locked || (!message.trim() && !photo)}><Icon name="arrow" size={19} /></button></div></form><p className="vf-test-disclaimer">Prova nuk dërgon mesazhe te klientët.</p>
        </div>}
      </aside>
    </div>
    <footer className="vf-footer"><span>{graph.nodes.length} hapa <i />{graph.edges.length} lidhje</span><div>{workspace.publishedVersionId && <button type="button" disabled={locked || dirty} title={dirty ? "Ruaj ndryshimet përpara këtij veprimi." : undefined} onClick={toggle}>{workspace.enabled ? "Çaktivizo" : "Aktivizo versionin e publikuar"}</button>}<span>Ndryshimet hyjnë në fuqi pas publikimit.</span></div></footer>
    {notice && <div className={`vf-notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? "!" : "✓"}<span>{notice.text}{notice.error && dirty && <small>{backupAvailable ? " Kopja lokale ruhet edhe pas rifreskimit në këtë dritare." : " Mbaje këtë faqe hapur që të mos humbasësh ndryshimet."}</small>}</span>{(refreshRequired || (notice.error && (!dirty || backupAvailable))) && <button type="button" className="vf-button" onClick={() => window.location.reload()}>Rifresko faqen</button>}{!refreshRequired && <button type="button" aria-label="Mbyll njoftimin" onClick={() => setNotice(null)}>×</button>}</div>}
    {problems.length > 0 && <div className="vf-problems" role="alert"><strong>{problems.length} {problems.length === 1 ? "detaj për të plotësuar" : "detaje për të plotësuar"}</strong>{problems.map((problem, i) => <button key={i} type="button" onClick={() => { selectNode(problem.nodeId); }}>{problem.nodeId ? `${graph.nodes.find(n => n.id === problem.nodeId)?.label}: ` : ""}{problem.message}<span>↗</span></button>)}</div>}
  </section>;
}
