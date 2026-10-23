import { describe, expect, it } from "vitest";
import { collectionInput, decidedFieldGuidance, decisionForTurn, turnIntent } from "./turn-decision";
import { recordEntityPresentation, resolveProductReference } from "@/lib/products/entity-bridge";
import { emptyState } from "@/lib/workflows/engine";
import { rememberTurn } from "@/lib/workflows/guidance";

describe("Package 2A meaning is independent from entity reference and punctuation", () => {
  it("2B selects only an unambiguous entry for the already decided process", () => {
    const decision = decisionForTurn({ message: "Dua të porosis", executor: "workflow", process: "order" });
    expect(decidedFieldGuidance(decision, [{ id: "book", label: "Booking", kind: "booking" }, { id: "order", label: "Order", kind: "product" }])).toMatchObject({ action: "route", target: "order" });
    expect(decidedFieldGuidance(decision, [{ id: "one", label: "One", kind: "product" }, { id: "two", label: "Two", kind: "product" }])).toMatchObject({ action: "clarify", target: null });
  });
  it.each([
    ["Më trego produktin e dytë.", "information"],
    ["Dua ta porosis produktin e dytë.", "order"],
    ["Sa kushton Paketa Parashkollore?", "information"],
    ["Dua Paketën Parashkollore, si ta porosis?", "order"],
    ["Si ta porosis Paketën Parashkollore?", "undetermined"],
    ["Më trego shërbimin e dytë.", "information"],
    ["Dua të rezervoj shërbimin e dytë.", "booking"],
    ["i dyti", "undetermined"],
    ["Nuk dua ta porosis, sa kushton?", "information"],
  ])("%s → %s", (message, intent) => expect(turnIntent(message)).toBe(intent));

  it.each(["quantity", "budget", "child_age"])("recognizes punctuation on a declared %s, without a business-specific rule", key => {
    expect(collectionInput("4?", { key, type: "number" })).toBe("4");
    expect(collectionInput("many?", { key, type: "number" })).toBeUndefined();
    expect(collectionInput("Sa kushton?", { key, type: "number" })).toBeUndefined();
  });
  it("accepts only a configured choice and never strips question marks from free prose", () => {
    expect(collectionInput("M?", { key: "size", type: "text", options: ["S", "M"] })).toBe("M");
    expect(collectionInput("XL?", { key: "size", type: "text", options: ["S", "M"] })).toBeUndefined();
    expect(collectionInput("A mund ta ndryshoj?", { key: "project_type", type: "text" })).toBeUndefined();
    expect(collectionInput("Po?", undefined)).toBeUndefined();
  });
  it("does not turn an unresolved entity into action intent", () => {
    expect(decisionForTurn({ message: "i dyti", executor: "coordinator", entity: { status: "unresolved", kind: "product" }, routing: {
      process: "clarify", action: "clarify", source: "rules", reason: "ambiguous", missingFields: [], reusedFields: [],
    } })).toMatchObject({ kind: "clarification", reason: "entity", intent: "undetermined" });
  });
  it.each(["atë produktin", "Më trego atë produktin"])("%s uses verified single-entity presentation, not a guessed name", message => {
    const state = emptyState(); const products = [{ id: "p", name: "Kit sintetik", price_amount: 10, currency: "EUR" }];
    recordEntityPresentation(state, "tenant", "Kit sintetik", products);
    rememberTurn(null, state, "Më trego katalogun", "Kit sintetik");
    expect(resolveProductReference({ businessId: "tenant", message, state, products, mode: "test" })).toMatchObject({ status: "selected", product: { id: "p" } });
    expect(resolveProductReference({ businessId: "other-tenant", message, state, products, mode: "test" }).status).toBe("clarify");
  });
});
