"use client";
import { useId } from "react";
import { Icon } from "@/components/dashboard/icon";
import { upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph, VisualFlow, VisualFlowKind, VisualTrace } from "@/lib/workflows/visual/types";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";

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
  const flows = graph ? upgradeVisualGraph(graph).flows : [];
  const nodeId = trace?.routing?.to ?? trace?.state.nodeId;
  const active = routing?.process ?? (trace?.routing?.action === "answer" ? "information" : flows.find(flow => flow.nodeIds.includes(nodeId ?? ""))?.kind);
  const profileCount = Object.values(state?.context?.profile ?? {}).filter(Boolean).length;
  const bookingVisible = bookingEnabled || flows.some(flow => flow.kind === "booking") || !!state?.processes?.booking;
  const cards = [
    ...flows.map(flow => ({ flow, kind: flow.kind, label: flow.label })),
    ...processes.filter(item => !flows.some(flow => flow.kind === item.kind) && (item.kind !== "booking" || bookingVisible)).map(item => ({ flow: undefined, kind: item.kind, label: processLabels[item.kind] })),
  ];
  const columns = [cards.filter((_, index) => index % 2 === 0), cards.filter((_, index) => index % 2 === 1)];
  const orbitHeight = Math.max(445, Math.max(...columns.map(column => column.length)) * 160 + 140);
  const activeFlowId = flows.find(flow => flow.nodeIds.includes(nodeId ?? ""))?.id;
  return <section className={`vf-hub ${compact ? "is-compact" : ""}`} aria-label="Mesazhi në qendër të workflow-t">
    <div className="vf-hub-caption"><span className="vf-live-dot" />Çdo mesazh hap rrugën e duhur</div>
    <div className="vf-hub-orbit is-flow-board" style={{ height: orbitHeight, flexBasis: orbitHeight }}>
      <svg className="vf-hub-lines" viewBox={`0 0 800 ${orbitHeight}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto-start-reverse"><path d="m2 1 4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.3" /></marker></defs>
        <ellipse cx="400" cy={orbitHeight / 2} rx="265" ry={orbitHeight / 2 - 40} />
        {columns.flatMap((column, side) => column.map((card, index) => {
          const x = side === 0 ? 165 : 635;
          const centerX = side === 0 ? 280 : 520;
          const y = 80 + index * 160 + 70;
          return <path key={card.flow?.id ?? card.kind} d={`M ${centerX} ${orbitHeight / 2} Q ${side === 0 ? 225 : 585} ${y} ${x} ${y}`} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />;
        }))}
      </svg>
      <button type="button" className="vf-hub-context" onClick={onContext} disabled={!onContext}><Icon name="customers" size={16} /><span>Konteksti i klientit</span><small>{profileCount ? `${profileCount} të dhëna të ruajtura` : "Një kujtesë për çdo proces"}</small></button>
      <div className="vf-hub-center">
        <span className="vf-hub-main-icon"><Icon name="inbox" size={27} /></span>
        <h2>Mesazhi i klientit</h2><p>Konteksti + kërkesa e re</p>
        <div className="vf-hub-message">{message ? <q>{message}</q> : <span>Provo një mesazh për të parë rrugën e ndjekur.</span>}</div>
        <span className="vf-hub-channels"><Icon name="instagram" size={13} /> Instagram <i /> Bisedë prove</span>
      </div>
      {columns.map((column, side) => <div className={`vf-hub-flow-column is-${side === 0 ? "left" : "right"}`} key={side}>
        {column.map(({ flow, kind, label }) => {
          const item = processes.find(item => item.kind === kind);
          const task = kind === "order" || kind === "booking" ? state?.processes?.[kind] : undefined;
          const current = activeFlowId ? flow?.id === activeFlowId : active === kind && cards.filter(card => card.kind === kind).length === 1;
          return <button type="button" key={flow?.id ?? kind} value={flow?.id} className={`vf-hub-process is-${kind} ${current ? "is-current" : ""}`} disabled={flow ? !onOpenFlow : !onOpen} onClick={() => flow ? onOpenFlow?.(flow.id) : onOpen?.(kind)} aria-label={`${flow ? "Hap rrjedhën" : "Shto rrjedhën"}: ${label}`}>
            <span className="vf-hub-process-icon"><Icon name={item?.icon ?? "workflows"} size={21} /></span>
            <strong>{label}</strong><span>{processLabels[kind]}</span>
            <small>{flow ? `${flow.nodeIds.length} hapa · Hap rrjedhën ↗` : onOpen ? "Shto rrjedhën +" : "Sipas konfigurimit"}</small>
            {current && task?.status === "suspended" ? <em>E pezulluar · të dhënat ruhen</em> : current && task?.status === "completed" ? <em>E përfunduar</em> : current ? <em>Rruga e këtij mesazhi</em> : null}
          </button>;
        })}
      </div>)}
      <div className="vf-hub-return"><Icon name="refresh" size={15} /><span>Përgjigje → prit mesazhin tjetër</span></div>
    </div>
    <div className="vf-hub-decision" aria-live="polite"><Icon name="spark" size={16} /><div><strong>{routing ? `Vendimi i agjentit · ${processLabels[routing.process]}` : "Workflow udhëzon bisedën"}</strong><p>{routing?.reason ?? "Klienti mund të ndryshojë kërkesën ose të rikthehet te një proces i mëparshëm. Progresi ruhet."}</p></div></div>
  </section>;
}

const fieldLabels: Record<string, string> = {
  name: "Emri", phone: "Telefoni", email: "Email", city: "Qyteti", address: "Adresa", customer_name: "Emri", customer_phone: "Telefoni", customer_email: "Email", customer_city: "Qyteti", customer_address: "Adresa", serviceId: "Shërbimi", date: "Data", time: "Ora", contact: "Kontakti", product: "Produkti", product_id: "Produkti",
};
export function WorkflowContextPanel({ state, routing }: { state?: ConversationStatePayload; routing?: Routing }) {
  const profile = Object.entries(state?.context?.profile ?? {});
  const orderFacts = Object.entries(state?.processes?.order?.snapshot.order ?? state?.context?.order ?? {});
  const booking = state?.processes?.booking?.draft;
  const service = state?.processes?.service;
  const serviceFacts = Object.entries(service?.order ?? {});
  return <div className="vf-context-panel">
    <span className="vf-detail-icon"><Icon name="customers" size={23} /></span><h2>Kujtesa e bisedës</h2><p className="vf-help">Të dhënat e provës ndiqen në të gjitha rrjedhat.</p>
    <h3>Profili i klientit</h3>{profile.length ? <dl>{profile.map(([key, fact]) => <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{fact?.value}</dd></div>)}</dl> : <p className="vf-help">Ende nuk janë dhënë të dhëna në këtë provë.</p>}
    <h3>Proceset në vazhdim</h3>{(["order", "booking"] as const).map(kind => {
      const task = state?.processes?.[kind];
      return <div className="vf-context-task" key={kind}><Icon name={kind === "order" ? "products" : "calendar"} size={17} /><strong>{processLabels[kind]}</strong><span>{task ? task.status === "active" ? "Në vazhdim" : task.status === "suspended" ? "E pezulluar" : "E përfunduar" : "Pa nisur"}</span></div>;
    })}
    {service && <div className="vf-context-task"><Icon name="briefcase" size={17} /><strong>Shërbimi</strong><span>{service.status === "active" ? "Në vazhdim" : service.status === "suspended" ? "I pezulluar" : "I përfunduar"}</span></div>}
    {orderFacts.length > 0 && <details className="vf-context-values"><summary>Të dhënat e porosisë</summary><dl>{orderFacts.map(([key, fact]) => <div key={key}><dt>{fieldLabels[key] ?? key.replaceAll("_", " ")}</dt><dd>{fact.value}</dd></div>)}</dl></details>}
    {serviceFacts.length > 0 && <details className="vf-context-values"><summary>Të dhënat e shërbimit</summary><dl>{serviceFacts.map(([key, fact]) => <div key={key}><dt>{fieldLabels[key] ?? key.replaceAll("_", " ")}</dt><dd>{fact.value}</dd></div>)}</dl></details>}
    {booking && <details className="vf-context-values"><summary>Të dhënat e rezervimit</summary><dl>{(["date", "time", "name", "contact"] as const).filter(key => booking[key]).map(key => <div key={key}><dt>{fieldLabels[key]}</dt><dd>{booking[key]}</dd></div>)}</dl></details>}
    {routing && <><h3>Vendimi i fundit</h3><p className="vf-help">{routing.reason}</p>{routing.resumed && <p className="vf-context-note">U rifillua: {processLabels[routing.resumed]}</p>}{routing.suspended && <p className="vf-context-note">U ruajt për më vonë: {processLabels[routing.suspended]}</p>}{[["U ripërdorën", routing.reusedFields], ["Mbeten për t’u plotësuar", routing.missingFields]].map(([label, fields]) => <div className="vf-context-fields" key={label as string}><h3>{label as string}</h3><p>{(fields as string[]).length ? (fields as string[]).map(key => fieldLabels[key] ?? key.replaceAll("_", " ")).join(" · ") : "—"}</p></div>)}</>}
  </div>;
}
