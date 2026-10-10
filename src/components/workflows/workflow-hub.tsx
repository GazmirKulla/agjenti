"use client";
import { useId, useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph, VisualFlow, VisualFlowKind, VisualTrace } from "@/lib/workflows/visual/types";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { workflowHubSelection } from "./hub-selection";

export const processLabels: Record<VisualFlowKind | "clarify", string> = {
  information: "Informacion", order: "Porosi", booking: "Rezervim", support: "Staf", custom: "Rrjedhë tjetër", clarify: "Sqarim",
};
const processes = [
  { kind: "information", icon: "knowledge", detail: "Njohuri dhe pyetje", place: "information" },
  { kind: "order", icon: "products", detail: "Produkte dhe porosi", place: "order" },
  { kind: "booking", icon: "calendar", detail: "Shërbime dhe orare", place: "booking" },
  { kind: "support", icon: "customers", detail: "Orientim te stafi", place: "support" },
] as const;
type Routing = AgentTurnResult["conversationRouting"];
export type WorkflowHubProps = {
  graph?: VisualGraph; trace?: VisualTrace; state?: ConversationStatePayload;
  routing?: Routing; message?: string; bookingEnabled?: boolean; compact?: boolean;
  onOpen?: (kind: VisualFlowKind) => void; onOpenFlow?: (flowId: string) => void; onContext?: () => void;
};

export function WorkflowFlowChooser({ flows, onSelect, onClose }: { flows: VisualFlow[]; onSelect: (flowId: string) => void; onClose: () => void }) {
  return <div className="vf-hub-flow-chooser" role="group" aria-label="Zgjidh rrjedhën" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="vf-hub-chooser-heading"><div><strong>Zgjidh rrjedhën</strong><p>Çdo rrjedhë ka hapat dhe emrin e vet.</p></div><button type="button" onClick={onClose} aria-label="Mbyll zgjedhjen">×</button></div>
    {flows.map((flow, index) => <button className="vf-hub-flow-option" type="button" key={flow.id} value={flow.id} autoFocus={index === 0} onClick={event => onSelect(event.currentTarget.value)}><span><strong>{flow.label}</strong><small>{flow.nodeIds.length} hapa</small></span><Icon name="arrow" size={16} /></button>)}
  </div>;
}

