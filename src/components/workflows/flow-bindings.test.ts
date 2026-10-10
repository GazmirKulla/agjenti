import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("./entity-flow-link.css", () => ({}));
import { upgradeVisualGraph, starterVisualGraph } from "@/lib/workflows/visual/model";
import { FlowBindings } from "./flow-bindings";
import { EntityFlowLink, entityWorkflowHref } from "./entity-flow-link";

describe("direct workflow assignments", () => {
  it("shows selected names, keeps inactive items selectable and identifies other flow owners", () => {
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.flows[0].productIds = ["product-a"];
    graph.flows[1].productIds = ["product-b"];
    const html = renderToStaticMarkup(createElement(FlowBindings, {
      flow: graph.flows[0], flows: graph.flows, disabled: false, onChange: () => undefined, onOpenFlow: () => undefined,
      catalog: { products: [{ id: "product-a", name: "Puzzle", isActive: false }, { id: "product-b", name: "Kornizë", isActive: true }], services: [] },
    }));
    expect(html).toContain("Puzzle");
    expect(html).toContain("Joaktiv · mund ta lidhësh tani");
    expect(html).toContain('type="checkbox" checked=""');
    expect(html).toContain('type="checkbox" disabled=""');
    expect(html).toContain(`E lidhur te ${graph.flows[1].label}`);
    expect(html).toContain("pas publikimit");
  });

  it("opens service assignments directly and explains non-bookable services", () => {
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.flows[0].serviceIds = ["service-a"];
    const html = renderToStaticMarkup(createElement(FlowBindings, {
      flow: graph.flows[0], flows: graph.flows, disabled: false, focus: { kind: "service", id: "service-a" }, onChange: () => undefined, onOpenFlow: () => undefined,
      catalog: { products: [], services: [{ id: "service-a", name: "Konsultë", isActive: true, bookingEnabled: false }] },
    }));
    expect(html).toContain("Konsultë");
    expect(html).toContain("pa rezervim me orar");
    expect(html).toContain("is-focused");
  });

  it("links catalog assignments to the exact visual flow, including disabled published metadata", () => {
    expect(entityWorkflowHref("studio", "product", "p-a", "flow-two")).toBe("/b/studio/workflows?product=p-a&flow=flow-two");
    const html = renderToStaticMarkup(createElement(EntityFlowLink, { slug: "studio", kind: "service", id: "s-a", binding: { flowId: "flow-two", name: "Përgatit konsultën" }, enabled: false }));
    expect(html).toContain("Përgatit konsultën");
    expect(html).toContain("Rrjedha është e çaktivizuar");
    expect(html).toContain("service=s-a&amp;flow=flow-two");
  });
});
