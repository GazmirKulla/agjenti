import { expect, it } from "vitest";
import { customerPriceText } from "./pricing";

it("shows the customer the whole price: fixed, from, range and the unit it is for", () => {
  expect(customerPriceText({ price_amount: 500, currency: "ALL" })).toBe("500 ALL");
  expect(customerPriceText({ price_amount: 500, currency: "ALL", price_mode: "from" })).toBe("nga 500 ALL");
  expect(customerPriceText({ price_amount: 500, price_max: 800, currency: "ALL", price_mode: "range" })).toBe("nga 500 deri 800 ALL");
  expect(customerPriceText({ price_amount: 12, price_max: 15, currency: "EUR", price_mode: "range", price_unit: " m² " })).toBe("nga 12 deri 15 EUR për m²");
  expect(customerPriceText({ price_amount: 40, currency: "ALL", price_unit: "copë" })).toBe("40 ALL për copë");
});

it("shows no number when the price is on request, unset, or a range without its upper end", () => {
  expect(customerPriceText({ price_amount: 500, currency: "ALL", price_mode: "request" })).toBeNull();
  expect(customerPriceText({ price_amount: null, currency: "ALL" })).toBeNull();
  expect(customerPriceText({ price_amount: 500, currency: " " })).toBeNull();
  expect(customerPriceText({ price_amount: 500, price_max: null, currency: "ALL", price_mode: "range" })).toBe("500 ALL");
});
