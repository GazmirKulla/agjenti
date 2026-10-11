import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ImportPreview, ImportRow } from "@/lib/products/import-model";
import { ProductCsvResult } from "./product-csv-result";

function render(status: ImportRow["status"], saved?: string) {
  const preview: ImportPreview = { rows: [{ line: 2, name: "TEST", status, errors: [], warnings: [], id: null, before: null, patch: {} }] };
  return renderToStaticMarkup(createElement(ProductCsvResult, { preview, saved, slug: "studio", busy: false, onDetails() {}, onNew() {} }));
}
describe("CSV import outcome", () => {
  it("offers inspection, not an approval action, when the catalog is unchanged", () => {
    const html = render("unchanged");
    expect(html).toContain("Katalogu është i përditësuar");
    expect(html).toContain("Shiko detajet");
    expect(html).not.toContain("Mirato");
    expect(html).not.toContain("Rishiko ndryshimet");
  });
  it("retains a saved receipt with access to products and an explicit new import", () => {
    const html = render("update", "U ruajtën 1 ndryshime.");
    expect(html).toContain("Importi u ruajt");
    expect(html).toContain('href="/b/studio/products"');
    expect(html).toContain("Shiko çfarë u ruajt");
    expect(html).toContain("Ngarko tjetër");
    expect(html).not.toContain("Rishiko ndryshimet");
    expect(html).not.toContain("Ngarko skedarin CSV");
  });
  it("directs conflicts to correction and pending changes to review", () => {
    expect(render("conflict")).toContain("Shiko korrigjimet");
    expect(render("conflict")).not.toContain("Ndryshimet janë gati");
    expect(render("update")).toContain("Rishiko ndryshimet");
    expect(render("update")).not.toContain("Importi u ruajt");
  });
});
