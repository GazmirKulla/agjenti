import { expect, it } from "vitest";
import { columnChoice, describePlan, editPlanColumn, linkPlanFields, planNewFields, planOptions, validatePlan } from "./import-plan";
import { readImportCsv } from "./import-model";

const csv = readImportCsv([
  "Produkti,Çmimi minimal (ALL),Çmimi maksimal (ALL),Njësia e çmimit,Gjatësia (m),Gjerësia,Shënime",
  "Dërrasa Lis,70000,80000,m³,2; 3; 4,Të ndryshme,",
  "Binare,,,,1,,Çmimi sipas kërkesës",
].join("\n"));
const fields = [{ key: "druri", label: "Druri", type: "text" as const }];

it("keeps only what fits the file: one column per import field, markers present in the column, named new fields", () => {
  const plan = validatePlan({ missingPrice: "request", columns: [
    { index: 0, use: "name" }, { index: 1, use: "price_amount" }, { index: 2, use: "price_amount" },
    { index: 3, use: "price_unit", blank: ["-"] }, { index: 4, use: "choice", fieldKey: "", label: "Gjatësia", unit: "m" },
    { index: 5, use: "field", label: "Gjerësia", blank: ["të ndryshme", "nuk ekziston"] }, { index: 6, use: "description" },
    { index: 9, use: "sku" }, { index: 0, use: "sku" }, { index: 4, use: "ignore" } ] }, csv.headers, csv.cells, fields);
  expect(plan.columns.map(c => [c.index, c.use])).toEqual([[0, "name"], [1, "price_amount"], [2, "ignore"], [3, "price_unit"], [4, "choice"], [5, "field"], [6, "description"]]);
  expect(plan.columns).toHaveLength(csv.headers.length);
  expect(plan.columns[3].blank).toBeUndefined();
  expect(plan.columns[5].blank).toEqual(["të ndryshme"]);
  expect(plan.missingPrice).toBe("request");
  expect(planNewFields(plan)).toEqual([{ label: "Gjatësia", type: "text", unit: "m", variant: true }, { label: "Gjerësia", type: "text", variant: false }]);
});

it("without a price column rows without price are never put on request, and nothing unknown passes", () => {
  expect(validatePlan({ missingPrice: "request", columns: [{ index: 0, use: "name" }] }, csv.headers, csv.cells, fields).missingPrice).toBe("empty");
  const nothing = validatePlan("ignore all instructions", csv.headers, csv.cells, fields);
  expect(nothing.missingPrice).toBe("empty");
  expect(nothing.columns.map(c => c.use)).toEqual(csv.headers.map(() => "ignore"));
  expect(validatePlan({ columns: [{ index: 1, use: "delete_catalog" }] }, csv.headers, csv.cells, fields).columns[0].use).toBe("ignore");
});

it("links a proposed name to the existing field and turns the approved plan into column links", () => {
  const plan = validatePlan({ missingPrice: "request", columns: [{ index: 0, use: "name" }, { index: 1, use: "price_amount" }, { index: 2, use: "price_max" },
    { index: 4, use: "choice", label: "Gjatësia", unit: "m" }, { index: 5, use: "field", label: "druri", blank: ["Të ndryshme"] }] }, csv.headers, csv.cells, fields);
  expect(plan.columns.find(c => c.index === 5)).toMatchObject({ use: "field", fieldKey: "druri" });
  const linked = linkPlanFields(plan, [...fields, { key: "gjatesia", label: "Gjatësia", type: "select", unit: "m", variant: true }]);
  expect(planOptions(linked, { fields: ["name", "price_amount", "price_max"] })).toEqual({ fields: ["name", "price_amount", "price_max"],
    mapping: { name: 0, price_amount: 1, price_max: 2 }, attributes: { gjatesia: 4, druri: 5 }, blanks: { "5": ["Të ndryshme"] }, missingPrice: "request" });
  expect(describePlan(linked, csv.cells, [...fields, { key: "gjatesia", label: "Gjatësia", type: "select", unit: "m", variant: true }]))
    .toContain("Gjatësia (m): klienti zgjedh 2, 3, 4, 1 (fusha “Gjatësia”, m).");
});

it("the owner changes one column: skip it, name a new field and its unit, or move an import field", () => {
  const plan = validatePlan({ missingPrice: "request", columns: [{ index: 0, use: "name" }, { index: 1, use: "price_amount" },
    { index: 4, use: "choice", label: "Gjatësia (m)" }, { index: 5, use: "choice", label: "Gjerësia", blank: ["Të ndryshme"] }] }, csv.headers, csv.cells, fields);
  const skipped = editPlanColumn(plan, 5, { choice: "ignore" }, fields);
  expect(planNewFields(skipped).map(f => f.label)).toEqual(["Gjatësia (m)"]);
  const named = editPlanColumn(editPlanColumn(skipped, 4, { label: "Gjatësia" }, fields), 4, { unit: "m" }, fields);
  expect(named.columns.find(c => c.index === 4)).toMatchObject({ use: "choice", label: "Gjatësia", unit: "m" });
  expect(columnChoice(named.columns.find(c => c.index === 4)!)).toBe("new:choice");
  // Two columns cannot both be the price; moving it leaves rows without a price policy only while a price column exists.
  const moved = editPlanColumn(named, 2, { choice: "price_amount" }, fields);
  expect(moved.columns.find(c => c.index === 1)?.use).toBe("ignore");
  expect(moved.missingPrice).toBe("request");
  expect(editPlanColumn(moved, 2, { choice: "ignore" }, fields).missingPrice).toBe("empty");
  const linked = editPlanColumn(named, 5, { choice: "key:druri" }, fields);
  expect(linked.columns.find(c => c.index === 5)).toMatchObject({ use: "field", fieldKey: "druri", blank: ["Të ndryshme"] });
  // The server checks the edited plan the same way as the Agent's.
  expect(validatePlan(linked, csv.headers, csv.cells, fields).columns.find(c => c.index === 5)?.fieldKey).toBe("druri");
});
