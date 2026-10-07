import { describe, expect, it } from "vitest";
import { emptyDraft, mergeDraft, parseEntities, value } from "@/lib/business-intelligence/model";
import { basicInstructions } from "@/lib/onboarding/model";
import { mergedReview, signalsFor, withSetupRecommendations } from "./proposal";
import { editDiscoveryDraft } from "./review";
import { selectDiscoveryImages } from "./images";

const product = (price: string) => parseEntities([{ target: "product", facts: [
  { field: "name", value: "Bluza" }, { field: "price", value: price }, { field: "currency", value: "EUR" },
] }], "manual", "test", "")[0];

describe("discovery evidence and review", () => {
  it("keeps image observations and OCR with provenance, rejecting invented commercial terms or image references", () => {
    const images = [{ id: "photo1", url: "https://cdn.test/1.jpg", postUrl: "https://instagram.com/p/1" }];
    const [entity] = parseEntities([{ target: "product", facts: [
      { field: "name", value: "Bluza", evidence: "A shirt is visible", evidenceKind: "visual", imageRef: "photo1", confidence: 1 },
      { field: "price", value: "12", evidence: "Looks expensive", evidenceKind: "visual", imageRef: "photo1" },
      { field: "currency", value: "EUR", evidence: "EUR", evidenceKind: "ocr", imageRef: "photo1", confidence: 1 },
      { field: "availability", value: "In stock", evidence: "In stock", evidenceKind: "ocr", imageRef: "invented" },
      { field: "imageUrl", value: "https://attacker.test/image.jpg", evidence: "A photo", evidenceKind: "visual", imageRef: "photo1" },
    ] }], "instagram", "ig:profile", "", images);
    expect(value(entity, "name")).toBe("Bluza");
    expect(value(entity, "price")).toBe("");
    expect(value(entity, "currency")).toBe("EUR");
    expect(value(entity, "availability")).toBe("");
    expect(value(entity, "imageUrl")).toBe("");
    expect(entity.facts[0]).toMatchObject({ sourceRef: images[0].postUrl, confidence: 0.79, imageRef: "photo1" });
  });
  it("preserves competing prices from individual photos and concurrent intelligence drafts with stable entity IDs", () => {
    const incoming = mergeDraft(mergeDraft(emptyDraft(), [product("10")]), [product("20")]);
    const existing = mergeDraft(emptyDraft(), [product("10")]);
    const merged = mergedReview(existing, incoming);
    expect(merged.entities).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]).toMatchObject({ entityId: existing.entities[0].id, field: "price", incoming: { value: "20" } });
    expect(mergedReview(merged, incoming).conflicts).toHaveLength(1);
    const edited = editDiscoveryDraft(merged, [{ id: existing.entities[0].id, values: { price: "20" } }], [`${existing.entities[0].id}:price`]);
    expect(value(edited.entities[0], "price")).toBe("20");
    expect(edited.conflicts).toEqual([]);
    expect(() => editDiscoveryDraft(merged, [{ id: existing.entities[0].id, values: { business_id: "victim" } }], [])).toThrow("invalid_edits");
  });
  it("reuses only the untouched starter, preserving active agents and confirmed custom rules", () => {
    const signals = signalsFor("services", ["services"]);
    const baseline = { business: { name: "Studio" }, agents: [{ id: "starter", is_active: false, instructions: basicInstructions("Studio") }] };
    const result = withSetupRecommendations(emptyDraft(), signals, baseline);
    expect(result.entities.find((e) => e.target === "agent")?.id).toBe("starter");
    const custom = withSetupRecommendations(emptyDraft(), signals, { ...baseline, agents: [{ id: "custom", is_active: false, instructions: "User's rules" }] });
    expect(custom.entities.find((e) => e.target === "agent")?.id).not.toBe("custom");
    const active = withSetupRecommendations(emptyDraft(), signals, { ...baseline, agents: [{ ...baseline.agents[0], is_active: true }] });
    expect(active.entities.some((e) => e.target === "agent")).toBe(false);
    const [agent] = parseEntities([{ target: "agent", facts: [{ field: "rules", value: "User's rules" }] }], "manual", "platform", "");
    agent.facts[0].confirmedByUser = true;
    expect(value(withSetupRecommendations({ ...emptyDraft(), entities: [agent] }, signals, baseline).entities.find((e) => e.target === "agent")!, "rules")).toBe("User's rules");
  });
  it("bounds and deduplicates image selection across history before carousel extras", () => {
    const posts = Array.from({ length: 100 }, (_, i) => ({ id: String(i), caption: "", mediaType: "IMAGE", permalink: null, imageUrl: `https://cdn.test/${i}.jpg`, images: [{ id: String(i), url: `https://cdn.test/${i}.jpg` }, { id: `${i}b`, url: `https://cdn.test/${i}b.jpg` }] }));
    const selected = selectDiscoveryImages(posts);
    expect(selected).toHaveLength(25);
    expect(new Set(selected.map((i) => i.url)).size).toBe(25);
    expect(selected.every((i) => !i.id.endsWith("b"))).toBe(true);
    expect(Number(selected.at(-1)?.id)).toBeGreaterThan(24);
    expect(selectDiscoveryImages([{ ...posts[0], images: [{ id: "bad", url: "http://cdn.test/unsafe.jpg" }] }])).toEqual([]);
  });
});
