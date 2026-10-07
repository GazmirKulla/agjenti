"use client";
import type { ReactNode } from "react";
import type { LabTurn, LabField, LabFailure } from "@/lib/chat-lab/model";
import type { TraceStage } from "@/lib/conversations/trace";

export const tabs: { id: TraceStage; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "context", label: "Context" },
  { id: "workflow", label: "Workflow" }, { id: "ai", label: "AI / API" },
  { id: "tools", label: "Tools / Actions" }, { id: "logs", label: "Logs" },
];
export function Raw({ value, label = "View Raw JSON" }: { value: unknown; label?: string }) {
  return <details className="lab-raw"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2) ?? "null"}</pre></details>;
}
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="lab-card"><h3>{title}</h3>{children}</section>;
}
/** Structured, reusable renderer for debug snapshots, including future read-only live turns. */
export function Data({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === undefined || value === null || value === "") return <span className="lab-muted">Not available</span>;
  if (typeof value !== "object") return <span className="lab-value">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="lab-muted">None</span>;
    if (value.every((item) => item === null || typeof item !== "object")) return <ul className="lab-data-values">{value.map((item, i) => <li key={i}><Data value={item} /></li>)}</ul>;
    return <div className="lab-data-list">{value.map((item, i) => <details key={i} open={value.length <= 3}><summary>{typeof item === "object" && item ? String(item.name ?? item.title ?? item.key ?? item.role ?? `Item ${i + 1}`) : `Item ${i + 1}`}</summary><Data value={item} depth={depth + 1} /></details>)}</div>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="lab-muted">None</span>;
  if (depth > 4) return <Raw value={value} />;
  return <dl className="lab-data">{entries.map(([key, item]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd><Data value={item} depth={depth + 1} /></dd></div>)}</dl>;
}
export function Fields({ fields }: { fields: LabField[] }) {
  return fields.length ? <div className="lab-fields">{fields.map((field) => <div className={`lab-field is-${field.status}`} key={field.key}><div><strong>{field.key}</strong><span className="lab-badge">{field.status}</span></div><Data value={field.value} /></div>)}</div> : <p className="lab-muted">No workflow fields declared for this turn.</p>;
}
export function intentOf(turn?: LabTurn) {
  return turn?.trace.find((event) => event.label === "Intent routed")?.data?.intent ?? null;
}
export function workflowOf(turn: LabTurn) {
  return turn.trace.find((event) => event.stage === "workflow")?.data ?? {};
}
export function Inspector({ turn, failure, tab, onTab }: { turn?: LabTurn; failure?: LabFailure; tab: TraceStage; onTab: (tab: TraceStage) => void }) {
  const workflow = turn ? workflowOf(turn) : {};
  const ai = turn?.trace.filter((e) => e.stage === "ai") ?? [];
  const usage = ai.flatMap((e) => e.data?.usage ? [{ call: e.label, usage: e.data.usage }] : []);
  const tokenTotals = usage.length ? usage.reduce((sum, entry) => {
    const tokens = entry.usage as Record<string, unknown>;
    const number = (value: unknown) => typeof value === "number" ? value : 0;
    return { input: sum.input + number(tokens.input_tokens ?? tokens.prompt_tokens), output: sum.output + number(tokens.output_tokens), total: sum.total + number(tokens.total_tokens) };
  }, { input: 0, output: 0, total: 0 }) : null;
  return <>
    <div className="lab-tabs" role="tablist" aria-label="Conversation inspector">{tabs.map((item) => <button type="button" key={item.id} role="tab" id={`lab-tab-${item.id}`} aria-controls="lab-inspector-content" aria-selected={tab === item.id} onClick={() => onTab(item.id)}>{item.label}</button>)}</div>
    <div className="lab-inspector-content" id="lab-inspector-content" role="tabpanel" aria-labelledby={`lab-tab-${tab}`}>
      {failure && <Card title="Last attempt failed"><p role="alert" className="lab-error">{failure.error}</p><p className="lab-muted">Conversation state was not advanced. Any selected successful turn remains below.</p>{failure.trace?.map((event, i) => <p className="lab-muted" key={i}>{event.elapsedMs} ms · {event.label}</p>)}<Raw value={failure.trace} label="Failed execution trace" /></Card>}
      {!turn ? <div className="lab-empty"><span className="lab-empty-icon">⌘</span><h3>Follow every decision</h3><p>Send a test message, then select a turn to inspect the real engine’s context, workflow and AI payloads.</p></div> : <>
        <div className="lab-inspector-meta"><span className="lab-badge">Turn {turn.turns}</span><span>{turn.debug.elapsedMs.toLocaleString()} ms · {turn.debug.source}</span></div>
        {tab === "overview" && <>
          <Card title="User input"><p className="lab-value">{turn.input || "[Simulated photo]"}</p></Card>
          <div className="lab-card-grid"><Card title="Detected intent"><Data value={intentOf(turn)} /><p className="lab-muted">Deterministic router · no confidence score</p></Card><Card title="Current workflow"><Data value={workflow.workflowName ?? turn.workflowId} /><span className="lab-badge">{turn.nextState.step_key}</span></Card></div>
          <Card title="Final agent response"><p className="lab-value">{turn.reply}</p></Card>
          <Card title="Performance"><Data value={{ executionTime: `${turn.debug.elapsedMs} ms`, model: turn.debug.model, inputTokens: tokenTotals?.input ?? "Unavailable", outputTokens: tokenTotals?.output ?? "Unavailable", totalTokens: tokenTotals?.total ?? "Unavailable" }} /></Card>
          <Card title="Warnings / errors">{turn.warnings.length ? turn.warnings.map((warning, i) => <p className="lab-warning" key={i}>{warning}</p>) : <span className="lab-badge">No warnings</span>}</Card>
        </>}
        {tab === "context" && <>
          <p className="lab-muted">Actual context read during this turn. The AI / API tab shows exactly which parts reached each model request.</p>
          {turn.trace.filter((e) => e.stage === "context").map((event, i) => <Card title={event.label} key={i}><Data value={event.data} /></Card>)}
          <Card title="Customer and prior collected data"><Data value={turn.trace.find((e) => e.label === "Business context loaded")?.data?.previousState} /></Card>
        </>}
        {tab === "workflow" && <>
          <Card title="Workflow state"><Data value={{ name: workflow.workflowName, id: turn.workflowId, previousStep: workflow.previousStep, currentStep: turn.nextState.step_key, status: turn.nextState.step_key === "order_ready" ? "ready" : "in progress", nextPossibleSteps: turn.workflowProgress.filter((s) => s.status === "pending").slice(0, 1).map((s) => s.key) }} /></Card>
          <Card title="Workflow progress">{turn.workflowProgress.length ? <ol className="lab-progress">{turn.workflowProgress.map((step) => <li key={step.key} className={`is-${step.status}`}><span>{step.status === "done" ? "✓" : step.status === "current" ? "●" : "○"}</span><div><strong>{step.label}</strong><small>{step.key} · {step.status}</small>{step.value && <p>{step.value}</p>}</div></li>)}</ol> : <p className="lab-muted">Informational turn; no workflow steps executed.</p>}</Card>
          <Card title="Collected workflow variables"><Data value={turn.nextState.fields} /></Card>
          <Card title="Required and optional fields"><Fields fields={turn.fields} /><p className="lab-muted">Required flags come from workflow configuration. The production engine currently advances through configured steps sequentially.</p></Card>
          <Card title="Missing required fields"><Data value={turn.fields.filter((f) => f.status === "missing").map((f) => f.key)} /></Card>
        </>}
        {tab === "ai" && <>
          <Card title="Model configuration"><Data value={{ model: turn.debug.model, parameters: "Only explicitly supplied parameters are shown in each request; others use provider defaults.", toolDefinitions: "None — production currently has no model action tools." }} /></Card>
          {ai.length ? ai.map((event, i) => <Card title={event.label} key={i}><span className={`lab-badge ${event.status === "error" ? "is-error" : ""}`}>{event.elapsedMs} ms{event.status ? ` · ${event.status}` : ""}</span><Data value={event.data?.request ? { request: event.data.request } : { parsed: event.data?.parsed, tokenUsage: event.data?.usage, response: event.data?.response ? "Provider body available in Raw Response below" : null }} /><Raw value={event.data} label={event.data?.request ? "View Raw Payload" : "View Raw Response"} /></Card>) : <p className="lab-muted">No AI call was needed for this turn.</p>}
          <Card title="Final transformed response"><p className="lab-value">{turn.reply}</p></Card>
        </>}
        {tab === "tools" && <>
          <p className="lab-muted">Read-only internal calls and the test action policy. No invented tool calls or simulated successful orders.</p>
          {turn.trace.filter((e) => e.stage === "tools").map((event, i) => <Card title={event.label} key={i}><span className="lab-badge">{event.status ?? "success"}</span><Data value={event.data} /></Card>)}
        </>}
        {tab === "logs" && <ol className="lab-logs">{turn.trace.map((event, i) => <li key={i}><time>{event.elapsedMs} ms</time><button onClick={() => onTab(event.stage === "logs" ? "overview" : event.stage)}><strong>{event.label}</strong><small>{event.status ?? "success"}</small></button></li>)}</ol>}
        <Raw value={{ ...turn, session: undefined, replaySession: undefined }} />
      </>}
    </div>
  </>;
}
