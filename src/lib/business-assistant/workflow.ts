import {
  normalizeVisualDraft,
  validateVisualGraph,
  nodeLabels,
  upgradeVisualGraph,
  emptyVisualGraph,
} from "@/lib/workflows/visual/model";
import type {
  VisualGraph,
  VisualNode,
  VisualEdge,
  VisualWorkspace,
  VisualFlow,
} from "@/lib/workflows/visual/types";
import { removeVisualFlow } from "@/lib/workflows/visual/remove-flow";
import { AssistantError, type Preview } from "./model";
import type { VisualBindingCatalog } from "@/lib/workflows/visual/bindings";
import type { SemanticChangeSummary } from "./semantic-summary";
import type { SimulationReport } from "@/lib/workflows/visual/simulation-types";
import type { PublicationReadiness } from "@/lib/workflows/visual/publication-types";

export type WorkflowCard = {
  publication?: PublicationReadiness;
  simulation?: SimulationReport;
  semanticSummary?: SemanticChangeSummary;
  workspace: VisualWorkspace;
  published: VisualGraph | null;
  proposed?: VisualGraph;
  versions?: { id: string; created_at: string }[];
};
export type Operation =
  | { op: "upgrade" }
  | { op: "reset"; name: string; evidence: string }
  | { op: "remove_process"; id: string }
  | { op: "put_flow"; flow: VisualFlow }
  | { op: "remove_flow"; id: string }
  | { op: "rename"; name: string }
  | { op: "put_node"; node: VisualNode }
  | { op: "remove_node"; id: string }
  | { op: "put_edge"; edge: VisualEdge }
  | { op: "remove_edge"; id: string };

/** Invalid model-authored edits may be repaired before any ticket or write exists. */
export class WorkflowProposalError extends AssistantError {}

