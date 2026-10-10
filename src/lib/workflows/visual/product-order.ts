import { advanceSharedOrder, getFact, sharedPrompt, validValue } from "../context";
import type { ConversationStatePayload, WorkflowStepDef } from "../engine";
import type { VisualGraph, VisualRunState } from "./types";

/** Walk the selected path, never flatten mutually exclusive branches into required steps. */
export function missingVisualOrderNode(graph: VisualGraph, visual: VisualRunState, state: ConversationStatePayload): string | null {
  if (graph.version !== 2 || !visual.binding) return null;
  let id = graph.flows.find(flow => flow.id === visual.binding!.flowId)?.entryNodeId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = graph.nodes.find(node => node.id === id);
    if (!node || ["end", "handoff", "booking"].includes(node.kind)) return null;
    let port = "next";
    if (node.kind === "collect") {
      const fact = node.config.fieldKey ? getFact(state, node.config.fieldKey) : undefined;
      const value = fact?.value ?? visual.values[node.config.fieldKey ?? ""];
      if (!value || !validValue(value, fact?.type ?? node.config.fieldType ?? "text")) return node.id;
    }
    if (node.kind === "confirm") {
      if (!["po", "jo"].includes(visual.values[node.id])) return node.id;
      port = visual.values[node.id] === "po" ? "yes" : "no";
    }
    if (node.kind === "condition") {
      if (!visual.branchPorts?.[node.id]) return node.id;
      port = visual.branchPorts[node.id];
    }
    id = graph.edges.find(edge => edge.source === node.id && edge.port === port)?.target;
  }
  return null;
}

/** Final review reuses shared profile/confirmation rules; no linear workflow is created. */
export function advanceVisualOrderReview(state: ConversationStatePayload, message: string, hasPhoto: boolean, arrived: boolean, graph: VisualGraph, productName: string) {
  const steps: WorkflowStepDef[] = [{ key: "collect_customer", kind: "customer", label: "Të dhënat e klientit" }];
  if (arrived) { state.step_key = "collect_customer"; state.context!.execution.awaitingOrderConfirmation = false; }
  const nextState = advanceSharedOrder(state, arrived ? "" : message, arrived ? false : hasPhoto, steps, arrived);
  const path = new Set<string>();
  let id = graph.version === 2 ? graph.flows.find(flow => flow.id === state.visual?.binding?.flowId)?.entryNodeId : undefined;
  while (id && !path.has(id)) {
    path.add(id); const node = graph.nodes.find(node => node.id === id);
    if (!node || ["end", "handoff", "booking"].includes(node.kind)) break;
    const port = ["condition", "confirm"].includes(node.kind) ? state.visual?.branchPorts?.[node.id] ?? (state.visual?.values[node.id] === "po" ? "yes" : "no") : "next";
    id = graph.edges.find(edge => edge.source === node.id && edge.port === port)?.target;
  }
  const labels: WorkflowStepDef[] = graph.nodes.filter(node => path.has(node.id) && node.kind === "collect").map(node => ({ key: node.config.fieldKey ?? node.id, kind: "text", label: node.label, fieldKey: node.config.fieldKey }));
  const fields = new Set(labels.map(step => step.key));
  const summary = { ...nextState, context: { ...nextState.context!, order: Object.fromEntries(Object.entries(nextState.context!.order).filter(([key]) => fields.has(key))) } };
  return { nextState, reply: sharedPrompt(summary, [...steps, ...labels], productName), complete: nextState.step_key === "order_ready" };
}
