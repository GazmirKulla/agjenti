import {
  normalizeVisualDraft,
  validateVisualGraph,
  nodeLabels,
  upgradeVisualGraph,
} from "@/lib/workflows/visual/model";
import type {
  VisualGraph,
  VisualNode,
  VisualEdge,
  VisualWorkspace,
  VisualFlow,
} from "@/lib/workflows/visual/types";
import { AssistantError, type Preview } from "./model";

export type WorkflowCard = {
  workspace: VisualWorkspace;
  published: VisualGraph | null;
  proposed?: VisualGraph;
  versions?: { id: string; created_at: string }[];
};
type Operation =
  | { op: "upgrade" }
  | { op: "put_flow"; flow: VisualFlow }
  | { op: "remove_flow"; id: string }
  | { op: "rename"; name: string }
  | { op: "put_node"; node: VisualNode }
  | { op: "remove_node"; id: string }
  | { op: "put_edge"; edge: VisualEdge }
  | { op: "remove_edge"; id: string };

/** Apply only explicit operations; never replace unrelated parts of a graph. */
export function applyWorkflowOperations(
  before: VisualGraph,
  input: string,
): VisualGraph {
  let operations: Operation[];
  try {
    operations = JSON.parse(input);
  } catch {
    throw new AssistantError("Ndryshimet e rrjedhës nuk u kuptuan.");
  }
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 96
  )
    throw new AssistantError(
      "Kërko deri në 96 ndryshime të rrjedhës njëherësh.",
    );
  let graph = structuredClone(before);
  for (const operation of operations) {
    if (!operation || typeof operation !== "object")
      throw new AssistantError("Veprim i pavlefshëm në rrjedhë.");
    switch (operation.op) {
      case "upgrade":
        graph = upgradeVisualGraph(graph);
        break;
      case "put_flow": {
        if (!operation.flow?.id) throw new AssistantError("Mungon procesi i rrjedhës.");
        graph = upgradeVisualGraph(graph);
        const index = graph.flows.findIndex(flow => flow.id === operation.flow.id);
        if (index < 0) graph.flows.push(operation.flow);
        else graph.flows[index] = operation.flow;
        break;
      }
      case "remove_flow": {
        if (graph.version !== 2 || !graph.flows.some(flow => flow.id === operation.id)) throw new AssistantError("Procesi nuk ekziston.");
        graph.flows = graph.flows.filter(flow => flow.id !== operation.id);
        break;
      }
      case "rename":
        graph.name = operation.name;
        break;
      case "put_node": {
        if (!operation.node?.id)
          throw new AssistantError("Mungon hapi i rrjedhës.");
        const index = graph.nodes.findIndex((n) => n.id === operation.node.id);
        if (index < 0) graph.nodes.push(operation.node);
        else graph.nodes[index] = operation.node;
        break;
      }
      case "remove_node": {
        const node = graph.nodes.find((n) => n.id === operation.id);
        if (!node || node.kind === "start")
          throw new AssistantError(
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
          throw new AssistantError("Mungon lidhja e rrjedhës.");
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
          throw new AssistantError("Lidhja nuk ekziston.");
        graph.edges = graph.edges.filter((e) => e.id !== operation.id);
        break;
      default:
        throw new AssistantError("Ky veprim nuk mbështetet për rrjedhën.");
    }
  }
  const normalized = normalizeVisualDraft(graph);
  if (!normalized)
    throw new AssistantError("Ndryshimet prodhojnë një rrjedhë të pavlefshme.");
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
): Preview {
  const fields: Preview["fields"] = [];
  if (before.name !== after.name)
    fields.push({ label: "Emri", before: before.name, after: after.name });
  const oldFlows = before.version === 2 ? before.flows : [], newFlows = after.version === 2 ? after.flows : [];
  const flowDescription = (flow: VisualFlow | undefined, graph: VisualGraph) => flow ? `${flow.label} · ${flow.kind} · Fillon te ${graph.nodes.find(n => n.id === flow.entryNodeId)?.label ?? flow.entryNodeId}
${flow.nodeIds.map(id => graph.nodes.find(n => n.id === id)?.label ?? id).join(", ")}` : "—";
  for (const id of new Set([...oldFlows, ...newFlows].map(flow => flow.id))) {
    const old = flowDescription(oldFlows.find(f => f.id === id), before), next = flowDescription(newFlows.find(f => f.id === id), after);
    if (old !== next) fields.push({label:"Procesi në qendrën e mesazhit",before:old,after:next});
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
