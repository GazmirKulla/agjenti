import { expect, it } from "vitest";
import { buildImportPreview, readImportCsv, importFields, type CatalogProduct } from "./import-model";
const existing: CatalogProduct = { id: "p1", name: "Libri", sku: "LIB-1", price_amount: 520, currency: "ALL", description: "Ruaje", image_url: "https://example.com/a.jpg", is_active: true, updated_at: "2026-10-11T10:00:00Z" };
const review = (csv: string, catalog = [existing]) => buildImportPreview(csv, { mapping: readImportCsv(csv).mapping, fields: [...importFields] }, catalog);
it("updates a matching SKU with exact before/after values while preserving absent and empty fields", () => {
  expect(review('emri,sku,cmimi,pershkrimi\nLibri,lib-1,790,')[0]).toMatchObject({ status: "update", id: "p1", before: existing, patch: { price_amount: 790, sku: "lib-1" } });
  expect(review('emri,sku,cmimi,pershkrimi\nLibri,LIB-1,790,')[0].patch).not.toHaveProperty("description");
});
it("never creates copies for ambiguous names and does not match by name automatically", () => {
  expect(review('emri,cmimi\nLibri,790')[0].status).toBe("conflict");
  expect(review('emri,sku,cmimi\nLibri,OTHER,790')[0].status).toBe("conflict");
});
it("rejects repeated SKU even when one duplicate row is deselected", () => {
  const csv = 'emri,sku,cmimi\nLibri,LIB-1,790\nLibri tjetër,lib-1,800';
  expect(buildImportPreview(csv, { mapping: readImportCsv(csv).mapping, fields: [...importFields], lines: [2] }, [existing])[0].status).toBe("conflict");
});
it("supports price-only updates without changing other supplied fields", () => {
  const csv = 'emri,sku,cmimi,monedha\nEmër tjetër,LIB-1,790,ALL';
  expect(buildImportPreview(csv, { mapping: readImportCsv(csv).mapping, fields: ["price_amount", "currency"] }, [existing])[0].patch).toEqual({ price_amount: 790 });
});
it("marks unchanged rows and new drafts separately", () => {
  const rows = review('emri,sku,cmimi\nLibri,LIB-1,520\nI ri,NEW,790');
  expect(rows.map(r => r.status)).toEqual(["unchanged", "create"]);
  expect(rows[1].warnings.join()).toContain("draft");
});
it("blocks invalid prices, currencies, images and ragged rows rather than silently dropping data", () => {
  for (const csv of ['emri,cmimi\nI ri,abc', 'emri,monedha\nI ri,nope', 'emri,foto\nI ri,javascript:alert(1)', 'emri,sku\nI ri,ABC,extra']) expect(review(csv)[0].status).toBe("conflict");
});
it("preserves quoted multiline descriptions and detects malformed files", () => {
  expect(review('emri,pershkrimi\nI ri,"Rreshti 1\nRreshti 2"')[0].patch.description).toContain('\n');
  expect(() => readImportCsv('emri,sku\n"I ri,ABC')).toThrow();
  expect(() => readImportCsv('emri\n' + Array.from({length:101}, () => 'Produkt').join('\n'))).toThrow();
});
it("validates mappings and blocks creation when name is excluded", () => {
  expect(() => buildImportPreview('emri\nI ri', { mapping: { name: 7 }, fields: ["name"] }, [])).toThrow();
  expect(buildImportPreview('emri,cmimi\nI ri,20', { mapping: { name: 0, price_amount: 1 }, fields: ["price_amount"] }, [])[0].status).toBe("conflict");
});
it("rejects ambiguous money and conflicting currency instead of coercing arbitrary text", () => {
  for (const price of ['12abc','1.23.45','-790','NaN']) expect(review(`emri,cmimi\nI ri,${price}`)[0].status).toBe("conflict");
  expect(review('emri,cmimi,monedha\nI ri,12 EUR,ALL')[0].status).toBe("conflict");
  expect(review('emri,cmimi\nI ri,790 Leke')[0].patch).toMatchObject({price_amount:790,currency:"ALL"});
  expect(review('emri,cmimi\nI ri,12 EUR')[0].patch).toMatchObject({price_amount:12,currency:"EUR"});
});
it("preserves type/workflow unless explicitly selected and includes the selection in preview", () => {
  const csv = 'sku,cmimi\nLIB-1,790';
  const options = {mapping:readImportCsv(csv).mapping,fields:["price_amount"] as const};
  const row = buildImportPreview(csv,{...options,fields:[...options.fields],productTypeId:"type",workflowId:"flow"},[existing])[0];
  expect(row.patch).toEqual({price_amount:790,product_type_id:"type",workflow_id:"flow"});
});
it("retains headerless CSV support using the established positional columns", async () => {
  const {withCsvHeaders} = await import('./import-model');
  const raw = withCsvHeaders('Një produkt;790;ALL;Përshkrim;NEW');
  expect(review(raw)[0]).toMatchObject({status:"create",patch:{name:"Një produkt",price_amount:790,sku:"NEW"}});
});