/** The return arrows mean waiting for another message, never an automatic execution cycle. */
export function WorkflowHub({ graph, trace, state, routing, message, bookingEnabled = false, compact = false, onOpen, onOpenFlow, onContext }: WorkflowHubProps) {
  const marker = `hub-${useId().replace(/:/g, "")}`;
  const [choosing, setChoosing] = useState<VisualFlowKind | null>(null);
  const chooserTrigger = useRef<HTMLButtonElement | null>(null);
  const flows = graph ? upgradeVisualGraph(graph).flows : [];
  const choices = choosing ? flows.filter(flow => flow.kind === choosing) : [];
  function closeChooser() { setChoosing(null); chooserTrigger.current?.focus(); }
  function openProcess(kind: VisualFlowKind, trigger: HTMLButtonElement) {
    const selection = workflowHubSelection(flows, kind);
    if (selection.action === "create") onOpen?.(selection.kind);
    else if (selection.action === "open") onOpenFlow?.(selection.flowId);
    else { chooserTrigger.current = trigger; setChoosing(kind); }
  }
  const nodeId = trace?.routing?.to ?? trace?.state.nodeId;
  const active = routing?.process ?? (trace?.routing?.action === "answer" ? "information" : flows.find(flow => flow.nodeIds.includes(nodeId ?? ""))?.kind);
  const profileCount = Object.values(state?.context?.profile ?? {}).filter(Boolean).length;
  const bookingVisible = bookingEnabled || flows.some(flow => flow.kind === "booking") || !!state?.processes?.booking;
  return <section className={`vf-hub ${compact ? "is-compact" : ""}`} aria-label="Mesazhi në qendër të workflow-t">
    <div className="vf-hub-caption"><span className="vf-live-dot" />Çdo mesazh hap rrugën e duhur</div>
    <div className="vf-hub-orbit">
      <svg className="vf-hub-lines" viewBox="0 0 800 460" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto-start-reverse"><path d="m2 1 4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.3" /></marker></defs>
        <ellipse cx="400" cy="230" rx="265" ry="180" />
        {["M 280 195 Q 225 180 165 130", "M 280 270 Q 220 285 165 340", ...(bookingVisible ? ["M 520 195 Q 585 180 635 130"] : []), "M 520 270 Q 580 285 635 340"].map((d, i) => <path key={i} d={d} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />)}
      </svg>
      <button type="button" className="vf-hub-context" onClick={onContext} disabled={!onContext}><Icon name="customers" size={16} /><span>Konteksti i klientit</span><small>{profileCount ? `${profileCount} të dhëna të ruajtura` : "Një kujtesë për çdo proces"}</small></button>
      <div className="vf-hub-center">
        <span className="vf-hub-main-icon"><Icon name="inbox" size={27} /></span>
        <h2>Mesazhi i klientit</h2><p>Konteksti + kërkesa e re</p>
        <div className="vf-hub-message">{message ? <q>{message}</q> : <span>Provo një mesazh për të parë rrugën e ndjekur.</span>}</div>
        <span className="vf-hub-channels"><Icon name="instagram" size={13} /> Instagram <i /> Bisedë prove</span>
      </div>
      {processes.filter(item => item.kind !== "booking" || bookingVisible).map(item => {
        const group = flows.filter(flow => flow.kind === item.kind);
        const task = item.kind === "order" || item.kind === "booking" ? state?.processes?.[item.kind] : undefined;
        const countLabel = `${group.length} ${group.length === 1 ? "rrjedhë" : "rrjedha"} · ${group.reduce((sum, flow) => sum + flow.nodeIds.length, 0)} hapa`;
        return <button type="button" key={item.kind} className={`vf-hub-process is-${item.place} ${active === item.kind ? "is-current" : ""}`} disabled={group.length ? !onOpenFlow : !onOpen} onClick={event => openProcess(item.kind, event.currentTarget)} aria-expanded={group.length > 1 ? choosing === item.kind : undefined} aria-label={`${group.length > 1 ? "Zgjidh rrjedhën" : "Hap rrjedhën"}: ${processLabels[item.kind]}`}>
          <span className="vf-hub-process-icon"><Icon name={item.icon} size={21} /></span>
          <strong>{processLabels[item.kind]}</strong><span title={group.map(flow => flow.label).join(" · ")}>{group.length ? group.map(flow => flow.label).join(" · ") : item.detail}</span>
          <small>{group.length ? countLabel : onOpen ? "Shto rrjedhën +" : "Sipas konfigurimit"}{group.length > 1 && onOpenFlow ? " · Zgjidh ↗" : ""}</small>
          {task?.status === "suspended" ? <em>E pezulluar · të dhënat ruhen</em> : task?.status === "completed" ? <em>E përfunduar</em> : active === item.kind ? <em>Rruga e këtij mesazhi</em> : null}
        </button>;
      })}
      <div className="vf-hub-return"><Icon name="refresh" size={15} /><span>Përgjigje → prit mesazhin tjetër</span></div>
    </div>
    <div className="vf-hub-decision" aria-live="polite"><Icon name="spark" size={16} /><div><strong>{routing ? `Vendimi i agjentit · ${processLabels[routing.process]}` : "Workflow udhëzon bisedën"}</strong><p>{routing?.reason ?? "Klienti mund të ndryshojë kërkesën ose të rikthehet te një proces i mëparshëm. Progresi ruhet."}</p></div></div>
    {flows.some(flow => flow.kind === "custom") && <div className="vf-hub-custom"><button type="button" className="vf-button" disabled={!onOpenFlow} onClick={event => openProcess("custom", event.currentTarget)} aria-expanded={choosing === "custom"}><Icon name="workflows" size={15} />Rrjedha të tjera · {flows.filter(flow => flow.kind === "custom").length}</button></div>}
    {choices.length > 0 && onOpenFlow && <div className="vf-hub-choice-layer"><button className="vf-hub-choice-backdrop" type="button" aria-label="Mbyll zgjedhjen e rrjedhës" onClick={closeChooser} /><WorkflowFlowChooser flows={choices} onClose={closeChooser} onSelect={flowId => { setChoosing(null); onOpenFlow(flowId); }} /></div>}
  </section>;
}

