import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("./visual-workflow.css", () => ({}));
vi.mock("./workflow-change-review.css", () => ({}));
import { WorkflowChangeReview } from "./workflow-change-review";
import { VisualGraphView } from "./visual-graph";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
import { diffHighlights, diffWorkflowGraphs } from "@/lib/workflows/visual/diff";
import { summarizeWorkflowChanges } from "@/lib/business-assistant/semantic-summary";

it("renders before/after explanations with pending status and collapsible technical details", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  after.nodes.find(n => n.id === "knowledge")!.config.prompt = "secret-private-prompt";
  const html = renderToStaticMarkup(h(WorkflowChangeReview, { before, after, summary: summarizeWorkflowChanges(before, after, 8, "v1") }));
  expect(html).toContain("ende i paruajtur"); expect(html).toContain("<dt>Para</dt>"); expect(html).toContain("<dt>Pas</dt>");
  expect(html).toContain("Hollësitë teknike"); expect(html).not.toContain("secret-private-prompt"); expect(html).not.toContain("Draft i ruajtur");
});
it("highlights exactly the changed IDs with text labels, including removal in the old snapshot", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  after.nodes = after.nodes.filter(n => n.id !== "product");
  after.edges = after.edges.filter(e => e.source !== "product" && e.target !== "product");
  after.edges.find(e => e.id === "e5")!.target = "handoff";
  const diff = diffWorkflowGraphs(before, after);
  const old = renderToStaticMarkup(h(VisualGraphView, { graph: before, changes: diffHighlights(diff, "before") }));
  const next = renderToStaticMarkup(h(VisualGraphView, { graph: after, changes: diffHighlights(diff, "after") }));
  expect(old).toContain('data-node-id="product" data-change="removed"');
  expect(old).toContain('data-edge-id="e4" data-change="removed"');
  expect(next).toContain('data-edge-id="e5" data-change="updated"');
  expect(next).not.toContain('data-node-id="product"');
  expect(next).not.toContain('data-node-id="handoff" data-change=');
  expect(old).toContain("− Hequr");
});
it("explains setup and unsupported actions without echoing arbitrary configuration values", () => {
  const graph = starterVisualGraph(), summary = summarizeWorkflowChanges(graph, graph, 8, null);
  summary.unsupportedCapabilities = ["inventory.check", "secret-private-unknown"];
  summary.requiredConfiguration = ["active_products", "secret-private-configuration"];
  const html = renderToStaticMarkup(h(WorkflowChangeReview, { before: graph, after: graph, summary }));
  expect(html).toContain("Kontrolli i inventarit"); expect(html).toContain("Shto ose aktivizo produktet");
  expect(html).not.toContain("secret-private");
});
