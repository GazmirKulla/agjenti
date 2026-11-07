import { describe, expect, it } from "vitest";
import type { VisualEdge, VisualGraph, VisualNode, VisualVersion } from "@/lib/workflows/visual/types";
import { compileVisualProcesses } from "@/lib/orchestration/visual-definition";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import { transitionCustomer, type Environment } from "@/lib/orchestration/transition";

const p = (id: string, kind: "start" | "collect" | "knowledge" | "booking" | "handoff" | "end", config: VisualNode["config"] = {}): VisualNode => ({
  id, kind, label: id, position: { x: 0, y: 0 }, config,
});
const graph = (nodes: VisualNode[], edges: VisualEdge[]): VisualGraph => ({ version: 1, name: "synthetic diversity", nodes, edges });
const edge = (id: string, source: string, target: string) => ({ id, source, target, port: "next" as const });
function version(g: VisualGraph): VisualVersion {
  return { id: "synthetic-v1", businessId: "business", createdAt: "2026-10-15T00:00:00Z", graph: g };
}
function envFor(g: VisualGraph): { definitions: ReturnType<typeof compileVisualProcesses>; env: Environment } {
  const definitions = compileVisualProcesses(version(g));
  return { definitions, env: { mode: "test", now: 1, definitions, startableVersionIds: new Set(["synthetic-v1"]), tools: [], promptTtlMs: 60000 } };
}

describe("diversity audit: compiled process runtime, synthetic graphs, no adapters", () => {
  it("retail uses only declared size/quantity fields and validates number input", () => {
    const { definitions, env } = envFor(graph([
      p("start", "start"), p("size", "collect", { fieldKey: "size", fieldType: "text", prompt: "Size?" }),
      p("quantity", "collect", { fieldKey: "quantity", fieldType: "number", prompt: "Quantity?" }), p("end", "end"),
    ], [edge("e1", "start", "size"), edge("e2", "size", "quantity"), edge("e3", "quantity", "end")]));
    const event = { id: "e", businessId: "business", conversationId: "c", actor: "customer" as const, message: "shirt" };
    const first = transitionCustomer(initialSnapshot("business", "c", "test"), event, { revision: 0, needsClarification: false,
      commands: [{ kind: "start", definitionId: definitions[0].id, versionId: "synthetic-v1", evidence: "shirt", initialFacts: [] }] }, env);
    const id = first.state.focusId!;
    expect(first.state.instances[id].wait?.fieldId).toBe("size");
    const size = transitionCustomer(first.state, { ...event, id: "s", message: "M" }, { revision: first.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "size", value: "M", evidence: "M" }] }] }, env);
    expect(size.state.instances[id].facts.size.value).toBe("M");
    expect(size.state.instances[id].wait?.fieldId).toBe("quantity");
    expect(() => transitionCustomer(size.state, { ...event, id: "bad", message: "many" }, { revision: size.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "quantity", value: "many", evidence: "many" }] }] }, env)).toThrow("invalid_fact");
    const valid = transitionCustomer(size.state, { ...event, id: "q", message: "2" }, { revision: size.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "quantity", value: 2, evidence: "2" }] }] }, env);
    expect(valid.state.instances[id].facts.quantity.value).toBe(2);
    expect(valid.state.instances[id].status).toBe("completed");
    expect(valid.state.instances[id].facts).not.toHaveProperty("child_age");
  });

  it("booking compiles collection and review before any domain effect", () => {
    const versioned: VisualVersion = { id: "synthetic-v1", businessId: "business", createdAt: "2026-10-15T00:00:00Z", graph: {
      version: 2, name: "synthetic diversity",
      nodes: [p("start", "start"), p("book", "booking"), p("done", "end")],
      flows: [{ id: "reservation", label: "Reservation", kind: "booking", entryNodeId: "book", nodeIds: ["book"] }],
      edges: [edge("s", "start", "done"), edge("b", "book", "done")],
    } };
    const definitions = compileVisualProcesses(versioned);
    expect(definitions[0].steps.some(s => s.kind === "collect")).toBe(true);
    expect(definitions[0].steps.some(s => s.kind === "confirm")).toBe(true);
    expect(definitions[0].steps.some(s => s.kind === "effect" && s.tool === "booking.create")).toBe(true);
    expect(definitions[0].fields.some(f => f.id === "child_age")).toBe(false);
  });

  it("quote compiles declared project and budget fields plus a staff handoff", () => {
    const versioned: VisualVersion = { id: "synthetic-v1", businessId: "business", createdAt: "2026-10-15T00:00:00Z", graph: {
      version: 2, name: "synthetic diversity",
      nodes: [
        p("start", "start"), p("project", "collect", { fieldKey: "project_type", fieldType: "text", prompt: "Project type?" }),
        p("budget", "collect", { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }), p("staff", "handoff", { prompt: "Staff" }), p("end", "end"),
      ],
      flows: [{ id: "quote", label: "Quote", kind: "custom", entryNodeId: "project", nodeIds: ["project", "budget", "staff"] }],
      edges: [edge("s", "start", "end"), edge("e1", "project", "budget"), edge("e2", "budget", "staff")],
    } };
    const definitions = compileVisualProcesses(versioned);
    expect(definitions[0].fields.map(f => f.id).sort()).toEqual(["budget", "project_type"]);
    expect(definitions[0].steps.some(s => s.kind === "handoff")).toBe(true);
    expect(definitions[0].steps.some(s => s.kind === "effect")).toBe(false);
    expect(definitions[0].fields.some(f => f.id === "child_age")).toBe(false);
  });

  it("information-only graph compiles without collect fields or order effects", () => {
    const { definitions } = envFor(graph([p("start", "start"), p("info", "knowledge", { prompt: "Verified information" }), p("end", "end")],
      [edge("e1", "start", "info"), edge("e2", "info", "end")]));
    expect(definitions[0].fields).toEqual([]);
    expect(definitions[0].steps.some(s => s.kind === "effect")).toBe(false);
    expect(definitions[0].steps.some(s => s.kind === "inform")).toBe(true);
  });

  it("preserves a waiting collect during an informational interruption, then resumes with a declared field", () => {
    const { definitions, env } = envFor(graph([p("start", "start"), p("budget", "collect", { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }), p("end", "end")],
      [edge("e1", "start", "budget"), edge("e2", "budget", "end")]));
    const event = { id: "e", businessId: "business", conversationId: "c", actor: "customer" as const, message: "project" };
    const first = transitionCustomer(initialSnapshot("business", "c", "test"), event, { revision: 0, needsClarification: false,
      commands: [{ kind: "start", definitionId: definitions[0].id, versionId: "synthetic-v1", evidence: "project", initialFacts: [] }] }, env);
    const id = first.state.focusId!, wait = structuredClone(first.state.instances[id].wait);
    const interruption = transitionCustomer(first.state, { ...event, id: "q", message: "How does this work?" }, { revision: first.state.revision, needsClarification: false, commands: [] }, env);
    expect(interruption.state.instances[id].wait).toEqual(wait);
    expect(interruption.state.instances[id].facts).toEqual({});
    const resumed = transitionCustomer(interruption.state, { ...event, id: "b", message: "12000" }, { revision: interruption.state.revision, needsClarification: false,
      commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "budget", value: 12000, evidence: "12000" }] }] }, env);
    expect(resumed.state.instances[id].facts.budget.value).toBe(12000);
    expect(resumed.state.instances[id].status).toBe("completed");
  });
});
