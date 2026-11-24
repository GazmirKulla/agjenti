import { expect, it } from "vitest";
import { blockCaption, blockReply, parseBlocks } from "./blocks";
import { unknownProductSetup } from "./product-fields";
import { searchBlocks } from "./search-blocks";

const setup = unknownProductSetup();
const row = { id: "00000000-0000-4000-8000-000000000001", name: "Lis", price_amount: 70000,
  currency: "ALL", price_mode: "range", price_max: 80000, price_unit: "m³", is_active: true };
const result = { kind: "product", mode: "filter", status: "complete", matchedCount: 12, more: true, rows: [row] };

it("keeps the server's total separate from the returned page after JSON round-trip", () => {
  const reply = blockReply("Rezultatet e kërkimit", searchBlocks(result, setup));
  const restored = parseBlocks(JSON.parse(JSON.stringify(reply.blocks)));
  expect(restored).toMatchObject([{ type: "table", total: 12, partial: true,
    rows: [{ cells: { name: "Lis", price: "nga 70000 deri 80000 ALL për m³" } }] }]);
  expect(blockCaption(reply.message, restored)).toBe("Rezultatet e kërkimit");
  for (const invalid of [null, [{ version: 2, type: "table" }], [{ ...restored[0], rows: [{}] }]]) {
    const fallback = blockCaption(reply.message, parseBlocks(invalid));
    expect(fallback).toContain("1 nga 12");
    expect(fallback).toContain("Lis");
    expect(fallback).not.toContain(row.id);
  }
});

it("distinguishes an empty result, incomplete scan and failed search", () => {
  expect(searchBlocks({ ...result, matchedCount: 0, rows: [], more: false }, setup)).toMatchObject([{ total: 0, rows: [], partial: false }]);
  expect(searchBlocks({ ...result, status: "partial" }, setup)).toMatchObject([{ total: null, partial: true, note: expect.stringContaining("12") }]);
  expect(searchBlocks({ ...result, status: "unavailable", rows: [] }, setup)).toEqual([]);
});
