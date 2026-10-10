import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
import { migrateConversationProcesses } from "@/lib/workflows/conversation-processes";
import type { ConversationRouting } from "@/lib/workflows/conversation-processes";
import { setFact } from "@/lib/workflows/context";
import { WorkflowHub, WorkflowContextPanel } from "./workflow-hub";

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
});