/** Apply explicit operations to a copy; replacement is always visible in the preview. */
export function applyWorkflowOperations(
  before: VisualGraph,
  input: string,
  request?: string,
): VisualGraph {
  let operations: Operation[];
  try {
    operations = JSON.parse(input);
  } catch {
    throw new WorkflowProposalError("Ndryshimet e rrjedhës nuk u kuptuan.");
  }
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 96
  )
    throw new WorkflowProposalError(
      "Kërko deri në 96 ndryshime të rrjedhës njëherësh.",
    );
  let graph = structuredClone(before);
  let resetScaffold = false;
  for (const operation of operations) {
    if (!operation || typeof operation !== "object")
      throw new WorkflowProposalError("Veprim i pavlefshëm në rrjedhë.");
    const allowed: Record<string, string[]> = { upgrade: ["op"], reset: ["op", "name", "evidence"], remove_process: ["op", "id"], rename: ["op", "name"], put_node: ["op", "node"], put_edge: ["op", "edge"], put_flow: ["op", "flow"], remove_node: ["op", "id"], remove_edge: ["op", "id"], remove_flow: ["op", "id"] };
    if (!Object.hasOwn(allowed, operation.op) || Object.keys(operation).some(key => !allowed[operation.op].includes(key)))
      throw new WorkflowProposalError("Ky veprim nuk mbështetet për rrjedhën.");
    if (operation.op === "put_node" && operation.node && (Object.keys(operation.node).some(key => !["id", "kind", "label", "position", "config"].includes(key)) || Object.keys(operation.node.config ?? {}).some(key => !["action", "prompt", "fieldKey", "fieldType", "condition", "value"].includes(key))))
      throw new WorkflowProposalError("Konfigurimi përmban një veprim që nuk mbështetet.");
    if (operation.op === "put_edge" && operation.edge && Object.keys(operation.edge).some(key => !["id", "source", "target", "port"].includes(key)))
      throw new WorkflowProposalError("Lidhja përmban konfigurim që nuk mbështetet.");
    if (operation.op === "put_flow" && operation.flow && Object.keys(operation.flow).some(key => !["id", "label", "kind", "entryNodeId", "nodeIds", "productIds", "serviceIds"].includes(key)))
      throw new WorkflowProposalError("Procesi përmban konfigurim që nuk mbështetet.");
    switch (operation.op) {
      case "reset":
        if (operation !== operations[0] || typeof operation.name !== "string" || !operation.name.trim() || operation.name.length > 120 || typeof operation.evidence !== "string" || !operation.evidence.trim() || !request?.includes(operation.evidence))
          throw new WorkflowProposalError("Rindërtimi kërkon referencë të saktë te kërkesa aktuale dhe duhet të jetë veprimi i parë.");
        graph = { ...emptyVisualGraph(), name: operation.name };
        resetScaffold = true;
        break;
      case "remove_process": {
        const result = removeVisualFlow(graph, operation.id);
        if (!result.graph) throw new WorkflowProposalError(result.error);
        graph = result.graph;
        break;
      }
      case "upgrade":
        graph = upgradeVisualGraph(graph);
        break;
      case "put_flow": {
        if (!operation.flow?.id) throw new WorkflowProposalError("Mungon procesi i rrjedhës.");
        graph = upgradeVisualGraph(graph);
        const index = graph.flows.findIndex(flow => flow.id === operation.flow.id);
        if (index < 0) graph.flows.push(operation.flow);
        else graph.flows[index] = {
          ...operation.flow,
          ...(operation.flow.productIds === undefined && graph.flows[index].productIds !== undefined ? { productIds: graph.flows[index].productIds } : {}),
          ...(operation.flow.serviceIds === undefined && graph.flows[index].serviceIds !== undefined ? { serviceIds: graph.flows[index].serviceIds } : {}),
        };
        break;
      }
      case "remove_flow": {
        if (graph.version !== 2 || !graph.flows.some(flow => flow.id === operation.id)) throw new WorkflowProposalError("Procesi nuk ekziston.");
        graph.flows = graph.flows.filter(flow => flow.id !== operation.id);
        break;
      }
      case "rename":
        graph.name = operation.name;
        break;
      case "put_node": {
        if (!operation.node?.id)
          throw new WorkflowProposalError("Mungon hapi i rrjedhës.");
        const index = graph.nodes.findIndex((n) => n.id === operation.node.id);
        if (index < 0) graph.nodes.push(operation.node);
        else graph.nodes[index] = operation.node;
        break;
      }
      case "remove_node": {
        const node = graph.nodes.find((n) => n.id === operation.id);
        if (!node || node.kind === "start")
          throw new WorkflowProposalError(
            "Hapi nuk ekziston ose është fillimi i rrjedhës.",
          );
        graph.nodes = graph.nodes.filter((n) => n.id !== operation.id);
        graph.edges = graph.edges.filter(
          (e) => e.source !== operation.id && e.target !== operation.id,
        );
        if (graph.version === 2) graph.flows = graph.flows.map(flow => ({...flow,nodeIds:flow.nodeIds.filter(id => id !== operation.id)})).filter(flow => flow.nodeIds.length);
        break;
      }
      case "put_edge": {
        if (!operation.edge?.id)
          throw new WorkflowProposalError("Mungon lidhja e rrjedhës.");
        // One outgoing edge per port; replacing it does not touch other branches.
        graph.edges = graph.edges.filter(
          (e) =>
            e.id !== operation.edge.id &&
            !(
              e.source === operation.edge.source &&
              e.port === operation.edge.port
            ),
        );
        graph.edges.push(operation.edge);
        break;
      }
      case "remove_edge":
        if (!graph.edges.some((e) => e.id === operation.id))
          throw new WorkflowProposalError("Lidhja nuk ekziston.");
        graph.edges = graph.edges.filter((e) => e.id !== operation.id);
        break;
      default:
        throw new WorkflowProposalError("Ky veprim nuk mbështetet për rrjedhën.");
    }
  }
  // reset supplies a neutral start/end scaffold. If the owner-selected new
  // entry is terminal, its unused, untouched scaffold end is not a process.
  // Never prune an existing business node or a node explicitly authored here.
  if (resetScaffold && !operations.some(op => op.op === "put_node" && op.node.id === "end")
      && !graph.edges.some(edge => edge.source === "end" || edge.target === "end")
      && !(graph.version === 2 && graph.flows.some(flow => flow.nodeIds.includes("end"))))
    graph.nodes = graph.nodes.filter(node => node.id !== "end");
  const normalized = normalizeVisualDraft(graph);
  if (!normalized)
    throw new WorkflowProposalError("Ndryshimet prodhojnë një rrjedhë të pavlefshme.");
  return normalized;
}
export function workflowProblems(graph: VisualGraph) {
  return validateVisualGraph(graph).errors.map(
    (e) =>
      `${graph.nodes.find((n) => n.id === e.nodeId)?.label ?? "Rrjedha"}: ${e.message}`,
  );
}
export function describeWorkflowNode(node: VisualNode) {
  const conditions = {
    intent_order: "Mesazhi kërkon porosi",
    intent_support: "Mesazhi kërkon ndihmë",
    intent_booking: "Mesazhi kërkon rezervim",
    field_present: "Fusha është plotësuar",
    field_equals: "Fusha ka vlerën",
  };
  return [
    nodeLabels[node.kind],
    node.kind === "order_status" && "Lexon vetëm statusin e porosive të klientit të kësaj bisede; nuk i ndryshon ato.",
    node.config.prompt,
    node.config.fieldKey && `Fusha: ${node.config.fieldKey}`,
    node.config.fieldType,
    node.config.condition && conditions[node.config.condition],
    node.config.value,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function workflowPreview(
  before: VisualGraph,
  after: VisualGraph,
  catalog?: VisualBindingCatalog,
): Preview {
  const fields: Preview["fields"] = [];
  if (before.name !== after.name)
    fields.push({ label: "Emri", before: before.name, after: after.name });
  const oldFlows = before.version === 2 ? before.flows : [], newFlows = after.version === 2 ? after.flows : [];
  const targetLabel = (id: string, kind: "products" | "services") => {
    const items = catalog?.[kind] ?? [], item = items.find(target => target.id === id);
    if (!item) return kind === "products" ? "Produkt i padisponueshëm" : "Shërbim i padisponueshëm";
    const duplicates = items.filter(target => target.name === item.name);
    if (duplicates.length < 2) return item.name;
    let length = 8;
    while (length < id.length && duplicates.some(target => target.id !== id && target.id.slice(0, length) === id.slice(0, length))) length += 4;
    return `${item.name} (${id.slice(0, length)}${length < id.length ? "…" : ""})`;
  };
  const flowSignature = (flow: VisualFlow | undefined) => flow && JSON.stringify({
    id: flow.id, label: flow.label, kind: flow.kind, entryNodeId: flow.entryNodeId,
    nodeIds: flow.nodeIds, productIds: flow.productIds ?? [], serviceIds: flow.serviceIds ?? [],
  });
  const flowDescription = (flow: VisualFlow | undefined, graph: VisualGraph) => flow ? [
    `${flow.label} · ${flow.kind} · Fillon te ${graph.nodes.find(n => n.id === flow.entryNodeId)?.label ?? flow.entryNodeId}`,
    flow.nodeIds.map(id => graph.nodes.find(n => n.id === id)?.label ?? id).join(", "),
    flow.productIds?.length ? `Produktet: ${flow.productIds.map(id => targetLabel(id, "products")).join(", ")}` : "",
    flow.serviceIds?.length ? `Shërbimet: ${flow.serviceIds.map(id => targetLabel(id, "services")).join(", ")}` : "",
  ].filter(Boolean).join("\n") : "—";
  for (const id of new Set([...oldFlows, ...newFlows].map(flow => flow.id))) {
    const oldFlow = oldFlows.find(f => f.id === id), newFlow = newFlows.find(f => f.id === id);
    const old = flowDescription(oldFlow, before), next = flowDescription(newFlow, after);
    if (flowSignature(oldFlow) !== flowSignature(newFlow) || old !== next) fields.push({label:"Procesi në qendrën e mesazhit",before:old,after:next});
  }
  const nodes = new Set([...before.nodes, ...after.nodes].map((n) => n.id));
  const describe = (graph: VisualGraph, id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return "—";
    const links = graph.edges
      .filter((e) => e.source === id)
      .map(
        (e) =>
          `${e.port === "yes" ? "Po" : e.port === "no" ? "Jo" : "Vazhdo"} → ${graph.nodes.find((n) => n.id === e.target)?.label ?? e.target}`,
      )
      .sort();
    return [node.label, describeWorkflowNode(node), ...links].join("\n");
  };
  for (const id of nodes) {
    const old = describe(before, id),
      next = describe(after, id);
    if (old !== next)
      fields.push({
        label:
          old === "—"
            ? "Hap i shtuar"
            : next === "—"
              ? "Hap i hequr"
              : "Hap i ndryshuar",
        before: old,
        after: next,
      });
  }
  if (!fields.length && JSON.stringify(before) !== JSON.stringify(after))
    fields.push({
      label: "Vendosja në diagram",
      before: "Vendosja aktuale",
      after: "Vendosja e përditësuar",
    });
  return {
    title: "Ruaj draftin e rrjedhës",
    subject: after.name,
    fields,
    notice: "Ruhet si draft. Rrjedha aktive ndryshon vetëm kur e publikon.",
  };
}
