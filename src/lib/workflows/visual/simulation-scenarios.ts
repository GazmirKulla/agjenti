import { diffWorkflowGraphs } from "./diff";
import type { VisualGraph, VisualIntent, VisualNode } from "./types";
import type { ScenarioResult } from "./simulation-types";

export type Scenario = {
  id: string;
  description: string;
  category: ScenarioResult["category"];
  nodeId?: string;
  awaiting?: boolean;
  values?: Record<string, string>;
  sharedValues?: Record<string, string>;
  message: string;
  intent: VisualIntent;
  photo?: boolean;
  expectation: { kind: "complete" | "suspend" | "branch" | "collect" | "existing" | "regression"; nodeId?: string; target?: string; port?: "yes" | "no"; value?: string };
  followPrompts?: boolean;
};

export function syntheticValue(node: VisualNode): string {
  // Profile aliases use stricter validators in the real runtime. A phone-like text works for those aliases too.
  const key = node.config.fieldKey?.toLowerCase() ?? "";
  if (node.config.fieldType === "email" || /email/.test(key)) return "simulation@example.invalid";
  if (node.config.fieldType === "photo") return "photo_received";
  if (node.config.fieldType === "number") return "2";
  return "+355690000000";
}

/** Expectations come from explicit graph edges/field contracts, never an LLM response. */
export function generateSimulationScenarios(before: VisualGraph, graph: VisualGraph): Scenario[] {
  const scenarios: Scenario[] = [];
  const add = (s: Scenario) => scenarios.push(s);
  for (const intent of ["order", "booking", "support", "question", "unknown"] as const) add({
    id: `entry:${intent}`, description: intent === "unknown" ? "Hyrje me qëllim të paqartë" : `Rrugë e plotë me qëllim: ${intent}`,
    category: intent === "unknown" ? "ambiguous_input" : "happy_path", message: "Përshëndetje", intent,
    expectation: { kind: "complete" }, followPrompts: true,
  });
  if (graph.version === 2) for (const flow of graph.flows) add({ id: `flow:${flow.id}`, nodeId: flow.entryNodeId,
    description: "Rruga e plotë brenda procesit të zgjedhur", category: "happy_path", message: "Përshëndetje", intent: "unknown",
    expectation: { kind: "complete" }, followPrompts: true });
  for (const node of graph.nodes) {
    const base = { nodeId: node.id, message: "", intent: "unknown" as VisualIntent };
    if (node.kind === "condition" || node.kind === "confirm") {
      for (const port of ["yes", "no"] as const) {
        const yes = port === "yes", config = node.config;
        const intent: VisualIntent = yes && config.condition?.startsWith("intent_") ? config.condition.slice(7) as VisualIntent : "unknown";
        const values: Record<string, string> = {};
        if (config.fieldKey && config.condition === "field_present" && yes) values[config.fieldKey] = "simulation-value";
        if (config.fieldKey && config.condition === "field_equals") values[config.fieldKey] = yes ? config.value ?? "" : `${config.value ?? ""}__different__`;
        add({ ...base, id: `branch:${node.id}:${port}`, description: `Zgjedhja e rrugës ${yes ? "Po" : "Jo"}`,
          category: yes ? "happy_path" : "alternative", awaiting: node.kind === "confirm", message: yes ? "po" : "jo", intent, values,
          expectation: { kind: "branch", nodeId: node.id, port, target: graph.edges.find(e => e.source === node.id && e.port === port)?.target },
        });
      }
    }
    if (node.kind === "collect" || node.kind === "confirm") {
      for (const [category, message] of [["missing_input", ""], ["ambiguous_input", "Çfarë do të thotë kjo?"]] as const) add({
        ...base, id: `${category}:${node.id}`, description: category === "missing_input" ? "Mungon informacioni i kërkuar" : "Pyetje në vend të përgjigjes",
        category, message, awaiting: true, expectation: { kind: "suspend", nodeId: node.id },
      });
    }
    if (node.kind === "collect") {
      const value = syntheticValue(node);
      add({ ...base, id: `collect:${node.id}`, description: "Mbledhja e informacionit të vlefshëm", category: "happy_path",
        awaiting: true, message: value, photo: node.config.fieldType === "photo", expectation: { kind: "collect", nodeId: node.id, value } });
      add({ ...base, id: `existing:${node.id}`, description: "Ripërdorimi i vlerës së mbledhur", category: "existing_values",
        values: { [node.config.fieldKey!]: value }, sharedValues: { [node.config.fieldKey!]: value },
        expectation: { kind: "existing", nodeId: node.id, value, target: graph.edges.find(e => e.source === node.id && e.port === "next")?.target } });
    }
    if (["knowledge", "product", "booking", "order_status", "handoff"].includes(node.kind)) add({
      ...base, id: `action:${node.id}`, description: "Kufiri i një veprimi që kërkon shërbim real", category: "capability", expectation: { kind: "complete" },
    });
  }
  const diff = diffWorkflowGraphs(before, graph);
  const changed = new Set([...diff.nodes.map(n => n.id), ...diff.edges.flatMap(e => [e.before?.source, e.after?.source].filter((id): id is string => !!id))]);
  const unchangedPath = (entry: string) => {
    const pending = [entry], visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (changed.has(id)) return false;
      if (visited.has(id)) continue;
      visited.add(id); pending.push(...before.edges.filter(e => e.source === id).map(e => e.target));
    }
    return true;
  };
  const unchanged = before.version === 2 ? before.flows.filter(f => diff.unchangedFlowIds.includes(f.id)).map(f => f.entryNodeId)
    : before.nodes.filter(n => unchangedPath(n.id)).map(n => n.id);
  for (const nodeId of unchanged) add({ id: `regression:${nodeId ?? "entry"}`, nodeId, description: "Regresion i rrjedhës së pandryshuar", category: "regression",
    message: "Përshëndetje", intent: "unknown", expectation: { kind: "regression" }, followPrompts: true });
  return scenarios;
}