const fieldLabels: Record<string, string> = {
  name: "Emri", phone: "Telefoni", email: "Email", city: "Qyteti", address: "Adresa", customer_name: "Emri", customer_phone: "Telefoni", customer_email: "Email", customer_city: "Qyteti", customer_address: "Adresa", serviceId: "Shërbimi", date: "Data", time: "Ora", contact: "Kontakti", product: "Produkti", product_id: "Produkti",
};
export function WorkflowContextPanel({ state, routing }: { state?: ConversationStatePayload; routing?: Routing }) {
  const profile = Object.entries(state?.context?.profile ?? {});
  const orderFacts = Object.entries(state?.processes?.order?.snapshot.order ?? state?.context?.order ?? {});
  const booking = state?.processes?.booking?.draft;
  return <div className="vf-context-panel">
    <span className="vf-detail-icon"><Icon name="customers" size={23} /></span><h2>Kujtesa e bisedës</h2><p className="vf-help">Të dhënat e provës ndiqen në të gjitha rrjedhat.</p>
    <h3>Profili i klientit</h3>{profile.length ? <dl>{profile.map(([key, fact]) => <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{fact?.value}</dd></div>)}</dl> : <p className="vf-help">Ende nuk janë dhënë të dhëna në këtë provë.</p>}
    <h3>Proceset në vazhdim</h3>{(["order", "booking"] as const).map(kind => {
      const task = state?.processes?.[kind];
      return <div className="vf-context-task" key={kind}><Icon name={kind === "order" ? "products" : "calendar"} size={17} /><strong>{processLabels[kind]}</strong><span>{task ? task.status === "active" ? "Në vazhdim" : task.status === "suspended" ? "E pezulluar" : "E përfunduar" : "Pa nisur"}</span></div>;
    })}
    {orderFacts.length > 0 && <details className="vf-context-values"><summary>Të dhënat e porosisë</summary><dl>{orderFacts.map(([key, fact]) => <div key={key}><dt>{fieldLabels[key] ?? key.replaceAll("_", " ")}</dt><dd>{fact.value}</dd></div>)}</dl></details>}
    {booking && <details className="vf-context-values"><summary>Të dhënat e rezervimit</summary><dl>{(["date", "time", "name", "contact"] as const).filter(key => booking[key]).map(key => <div key={key}><dt>{fieldLabels[key]}</dt><dd>{booking[key]}</dd></div>)}</dl></details>}
    {routing && <><h3>Vendimi i fundit</h3><p className="vf-help">{routing.reason}</p>{routing.resumed && <p className="vf-context-note">U rifillua: {processLabels[routing.resumed]}</p>}{routing.suspended && <p className="vf-context-note">U ruajt për më vonë: {processLabels[routing.suspended]}</p>}{[["U ripërdorën", routing.reusedFields], ["Mbeten për t’u plotësuar", routing.missingFields]].map(([label, fields]) => <div className="vf-context-fields" key={label as string}><h3>{label as string}</h3><p>{(fields as string[]).length ? (fields as string[]).map(key => fieldLabels[key] ?? key.replaceAll("_", " ")).join(" · ") : "—"}</p></div>)}</>}
  </div>;
}
