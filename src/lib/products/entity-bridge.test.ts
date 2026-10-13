import { describe, expect, it } from "vitest";
import { emptyState } from "@/lib/workflows/engine";
import { rememberTurn } from "@/lib/workflows/guidance";
import { migrateContext } from "@/lib/workflows/context";
import { migrateConversationProcesses, restoreOrder, snapshotOrder } from "@/lib/workflows/conversation-processes";
import { combineProductPresentations, recordEntityPresentation, renderProductReferences, resolveProductReference, type ReferenceProduct } from "./entity-bridge";

const products: ReferenceProduct[] = [
  { id: "p1", name: "Puzzle", price_amount: 20, currency: "EUR" },
  { id: "p2", name: "Libri", price_amount: 10, currency: "EUR" },
];
function presented(list = products) {
  const state = emptyState();
  const rendered = renderProductReferences(list.map(p => `[[product:${p.id}]]`).join("\n"), list);
  recordEntityPresentation(state, "business", rendered.reply, rendered.presentedProducts);
  rememberTurn(null, state, "Çfarë produktesh keni?", rendered.reply);
  return state;
}
const resolve = (message: string, state = presented(), catalog = products) => resolveProductReference({ businessId: "business", message, state, products: catalog, mode: "test" });

describe("W3 verified presentation and references", () => {
  it("records only rendered tenant catalog slots, in display order, bounded and without selecting a product", () => {
    const rendered = renderProductReferences("[[product:p2]] then [[product:p1]]; [[product:foreign]]; invented product", products);
    expect(rendered.reply).toContain("Libri — 10 EUR");
    expect(rendered.reply).not.toContain("[[product:");
    expect(rendered.presentedProducts.map(p => p.id)).toEqual(["p2", "p1"]);
    const state = presented();
    expect(state.product_id).toBeNull();
    expect(state.entityPresentation?.entities).toEqual(expect.arrayContaining([expect.objectContaining({ id: "p2", kind: "product", displayOrder: 2, sourceTurn: state.entityPresentation!.sourceTurn })]));
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `Product ${i}` }));
    expect(presented(many).entityPresentation?.entities).toHaveLength(10);
    expect(renderProductReferences("Puzzle is best", products).presentedProducts).toEqual([]);
  });
  it("does not claim ordinal evidence for repeated, mixed prose/slot, or oversized lists", () => {
    expect(renderProductReferences("[[product:p1]] [[product:p2]] [[product:p1]]", products).presentedProducts).toEqual([]);
    expect(renderProductReferences("Puzzle or [[product:p2]]", products).presentedProducts).toEqual([]);
    const state = emptyState();
    recordEntityPresentation(state, "business", "Puzzle", Array.from({ length: 11 }, () => products[0]));
    expect(state.entityPresentation).toBeUndefined();
    expect(resolve("i pari apo i dyti")).toMatchObject({ status: "clarify", reason: "ambiguous_reference" });
  });
  it("composes actual visual replies in display order, discarding unused/repeated presentations", () => {
    const first = { reply: "Puzzle", presentedProducts: [products[0]] }, second = { reply: "Libri", presentedProducts: [products[1]] };
    expect(combineProductPresentations("Puzzle\nLibri", [second, first]).map(p => p.id)).toEqual(["p1", "p2"]);
    expect(combineProductPresentations("Libri", [first, second]).map(p => p.id)).toEqual(["p2"]);
    expect(combineProductPresentations("Puzzle\nPuzzle", [first, first])).toEqual([]);
  });
  it.each(["the second one", "i dyti", "dua të dytin", "produktin 2"])("resolves display order: %s", message => {
    expect(resolve(message)).toMatchObject({ status: "selected", product: { id: "p2" }, via: "ordinal" });
  });
  it.each(["the cheapest", "më i liri", "dua më të lirin"])("compares verified prices: %s", message => {
    expect(resolve(message)).toMatchObject({ status: "selected", product: { id: "p2" }, via: "cheapest" });
  });
  it.each(["not Puzzle, I want Libri", "not Puzzle, Libri", "Jo Puzzle, dua Libri", "nuk dua Puzzle por Libri"])("excludes the negated entity: %s", message => {
    expect(resolve(message)).toMatchObject({ status: "selected", product: { id: "p2" }, via: "correction" });
  });
  it.each(["this one", "këtë", "dua këtë"])("requires a single displayed referent: %s", message => {
    expect(resolve(message)).toMatchObject({ status: "clarify", reason: "ambiguous_reference" });
    expect(resolve(message, presented([products[1]]))).toMatchObject({ status: "selected", product: { id: "p2" } });
  });
  it("does not let unknown or incomplete corrections fall back to the old selection", () => {
    expect(resolve("not Puzzle")).toMatchObject({ status: "clarify" });
    expect(resolve("Jo Puzzle, dua Qwerty")).toMatchObject({ status: "clarify" });
    expect(resolve("Puzzle", presented(), [...products, { id: "duplicate", name: "Puzzle" }])).toMatchObject({ status: "clarify", reason: "multiple_matches" });
  });
  it.each([
    ["tied_prices", [{ ...products[0], price_amount: 10 }, products[1]]],
    ["missing_price", [{ ...products[0], price_amount: null }, products[1]]],
    ["missing_price", [{ ...products[0], currency: null }, products[1]]],
    ["mixed_currencies", [{ ...products[0], currency: "ALL" }, products[1]]],
  ] as const)("asks rather than guessing with %s", (reason, catalog) => {
    const list = [...catalog];
    expect(resolve("më i liri", presented(list), list)).toMatchObject({ status: "clarify", reason });
  });
  it("rejects deactivated, foreign, expired, out-of-range and changed-price references", () => {
    expect(resolve("i dyti", presented(), [products[0]])).toMatchObject({ status: "clarify", reason: "unavailable" });
    const foreign = presented(); foreign.entityPresentation!.businessId = "other";
    expect(resolve("i dyti", foreign)).toMatchObject({ status: "clarify", reason: "stale_reference" });
    const expired = presented(); expired.entityPresentation!.expiresAt = Date.now() - 1;
    expect(resolve("i dyti", expired)).toMatchObject({ status: "clarify", reason: "stale_reference" });
    expect(resolve("i treti")).toMatchObject({ status: "clarify", reason: "unavailable" });
    expect(resolve("më i liri", presented(), [{ ...products[0], price_amount: 5 }, products[1]])).toMatchObject({ status: "clarify", reason: "price_changed" });
  });
  it("requires actual outbound delivery in production and current conversation scope in both modes", () => {
    const state = presented(), reply = state.recentMessages!.at(-1)!.content;
    expect(resolveProductReference({ businessId: "business", message: "i dyti", state, products })).toMatchObject({ status: "clarify" });
    expect(resolveProductReference({ businessId: "business", message: "i dyti", state, products, deliveredReply: reply })).toMatchObject({ status: "selected" });
    const next = structuredClone(state);
    rememberTurn(state, next, "Ku jeni?", "Në Tiranë.");
    expect(resolve("i dyti", next)).toMatchObject({ status: "clarify", reason: "stale_reference" });
    expect(resolve("Libri", next)).toMatchObject({ status: "selected", product: { id: "p2" } });
  });
  it.each([undefined, 2, 3] as const)("reads legacy schema %s without inventing presentation or selection", schemaVersion => {
    const state = { ...emptyState(), schemaVersion };
    expect(resolve("këtë", state)).toMatchObject({ status: "clarify" });
    expect(resolve("Libri", state)).toMatchObject({ status: "selected", product: { id: "p2" } });
    expect(migrateContext(state).entityPresentation).toBeUndefined();
  });
  it("keeps current selection and presentation authoritative over historical snapshots", () => {
    let state = migrateConversationProcesses(migrateContext(presented()), () => "task");
    state.context!.execution.factOwner = "order"; state.product_id = "p1";
    state.processes!.order = { id: "order", status: "suspended", snapshot: snapshotOrder(state) };
    state.product_id = "p2";
    const before = structuredClone(state);
    state = restoreOrder(state, { resume: true });
    expect(state.product_id).toBe("p2");
    expect(state.entityPresentation).toEqual(before.entityPresentation);
    expect(before.processes!.order!.snapshot.product_id).toBe("p1");
  });
});
