import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/workflows/visual/test-actions", () => ({ simulateVisualWorkflow: vi.fn() }));
import { WorkflowCard } from "./workflow-card";
import { starterVisualGraph, emptyVisualGraph } from "@/lib/workflows/visual/model";
import { simulateWorkflowProposal } from "@/lib/workflows/visual/simulation";
const graph = starterVisualGraph();
const workspace = { graph, revision: 3, publishedVersionId: null, enabled: false, available: true, generated: false, hasUnpublishedChanges: false };
it("keeps publication review accessible when a local simulation cannot exercise external services", () => {
  const simulation = simulateWorkflowProposal({ proposalId: "test", baseRevision: 3, before: graph, candidate: graph });
  const html = renderToStaticMarkup(createElement(WorkflowCard, { data: { workspace, published: null, simulation }, slug: "test", pending: false, onRequest: vi.fn() }));
  expect(html).toContain("Rindërto me asistentin");
  expect(html).toMatch(/<button[^>]*(?<!disabled="")>Publiko draftin…<\/button>/);
  expect(html).toContain("UNVERIFIED");
});
it("offers optional creation without publishing an absent workflow", () => {
  const html = renderToStaticMarkup(createElement(WorkflowCard, { data: { workspace: { ...workspace, graph: emptyVisualGraph(), generated: true, revision: 0 }, published: null }, slug: "test", pending: false, onRequest: vi.fn() }));
  expect(html).toContain("Sugjero workflow");
  expect(html).toContain("Pa workflow");
  expect(html).not.toContain("Publiko draftin");
  expect(html).not.toContain("Mesazh i ri");
  expect(html).not.toContain("Duhet plotësuar para publikimit");
});
