"use client";
import { useMemo, useState } from "react";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { diffHighlights, diffWorkflowGraphs } from "@/lib/workflows/visual/diff";
import { semanticChangeFocus, type SemanticChangeSummary } from "@/lib/business-assistant/semantic-summary";
import { VisualGraphView } from "./visual-graph";
import "./workflow-change-review.css";

const configurationLabels: Record<string, string> = {
  active_products: "Shto ose aktivizo produktet në katalog.", active_knowledge: "Shto informacion aktiv për biznesin.",
  agent_booking_enabled: "Aktivizo rezervimet e agjentit.", active_bookable_service: "Konfiguro një shërbim që mund të rezervohet.",
  published_order_status_flow: "Konfiguro rrjedhën e leximit të statusit të porosisë.", capability_assessment: "Riverifiko aftësitë e biznesit.",
  "module:products": "Aktivizo modulin e produkteve.", "module:knowledge": "Aktivizo modulin e njohurive.",
  "module:orders": "Aktivizo modulin e porosive.", "module:workflows": "Aktivizo workflow-t.",
  "module:bookings": "Aktivizo modulin e rezervimeve.", "module:staff": "Aktivizo aksesin e stafit.",
};
const unsupportedLabels: Record<string, string> = { "inventory.check": "Kontrolli i inventarit", "back_in_stock.notify": "Njoftimi kur produkti rikthehet në stok", "schedule.trigger": "Ekzekutimi automatik në një kohë të planifikuar" };

export function WorkflowChangeReview({ before, after, summary }: { before: VisualGraph; after: VisualGraph; summary: SemanticChangeSummary }) {
  const [side, setSide] = useState<"before" | "after">("after");
  const [focus, setFocus] = useState<{ nodeId: string; sequence: number }>();
  const diff = useMemo(() => diffWorkflowGraphs(before, after), [before, after]);
  const graph = side === "before" ? before : after;
  const flowName = (id: string) => (after.version === 2 ? after.flows.find(f => f.id === id)?.label : undefined) ?? (before.version === 2 ? before.flows.find(f => f.id === id)?.label : undefined) ?? "Procesi";
  return <section className="workflow-change-review" aria-label="Çfarë ndryshon për biznesin">
    <header><h3>Çfarë ndryshon për klientin?</h3><p>{summary.blocked ? "Kërkesë e bllokuar · pa ndryshime të ekzekutueshme" : "Propozim · ende i paruajtur"} · bazuar në revisionin {summary.baseRevision}</p>
      {summary.publishedVersionId && <small>Versioni i publikuar: {summary.publishedVersionId}</small>}
      <p>Struktura më poshtë është verifikuar nga dy versionet. Sjellja gjatë bisedës nuk është e garantuar.</p></header>
    {diff.empty && <p>Nuk ka ndryshime në rrjedhë.</p>}
    {(["added", "updated", "removed"] as const).map(kind => {
      const entries = summary.changes.filter(c => c.kind === kind);
      return entries.length ? <section key={kind} aria-label={{ added: "Shtuar", updated: "Ndryshuar", removed: "Hequr" }[kind]}>
        <h4>{{ added: "+ Shtuar", updated: "~ Ndryshuar", removed: "− Hequr" }[kind]}</h4>
        {entries.map(change => <article className={`workflow-change is-${kind}`} key={change.id}>
          <button type="button" disabled={!change.nodeId} onClick={() => {
            const target = semanticChangeFocus(change); setSide(target.side);
            if (target.nodeId) setFocus(previous => ({ nodeId: target.nodeId!, sequence: (previous?.sequence ?? 0) + 1 }));
          }}>{change.title}{change.nodeId && <span aria-hidden="true"> ↗</span>}</button>
          <dl><div><dt>Para</dt><dd>{change.before}</dd></div><div><dt>Pas</dt><dd>{change.after}</dd></div></dl>
          {change.conditionChanged && <small>Rregulli i zgjedhjes ndryshon. Kontrollo të dyja rrugët: Po dhe Jo.</small>}
          {change.requiresSimulation && <small>Kërkon provë me skenarë klientësh.</small>}
        </article>)}
      </section> : null;
    })}
    <p>{summary.affectedFlows.length} procese të prekura · {summary.unchangedFlows.length} pa ndryshime strukturore.</p>
    {summary.affectedFlows.length > 0 && <p>Preken: {summary.affectedFlows.map(flowName).join(", ")}.</p>}
    {summary.unchangedFlows.length > 0 && <p>Pa ndryshime: {summary.unchangedFlows.map(flowName).join(", ")}.</p>}
    {summary.inferredBehavior.length > 0 && <section><h4>Ndikim i mundshëm — i inferuar</h4>{summary.inferredBehavior.map(text => <p key={text}>{text}</p>)}</section>}
    <section><h4>E paverifikuar</h4>{summary.unverifiedBehavior.map(text => <p key={text}>{text}</p>)}</section>
    {summary.unsupportedCapabilities.length > 0 && <section role="alert"><h4>Nuk mbështeten</h4><ul>{summary.unsupportedCapabilities.map((key, i) => <li key={i}>{Object.hasOwn(unsupportedLabels, key) ? unsupportedLabels[key] : "Një aftësi jashtë funksioneve të verifikuara."}</li>)}</ul><p>Nuk paraqiten si veprime të ekzekutueshme.</p></section>}
    {summary.requiredConfiguration.length > 0 && <section role="status"><h4>Kërkon konfigurim</h4><ul>{summary.requiredConfiguration.map((key, i) => <li key={i}>{Object.hasOwn(configurationLabels, key) ? configurationLabels[key] : "Plotëso konfigurimin e aftësisë së kërkuar."}</li>)}</ul><p>Drafti nuk nënkupton gatishmëri për aktivizim.</p></section>}
    <div className="workflow-diff-tabs" role="group" aria-label="Krahasimi i diagramit">
      <button type="button" aria-pressed={side === "before"} onClick={() => setSide("before")}>Para ndryshimeve</button>
      <button type="button" aria-pressed={side === "after"} onClick={() => setSide("after")}>Pas ndryshimeve</button>
    </div>
    <p className="workflow-diff-legend">+ Shtuar · ~ Ndryshuar · − Hequr (shfaqet te Para)</p>
    <VisualGraphView graph={graph} compact changes={diffHighlights(diff, side)} preserveViewport focusRequest={focus} selectedNodeId={graph.nodes.some(n => n.id === focus?.nodeId) ? focus?.nodeId : undefined} onSelect={nodeId => setFocus(previous => ({ nodeId, sequence: (previous?.sequence ?? 0) + 1 }))} />
    <details><summary>Hollësitë teknike</summary><p>Vetëm identifikues dhe fusha të ndryshuara; përmbajtja e konfigurimeve nuk shfaqet.</p>
      <ul>{[...diff.nodes.map(c => ({ ...c, type: "Hap" })), ...diff.edges.map(c => ({ ...c, type: "Lidhje" })), ...diff.flows.map(c => ({ ...c, type: "Proces" }))].map(c => <li key={`${c.type}:${c.id}`}>{c.type}: {c.id} · {c.kind}{c.fields.length ? ` · ${c.fields.join(", ")}` : ""}</li>)}</ul>
      <p>Procese të prekura: {summary.affectedFlows.join(", ") || "—"}</p><p>Pa ndryshime: {summary.unchangedFlows.join(", ") || "—"}</p>
    </details>
  </section>;
}
