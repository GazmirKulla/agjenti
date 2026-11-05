import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.unmock("./selection");
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = provider; } }));
import { selectSemanticCandidates, SelectionUnavailable, withSemanticSelections } from "./selection";
import { matchingCatalogNames } from "@/lib/products/match-name";
const candidates = [{ title: "Book 3+" }, { title: "Book 5+" }];
const response = (matches: unknown) => ({ status: "completed", output_text: JSON.stringify({ matches }) });
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", "synthetic"); provider.create.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it.each(["Dua librin për fëmijët më të vegjël", "Quiero el libro para niños más pequeños", "I'd like the younger age edition"])("uses structured model references across paraphrases: %s", async message => {
  provider.create.mockResolvedValue(response([{ index: 0, score: 1, evidence: message }]));
  expect(await selectSemanticCandidates("identity", candidates, message)).toEqual([{ index: 0, score: 1, evidence: message }]);
  expect(provider.create.mock.calls[0][0]).toMatchObject({ store: false, text: { format: { strict: true } } });
});
it.each([
  [{ index: 2, score: 1, evidence: "book" }],
  [{ index: -1, score: 1, evidence: "book" }],
  [{ index: 0, score: 2, evidence: "book" }],
  [{ index: 0, score: 1, evidence: "other conversation" }],
  [{ index: 0, score: 1, evidence: "book", authorized: true }],
  [{ index: 0, score: 1, evidence: "book" }, { index: 0, score: 1, evidence: "book" }],
  null,
])("rejects unknown identities, malformed schemas and invented evidence: %j", async matches => {
  provider.create.mockResolvedValue(response(matches));
  await expect(selectSemanticCandidates("identity", candidates, "book")).rejects.toBeInstanceOf(SelectionUnavailable);
});
it("never matches a familiar name when the provider fails or the key is absent", async () => {
  provider.create.mockRejectedValue(new Error("offline"));
  await expect(matchingCatalogNames([{ name: "Book" }], "Book")).rejects.toBeInstanceOf(SelectionUnavailable);
  vi.stubEnv("OPENAI_API_KEY", "");
  await expect(matchingCatalogNames([{ name: "Book" }], "Book")).rejects.toBeInstanceOf(SelectionUnavailable);
  expect(provider.create).toHaveBeenCalledTimes(1);
});
it("preserves ambiguous variants and duplicate names instead of inventing a winning ID", async () => {
  const entries = [{ name: "Book", id: "a" }, { name: "Book", id: "b" }];
  provider.create.mockResolvedValue(response([{ index: 0, score: 1, evidence: "Book" }]));
  expect(await matchingCatalogNames(entries, "Book")).toEqual(entries);
});
it("does not salvage a partial selection when a later batch fails", async () => {
  provider.create.mockResolvedValueOnce(response([{ index: 0, score: 1, evidence: "book" }])).mockRejectedValueOnce(new Error("offline"));
  await expect(selectSemanticCandidates("identity", Array.from({ length: 101 }, (_, i) => ({ title: `Book ${i}` })), "book"))
    .rejects.toBeInstanceOf(SelectionUnavailable);
});
it("reuses identical interpretation only inside one turn and isolates different candidate sets", async () => {
  provider.create.mockResolvedValue(response([]));
  await withSemanticSelections(async () => {
    await Promise.all([1,2].map(() => selectSemanticCandidates("identity", candidates, "book")));
    await selectSemanticCandidates("identity", [{ title: "another tenant" }], "book");
  });
  expect(provider.create).toHaveBeenCalledTimes(2);
  await withSemanticSelections(() => selectSemanticCandidates("identity", candidates, "book"));
  expect(provider.create).toHaveBeenCalledTimes(3);
});
it("rejects incomplete provider output even if its JSON looks valid", async () => {
  provider.create.mockResolvedValue({ ...response([]), status: "incomplete" });
  await expect(selectSemanticCandidates("relevance", candidates, "book")).rejects.toBeInstanceOf(SelectionUnavailable);
});
