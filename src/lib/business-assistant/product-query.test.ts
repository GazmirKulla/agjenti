import { describe, expect, it } from "vitest";
import { itemKind } from "@/lib/items/kinds";
import type { BusinessField } from "@/lib/items/fields";
import { productSchema } from "./product-fields";
import { parseProductQuery, queryFields, runProductQuery, type QueryField } from "./product-query";

// Language examples are test data only: the runtime compares structured values, never words.
const own: BusinessField[] = [
  { key: "mosha", label: "Mosha e rekomanduar", type: "text" },
  { key: "faqe", label: "Faqe", type: "number" },
  { key: "gjuha", label: "Gjuha", type: "select", options: ["Shqip", "English"] },
  { key: "ngjyra", label: "Ngjyra", type: "select", variant: true },
  { key: "dixhital", label: "Dixhital", type: "boolean" },
];
const schema = productSchema({ kind: itemKind("product"), fields: own, fieldsRead: true });
const fields = queryFields(schema, ["old_field"]);
const row = (id: string, attributes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id, name: `Produkt ${id}`, price_amount: 100, currency: "ALL", is_active: true, archived_at: null, attributes, ...extra });
const catalog = [
  row("a", { mosha: "3-5 vjec", faqe: 120, gjuha: "Shqip", dixhital: true }, { price_amount: 990 }),
  row("b", { mosha: "5-7 vjec", faqe: "48", gjuha: "shqip " }, { price_amount: 550 }),
  row("c", { faqe: "rreth 30", gjuha: "English", ngjyra: ["E kuqe", "Blu"] }, { price_amount: 490, is_active: false }),
  row("d", { old_field: "x" }, { price_amount: 1290, archived_at: "2026-11-01T00:00:00Z" }),
];
const run = (raw: Record<string, unknown>, variants?: Map<string, Record<string, string>[]>) => {
  const parsed = parseProductQuery(raw, fields);
  if ("error" in parsed) throw new Error(parsed.error);
  return runProductQuery(catalog, parsed.query, fields, variants);
};
const ids = (r: { matched: Record<string, unknown>[] }) => r.matched.map(p => p.id);

describe("product queries run by the server", () => {
  it("matches values regardless of case, accents and spacing, in any language", () => {
    expect(ids(run({ filters: JSON.stringify([{ field: "gjuha", op: "eq", value: "SHQIP" }]) }))).toEqual(["a", "b"]);
    expect(ids(run({ filters: [{ field: "gjuha", op: "in", value: ["english", "Deutsch"] }] }))).toEqual(["c"]);
  });

  it("finds missing and present values, and keeps products without a value out of neq", () => {
    expect(ids(run({ filters: [{ field: "mosha", op: "missing" }] }))).toEqual(["c", "d"]);
    expect(ids(run({ filters: [{ field: "gjuha", op: "neq", value: "Shqip" }] }))).toEqual(["c"]);
  });

  it("compares numbers stored as numbers or numeric text, and reports values it cannot compare", () => {
    const result = run({ filters: [{ field: "faqe", op: "gte", value: 40 }] });
    expect(ids(result)).toEqual(["a", "b"]);
    expect(result.uncomparable).toEqual([{ field: "faqe", count: 1 }]);
  });

  it("does not count a product as uncomparable when another filter already excludes it", () => {
    const result = run({ filters: [{ field: "gjuha", op: "eq", value: "Shqip" }, { field: "faqe", op: "gt", value: 10 }] });
    expect(result.uncomparable).toEqual([]);
  });

  it("filters standard columns, the derived status and booleans", () => {
    expect(ids(run({ filters: [{ field: "price_amount", op: "lt", value: 600 }, { field: "status", op: "eq", value: "active" }] }))).toEqual(["b"]);
    expect(ids(run({ filters: [{ field: "status", op: "eq", value: "archived" }] }))).toEqual(["d"]);
    expect(ids(run({ filters: [{ field: "dixhital", op: "eq", value: true }] }))).toEqual(["a"]);
  });

  it("reads a customer-chosen field from both stored choices and variant rows", () => {
    const variants = new Map([["b", [{ ngjyra: "E kuqe" }]]]);
    expect(ids(run({ filters: [{ field: "ngjyra", op: "eq", value: "e kuqe" }] }, variants))).toEqual(["b", "c"]);
  });

  it("counts per value with the missing ones apart, and sorts with missing values last", () => {
    const grouped = run({ filters: [], group_by: "gjuha" });
    expect(grouped.groups).toMatchObject({ field: "gjuha", missing: 1, values: [{ value: "Shqip", count: 2 }, { value: "English", count: 1 }] });
    expect(ids(run({ filters: [], sort: JSON.stringify({ field: "faqe", dir: "desc" }) })).slice(0, 2)).toEqual(["a", "b"]);
  });

  it("can still reach values left by a removed field", () => {
    expect(ids(run({ filters: [{ field: "old_field", op: "present" }] }))).toEqual(["d"]);
  });

  it("matches a name or SKU fragment", () => {
    expect(ids(run({ filters: [], query: "produkt c" }))).toEqual(["c"]);
  });

  it("rejects what does not fit the business's fields so the model can correct it", () => {
    const check = (raw: Record<string, unknown>) => parseProductQuery(raw, fields);
    expect(check({ filters: [{ field: "made_up", op: "eq", value: "x" }] })).toHaveProperty("error");
    expect(check({ filters: [{ field: "gjuha", op: "like", value: "x" }] })).toHaveProperty("error");
    expect(check({ filters: [{ field: "faqe", op: "gt", value: "shumë" }] })).toHaveProperty("error");
    expect(check({ filters: [{ field: "gjuha", op: "in", value: "Shqip" }] })).toHaveProperty("error");
    expect(check({ filters: "not json" })).toHaveProperty("error");
    expect(check({ filters: Array.from({ length: 11 }, () => ({ field: "faqe", op: "present" })) })).toHaveProperty("error");
    expect(check({ group_by: "made_up" })).toHaveProperty("error");
    expect(check({ sort: { field: "faqe", dir: "up" } })).toHaveProperty("error");
  });

  it("works for any item kind's fields, e.g. a property's area", () => {
    const property = productSchema({ kind: itemKind("property"), fields: [], fieldsRead: true });
    const propertyFields = queryFields(property);
    expect((propertyFields.get("size_m2") as QueryField).type).toBe("number");
    const parsed = parseProductQuery({ filters: [{ field: "size_m2", op: "gt", value: 100 }] }, propertyFields);
    if ("error" in parsed) throw new Error(parsed.error);
    const homes = [row("h1", { size_m2: 120 }), row("h2", { size_m2: 80 })];
    expect(runProductQuery(homes, parsed.query, propertyFields).matched.map(p => p.id)).toEqual(["h1"]);
  });
});
