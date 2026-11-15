import { expect, it } from "vitest";
import { orderItemsText, orderItemSummary } from "./item-summary";

it("lists the items by position with their product names", () => {
  const items = orderItemSummary([
    { quantity: 1, position: 2, products: { name: "Kornizë" } },
    { quantity: "2", position: 1, products: [{ name: "Puzzle A4" }] },
    { quantity: 0.5, position: null, products: null },
  ]);
  expect(items).toEqual([{ name: "Produkt", quantity: 0.5 }, { name: "Puzzle A4", quantity: 2 }, { name: "Kornizë", quantity: 1 }]);
  expect(orderItemsText(items)).toBe("0.5 × Produkt, 2 × Puzzle A4, 1 × Kornizë");
  expect(orderItemSummary(null)).toEqual([]);
});
