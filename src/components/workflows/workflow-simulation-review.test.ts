import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("./workflow-simulation-review.css", () => ({}));
vi.mock("./visual-workflow.css", () => ({}));
vi.mock("./workflow-change-review.css", () => ({}));
import { WorkflowSimulationReview } from "./workflow-simulation-review";
import { WorkflowChangeReview } from "./workflow-change-review";
import { simulateWorkflowProposal } from "@/lib/workflows/visual/simulation";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
import { summarizeWorkflowChanges } from "@/lib/business-assistant/semantic-summary";
const graph = starterVisualGraph();
const report = simulateWorkflowProposal({ proposalId: "test-proposal", baseRevision: 7, candidate: graph, before: graph });
it("renders evidence, unavailable actions and graph binding without claiming full validation", () => {
  const html = renderToStaticMarkup(h(WorkflowSimulationReview, { report, onFocus: vi.fn() }));
  expect(html).toContain("UNVERIFIED"); expect(html).toContain("Jo plotësisht i validuar");
  expect(html).toContain("Pritshmëria"); expect(html).toContain("Ekzekutimi");
  expect(html).toContain("Nuk u ekzekutua: "); expect(html).toContain("Fokuso hapin knowledge");
  expect(html).toContain(report.candidateGraphHash); expect(html).toContain("test-proposal");
});
it("integrates simulation into the existing semantic preview without contradictory no-simulation text", () => {
  const html = renderToStaticMarkup(h(WorkflowChangeReview, { before: graph, after: graph, summary: summarizeWorkflowChanges(graph, graph, 7, null), simulation: report }));
  expect(html).toContain("Prova automatike"); expect(html).not.toContain("Nuk është kryer simulim");
  expect(html).toContain("Rezultatet e provës së izoluar");
});
it("renders the capability, missing setup, affected step and remediation without implying execution", () => {
  const report = simulateWorkflowProposal({ proposalId: "setup", baseRevision: 0, candidate: graph, before: graph,
    capabilities: [{ capabilityKey: "product.search", status: "needs_setup", reasonCode: "missing_requirements", missingRequirements: ["active_products"] }] });
  const html = renderToStaticMarkup(h(WorkflowSimulationReview, { report, onFocus: vi.fn() }));
  for (const text of ["product.search", "active_products", "missing_requirements", "Hapat e prekur", "Si ta zgjidhësh", "Nuk u ekzekutua — nuk është test i dështuar."]) expect(html).toContain(text);
  expect(html).not.toContain("U ekzekutua dhe dështoi.");
});
