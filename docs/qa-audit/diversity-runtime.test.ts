import { describe, expect, it } from "vitest";
import { advanceVisualWorkflow } from "@/lib/workflows/visual/runtime";
import type { VisualEdge, VisualGraph, VisualNode, VisualRunState } from "@/lib/workflows/visual/types";

const p = (id: string, kind: "start" | "collect" | "knowledge" | "booking" | "handoff" | "end", config: VisualNode["config"] = {}): VisualNode => ({
  id, kind, label: id, position: { x: 0, y: 0 }, config,
});
const graph = (nodes: VisualNode[], edges: VisualEdge[]): VisualGraph => ({ version: 1, name: "synthetic diversity", nodes, edges });
const edge = (id: string, source: string, target: string) => ({ id, source, target, port: "next" as const });
const run = (g: VisualGraph, message: string, state?: VisualRunState) => advanceVisualWorkflow({ graph: g, versionId: "synthetic-v1", state, message, hasPhoto: false, intent: "unknown" });

describe("diversity audit: real visual runtime, synthetic graphs, no adapters", () => {
  it("retail uses only declared size/quantity fields and validates number input", () => {
    const g = graph([
      p("start", "start"), p("size", "collect", { fieldKey: "size", fieldType: "text", prompt: "Size?" }),
      p("quantity", "collect", { fieldKey: "quantity", fieldType: "number", prompt: "Quantity?" }), p("end", "end"),
    ], [edge("e1", "start", "size"), edge("e2", "size", "quantity"), edge("e3", "quantity", "end")]);
    const first = run(g, "shirt");
    expect(first.action.kind).toBe("prompt");
    const size = run(g, "M", first.state);
    expect(size.state.values).toEqual({ size: "M" });
    expect(size.action.nodeId).toBe("quantity");
    const invalid = run(g, "many", size.state);
    expect(invalid.state.values).toEqual({ size: "M" });
    expect(invalid.action.nodeId).toBe("quantity");
    const valid = run(g, "2", invalid.state);
    expect(valid.state.values).toEqual({ size: "M", quantity: "2" });
    expect(valid.action.kind).toBe("end");
    expect(valid.state.values).not.toHaveProperty("child_age");
  });

  it("booking collects declared service date then stops at booking adapter boundary", () => {
    const g = graph([
      p("start", "start"), p("date", "collect", { fieldKey: "service_date", fieldType: "text", prompt: "Date?" }), p("book", "booking"),
    ], [edge("e1", "start", "date"), edge("e2", "date", "book"), edge("e3", "book", "book")]);
    const first = run(g, "salon");
    const dated = run(g, "2026-10-20", first.state);
    expect(dated.state.values).toEqual({ service_date: "2026-10-20" });
    expect(dated.action.kind).toBe("booking");
    expect(dated.state.values).not.toHaveProperty("child_age");
    // Pure runtime returns a booking action; it does not call or create a booking.
  });

  it("quote collects project_type and numeric budget, rejecting invalid budget", () => {
    const g = graph([
      p("start", "start"), p("project", "collect", { fieldKey: "project_type", fieldType: "text", prompt: "Project type?" }),
      p("budget", "collect", { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }), p("staff", "handoff", { prompt: "Staff" }),
    ], [edge("e1", "start", "project"), edge("e2", "project", "budget"), edge("e3", "budget", "staff")]);
    const first = run(g, "renovation");
    const typed = run(g, "office", first.state);
    const invalid = run(g, "unknown", typed.state);
    expect(invalid.action.nodeId).toBe("budget");
    expect(invalid.state.values).toEqual({ project_type: "office" });
    const valid = run(g, "15000", invalid.state);
    expect(valid.state.values).toEqual({ project_type: "office", budget: "15000" });
    expect(valid.action.kind).toBe("handoff");
    expect(valid.state.values).not.toHaveProperty("child_age");
  });

  it("information-only graph has no collect field and does not create an order cursor", () => {
    const g = graph([p("start", "start"), p("info", "knowledge", { prompt: "Verified information" }), p("end", "end")], [edge("e1", "start", "info"), edge("e2", "info", "end")]);
    const result = run(g, "What do you offer?");
    expect(result.action.kind).toBe("knowledge");
    expect(result.state.values).toEqual({});
    expect(result.state.values).not.toHaveProperty("child_age");
  });

  it("preserves a waiting collect during an informational interruption, then resumes with a declared field", () => {
    const g = graph([p("start", "start"), p("budget", "collect", { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }), p("end", "end")], [edge("e1", "start", "budget"), edge("e2", "budget", "end")]);
    const first = run(g, "project");
    const interruption = run(g, "How does this work?", first.state);
    expect(interruption.action.kind).toBe("prompt");
    expect(interruption.state.nodeId).toBe("budget");
    expect(interruption.state.values).toEqual({});
    const resumed = run(g, "12000", interruption.state);
    expect(resumed.state.values).toEqual({ budget: "12000" });
    expect(resumed.action.kind).toBe("end");
  });
});
