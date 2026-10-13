import { diffWorkflowGraphs, type ChangeKind } from "@/lib/workflows/visual/diff";
import type { VisualGraph, VisualNode } from "@/lib/workflows/visual/types";
import type { AutomationProposal } from "./automation-proposal";

export type SemanticChange = {
  id: string; kind: ChangeKind; subject: "step" | "route" | "flow" | "workflow";
  title: string; before: string; after: string;
  nodeId?: string; flowId?: string;
  conditionChanged: boolean; promptChanged: boolean;
  requiresSimulation: boolean;
};
export type SemanticChangeSummary = {
  version: 1; baseRevision: number; publishedVersionId: string | null;
  blocked: boolean;
  changes: SemanticChange[];
  affectedFlows: string[]; unchangedFlows: string[];
  inferredBehavior: string[]; unverifiedBehavior: string[];
  unsupportedCapabilities: string[]; requiredConfiguration: string[];
  simulationRequired: boolean;
};

// Never copy arbitrary prompts, condition values, integration settings or model prose
// into explanations. The summary describes configured structure, not execution success.
const behaviors: Record<VisualNode["kind"], string> = {
  action: "Ekzekutimi i veprimit të autorizuar me të dhënat e bisedës",
  start: "Fillimi i kërkesës së klientit", condition: "Zgjedhja e rrugës sipas një rregulli",
  knowledge: "Përgjigje nga informacioni i biznesit", collect: "Kërkimi i një të dhëne nga klienti",
  confirm: "Kërkimi i konfirmimit të klientit", product: "Vazhdimi i procesit të produktit",
  booking: "Përdorimi i procesit të rezervimit", order_status: "Leximi i statusit të porosisë",
  handoff: "Orientimi te stafi", end: "Përfundimi i kësaj rruge",
};
function describe(node?: VisualNode): string {
  if (!node) return "Nuk përfshihet në këtë version.";
  const conditions = { intent_order: "kur mesazhi kërkon porosi", intent_booking: "kur mesazhi kërkon rezervim", intent_support: "kur mesazhi kërkon ndihmë", field_present: "kur e dhëna e zgjedhur është plotësuar", field_equals: "kur e dhëna përputhet me vlerën e konfiguruar" };
  const fields: Record<string, string> = { customer_name: "emrit të klientit", customer_phone: "numrit të telefonit", customer_email: "emailit të klientit", customer_city: "qytetit", customer_address: "adresës" };
  if (node.kind === "collect" && Object.hasOwn(fields, node.config.fieldKey ?? "")) return `Kërkimi i ${fields[node.config.fieldKey!]}.`;
  return `${behaviors[node.kind]}${node.kind === "condition" ? `: ${node.config.condition ? conditions[node.config.condition] : "rregulli nuk është zgjedhur"}` : ""}.`;
}
function route(graph: VisualGraph, edge?: VisualGraph["edges"][number]) {
  if (!edge) return "Kjo rrugë nuk është e lidhur.";
  return `${edge.port === "yes" ? "Nëse përgjigjja është Po" : edge.port === "no" ? "Nëse përgjigjja është Jo" : "Pas këtij hapi"}: ${describe(graph.nodes.find(n => n.id === edge.target))} Pikënisja: ${describe(graph.nodes.find(n => n.id === edge.source))}`;
}
export function summarizeWorkflowChanges(before: VisualGraph, after: VisualGraph, revision: number, publishedVersionId: string | null, automation?: AutomationProposal): SemanticChangeSummary {
  const diff = diffWorkflowGraphs(before, after);
  const changes: SemanticChange[] = diff.nodes.map(c => {
    const promptChanged = c.kind === "updated" && c.before?.config.prompt !== c.after?.config.prompt;
    const conditionChanged = [c.before, c.after].some(n => n?.kind === "condition") && (c.kind !== "updated" || ["condition", "fieldKey", "value"].some(k => c.before?.config[k as keyof VisualNode["config"]] !== c.after?.config[k as keyof VisualNode["config"]]));
    return { id: `step:${c.id}`, kind: c.kind, subject: "step", title: behaviors[(c.after ?? c.before)!.kind],
      before: `${describe(c.before)}${promptChanged ? c.before?.config.prompt ? " Përdor tekstin e mëparshëm." : " Pa tekst të personalizuar." : ""}`,
      after: `${describe(c.after)}${promptChanged ? c.after?.config.prompt ? " Teksti është ndryshuar; kuptimi i tij duhet provuar." : " Teksti i personalizuar hiqet." : ""}${conditionChanged && c.kind === "updated" ? " Rregulli ose krahasimi i të dhënave ndryshon." : ""}${c.fields.includes("label") ? " Emërtimi i hapit ndryshon." : ""}${c.fields.includes("position") ? " Vendosja në diagram ndryshon." : ""}${c.fields.includes("config") && !promptChanged && !conditionChanged ? " Konfigurimi i të dhënave të hapit ndryshon." : ""}`,
      nodeId: c.id, promptChanged, conditionChanged, requiresSimulation: c.kind !== "updated" || c.fields.some(f => f === "kind" || f === "config") };
  });
  changes.push(...diff.edges.map(c => ({ id: `route:${c.id}`, kind: c.kind, subject: "route" as const, title: "Rruga që ndjek kërkesa", before: route(before, c.before), after: route(after, c.after), nodeId: (c.after ?? c.before)!.source, promptChanged: false, conditionChanged: false, requiresSimulation: true })));
  changes.push(...diff.flows.map(c => ({ id: `flow:${c.id}`, kind: c.kind, subject: "flow" as const, title: "Procesi i biznesit", before: c.before ? `Procesi përmban ${c.before.nodeIds.length} hapa.` : "Procesi nuk përfshihet.", after: c.after ? `Procesi përmban ${c.after.nodeIds.length} hapa.${c.fields.includes("label") ? " Emërtimi ndryshon." : ""}${c.fields.includes("entryNodeId") ? " Pikënisja ndryshon." : ""}${c.fields.includes("kind") ? "Kategoria e procesit ndryshon." : ""}${c.fields.includes("nodeIds") ? " Përbërja e procesit ndryshon." : ""}${c.fields.some(f => f === "productIds" || f === "serviceIds") ? " Lidhja me produktet ose shërbimet ndryshon." : ""}` : "Grupimi i procesit hiqet; kjo nuk nënkupton fshirjen e hapave.", nodeId: (c.after ?? c.before)!.entryNodeId, flowId: c.id, promptChanged: false, conditionChanged: false, requiresSimulation: c.kind !== "updated" || c.fields.some(f => f !== "label") })));
  if (diff.metadata.length) changes.push({ id: "workflow:metadata", kind: "updated", subject: "workflow", title: "Organizimi i rrjedhës", before: "Përkufizimi aktual.", after: diff.metadata.includes("version") ? "Formati i rrjedhës përditësohet; kjo nuk e publikon." : "Emri i rrjedhës ndryshon.", promptChanged: false, conditionChanged: false, requiresSimulation: diff.metadata.includes("version") });
  const simulationRequired = changes.some(c => c.requiresSimulation);
  return { version: 1, baseRevision: revision, publishedVersionId, blocked: Boolean(automation && !automation.canSaveDraft), changes, affectedFlows: diff.affectedFlowIds, unchangedFlows: diff.unchangedFlowIds,
    inferredBehavior: simulationRequired ? ["Rrugët ose përmbajtja e ndryshuar mund të ndikojnë te përgjigjet e klientit. Ky është interpretim, jo rezultat prove."] : [],
    unverifiedBehavior: ["Struktura nuk provon kuptimin e udhëzimeve, të dhënat reale ose suksesin e veprimeve. Nuk është kryer simulim nga kjo përmbledhje."],
    unsupportedCapabilities: automation?.unsupportedActions ?? [], requiredConfiguration: automation?.missingRequirements ?? [], simulationRequired };
}

export function semanticChangeFocus(change: SemanticChange) {
  return { side: change.kind === "removed" ? "before" as const : "after" as const, nodeId: change.nodeId };
}
