import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/workflows/entity-flow-link.css", () => ({}));
import { ProductFields } from "../dashboard/product-fields";

it("shows the business workflow and links to its root while preserving optional product processes", () => {
  const html = renderToStaticMarkup(createElement(ProductFields, {
    slug: "filiz", types: [], product: { id: "book", visual_workflow: { name: "Personalizim", flowId: "custom" } },
    workflows: [{ id: "", name: "Rrjedha e workflow 1", businessWorkflow: { name: "Rrjedha e workflow 1", active: true, status: "Aktiv" } }, { id: "legacy", name: "Madhësitë" }],
  }));
  expect(html).toContain('href="/b/filiz/workflows"');
  expect(html).toContain("Rrjedha e workflow 1");
  expect(html).toContain("Proces i posaçëm");
  expect(html).toContain("Personalizim");
  expect(html).toContain('value="legacy"');
  expect(html).not.toContain('value="visual:');
});
