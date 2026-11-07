import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import { emptyState } from "@/lib/workflows/engine";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import { WorkflowHub, WorkflowContextPanel, WorkflowFlowChooser } from "./workflow-hub";
import { removeVisualFlow } from "@/lib/workflows/visual/remove-flow";
import { workflowHubSelection } from "./hub-selection";

describe("message workflow presentation", () => {
  it("shows configured booking only and keeps the editor graph unchanged", () => {
    const graph = starterVisualGraph();
    const before = structuredClone(graph);
    const initial = renderToStaticMarkup(createElement(WorkflowHub, { graph }));
    expect(initial).not.toContain("Shto rrjedhën: Rezervim");
    const enabled = renderToStaticMarkup(createElement(WorkflowHub, { graph, bookingEnabled: true }));
    expect(enabled).not.toContain("Shto rrjedhën: Rezervim");
    expect(graph).toEqual(before);
  });
  it("does not reintroduce a removed order flow as a placeholder card", () => {
    const removed = removeVisualFlow(starterVisualGraph(), "product");
    expect(removed.graph).toBeDefined();
    const html = renderToStaticMarkup(createElement(WorkflowHub, { graph: removed.graph, onOpen: () => undefined }));
    expect(html).not.toContain("is-order");
    expect(html).toContain("Përgjigju nga njohuritë");
  });
  it("shows an actual booking instance from native runtime without leftover routing", () => {
    const runtime = initialSnapshot("business", "conversation", "test");
    runtime.focusId = "booking";
    runtime.profileMemory = { phone: { value: "0691234567", type: "phone" } };
    runtime.instances.booking = {
      id: "booking", definitionId: "booking", versionId: "v", stepId: "date", status: "suspended",
      facts: { date: { value: "2026-11-07", subject: "booking", fieldId: "date", revision: 1, eventId: "e", evidence: "Dua takim të premten" } },
    };
    const state = { ...emptyState(), runtime };
    const html = renderToStaticMarkup(createElement(WorkflowHub, { state, message: "Dua takim të premten", bookingEnabled: true }));
    expect(html).toContain("Dua takim të premten");
    expect(html).toContain("is-booking");
    const context = renderToStaticMarkup(createElement(WorkflowContextPanel, { state }));
    expect(context).toContain("0691234567");
    expect(context).toContain("U ruajt për më vonë");
    expect(context).toContain("2026-11-07");
  });
  it("keeps customer input as text and renders collected native facts", () => {
    const runtime = initialSnapshot("business", "conversation", "test");
    runtime.focusId = "order";
    runtime.profileMemory = { phone: { value: "0691234567", type: "phone" } };
    runtime.instances.order = {
      id: "order", definitionId: "order", versionId: "v", stepId: "date", status: "waiting_input",
      facts: { date: { value: "2026-11-07", subject: "order", fieldId: "date", revision: 1, eventId: "e", evidence: "të premten" } },
    };
    const html = renderToStaticMarkup(createElement(WorkflowContextPanel, { state: { ...emptyState(), runtime } }));
    expect(html).toContain("0691234567");
    expect(html).toContain("Data");
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
  it("shows each new flow as a direct named card in the hub", () => {
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.flows.push({ id: "custom-extra", kind: "custom", label: "Rrjedha ime e re", entryNodeId: "custom-node", nodeIds: ["custom-node"] });
    graph.flows.push({ id: "support-extra", kind: "support", label: "Ndihma pas shitjes", entryNodeId: "handoff-extra", nodeIds: ["handoff-extra"] });
    const html = renderToStaticMarkup(createElement(WorkflowHub, { graph, onOpenFlow: () => undefined }));
    expect(html).toContain('value="support-extra"');
    expect(html).toContain("Ndihma pas shitjes");
    expect(html).toContain('aria-label="Hap rrjedhën: Ndihma pas shitjes"');
    expect(html).not.toContain("Rrjedha të tjera");
    expect(html).toContain('aria-label="Hap rrjedhën: Rrjedha ime e re"');
    expect(workflowHubSelection([], "booking")).toEqual({ action: "create", kind: "booking" });
  });
});
