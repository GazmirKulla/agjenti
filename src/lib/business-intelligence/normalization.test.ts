import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: m.create }; } }));
import { normalizeSource } from "./normalization";
afterEach(() => vi.unstubAllEnvs());
describe("multimodal source normalization", () => {
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
