import { describe, expect, it } from "vitest";
import type { VisualGraph, VisualNode, VisualVersion } from "@/lib/workflows/visual/types";
import { compileVisualProcesses } from "@/lib/orchestration/visual-definition";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import { transitionCustomer, type Environment } from "@/lib/orchestration/transition";

const node = (id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode => ({ id, kind, label: id, position: { x: 0, y: 0 }, config });
function linear(...steps: VisualNode[]): VisualGraph {
  const nodes = [node("start", "start"), ...steps, node("end", "end")];
  return { version: 1, name: "audit", nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `e${i}`, source: n.id, target: nodes[i + 1].id, port: "next" as const })) };
}
const version = (graph: VisualGraph): VisualVersion => ({ id: "audit-version", businessId: "audit-business", graph, createdAt: "2026-10-15T00:00:00Z" });

describe("audit orchestration: compiled processes with synthetic retail/quote graphs", () => {
  it("retail persists declared size/quantity across turns and rejects invalid numbers", () => {
    const definitions = compileVisualProcesses(version(linear(
      node("size", "collect", { fieldKey: "size", fieldType: "text", prompt: "Size?" }),
      node("quantity", "collect", { fieldKey: "quantity", fieldType: "number", prompt: "Quantity?" }),
    )));
    const env: Environment = { mode: "test", now: 1, definitions, startableVersionIds: new Set(["audit-version"]), tools: [], promptTtlMs: 60000 };
    const event = { id: "e", businessId: "audit-business", conversationId: "c", actor: "customer" as const, message: "start" };
    const first = transitionCustomer(initialSnapshot("audit-business", "c", "test"), event, { revision: 0, needsClarification: false,
      commands: [{ kind: "start", definitionId: definitions[0].id, versionId: "audit-version", evidence: "start", initialFacts: [] }] }, env);
    const id = first.state.focusId!;
    expect(first.state.instances[id].wait?.fieldId).toBe("size");
    const second = transitionCustomer(first.state, { ...event, id: "s", message: "M" }, { revision: first.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "size", value: "M", evidence: "M" }] }] }, env);
    expect(second.state.instances[id].facts.size.value).toBe("M");
    expect(second.state.instances[id].wait?.fieldId).toBe("quantity");
    const third = transitionCustomer(second.state, { ...event, id: "q", message: "2" }, { revision: second.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "quantity", value: 2, evidence: "2" }] }] }, env);
    expect(third.state.instances[id].facts).toMatchObject({ size: { value: "M" }, quantity: { value: 2 } });
    expect(third.state.instances[id].status).toBe("completed");
    expect(third.state.instances[id].facts).not.toHaveProperty("child_age");
  });

  it("invalid numeric input stays pending and an informational interruption does not consume the field", () => {
    const definitions = compileVisualProcesses(version(linear(node("budget", "collect", { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }))));
    const env: Environment = { mode: "test", now: 1, definitions, startableVersionIds: new Set(["audit-version"]), tools: [], promptTtlMs: 60000 };
    const event = { id: "e", businessId: "audit-business", conversationId: "c", actor: "customer" as const, message: "start" };
    const first = transitionCustomer(initialSnapshot("audit-business", "c", "test"), event, { revision: 0, needsClarification: false,
      commands: [{ kind: "start", definitionId: definitions[0].id, versionId: "audit-version", evidence: "start", initialFacts: [] }] }, env);
    const id = first.state.focusId!;
    expect(() => transitionCustomer(first.state, { ...event, id: "bad", message: "unknown" }, { revision: first.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "budget", value: "unknown", evidence: "unknown" }] }] }, env)).toThrow("invalid_fact");
    const interrupted = transitionCustomer(first.state, { ...event, id: "q", message: "Sa kushton?" }, { revision: first.state.revision, needsClarification: false, commands: [] }, env);
    expect(interrupted.state.instances[id].facts).toEqual({});
    expect(interrupted.state.instances[id].wait?.fieldId).toBe("budget");
    const resumed = transitionCustomer(interrupted.state, { ...event, id: "ok", message: "12000" }, { revision: interrupted.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "budget", value: 12000, evidence: "12000" }] }] }, env);
    expect(resumed.state.instances[id].facts.budget.value).toBe(12000);
    expect(resumed.state.instances[id].status).toBe("completed");
  });

  it("rejects missing graph configuration before compiling a process", () => {
    const invalid = { version: 1, name: "", nodes: [], edges: [] } as unknown as VisualGraph;
    expect(() => compileVisualProcesses(version(invalid))).toThrow("invalid_visual_definition");
  });
});
