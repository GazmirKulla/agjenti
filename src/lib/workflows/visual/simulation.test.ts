import { afterEach, describe, expect, it, vi } from "vitest";
import * as runtime from "./runtime";
import { matchesSimulationBinding, simulateWorkflowProposal, simulationBinding } from "./simulation";
import { normalizeVisualDraft, starterVisualGraph, upgradeVisualGraph } from "./model";
import type { VisualGraph, VisualNode } from "./types";
import type { CapabilityAssessment } from "@/lib/capabilities/registry";

const forbidden = vi.hoisted(() => vi.fn(() => { throw new Error("external side effect forbidden"); }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: forbidden }));
vi.mock("@/lib/conversations/process-conversation-message", () => ({ processConversationMessage: forbidden }));
vi.mock("openai", () => ({ default: forbidden }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); forbidden.mockClear(); });
function node(id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode {
  return { id, kind, label: id, position: { x: 0, y: 0 }, config };
}
function collectGraph(): VisualGraph {
  return { version: 1, name: "Collect", nodes: [node("start", "start"), node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Email?" }), node("end", "end")],
    edges: [{ id: "first", source: "start", target: "email", port: "next" }, { id: "last", source: "email", target: "end", port: "next" }] };
}
function branchGraph(): VisualGraph {
  return { version: 1, name: "WhatsApp only", nodes: [node("start", "start"), node("channel", "condition", { condition: "field_equals", fieldKey: "channel", value: "whatsapp" }),
    node("phone", "collect", { fieldKey: "phone", fieldType: "phone", prompt: "Phone?" }), node("end", "end")], edges: [
    { id: "first", source: "start", target: "channel", port: "next" }, { id: "yes", source: "channel", target: "phone", port: "yes" },
    { id: "no", source: "channel", target: "end", port: "no" }, { id: "last", source: "phone", target: "end", port: "next" }] };
}
const run = (candidate: VisualGraph, before = candidate, capabilities: CapabilityAssessment[] = []) => simulateWorkflowProposal({ proposalId: "proposal-a", baseRevision: 3, candidate, before, capabilities });

describe("isolated automatic simulation", () => {
  it("passes supported local execution with actual runtime evidence", () => {
    const graph = collectGraph(), snapshot = structuredClone(graph), report = run(graph);
    expect(report.result).toBe("PASS"); expect(report.canPublish).toBe(true);
    expect(report.scenarios.every(s => s.executionCount > 0 && s.traversedNodeIds.length > 0)).toBe(true);
    expect(report.scenarios.find(s => s.scenarioId === "entry:order")?.traversedNodeIds).toEqual(["start", "email", "email", "end"]);
    expect(graph).toEqual(snapshot);
  });
  it("selects both condition branches from explicit graph expectations", () => {
    const report = run(branchGraph());
    expect(report.result).toBe("PASS");
    expect(report.scenarios.find(s => s.scenarioId === "branch:channel:yes")).toMatchObject({ result: "PASS", traversedNodeIds: ["channel", "phone"], selectedBranches: { channel: "yes" } });
    expect(report.scenarios.find(s => s.scenarioId === "branch:channel:no")).toMatchObject({ result: "PASS", traversedNodeIds: ["channel", "end"], selectedBranches: { channel: "no" } });
  });
  it("keeps missing and ambiguous input out of collected values", () => {
    const report = run(collectGraph());
    for (const category of ["missing_input", "ambiguous_input"]) {
      expect(report.scenarios.find(s => s.category === category && s.initialState.nodeId === "email")).toMatchObject({ result: "PASS", collectedFields: [], traversedNodeIds: ["email"] });
    }
  });
  it("reuses previously collected values without asking again", () => {
    expect(run(collectGraph()).scenarios.find(s => s.scenarioId === "existing:email")).toMatchObject({ result: "PASS", traversedNodeIds: ["email", "end"], collectedFields: [{ nodeId: "email", value: expect.any(String) }] });
  });
  it.each(["unsupported", "needs_setup", "needs_clarification"] as const)("blocks %s capabilities, despite an executable graph", status => {
    const report = run(collectGraph(), collectGraph(), [{ capabilityKey: status === "unsupported" ? "inventory.check" : "product.search", status, reasonCode: "test", missingRequirements: [] }]);
    expect(report.result).toBe("BLOCKED"); expect(report.canPublish).toBe(false);
    expect(report.scenarios.at(-1)?.executionCount).toBe(0);
  });
  it("refuses invented capabilities even if incorrectly marked ready", () => {
    expect(run(collectGraph(), collectGraph(), [{ capabilityKey: "back_in_stock.notify", status: "ready", reasonCode: "test", missingRequirements: [] }]).canPublish).toBe(false);
  });
  it("fails closed on assessment failures and unresolved business intent", () => {
    const graph = collectGraph();
    const report = simulateWorkflowProposal({ proposalId: "p", baseRevision: 1, before: graph, candidate: graph, assessmentUnavailable: true, clarificationRequired: true });
    expect(report.result).toBe("BLOCKED"); expect(report.scenarios.map(s => s.scenarioId)).toContain("assessment_unavailable");
  });
  it("never invokes messaging, persistence, model providers or external APIs", () => {
    vi.stubGlobal("fetch", forbidden);
    const report = run(upgradeVisualGraph(starterVisualGraph()));
    expect(report.result).toBe("UNVERIFIED"); expect(report.canPublish).toBe(false);
    expect(report.scenarios.flatMap(s => s.attemptedActions).map(a => a.kind)).toEqual(expect.arrayContaining(["knowledge", "product", "handoff"]));
    expect(report.scenarios.flatMap(s => s.attemptedActions).every(a => a.disposition === "not_executed")).toBe(true);
    expect(forbidden).not.toHaveBeenCalled();
  });
  it.each(["booking", "order_status"] as const)("does not execute %s even with ready capabilities", kind => {
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.nodes.find(n => n.id === "product")!.kind = kind;
    const report = run(graph);
    expect(report.scenarios.find(s => s.scenarioId === "action:product")).toMatchObject({ result: "UNVERIFIED", attemptedActions: [{ kind, nodeId: "product", disposition: "not_executed" }] });
    expect(forbidden).not.toHaveBeenCalled();
  });
  it("binds reports to proposal, normalized graph and base revision", () => {
    const graph = collectGraph(), report = run(graph), binding = simulationBinding(report);
    expect(matchesSimulationBinding(binding, "proposal-a", 3, graph)).toBe(true);
    expect(matchesSimulationBinding(binding, "proposal-b", 3, graph)).toBe(false);
    expect(matchesSimulationBinding(binding, "proposal-a", 4, graph)).toBe(false);
    const changed = structuredClone(graph); changed.nodes[1].config.prompt = "Changed";
    expect(matchesSimulationBinding(binding, "proposal-a", 3, changed)).toBe(false);
    expect(matchesSimulationBinding(binding, "proposal-a", 3, normalizeVisualDraft(graph))).toBe(true);
  });
  it("marks invalid paths BLOCKED without pretending they executed", () => {
    const graph = collectGraph(); graph.edges.pop();
    const report = run(graph);
    expect(report.result).toBe("BLOCKED"); expect(report.scenarios.every(s => !s.executionCount)).toBe(true);
  });
  it("rejects executable configuration outside the existing graph contract", () => {
    const graph = collectGraph(); Object.assign(graph.nodes[1].config, { webhook: "https://secret.invalid" });
    const report = run(graph);
    expect(report.canPublish).toBe(false); expect(JSON.stringify(report)).not.toContain("secret.invalid");
  });
  it("reports execution errors and independently detects incorrect branch selection", () => {
    const advance = runtime.advanceVisualWorkflow;
    vi.spyOn(runtime, "advanceVisualWorkflow").mockImplementation(p => {
      const execution = advance(p);
      if (p.state?.nodeId === "channel") execution.state.branchPorts = { channel: "no" };
      return execution;
    });
    const report = run(branchGraph());
    expect(report.result).toBe("FAIL"); expect(report.canPublish).toBe(false);
    expect(report.scenarios.find(s => s.scenarioId === "branch:channel:yes")?.result).toBe("FAIL");
    vi.spyOn(runtime, "advanceVisualWorkflow").mockImplementation(() => { throw new Error("secret-diagnostic"); });
    const failed = run(collectGraph());
    expect(failed.result).toBe("FAIL"); expect(JSON.stringify(failed)).not.toContain("secret-diagnostic");
  });
  it("executes regressions for unchanged branches without demanding that intentional changes stay identical", () => {
    const before = branchGraph(), after = structuredClone(before); after.nodes.find(n => n.id === "phone")!.config.prompt = "New question";
    const report = run(after, before);
    expect(report.result).toBe("PASS");
    expect(report.scenarios.filter(s => s.category === "regression").map(s => s.initialState.nodeId)).toEqual(["end"]);
  });
  it("detects a regression from actual before/after execution, independent of structural comparison", () => {
    const before = collectGraph(), after = { ...before, name: "New label" }, advance = runtime.advanceVisualWorkflow;
    vi.spyOn(runtime, "advanceVisualWorkflow").mockImplementation(p => {
      const execution = advance(p);
      if (p.graph.name === "New label") execution.state.values.unexpected = "new value";
      return execution;
    });
    const report = run(after, before);
    expect(report.scenarios.some(s => s.validationFindings.some(f => f.code === "regression_changed"))).toBe(true);
    expect(report.canPublish).toBe(false);
  });
  it("redacts prompts and configuration-derived values from reports", () => {
    const graph = branchGraph(); graph.nodes[1].config.value = "secret-condition"; graph.nodes[2].config.prompt = "secret-prompt";
    const report = run(graph);
    expect(report.scenarios.find(s => s.scenarioId === "branch:channel:yes")?.result).toBe("PASS");
    expect(JSON.stringify(report)).not.toMatch(/secret-condition|secret-prompt/);
  });
  it("does not report unresolved multi-turn loops as PASS", () => {
    const graph = collectGraph(); graph.nodes.push(node("confirm", "confirm", { prompt: "Again?" }));
    graph.edges[1].target = "confirm";
    graph.edges.push({ id: "yes", source: "confirm", port: "yes", target: "email" }, { id: "no", source: "confirm", port: "no", target: "end" });
    const report = run(graph);
    expect(report.result).toBe("FAIL"); expect(report.canPublish).toBe(false);
    expect(report.scenarios.every(s => s.executionCount <= 40)).toBe(true);
  });
  it("marks exhausted time budgets unverified, with no fake execution evidence", () => {
    let ticks = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ticks++ * 3000);
    const report = run(collectGraph());
    expect(report.result).toBe("UNVERIFIED"); expect(report.canPublish).toBe(false);
    expect(report.scenarios).toEqual([expect.objectContaining({ scenarioId: "time_budget", executionCount: 0 })]);
  });
  it("executes unchanged v2 flow regressions while explicitly declining to verify hub selection", () => {
    const before = upgradeVisualGraph(starterVisualGraph()), after = structuredClone(before);
    after.nodes.find(n => n.id === "knowledge")!.config.prompt = "Changed knowledge";
    const report = run(after, before);
    expect(report.scenarios.some(s => s.category === "regression" && s.initialState.nodeId === "product")).toBe(true);
    expect(report.scenarios.some(s => s.category === "regression" && s.initialState.nodeId === "knowledge")).toBe(false);
    expect(report.scenarios.find(s => s.scenarioId === "hub_unverified")?.result).toBe("UNVERIFIED");
    expect(report.canPublish).toBe(false);
  });
});
