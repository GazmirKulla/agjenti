import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class {
        responses = { create: m.create };
    } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
import { extractMessageFacts, profileExtractionFields } from "./extract-facts";
import { migrateContext } from "./context";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "test-only"); });
it("accepts grounded extraction while rejecting hallucinations, unknown keys and invalid values", async () => {
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [{ key: "customer_name", value: "Ana", evidence: "Unë jam Ana", confidence: 0.99 }, { key: "customer_phone", value: "nuk e di", evidence: "nuk e di", confidence: 1 }, { key: "customer_address", value: "Tirana", evidence: "Tirana", confidence: 1 }, { key: "constructor", value: "Ana", evidence: "Ana", confidence: 1 }] }) });
    const s = migrateContext();
    expect(await extractMessageFacts(s, "Unë jam Ana, telefonin nuk e di", profileExtractionFields)).toBe(1);
    expect(s.customer.name).toBe("Ana");
    expect(s.customer.phone).toBeNull();
    expect(s.customer.address).toBeNull();
});
it("keeps known state if extraction fails and does not interpret a question as a value", async () => {
    m.create.mockRejectedValue(new Error("offline"));
    const s = migrateContext();
    expect(await extractMessageFacts(s, "Unë jam Ana", profileExtractionFields)).toBe(0);
    expect(await extractMessageFacts(s, "Cili është telefoni?", profileExtractionFields)).toBe(0);
    expect(m.create).toHaveBeenCalledTimes(1);
});
