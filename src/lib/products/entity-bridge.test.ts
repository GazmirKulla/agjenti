import { describe, expect, it } from "vitest";
import { emptyState } from "@/lib/workflows/engine";
import { rememberTurn } from "@/lib/workflows/guidance";
import { migrateContext } from "@/lib/workflows/context";
import { migrateConversationProcesses, restoreOrder, snapshotOrder } from "@/lib/workflows/conversation-processes";
import { combineProductPresentations, recordEntityPresentation, recordReplyPresentation, renderProductReferences, resolveProductReference, resolveServiceReference, type ReferenceProduct } from "./entity-bridge";

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
const resolve = async (message: string, state = presented(), catalog = products) => (await resolveProductReference({ businessId: "business", message, state, products: catalog, mode: "test" }));

describe("2B shared presentation evidence for services", () => {
  const services = [{ id: "s1", name: "Konsulta" }, { id: "s2", name: "Trajnimi" }];
  function shown(list = services) {
    const state = emptyState();
    const render = renderProductReferences(list.map(s => `[[service:${s.id}]]`).join("\n"), list, "service");
    recordEntityPresentation(state, "business", render.reply, render.presentedProducts, "service");
    rememberTurn(null, state, "Shërbimet?", render.reply);
    return state;
  }
  it.each(["i dyti", "shërbimin e dytë"])("resolves %s without borrowing product identity", async message => {
    const state = shown();
    expect((await resolveServiceReference({ businessId: "business", message, state, services, mode: "test" }))).toMatchObject({ status: "selected", service: { id: "s2" } });
    expect((await resolve(message, state)).status).toBe("clarify");
    expect(state.product_id).toBeNull();
  });
  it("resolves a single service pronoun and rejects stale, undelivered and foreign evidence", async () => {
    const state = shown([services[0]]);
    const args = { businessId: "business", message: "ai shërbimi", services, state };
    expect((await resolveServiceReference(args)).status).toBe("clarify");
    expect((await resolveServiceReference({ ...args, deliveredReply: "Konsulta" }))).toMatchObject({ status: "selected", service: { id: "s1" } });
    expect((await resolveServiceReference({ ...args, mode: "test", businessId: "foreign" })).status).toBe("clarify");
    state.entityPresentation!.expiresAt = 0;
    expect((await resolveServiceReference({ ...args, mode: "test" })).status).toBe("clarify");
  });
  it("other requires exactly two displayed choices and a current selection", async () => {
    const state = presented();
    expect((await resolve("jo atë, tjetrin", state)).status).toBe("clarify");
    state.product_id = "p1";
    expect((await resolve("jo atë, tjetrin", state))).toMatchObject({ status: "selected", product: { id: "p2" } });
    expect((await resolve("jo atë, tjetrin", state, [products[0]])).status).toBe("clarify");
  });
  it("mixed composed replies invalidate ordinal evidence instead of selecting a preferred kind", async () => {
    const state = presented();
    recordReplyPresentation(state, "business", { reply: "Puzzle, Konsulta", presentedProducts: [products[0]], presentedServices: [services[0]] });
    expect(state.entityPresentation).toBeUndefined();
    expect((await resolve("i dyti", state)).status).toBe("clarify");
  });
  it("other uses the current canonical selection, not a historical order snapshot", async () => {
    const state = migrateConversationProcesses(migrateContext(presented()), () => "task");
    state.context!.execution.factOwner = "order"; state.product_id = "p1";
    state.processes!.order = { id: "task", status: "active", snapshot: snapshotOrder(state) };
    state.product_id = "p2";
    expect((await resolve("jo atë, tjetrin", state))).toMatchObject({ status: "selected", product: { id: "p1" } });
  });
});

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
  it("does not claim ordinal evidence for repeated, mixed prose/slot, or oversized lists", async () => {
    expect(renderProductReferences("[[product:p1]] [[product:p2]] [[product:p1]]", products).presentedProducts).toEqual([]);
    expect(renderProductReferences("Puzzle or [[product:p2]]", products).presentedProducts).toEqual([]);
    const state = emptyState();
    recordEntityPresentation(state, "business", "Puzzle", Array.from({ length: 11 }, () => products[0]));
    expect(state.entityPresentation).toBeUndefined();
    expect((await resolve("i pari apo i dyti"))).toMatchObject({ status: "clarify", reason: "ambiguous_reference" });
  });
  it("composes actual visual replies in display order, discarding unused/repeated presentations", () => {
    const first = { reply: "Puzzle", presentedProducts: [products[0]] }, second = { reply: "Libri", presentedProducts: [products[1]] };
    expect(combineProductPresentations("Puzzle\nLibri", [second, first]).map(p => p.id)).toEqual(["p1", "p2"]);
    expect(combineProductPresentations("Libri", [first, second]).map(p => p.id)).toEqual(["p2"]);
    expect(combineProductPresentations("Puzzle\nPuzzle", [first, first])).toEqual([]);
  });
  it.each(["the second one", "i dyti", "dua të dytin", "produktin 2"])("resolves display order: %s", async message => {
    expect((await resolve(message))).toMatchObject({ status: "selected", product: { id: "p2" }, via: "ordinal" });
  });
  it.each(["the cheapest", "më i liri", "dua më të lirin"])("compares verified prices: %s", async message => {
    expect((await resolve(message))).toMatchObject({ status: "selected", product: { id: "p2" }, via: "cheapest" });
  });
  it.each(["not Puzzle, I want Libri", "not Puzzle, Libri", "Jo Puzzle, dua Libri", "nuk dua Puzzle por Libri"])("excludes the negated entity: %s", async message => {
    expect((await resolve(message))).toMatchObject({ status: "selected", product: { id: "p2" }, via: "correction" });
  });
  it.each(["this one", "këtë", "dua këtë"])("requires a single displayed referent: %s", async message => {
    expect((await resolve(message))).toMatchObject({ status: "clarify", reason: "ambiguous_reference" });
    expect((await resolve(message, presented([products[1]])))).toMatchObject({ status: "selected", product: { id: "p2" } });
  });
  it("does not let unknown or incomplete corrections fall back to the old selection", async () => {
    expect((await resolve("not Puzzle"))).toMatchObject({ status: "clarify" });
    expect((await resolve("Jo Puzzle, dua Qwerty"))).toMatchObject({ status: "clarify" });
    expect((await resolve("Puzzle", presented(), [...products, { id: "duplicate", name: "Puzzle" }]))).toMatchObject({ status: "clarify", reason: "multiple_matches" });
  });
  it.each([
    ["tied_prices", [{ ...products[0], price_amount: 10 }, products[1]]],
    ["missing_price", [{ ...products[0], price_amount: null }, products[1]]],
    ["missing_price", [{ ...products[0], currency: null }, products[1]]],
    ["mixed_currencies", [{ ...products[0], currency: "ALL" }, products[1]]],
  ] as const)("asks rather than guessing with %s", async (reason, catalog) => {
    const list = [...catalog];
    expect((await resolve("më i liri", presented(list), list))).toMatchObject({ status: "clarify", reason });
  });
  it("rejects deactivated, foreign, expired, out-of-range and changed-price references", async () => {
    expect((await resolve("i dyti", presented(), [products[0]]))).toMatchObject({ status: "clarify", reason: "unavailable" });
    const foreign = presented(); foreign.entityPresentation!.businessId = "other";
    expect((await resolve("i dyti", foreign))).toMatchObject({ status: "clarify", reason: "stale_reference" });
    const expired = presented(); expired.entityPresentation!.expiresAt = Date.now() - 1;
    expect((await resolve("i dyti", expired))).toMatchObject({ status: "clarify", reason: "stale_reference" });
    expect((await resolve("i treti"))).toMatchObject({ status: "clarify", reason: "unavailable" });
    expect((await resolve("më i liri", presented(), [{ ...products[0], price_amount: 5 }, products[1]]))).toMatchObject({ status: "clarify", reason: "price_changed" });
  });
  it("requires actual outbound delivery in production and current conversation scope in both modes", async () => {
    const state = presented(), reply = state.recentMessages!.at(-1)!.content;
    expect((await resolveProductReference({ businessId: "business", message: "i dyti", state, products }))).toMatchObject({ status: "clarify" });
    expect((await resolveProductReference({ businessId: "business", message: "i dyti", state, products, deliveredReply: reply }))).toMatchObject({ status: "selected" });
    const next = structuredClone(state);
    rememberTurn(state, next, "Ku jeni?", "Në Tiranë.");
    expect((await resolve("i dyti", next))).toMatchObject({ status: "clarify", reason: "stale_reference" });
    expect((await resolve("Libri", next))).toMatchObject({ status: "selected", product: { id: "p2" } });
  });
  it.each([undefined, 2, 3] as const)("reads legacy schema %s without inventing presentation or selection", async schemaVersion => {
    const state = { ...emptyState(), schemaVersion };
    expect((await resolve("këtë", state))).toMatchObject({ status: "clarify" });
    expect((await resolve("Libri", state))).toMatchObject({ status: "selected", product: { id: "p2" } });
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
