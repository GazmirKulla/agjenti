import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: m.create }; } }));
import { normalizeSource } from "./normalization";
afterEach(() => vi.unstubAllEnvs());
describe("multimodal source normalization", () => {
  it("retains independent knowledge topics with grounded authored titles, not only literal FAQs", async () => {
    const passages = ["Fletë pune edukative për fëmijë", "Për moshat 3–6 vjeç", "Mësojnë pa ekran dhe zhvillojnë logjikën", "Printoji dhe përdori në shtëpi"];
    m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ entities: passages.map((text, i) => ({ target: "knowledge", facts: [{ field: "title", value: ["Oferta", "Mosha", "Përfitimet", "Përdorimi"][i], evidence: text }, { field: "body", value: text, evidence: text }] })) }) });
    const result = await normalizeSource(passages.join("\n"), "instagram", "ig:studio", "knowledge", [], "onboarding");
    expect(result).toHaveLength(4);
    expect(result.every(entity => entity.facts.every(fact => fact.value))).toBe(true);
    expect(m.create.mock.calls.at(-1)![0].instructions).toContain("rather than collapsing everything into one");
  });
  it("uses a context-only schema and rejects accidental product/service extraction during onboarding", async () => {
    m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ entities: [
      { target: "product", facts: [{ field: "name", value: "Monday announcement", evidence: "Monday announcement" }] },
      { target: "service", facts: [{ field: "name", value: "Service", evidence: "Service" }] },
      { target: "profile", facts: [{ field: "description", value: "Dental clinic", evidence: "Dental clinic" }] },
    ] }) });
    const result = await normalizeSource("Monday announcement. Service. Dental clinic", "instagram", "ig:1", "profile", [], "onboarding");
    expect(result.map(entity => entity.target)).toEqual(["profile"]);
    const args = m.create.mock.calls.at(-1)![0];
    expect(args.text.format.schema.properties.entities.items.properties.target.enum).toEqual(["profile", "knowledge"]);
    expect(args.instructions).toContain("Omit temporary discounts");
  });
  it("treats announcements without durable facts as a successful empty result", async () => {
    m.create.mockResolvedValue({ status: "completed", output_text: '{"entities":[]}' });
    expect(await normalizeSource("Our website is live! Happy Monday!", "instagram", "ig:1", "profile", [], "onboarding")).toEqual([]);
  });
  it("sends actual image inputs and parses photo evidence with the configured vision model", async () => {
    vi.stubEnv("BUSINESS_VISION_MODEL", "configured-vision-model");
    m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ entities: [{ target: "product", facts: [{ field: "name", value: "Shirt", evidence: "A shirt is visible", evidenceKind: "visual", imageRef: "image1", confidence: 0.9 }] }] }) });
    const result = await normalizeSource("A caption", "instagram", "ig:1", "profile", [{ id: "image1", url: "https://cdn.test/a.jpg" }]);
    const args = m.create.mock.calls.at(-1)![0];
    expect(args.model).toBe("configured-vision-model");
    expect(args.input[0].content).toContainEqual({ type: "input_image", image_url: "https://cdn.test/a.jpg", detail: "auto" });
    expect(result[0].facts[0]).toMatchObject({ value: "Shirt", imageRef: "image1", evidenceKind: "visual", confidence: 0.79 });
  });
});
