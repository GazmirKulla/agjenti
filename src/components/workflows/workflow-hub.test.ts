import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import { migrateConversationProcesses } from "@/lib/workflows/conversation-processes";
import type { ConversationRouting } from "@/lib/workflows/conversation-processes";
import { setFact } from "@/lib/workflows/context";
import { WorkflowHub, WorkflowContextPanel, WorkflowFlowChooser } from "./workflow-hub";
import { workflowHubSelection } from "./hub-selection";

describe("message workflow presentation", () => {
  const decision: ConversationRouting = { process: "booking", action: "start", reason: "Klienti kërkoi një rezervim; porosia ruhet.", source: "rules", reusedFields: ["customer_phone"], missingFields: ["date", "time"], suspended: "order" };
  it("shows configured booking only and keeps the editor graph unchanged", () => {
    const graph = starterVisualGraph();
    const before = structuredClone(graph);
    const initial = renderToStaticMarkup(createElement(WorkflowHub, { graph }));
    expect(initial).not.toContain("Hap rrjedhën: Rezervim");
    const enabled = renderToStaticMarkup(createElement(WorkflowHub, { graph, bookingEnabled: true }));
    expect(enabled).toContain("Hap rrjedhën: Rezervim");
    expect(graph).toEqual(before);
  });
  it("shows an actual booking decision even when no visual trace was returned", () => {
    const state = migrateConversationProcesses(null, () => "test");
    state.processes!.booking = { id: "booking", status: "active" };
    const html = renderToStaticMarkup(createElement(WorkflowHub, { state, routing: decision, message: "Dua takim të premten" }));
    expect(html).toContain("Dua takim të premten");
    expect(html).toContain("is-booking is-current");
    expect(html).toContain(decision.reason);
    const context = renderToStaticMarkup(createElement(WorkflowContextPanel, { state, routing: decision }));
    expect(context).toContain("U ruajt për më vonë");
  });
  it("keeps customer input as text and renders collected and missing fields", () => {
    const state = migrateConversationProcesses(null, () => "test");
    setFact(state, "customer_phone", "0691234567", "phone", "message");
    const html = renderToStaticMarkup(createElement(WorkflowContextPanel, { state, routing: decision }));
    expect(html).toContain("0691234567");
    expect(html).toContain("Data · Ora");
    expect(html).toContain("Telefoni");
    const hub = renderToStaticMarkup(createElement(WorkflowHub, { message: "<script>alert(1)</script>" }));
    expect(hub).toContain("&lt;script&gt;");
    expect(hub).not.toContain("<script>");
  });
  it.each(["support", "custom"] as const)("asks which %s flow instead of selecting the first match", kind => {
    const flows = [
      { id: "flow-first", kind, label: "Kontakti në WhatsApp", entryNodeId: "first", nodeIds: ["first"] },
      { id: "flow-second", kind, label: "Ndihmë pas porosisë", entryNodeId: "second", nodeIds: ["second", "details"] },
    ];
    const selection = workflowHubSelection(flows, kind);
    expect(selection).toEqual({ action: "choose", flows });
    const html = renderToStaticMarkup(createElement(WorkflowFlowChooser, { flows, onSelect: () => undefined, onClose: () => undefined }));
    expect(html).toContain('value="flow-first"');
    expect(html).toContain('value="flow-second"');
    expect(html).toContain("Kontakti në WhatsApp");
    expect(html).toContain("Ndihmë pas porosisë");
    expect(workflowHubSelection([flows[1]], kind)).toEqual({ action: "open", flowId: "flow-second" });
  });
  it("shows multiple flow labels and their count in the hub", () => {
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.flows.push({ id: "support-extra", kind: "support", label: "Ndihma pas shitjes", entryNodeId: "handoff-extra", nodeIds: ["handoff-extra"] });
    const html = renderToStaticMarkup(createElement(WorkflowHub, { graph, onOpenFlow: () => undefined }));
    expect(html).toContain("2 rrjedha · 2 hapa");
    expect(html).toContain("Ndihma pas shitjes");
    expect(html).toContain('aria-label="Zgjidh rrjedhën: Staf"');
    expect(workflowHubSelection([], "booking")).toEqual({ action: "create", kind: "booking" });
  });
});
