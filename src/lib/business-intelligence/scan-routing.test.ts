import { describe, expect, it } from "vitest";
import { emptyDraft, mergeDraft, normalizeDraftCurrencies, parseEntities, value, entityValidationIssues } from "./model";
import { scanKnowledge, withoutScanKnowledge, reviewEntities } from "./scan-routing";

const knowledge = () => parseEntities([{ target: "knowledge", facts: [{ field: "title", value: "Dërgesa", evidence: "Dërgesa" }, { field: "body", value: "Dërgojmë brenda dy ditësh.", evidence: "Dërgojmë brenda dy ditësh." }] }], "website", "https://shop.test", "Dërgesa Dërgojmë brenda dy ditësh.")[0];
const product = (priceEvidence: string) => parseEntities([{ target: "product", facts: [{ field: "name", value: "Puzzle", evidence: "Puzzle" }, { field: "price", value: "12", evidence: priceEvidence, confidence: .9 }] }], "instagram", "ig:post", `Puzzle ${priceEvidence}`)[0];

describe("automatic source routing", () => {
  it("routes supported FAQ to Knowledge while keeping products for confirmation", () => {
    const faq = knowledge(); const offer = product("12 €");
    const draft = { ...emptyDraft(), entities: [faq, offer] };
    expect(scanKnowledge(draft).map(entity => entity.id)).toEqual([faq.id]);
    expect(withoutScanKnowledge(draft, scanKnowledge(draft)).entities).toEqual([offer]);
    expect(reviewEntities(draft, "product")).toEqual([offer]);
  });
  it("respects disabled sections, excluded entries, incomplete and manual knowledge", () => {
    const faq = knowledge(); const draft = { ...emptyDraft(), entities: [faq] };
    expect(scanKnowledge({ ...draft, reviewPreferences: { excludedTargets: ["knowledge"], excludedEntityIds: [] } })).toEqual([]);
    expect(scanKnowledge({ ...draft, reviewPreferences: { excludedTargets: [], excludedEntityIds: [faq.id] } })).toEqual([]);
    expect(scanKnowledge({ ...draft, reviewPreferences: { excludedTargets: [], excludedEntityIds: [], enabledModules: ["products"] } })).toEqual([]);
    faq.facts.find(fact => fact.field === "body")!.source = "manual";
    expect(scanKnowledge(draft)).toEqual([]);
    faq.facts.find(fact => fact.field === "body")!.source = "website";
    faq.facts.find(fact => fact.field === "body")!.value = null;
    expect(scanKnowledge(draft)).toEqual([]);
  });
  it("removes imported FAQ with a stable merged identity and its stale conflicts", () => {
    const old = knowledge(); const next = knowledge();
    next.facts.find(fact => fact.field === "body")!.value = "Tri ditë.";
    const merged = mergeDraft({ ...emptyDraft(), entities: [old] }, [next]);
    expect(merged.conflicts).toHaveLength(1);
    const cleaned = withoutScanKnowledge(merged, [next]);
    expect(cleaned.entities).toEqual([]);
    expect(cleaned.conflicts).toEqual([]);
    expect(cleaned.missingInformation).toEqual([]);
  });
  it("keeps supported competing FAQ answers for inactive import rather than losing them", () => {
    const first = knowledge(); const second = knowledge();
    second.facts.find(fact => fact.field === "body")!.value = "Tri ditë.";
    const merged = mergeDraft({ ...emptyDraft(), entities: [first] }, [second]);
    expect(scanKnowledge(merged).map(entity => value(entity, "body"))).toEqual(["Dërgojmë brenda dy ditësh.", "Tri ditë."]);
  });
  it("reads currency from the same offer's price text or OCR without guessing ambiguous currency", () => {
    for (const [quote, expected] of [["12 €", "EUR"], ["12 Lekë", "ALL"], ["12 GBP", "GBP"], ["12 $", ""], ["12 EUR / 1200 ALL", ""]]) expect(value(product(quote), "currency")).toBe(expected);
    const noCurrency = product("12");
    expect(value(mergeDraft({ ...emptyDraft(), entities: [noCurrency] }, [product("12 €")]).entities[0], "currency")).toBe("EUR");
    const visual = product("12");
    visual.facts.find(fact => fact.field === "price")!.evidence = "12 €";
    visual.facts.find(fact => fact.field === "price")!.evidenceKind = "visual";
    expect(value(normalizeDraftCurrencies({ ...emptyDraft(), entities: [visual] }).entities[0], "currency")).toBe("");
  });
  it("keeps competing answers together when a routing batch reaches its limit", () => {
    const entries = Array.from({ length: 60 }, (_, i) => {
      const entry = knowledge(); entry.facts.find(fact => fact.field === "title")!.value = `Pyetje ${i}`; return entry;
    });
    const last = entries[59]; const body = last.facts.find(fact => fact.field === "body")!;
    const draft = { ...emptyDraft(), entities: entries, conflicts: [{ entityId: last.id, field: "body", current: body, incoming: { ...body, value: "Tri ditë." } }] };
    const batch = scanKnowledge(draft);
    expect(batch).toHaveLength(59);
    const remaining = withoutScanKnowledge(draft, batch);
    expect(remaining.conflicts).toHaveLength(1);
    expect(scanKnowledge(remaining).map(entity => value(entity, "body"))).toEqual([body.value, "Tri ditë."]);
  });
  it("normalizes legacy currency aliases and equivalent conflicts automatically", () => {
    const offer = product("12 €"); offer.facts.find(fact => fact.field === "currency")!.value = "Euro";
    const incoming = { ...offer.facts.find(fact => fact.field === "currency")!, value: "€" };
    const draft = normalizeDraftCurrencies({ ...emptyDraft(), entities: [offer], conflicts: [{ entityId: offer.id, field: "currency", current: offer.facts.find(fact => fact.field === "currency")!, incoming }] });
    expect(value(draft.entities[0], "currency")).toBe("EUR");
    expect(draft.conflicts).toEqual([]);
    expect(entityValidationIssues(draft.entities)).toEqual([]);
  });
});
