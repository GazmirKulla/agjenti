"use client";
import { useId } from "react";
import { flowVisibleNodeIds } from "./flow-visibility";
import { Icon } from "@/components/dashboard/icon";
import { upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph, VisualFlow, VisualFlowKind, VisualTrace } from "@/lib/workflows/visual/types";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { Instance, InstanceStatus } from "@/lib/orchestration/contracts";

export const processLabels: Record<VisualFlowKind | "clarify" | "service" | "actionFlow", string> = {
  service: "Shërbimi", actionFlow: "Veprimi administrativ",
  information: "Informacion", order: "Porosi", booking: "Rezervim", support: "Staf", custom: "Rrjedhë tjetër", clarify: "Sqarim",
};
const processes = [
  { kind: "information", icon: "knowledge", detail: "Njohuri dhe pyetje", place: "information" },
  { kind: "order", icon: "products", detail: "Produkte dhe porosi", place: "order" },
  { kind: "booking", icon: "calendar", detail: "Shërbime dhe orare", place: "booking" },
  { kind: "support", icon: "customers", detail: "Orientim te stafi", place: "support" },
] as const;
export type WorkflowHubProps = {
  graph?: VisualGraph; trace?: VisualTrace; state?: ConversationStatePayload;
  message?: string; bookingEnabled?: boolean; compact?: boolean;
  onOpen?: (kind: VisualFlowKind) => void; onOpenFlow?: (flowId: string) => void; onContext?: () => void;
};
function focusedInstance(state?: ConversationStatePayload): Instance | undefined {
  const runtime = state?.runtime;
  if (!runtime) return;
  return runtime.focusId ? runtime.instances[runtime.focusId] : Object.values(runtime.instances).at(-1);
}
function taskPhase(status?: InstanceStatus) {
  if (status === "suspended") return "suspended";
  if (status === "completed" || status === "cancelled" || status === "failed") return "completed";
  if (status && !["completed", "cancelled", "failed"].includes(status)) return "active";
  return null;
}
function phaseLabel(status?: InstanceStatus) {
  const phase = taskPhase(status);
  return phase === "suspended" ? "E pezulluar" : phase === "completed" ? "E përfunduar" : phase === "active" ? "Në vazhdim" : "Pa nisur";
}

export function WorkflowFlowChooser({ flows, onSelect, onClose }: { flows: VisualFlow[]; onSelect: (flowId: string) => void; onClose: () => void }) {
  return <div className="vf-hub-flow-chooser" role="group" aria-label="Zgjidh rrjedhën" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="vf-hub-chooser-heading"><div><strong>Zgjidh rrjedhën</strong><p>Çdo rrjedhë ka hapat dhe emrin e vet.</p></div><button type="button" onClick={onClose} aria-label="Mbyll zgjedhjen">×</button></div>
    {flows.map((flow, index) => <button className="vf-hub-flow-option" type="button" key={flow.id} value={flow.id} autoFocus={index === 0} onClick={event => onSelect(event.currentTarget.value)}><span><strong>{flow.label}</strong><small>{flow.nodeIds.length} hapa</small></span><Icon name="arrow" size={16} /></button>)}
  </div>;
}

