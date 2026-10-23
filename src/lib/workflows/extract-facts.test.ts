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

it("extracts a configured dependent fact supplied inside a recommendation question", async () => {
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [{ key: "child_age", value: "5", evidence: "moshen 5 vjec", confidence: 0.99 }] }) });
    const state = migrateContext();
    expect(await extractMessageFacts(state, "cilin me sugjeroni per moshen 5 vjec?", [{ key: "child_age", type: "number", label: "Sa vjeç është fëmija?" }], { questionFacts: true })).toBe(1);
    expect(state.context?.order.child_age.value).toBe("5");
    expect(state.customer).toEqual(migrateContext().customer);
});

it("does not store an invented age for a question asking its unknown value", async () => {
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [{ key: "child_age", value: "5", evidence: "5 vjec", confidence: 1 }] }) });
    const state = migrateContext();
    expect(await extractMessageFacts(state, "Per cfare moshe eshte libri?", [{ key: "child_age", type: "number" }], { questionFacts: true })).toBe(0);
    expect(state.context?.order.child_age).toBeUndefined();
});

it.each([
    ["quantity", "I need 4", "4"],
    ["quantity", "Actually make it 5", "5"],
    ["budget", "My budget is 1500.50", "1500.50"],
])("grounds natural-language %s in the actual message, not an invented normalized value", async (key, message, value) => {
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [{ key, value, evidence: message, confidence: 0.99 }] }) });
    const state = migrateContext();
    expect(await extractMessageFacts(state, message, [{ key, type: "number" }])).toBe(1);
    expect(state.context?.order[key].value).toBe(value);
    expect(state.context?.profile).toEqual({});
});

it("does not assume that spelling a number supplies a schema-valid grounded numeral", async () => {
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [{ key: "quantity", value: "4", evidence: "four", confidence: 1 }] }) });
    const state = migrateContext();
    expect(await extractMessageFacts(state, "four", [{ key: "quantity", type: "number" }])).toBe(0);
    expect(state.context?.order.quantity).toBeUndefined();
});
it("preserves the existing configured multiline text contract, rather than imposing onboarding constraints", async () => {
    const state = migrateContext(), value = "Landing page\nOnline catalog";
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [{ key: "project_description", value, evidence: value, confidence: 1 }] }) });
    expect(await extractMessageFacts(state, value, [{ key: "project_description", type: "text" }])).toBe(1);
    expect(state.context?.order.project_description?.value).toBe(value);
});

it.each([
    { owner: "order" as const, key: "size", type: "text" as const, value: "M", options: ["S", "M"] },
    { owner: "service" as const, key: "project_type", type: "text" as const, value: "Website" },
    { owner: "service" as const, key: "budget", type: "number" as const, value: "1500" },
    { owner: "auxiliary" as const, key: "preferred_date", type: "text" as const, value: "2026-11-02" },
    { owner: "auxiliary" as const, key: "equipment_count", type: "number" as const, value: "8" },
])("server-scoped $key candidates reuse state v3 without authorizing arbitrary keys", async ({ owner, key, type, value, options }) => {
    const state = migrateContext(); state.schemaVersion = 3;
    state.context!.execution.factOwner = owner;
    const message = `Deklarimi: ${value}`;
    m.create.mockResolvedValue({ output_text: JSON.stringify({ facts: [
        { key, value, evidence: message, confidence: 1 },
        { key: "unauthorized_business_setting", value, evidence: message, confidence: 1 },
    ] }) });
    expect(await extractMessageFacts(state, message, [{ key, type, options }])).toBe(1);
    expect(state.context?.order).toEqual({ [key]: { value, type, source: `message:${message}`, validated: true } });
    expect(state.context?.execution.factOwner).toBe(owner);
    expect(state.context?.profile).toEqual({});
    expect(state.customerDeclaredFacts).toBeUndefined();
    expect(migrateContext(JSON.parse(JSON.stringify(state))).context).toEqual(state.context);
});
