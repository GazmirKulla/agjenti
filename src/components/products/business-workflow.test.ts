import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/workflows/entity-flow-link.css", () => ({}));
import { ProductFields } from "../dashboard/product-fields";

it("shows the business workflow and links to its root while preserving optional product processes", () => {
  const html = renderToStaticMarkup(createElement(ProductFields, {
    slug: "filiz", product: { id: "book", visual_workflow: { name: "Personalizim", flowId: "custom" } },
    workflows: [{ id: "", name: "Rrjedha e workflow 1", businessWorkflow: { name: "Rrjedha e workflow 1", active: true, status: "Aktiv" } }, { id: "legacy", name: "Madhësitë" }],
  }));
  expect(html).toContain('href="/b/filiz/workflows"');
  expect(html).toContain("Rrjedha e workflow 1");
  expect(html).toContain("Proces i posaçëm");
  expect(html).toContain("Personalizim");
  // Without a process of its own the form offers none: the agent's automatic process applies.
  expect(html).not.toContain('name="workflow_id"');
  expect(html).not.toContain("Shablloni i porosisë");
});

it("lets a product that still has an old order process switch to the automatic one", () => {
  const html = renderToStaticMarkup(createElement(ProductFields, {
    slug: "filiz", product: { id: "book", workflow_id: "legacy" },
    workflows: [{ id: "legacy", name: "Madhësitë" }],
  }));
  expect(html).toContain("Procesi i vjetër i porosisë");
  expect(html).toContain('<option value="">Procesi automatik i Agjentit</option>');
  expect(html).toContain('value="legacy"');
  expect(html).not.toContain('value="visual:');
});