/** The return arrows mean waiting for another message, never an automatic execution cycle. */
export function WorkflowHub({ graph, trace, state, message, bookingEnabled = false, compact = false, onOpen, onOpenFlow, onContext }: WorkflowHubProps) {
  const marker = `hub-${useId().replace(/:/g, "")}`;
  const definition = graph ? upgradeVisualGraph(graph) : undefined;
  const flows = definition?.flows ?? [];
  const nodeId = trace?.routing?.to ?? trace?.state.nodeId;
  const active = trace?.routing?.action === "answer" ? "information" : flows.find(flow => flow.nodeIds.includes(nodeId ?? ""))?.kind;
  const profileCount = Object.values(state?.runtime?.profileMemory ?? {}).filter(Boolean).length;
  const bookingVisible = bookingEnabled || flows.some(flow => flow.kind === "booking");
  const focused = focusedInstance(state);
  const cards = [
    ...flows.map(flow => ({ flow, kind: flow.kind, label: flow.label })),
    ...processes.filter(item => !definition && !flows.some(flow => flow.kind === item.kind) && (item.kind !== "booking" || bookingVisible)).map(item => ({ flow: undefined, kind: item.kind, label: processLabels[item.kind] })),
  ];
  const columns = [cards.filter((_, index) => index % 2 === 0), cards.filter((_, index) => index % 2 === 1)];
  const orbitHeight = Math.max(445, Math.max(...columns.map(column => column.length)) * 160 + 140);
  const activeFlowId = flows.find(flow => flow.nodeIds.includes(nodeId ?? ""))?.id;
  const phase = taskPhase(focused?.status);
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
          const current = activeFlowId ? flow?.id === activeFlowId : active === kind && cards.filter(card => card.kind === kind).length === 1;
          return <button type="button" key={flow?.id ?? kind} value={flow?.id} className={`vf-hub-process is-${kind} ${current ? "is-current" : ""}`} disabled={flow ? !onOpenFlow : !onOpen} onClick={() => flow ? onOpenFlow?.(flow.id) : onOpen?.(kind)} aria-label={`${flow ? "Hap rrjedhën" : "Shto rrjedhën"}: ${label}`}>
            <span className="vf-hub-process-icon"><Icon name={item?.icon ?? "workflows"} size={21} /></span>
            <strong>{label}</strong><span>{processLabels[kind]}</span>
            <small>{flow ? `${definition ? flowVisibleNodeIds(definition, flow.id).size : flow.nodeIds.length} hapa · Hap rrjedhën ↗` : onOpen ? "Shto rrjedhën +" : "Sipas konfigurimit"}</small>
            {current && phase === "suspended" ? <em>E pezulluar · të dhënat ruhen</em> : current && phase === "completed" ? <em>E përfunduar</em> : current ? <em>Rruga e këtij mesazhi</em> : null}
          </button>;
        })}
      </div>)}
      <div className="vf-hub-return"><Icon name="refresh" size={15} /><span>Përgjigje → prit mesazhin tjetër</span></div>
    </div>
    <div className="vf-hub-decision" aria-live="polite"><Icon name="spark" size={16} /><div><strong>{focused?.status === "handoff" ? "Orientim te stafi" : "Workflow udhëzon bisedën"}</strong><p>Klienti mund të ndryshojë kërkesën ose të rikthehet te një proces i mëparshëm. Progresi ruhet.</p></div></div>
  </section>;
}

const fieldLabels: Record<string, string> = {
  name: "Emri", phone: "Telefoni", email: "Email", city: "Qyteti", address: "Adresa", customer_name: "Emri", customer_phone: "Telefoni", customer_email: "Email", customer_city: "Qyteti", customer_address: "Adresa", serviceId: "Shërbimi", date: "Data", time: "Ora", contact: "Kontakti", product: "Produkti", product_id: "Produkti",
};
export function WorkflowContextPanel({ state }: { state?: ConversationStatePayload }) {
  const runtime = state?.runtime;
  const profile = Object.entries(runtime?.profileMemory ?? {});
  const instances = Object.values(runtime?.instances ?? {});
  const focused = focusedInstance(state);
  const facts = Object.values(focused?.facts ?? {});
  return <div className="vf-context-panel">
    <span className="vf-detail-icon"><Icon name="customers" size={23} /></span><h2>Kujtesa e bisedës</h2><p className="vf-help">Të dhënat e provës ndiqen në të gjitha rrjedhat.</p>
    <h3>Profili i klientit</h3>{profile.length ? <dl>{profile.map(([key, fact]) => <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{fact?.value}</dd></div>)}</dl> : <p className="vf-help">Ende nuk janë dhënë të dhëna në këtë provë.</p>}
    <h3>Proceset në vazhdim</h3>
    {instances.length ? instances.map(instance => <div className="vf-context-task" key={instance.id}><Icon name="workflows" size={17} /><strong>{instance.definitionId}</strong><span>{phaseLabel(instance.status)}</span></div>)
      : <p className="vf-help">Nuk ka proces të nisur në këtë provë.</p>}
    {focused?.status === "suspended" && <p className="vf-context-note">U ruajt për më vonë</p>}
    {facts.length > 0 && <details className="vf-context-values"><summary>Të dhënat e mbledhura</summary><dl>{facts.map(fact => <div key={fact.fieldId}><dt>{fieldLabels[fact.fieldId] ?? fact.fieldId.replaceAll("_", " ")}</dt><dd>{String(fact.value)}</dd></div>)}</dl></details>}
  </div>;
}
