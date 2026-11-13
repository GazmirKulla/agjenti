import { describe, expect, it } from "vitest";
import { orderOutcome } from "./payments";

const payment = { id: "p1", amount: 1_500, currency: "ALL" };
const order = (changes = {}) => ({ id: "o1", amount: 1_500, currencyCode: "ALL", merchantCustomReference: "p1", isCompleted: false, ...changes });

describe("orderOutcome", () => {
  it("counts only a completed order with our amount, currency and reference", () => {
    expect(orderOutcome(payment, order({ isCompleted: true }))).toBe("paid");
    expect(orderOutcome(payment, order({ isCompleted: true, amount: 100 }))).toBe("failed");
    expect(orderOutcome(payment, order({ isCompleted: true, currencyCode: "EUR" }))).toBe("failed");
    expect(orderOutcome(payment, order({ isCompleted: true, merchantCustomReference: "other" }))).toBe("failed");
  });

  it("uses the original amount when POK converted the currency", () => {
    expect(orderOutcome(payment, order({ isCompleted: true, amount: 15, currencyCode: "EUR", originalAmount: 1_500, originalCurrencyCode: "ALL" }))).toBe("paid");
  });

  it("treats refunded, cancelled and expired orders as failed and waits otherwise", () => {
    expect(orderOutcome(payment, order({ isCompleted: true, isRefunded: true }))).toBe("failed");
    expect(orderOutcome(payment, order({ isCanceled: true }))).toBe("failed");
    expect(orderOutcome(payment, order({ expiresAt: "2026-01-01T00:00:00Z" }), Date.parse("2026-01-02T00:00:00Z"))).toBe("failed");
    expect(orderOutcome(payment, order({ expiresAt: "2026-01-03T00:00:00Z" }), Date.parse("2026-01-02T00:00:00Z"))).toBe("pending");
  });
});
