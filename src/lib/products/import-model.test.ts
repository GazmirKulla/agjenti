import { describe, expect, it } from "vitest";
import { autoMapAttributes, buildImportPreview, readImportCsv, importFields, type CatalogProduct } from "./import-model";
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
it("groups rows with the same name into one product with variants and keeps the business's own fields", () => {
  const fields = [{ key: "druri", label: "Druri", type: "text" as const }, { key: "gjatesia", label: "Gjatësia", type: "select" as const, variant: true }];
  const csv = "emri,sku,cmimi,Gjatësia,Druri\nDorezë druri,D80,500,80 cm,Ah\nDorezë druri,D120,800,120 cm,Ah\nBisht,B1,300,,Lis";
  const { mapping, headers } = readImportCsv(csv);
  const attributes = autoMapAttributes(headers, fields, Object.values(mapping) as number[]);
  expect(attributes).toEqual({ gjatesia: 3, druri: 4 });
  const rows = buildImportPreview(csv, { mapping, fields: [...importFields], attributes }, [], fields);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ status: "create", name: "Dorezë druri", patch: { price_amount: 500, attributes: { druri: "Ah" } },
    variants: [{ options: { gjatesia: "80 cm" }, sku: "D80", price_amount: null }, { options: { gjatesia: "120 cm" }, sku: "D120", price_amount: 800 }] });
  expect(rows[0].patch).not.toHaveProperty("sku");
  expect(rows[1]).toMatchObject({ status: "create", name: "Bisht", patch: { attributes: { druri: "Lis" } } });
  expect(rows[1].variants).toBeUndefined();
});
it("adds variants to an existing product with the same name and flags a repeated variant", () => {
  const fields = [{ key: "gjatesia", label: "Gjatësia", type: "select" as const, variant: true }];
  const csv = "emri,cmimi,gjatesia\nLibri,520,A5\nLibri,520,A5";
  const { mapping } = readImportCsv(csv);
  const [row] = buildImportPreview(csv, { mapping, fields: [...importFields], attributes: { gjatesia: 2 } }, [existing], fields);
  expect(row).toMatchObject({ id: "p1", status: "conflict" });
  expect(row.errors.join()).toContain("përsëritet");
  const [ok] = buildImportPreview("emri,cmimi,gjatesia\nLibri,520,A5", { mapping, fields: [...importFields], attributes: { gjatesia: 2 } }, [existing], fields);
  expect(ok).toMatchObject({ id: "p1", status: "update", variants: [{ options: { gjatesia: "A5" }, price_amount: null }] });
});

describe("a business's own CSV read with an approved plan", () => {
  // The wood catalog a customer sent: ranges per m³, several lengths per cell, prices on request.
  const csv = [
    "Produkti,Çmimi minimal (ALL),Çmimi maksimal (ALL),Njësia e çmimit,Gjatësia (m),Trashësia (cm),Gjerësia,Përmasa / seksioni,Shënime",
    "Dërrasa Lis,70000,80000,m³,2; 3; 4,3; 5; 7; 10,Të ndryshme,,",
    "Binare,,,,1,,,5x5; 6x6; 7x7; 8x8; 10x10 cm,Çmimi sipas kërkesës",
    "Binare për Çati,30000,33000,m³,4; 5; 7,,Të ndryshme,Të ndryshme,",
    "Rrathë për Tavolina,4000,8000,copë,,,,,Në varësi të përmasave",
    "Dërrasa Qershi,65000,80000,m³,2,3; 5,,,Përmasat e dhëna: 2m x 5cm; 2m x 3cm",
    "Dërrasa Plep,33000,35000,m³,,5; 7,,,",
  ].join("\n");
  const fields = [
    { key: "gjatesia", label: "Gjatësia", type: "select" as const, unit: "m", variant: true },
    { key: "trashesia", label: "Trashësia", type: "select" as const, unit: "cm", variant: true },
    { key: "permasa", label: "Përmasa", type: "select" as const, unit: "cm", variant: true },
  ];
  const options = {
    fields: [...importFields], mapping: { name: 0, price_amount: 1, price_max: 2, price_unit: 3, description: 8 },
    attributes: { gjatesia: 4, trashesia: 5, permasa: 7 }, blanks: { "6": ["Të ndryshme"], "7": ["të ndryshme"] }, missingPrice: "request" as const,
  };
  it("reads ranges per unit, lists the customer chooses from and prices on request", () => {
    const rows = buildImportPreview(csv, options, [], fields);
    expect(rows.map(r => r.status)).toEqual(["create", "create", "create", "create", "create", "create"]);
    expect(rows[0].patch).toMatchObject({ name: "Dërrasa Lis", price_amount: 70000, price_max: 80000, price_mode: "range", price_unit: "m³",
      attributes: { gjatesia: ["2", "3", "4"], trashesia: ["3", "5", "7", "10"] } });
    expect(rows[0].variants).toBeUndefined();
    expect(rows[1].patch).toMatchObject({ price_mode: "request", price_amount: null, description: "Çmimi sipas kërkesës",
      attributes: { gjatesia: ["1"], permasa: ["5x5", "6x6", "7x7", "8x8", "10x10"] } });
    expect(rows[2].patch.attributes).toEqual({ gjatesia: ["4", "5", "7"] });
    expect(rows[3].patch).toMatchObject({ price_mode: "range", price_unit: "copë" });
    expect(rows[3].patch.attributes).toBeUndefined();
    expect(rows[4].patch.attributes).toEqual({ gjatesia: ["2"], trashesia: ["3", "5"] });
    expect(rows[5].patch.attributes).toEqual({ trashesia: ["5", "7"] });
  });
  it("without the plan's choices a missing price stays empty and blanks are plain values", () => {
    const rows = buildImportPreview(csv, { ...options, missingPrice: undefined, blanks: undefined }, [], fields);
    expect(rows[1].patch).not.toHaveProperty("price_mode");
    expect(rows[2].status).toBe("create");
    expect(rows[2].patch.attributes).toMatchObject({ permasa: ["Të ndryshme"] });
  });
  it("keeps an unchanged range, rejects an upper price below the lower one and lists on repeated names", () => {
    const before: CatalogProduct = { id: "p2", name: "Dërrasa Plep", sku: null, price_amount: 33000, price_max: 35000, price_mode: "range", price_unit: "m³", currency: "ALL",
      description: null, image_url: null, is_active: false, updated_at: "2026-11-13T10:00:00Z", attributes: { trashesia: ["5", "7"] } };
    const plep = buildImportPreview(csv, options, [before], fields).find(r => r.name === "Dërrasa Plep")!;
    expect(plep).toMatchObject({ id: "p2", status: "unchanged" }); // same range, unit and lists
    const grouped = buildImportPreview(csv + "\nDërrasa Lis,70000,90000,m³,5,3,,,", options, [], fields);
    expect(grouped[0].errors.join()).toContain("lista vlerash");
    const low = buildImportPreview("emri,cmimi,Çmimi maksimal\nI ri,500,400", { fields: [...importFields], mapping: { name: 0, price_amount: 1, price_max: 2 } }, []);
    expect(low[0].status).toBe("conflict");
  });
});
