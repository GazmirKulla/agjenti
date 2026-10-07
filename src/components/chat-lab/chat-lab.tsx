"use client";
import { useEffect, useRef, useState } from "react";
import { loadLabSetup, runLabTurn, searchLabBusinesses } from "@/lib/chat-lab/actions";
import type { LabBusiness, LabSetup, LabTurn, LabFailure } from "@/lib/chat-lab/model";
import type { TraceStage } from "@/lib/conversations/trace";
import { emptyState } from "@/lib/workflows/engine";
import { Card, Data, Fields, Inspector, Raw, intentOf, workflowOf } from "./inspector";
import "./chat-lab.css";

type Turn = { result: LabTurn; beforeSession: string | null; hasPhoto: boolean };
const chain: { label: string; tab: TraceStage }[] = [
  { label: "User message", tab: "overview" }, { label: "Intent detection", tab: "overview" },
  { label: "Context retrieval", tab: "context" }, { label: "Workflow resolution", tab: "workflow" },
  { label: "AI processing", tab: "ai" }, { label: "Tool calls", tab: "tools" }, { label: "Final response", tab: "overview" },
];
export function ChatLab() {
  const [query, setQuery] = useState("");
  const [businesses, setBusinesses] = useState<LabBusiness[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [setup, setSetup] = useState<LabSetup | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<TraceStage>("overview");
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<LabFailure | undefined>();
  const [dataOpen, setDataOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<LabBusiness | "reset" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const epoch = useRef(0);
  const latest = turns.at(-1)?.result;
  const current = latest?.nextState ?? emptyState();
  const active = turns[selected]?.result;

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchLabBusinesses(query);
        if (!stale) { setBusinesses(result.businesses); setSearchError(result.error ?? ""); }
      } catch { if (!stale) setSearchError("Unable to search businesses. Try again."); }
      finally { if (!stale) setSearching(false); }
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [turns, pending]);
  useEffect(() => { if (dataOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [dataOpen]);
  useEffect(() => { if (confirmation) confirmDialog.current?.showModal(); else confirmDialog.current?.close(); }, [confirmation]);
  useEffect(() => { if (inspectorOpen) drawer.current?.showModal(); else drawer.current?.close(); }, [inspectorOpen]);
  useEffect(() => () => { epoch.current++; }, []);

  function reset() {
    epoch.current++; setTurns([]); setSelected(0); setDraft(""); setPhoto(false); setError(""); setPending(null); setTab("overview"); setFailure(undefined);
  }
  async function chooseBusiness(business: LabBusiness) {
    if (busy.current) return;
    busy.current = true;
    reset(); setSetup(null); setLoadingSetup(true);
    try {
      const result = await loadLabSetup(business.id);
      if ("error" in result) setError(result.error); else setSetup(result.setup);
    } catch { setError("Unable to load business. Try again."); }
    finally { busy.current = false; setLoadingSetup(false); }
  }
  function requestBusiness(business: LabBusiness) {
    if (setup?.id === business.id || busy.current) return;
    if (turns.length || draft) setConfirmation(business); else void chooseBusiness(business);
  }
  async function send(replay = false) {
    if (!setup || busy.current || (!replay && !draft.trim() && !photo)) return;
    const last = turns.at(-1);
    if (replay && !last) return;
    const message = replay ? last!.result.input : draft.trim();
    const hasPhoto = replay ? last!.hasPhoto : photo;
    const session = replay ? last!.beforeSession : latest?.session ?? null;
    const version = epoch.current;
    busy.current = true; setError(""); setFailure(undefined); setPending(message + (hasPhoto ? "\n[Simulated photo]" : ""));
    try {
      const result = await runLabTurn({ businessId: setup.id, message, hasPhoto, session });
      if (version !== epoch.current) return;
      if ("error" in result) { setError(result.error); setFailure(result); setTab("logs"); return; }
      const next = replay ? turns.slice(0, -1) : turns;
      setTurns([...next, { result, beforeSession: result.replaySession, hasPhoto }]);
      setSelected(next.length);
      if (!replay) { setDraft(""); setPhoto(false); }
    } catch { if (version === epoch.current) setError("Connection failed. Your message is still here; try again."); }
    finally { if (version === epoch.current) { busy.current = false; setPending(null); } }
  }
  function inspect(index: number, target: TraceStage) { setSelected(index); setTab(target); if (window.matchMedia("(max-width: 1100px)").matches) setInspectorOpen(true); }
  const snapshot = {
    testConversationId: latest?.testConversationId ?? null, business: setup, mode: "test", source: "admin_chat_lab",
    customer: { id: null, ...current.customer, username: null, email: null, channel: "admin_chat_lab" },
    intent: { current: intentOf(latest), previous: intentOf(turns.at(-2)?.result) },
    selection: { product: latest?.productName ?? null, productId: current.product_id, service: latest?.trace.find((e) => e.label === "Context retrieval completed")?.data?.service ?? null, variant: current.fields.variant ?? null, quantity: current.fields.quantity ?? null },
    workflow: { id: latest?.workflowId ?? null, name: latest ? workflowOf(latest).workflowName ?? null : null, currentStep: current.step_key, status: !latest ? "not started" : current.step_key === "order_ready" ? "ready" : "in progress" },
    collectedData: current.fields, missingData: latest?.fields.filter((f) => f.status === "missing").map((f) => f.key) ?? [],
    context: latest?.trace.filter((e) => e.stage === "context").map((e) => ({ section: e.label, ...e.data })) ?? [],
  };
  return <div className="chat-lab">
    <header className="lab-heading"><div className="lab-heading-title"><span className="lab-brand" aria-hidden>⚗</span><div><div className="lab-eyebrow">ADMIN WORKSPACE <span className="lab-badge">TEST ONLY</span></div><h1>Chat Lab</h1><p>Simulate a customer. Inspect every engine decision.</p></div></div><button className="btn btn-ghost" onClick={() => setDataOpen(true)} disabled={!setup}>▤ Conversation Data</button></header>
    <div className="lab-safety"><span aria-hidden>◈</span><p>Production engine · live business context · isolated test state</p><span className="lab-badge">External actions disabled</span></div>
    <div className="lab-layout">
      <aside className="lab-setup panel"><div className="lab-panel-heading"><div><span className="lab-eyebrow">01 / CONFIGURE</span><h2>Test Setup</h2></div></div>
        <label htmlFor="lab-business-search">Business</label><input id="lab-business-search" type="search" placeholder="Search businesses…" maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} />
        {searchError && <p className="lab-error" role="alert">{searchError}</p>}
        <div className="lab-businesses" aria-label="Businesses" aria-busy={searching}>
          {searching ? <p className="lab-muted">Searching…</p> : businesses.length ? businesses.map((business) => <button type="button" key={business.id} aria-pressed={setup?.id === business.id} disabled={pending !== null || loadingSetup} onClick={() => requestBusiness(business)}><span className="lab-avatar">{business.name.slice(0, 1).toUpperCase()}</span><span><strong>{business.name}</strong><small>{business.slug}</small></span>{setup?.id === business.id && <span>✓</span>}</button>) : <p className="lab-muted">No businesses found.</p>}
        </div>
        {!searching && businesses.length === 50 && <p className="lab-muted">Showing 50 results. Refine your search.</p>}
        {loadingSetup && <p role="status">Loading business context…</p>}
        {setup && <><div className="lab-selected-business"><h3>{setup.name}</h3><span className="lab-badge">{setup.businessType}</span></div><dl className="lab-counts"><div><dt>Active products</dt><dd>{setup.products}</dd></div><div><dt>Active services</dt><dd>{setup.services}</dd></div><div><dt>Workflows</dt><dd>{setup.workflows}</dd></div></dl><p className="lab-muted">Services are active knowledge entries marked “service”.</p><div className="lab-channels"><h3>Channel integrations</h3>{setup.channels.length ? setup.channels.map((channel, i) => <div key={i}><span>Instagram{channel.username ? ` · @${channel.username}` : ""}</span><span className="lab-badge">{channel.status}</span></div>) : <p className="lab-muted">No Instagram connection. Test mode still works.</p>}</div><button className="btn btn-primary lab-new" disabled={pending !== null} onClick={() => turns.length || draft ? setConfirmation("reset") : reset()}>＋ New Test Conversation</button></>}
        <div className="lab-setup-note"><strong>Safe to explore</strong><p>Test messages use the same AI and workflow logic as production. They are never delivered to a customer.</p><p>Sessions expire after one hour or 40 turns. AI requests use the configured provider.</p></div>
      </aside>
      <section className="lab-chat panel"><div className="lab-panel-heading"><div><span className="lab-eyebrow">02 / SIMULATE</span><h2>Test Conversation <span className="lab-badge">TEST</span></h2></div><div className="lab-chat-actions"><button title="Reset conversation" disabled={!turns.length || pending !== null} onClick={() => setConfirmation("reset")}>↻ Reset</button><button title="Replay last message from its previous state" disabled={!turns.length || pending !== null} onClick={() => void send(true)}>▷ Replay</button></div></div>
        <p className="lab-session">{latest?.testConversationId ?? "Temporary session starts with your first message"}</p>
        <div className="lab-chat-log" ref={log} role="log" aria-label="Test conversation" aria-live="polite">
          {!turns.length && pending === null && <div className="lab-empty"><span className="lab-empty-icon">↗</span><h3>{setup ? `Meet ${setup.name}’s agent` : "Choose a business to begin"}</h3><p>Ask a question, explore a workflow, or follow an order from the first message to the last field.</p>{setup && <button className="lab-example" onClick={() => setDraft("Përshëndetje! Çfarë produktesh ofroni?")}>Përshëndetje! Çfarë produktesh ofroni? ↗</button>}</div>}
          {turns.map(({ result, hasPhoto }, index) => <article className={`lab-turn ${selected === index ? "is-selected" : ""}`} key={`${result.timestamp}-${index}`}><div className="lab-turn-label">TURN {index + 1}<time dateTime={result.timestamp}>{new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><button className="lab-bubble customer" aria-label={`Inspect customer message ${index + 1}`} onClick={() => inspect(index, "overview")}><small>CUSTOMER</small><p>{result.input}{hasPhoto && "\n[Simulated photo]"}</p></button><button className="lab-bubble agent" aria-label={`Inspect agent response ${index + 1}`} onClick={() => inspect(index, "overview")}><small>✦ AGENT <span>{result.debug.source}</span></small><p>{result.reply}</p></button><div className="lab-chain" aria-label={`Turn ${index + 1} execution stages`}>{chain.map((step, i) => <button key={step.label} onClick={() => inspect(index, step.tab)} title={`Inspect ${step.label}`}><span>{i + 1}</span>{step.label}{i < chain.length - 1 && <b aria-hidden>→</b>}</button>)}</div><div className="lab-turn-footer"><span>{result.debug.elapsedMs} ms</span>{result.warnings.length > 0 && <span className="lab-badge is-error">{result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}</span>}<button onClick={() => inspect(index, "logs")}>Inspect turn →</button></div></article>)}
          {pending !== null && <div className="lab-pending"><div className="lab-bubble customer"><small>CUSTOMER</small><p>{pending}</p></div><p role="status">✦ Processing through the production engine…</p></div>}
        </div>
        <form className="lab-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}><label className="sr-only" htmlFor="lab-message">Customer message</label><textarea id="lab-message" value={draft} rows={3} maxLength={2000} disabled={!setup || pending !== null || (latest?.turns ?? 0) >= 40} placeholder={setup ? "Write a customer message…" : "Select a business first…"} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="lab-composer-controls"><label><input type="checkbox" checked={photo} disabled={!setup || pending !== null} onChange={(e) => setPhoto(e.target.checked)} /> Simulate photo</label><button className="btn btn-primary" disabled={!setup || pending !== null || (!draft.trim() && !photo) || (latest?.turns ?? 0) >= 40}>{pending !== null ? "Processing…" : "Send ↑"}</button></div><p className="lab-muted">Enter to send · Shift + Enter for a new line · {latest?.turns ?? 0}/40 turns. Photo tests workflow only.</p>{error && <p role="alert" className="lab-error">{error}</p>}{latest?.turns === 40 && <p className="lab-warning">Turn limit reached. Start a new test conversation.</p>}</form>
      </section>
      <aside className="lab-inspector panel"><div className="lab-panel-heading"><div><span className="lab-eyebrow">03 / UNDERSTAND</span><h2>Conversation Inspector</h2></div><span className="lab-badge">{active ? `Turn ${selected + 1}` : "Ready"}</span></div>{!inspectorOpen && <Inspector turn={active} failure={failure} tab={tab} onTab={setTab} />}</aside>
    </div>
    <button className="btn btn-primary lab-inspector-toggle" onClick={() => setInspectorOpen(true)}>⌘ Open Inspector{active ? ` · Turn ${selected + 1}` : ""}</button>
    <dialog className="lab-dialog lab-drawer" aria-labelledby="lab-drawer-title" ref={drawer} onClose={() => setInspectorOpen(false)}><header><h2 id="lab-drawer-title">Conversation Inspector</h2><button aria-label="Close inspector" onClick={() => setInspectorOpen(false)}>✕</button></header>{inspectorOpen && <Inspector turn={active} failure={failure} tab={tab} onTab={setTab} />}</dialog>
    <dialog className="lab-dialog" ref={dialog} onClose={() => setDataOpen(false)} aria-labelledby="lab-data-title"><header><div><span className="lab-eyebrow">CURRENT FULL STATE · TEST</span><h2 id="lab-data-title">Conversation Data</h2><p>The latest conversation state, independent of the selected turn.</p></div><button aria-label="Close conversation data" onClick={() => setDataOpen(false)}>✕</button></header><div className="lab-modal-grid"><Card title="Customer"><Data value={snapshot.customer} /></Card><Card title="Intent"><Data value={snapshot.intent} /></Card><Card title="Selection"><Data value={snapshot.selection} /></Card><Card title="Workflow"><Data value={snapshot.workflow} /></Card><Card title="Collected Data"><Data value={{ ...current.fields, customer: current.customer }} /></Card><Card title="Missing Data">{latest?.fields.some((f) => f.status === "missing") ? <Fields fields={latest.fields.filter((f) => f.status === "missing")} /> : <p className="lab-muted">{latest ? "No missing required fields reported by this workflow." : "Send a message to inspect required fields."}</p>}</Card></div><Card title="Context available to this conversation"><p className="lab-muted">Products and relevant knowledge loaded by the engine. Policies and FAQs appear within knowledge when configured. No separate customer profile or conversation summary is loaded.</p><Data value={snapshot.context} /></Card><Raw value={snapshot} /></dialog>
    <dialog className="lab-dialog lab-confirm" ref={confirmDialog} onClose={() => setConfirmation(null)} aria-labelledby="lab-confirm-title"><header><h2 id="lab-confirm-title">Start a fresh test?</h2></header><p>{confirmation === "reset" ? "This clears the current conversation and collected data." : `Switching to ${confirmation?.name ?? "another business"} clears the current conversation and collected data.`} This cannot be undone.</p><footer><button className="btn btn-ghost" onClick={() => setConfirmation(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { const next = confirmation; setConfirmation(null); if (next === "reset") reset(); else if (next) void chooseBusiness(next); }}>Start fresh</button></footer></dialog>
  </div>;
}
