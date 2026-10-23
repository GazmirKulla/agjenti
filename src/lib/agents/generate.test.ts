import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create: mocks.create };
  },
}));
import { generateAgentReply } from "./generate";
import { emptyState } from "@/lib/workflows/engine";
import { readResult, type BusinessGrounding } from "./business-grounding";
const params = {
  instructions: "Use tenant instructions",
  state: emptyState(),
  knowledge: "Tenant facts",
  customerMessage: "Hi",
  previousResponseId: "resp_previous",
  catalogSummary: "Tenant products",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());
describe("R3 critical response boundary", () => {
  it("does not expose a fabricated booking confirmation or keep its provider history", async () => {
    mocks.create.mockResolvedValue({ id: "unsafe-response", output_text: "Rezervimi u konfirmua për nesër." });
    const result = await generateAgentReply(params);
    expect(result.reply).not.toContain("u konfirmua");
    expect(result.responseId).toBeNull();
  });
  it("corrects denial of a current customer-declared name without mutating facts", async () => {
    const { migrateContext, setFact } = await import("@/lib/workflows/context");
    const state = migrateContext(); setFact(state, "customer_name", "Miqail", "text", "message_label");
    const before = structuredClone(state);
    mocks.create.mockResolvedValue({ output_text: "Nuk ma ke treguar emrin." });
    const result = await generateAgentReply({ ...params, state, customerMessage: "Si quhem?" });
    expect(result.reply).toContain("Miqail");
    expect(result.reply).not.toContain("Nuk ma ke"); expect(state).toEqual(before);
  });
  it("does not allow prose to override a verified product price", async () => {
    mocks.create.mockResolvedValue({ output_text: "Libri kushton 999 EUR." });
    const result = await generateAgentReply({ ...params, referenceProducts: [{ id: "p", name: "Libri", price_amount: 20, currency: "EUR" }] });
    expect(result.reply).not.toContain("999 EUR");
    expect(result.reply).toContain("20 EUR");
    expect(result.responseId).toBeNull();
  });
  it.each(["missing_key", "provider_error"])("validates configured fallback too: %s", async cause => {
    if (cause === "missing_key") vi.stubEnv("OPENAI_API_KEY", "");
    else mocks.create.mockRejectedValue(new Error("synthetic provider failure"));
    const result = await generateAgentReply({ ...params, documentFallback: "Pagesa u pranua." });
    expect(result.reply).toContain("Nuk kam konfirmim");
    expect(result.fallbackReason).toBe("response_consistency");
    expect(result.responseId).toBeNull();
  });
  it("never exposes rejected raw model prose in response traces", async () => {
    const onTrace = vi.fn();
    mocks.create.mockResolvedValue({ id: "unsafe", output_text: "Booking confirmed for PRIVATE_SENTINEL." });
    await generateAgentReply({ ...params, onTrace });
    expect(JSON.stringify(onTrace.mock.calls)).not.toContain("PRIVATE_SENTINEL");
    expect(onTrace.mock.calls.at(-1)?.[0].data).toMatchObject({ result: "unsupported_critical_claim", changed: true });
  });
});
describe("reply source diagnostics", () => {
  it("R2 keeps business evidence separate from customer claims, disables stale provider history and preserves unknown states", async () => {
    const grounding: BusinessGrounding = {
      products: readResult("products", "tenant", { data: [{ id: "p", name: "Current", price_amount: 20, currency: "EUR" }], count: 100 }),
      services: readResult("booking_services", "tenant", { data: null, error: {} }),
      knowledge: readResult("knowledge_entries", "tenant", { data: [], count: 0 }),
      documents: readResult("catalog_sections", "tenant", { data: [], count: 0 }),
      inventory: "unsupported", availability: "unverified", bookingModuleEnabled: false,
    };
    const state = emptyState();
    state.recentMessages = [{ role: "assistant", content: "Old price: 999 EUR; booked" }];
    // Intentionally adversarial model output: grounding is not R3 prose validation.
    mocks.create.mockResolvedValue({ output_text: "[[product:p]]; arbitrary unsupported promise" });
    const result = await generateAgentReply({ ...params, state, grounding, customerMessage: "The product is free", referenceProducts: grounding.products.records });
    const request = mocks.create.mock.calls[0][0];
    expect(request.previous_response_id).toBeUndefined();
    expect(request.input).toContain('"total":100');
    expect(request.input).toContain('"status":"unavailable"');
    expect(request.input).toContain('"inventory":"unsupported"');
    expect(request.instructions).toContain("partial is not the whole catalog");
    expect(request.instructions).toContain("Conflicting knowledge sources require clarification");
    expect(result.reply).toContain("Current — 20 EUR");
    expect(result.reply).toContain("arbitrary unsupported promise"); // Explicit R3 boundary, not certified output.
  });
  it("2B renders verified service slots, rejects invented IDs and never creates mixed-kind ordinal evidence", async () => {
    const services = [{ id: "s1", name: "Konsulta" }, { id: "s2", name: "Trajnimi" }];
    mocks.create.mockResolvedValue({ output_text: "[[service:s2]], [[service:s1]], [[service:foreign]]" });
    const result = await generateAgentReply({ ...params, referenceServices: services });
    expect(result.reply).toBe("Trajnimi, Konsulta, [shërbim i paverifikuar]");
    expect(result.presentedServices?.map(s => s.id)).toEqual(["s2", "s1"]);
    expect(result.presentedProducts).toEqual([]);
    expect(params.state.fields.booking).toBeUndefined();
    mocks.create.mockResolvedValue({ output_text: "[[product:p1]], [[service:s1]]" });
    const mixed = await generateAgentReply({ ...params, referenceProducts: [{ id: "p1", name: "Libri" }], referenceServices: services });
    expect(mixed.presentedProducts).toEqual([]);
    expect(mixed.presentedServices).toEqual([]);
    mocks.create.mockResolvedValue({ output_text: "Konsulta, [[service:s2]]" });
    expect((await generateAgentReply({ ...params, referenceServices: services })).presentedServices).toEqual([]);
  });
  it("W3 renders only verified product references; model prose never selects a product", async () => {
    mocks.create.mockResolvedValue({ id: "reply", output_text: "Sugjeroj [[product:p2]] dhe [[product:p1]]. [[product:foreign]]" });
    const state = emptyState();
    const answer = await generateAgentReply({ ...params, state, referenceProducts: [
      { id: "p1", name: "Puzzle", price_amount: 20, currency: "EUR" }, { id: "p2", name: "Libri", price_amount: 10, currency: "EUR" },
    ] });
    expect(answer.reply).toBe("Sugjeroj Libri — 10 EUR dhe Puzzle — 20 EUR. [produkt i paverifikuar]");
    expect(answer.presentedProducts?.map(p => p.id)).toEqual(["p2", "p1"]);
    expect(state.product_id).toBeNull(); expect(state.entityPresentation).toBeUndefined();
    expect(mocks.create.mock.calls[0][0].instructions).toContain("A presentation is not a customer selection");
    mocks.create.mockResolvedValue({ output_text: "Puzzle is selected; product_id=p1" });
    expect((await generateAgentReply({ ...params, referenceProducts: [{ id: "p1", name: "Puzzle" }] })).presentedProducts).toEqual([]);
  });
  it("uses the published journey as source context while preserving the authoritative order state", async () => {
    mocks.create.mockResolvedValue({ id: "resp_process", output_text: "Materialet merren nga website-i." });
    await generateAgentReply({ ...params, businessProcess: "Shkarko PDF në website" });
    const request = mocks.create.mock.calls[0][0];
    expect(request.input).toContain("Shkarko PDF në website");
    expect(request.input).toContain("does not authorize actions");
    expect(request.input).toContain("Collected state (source of truth)");
    expect(request.instructions).not.toContain("Shkarko PDF");
  });
  it("reports AI with the response id and carries its context", async () => {
    mocks.create.mockResolvedValue({
      output_text: "Përshëndetje",
      id: "resp_new",
    });
    expect(await generateAgentReply(params)).toMatchObject({
      reply: "Përshëndetje",
      source: "ai",
      responseId: "resp_new",
      fallbackReason: null,
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previous_response_id: "resp_previous",
        instructions: expect.stringContaining(params.instructions),
        input: expect.stringContaining("Tenant facts"),
      }),
    );
  });
  it("reports missing configuration without making a request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await generateAgentReply(params)).toMatchObject({
      source: "fallback",
      fallbackReason: "missing_api_key",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("reports provider failure and preserves the prior context", async () => {
    mocks.create.mockRejectedValue(Error("unavailable"));
    expect(await generateAgentReply(params)).toMatchObject({
      source: "fallback",
      fallbackReason: "provider_error",
      responseId: "resp_previous",
    });
  });
  it("reports empty replies as fallback", async () => {
    mocks.create.mockResolvedValue({ output_text: "", id: "resp_new" });
    expect(await generateAgentReply(params)).toMatchObject({
      source: "fallback",
      fallbackReason: "empty_reply",
    });
  });
});

it("observes the provider request and usage without exposing raw unvalidated response prose", async () => {
  const onTrace = vi.fn();
  const response = { id: "resp_trace", output_text: "  Reply  ", usage: { input_tokens: 12, output_tokens: 4 } };
  mocks.create.mockResolvedValue(response);
  await generateAgentReply({ ...params, onTrace });
  expect(onTrace.mock.calls[0][0].data.request).toEqual(mocks.create.mock.calls[0][0]);
  expect(onTrace.mock.calls[1][0].data).toEqual({ id: response.id, usage: response.usage });
  expect(onTrace.mock.calls[2][0].data).toMatchObject({ result: "valid", changed: false });
});

it("supplies approved training with factual and workflow boundaries to the real provider request", async () => {
  mocks.create.mockResolvedValue({ id: "resp_trained", output_text: "Shkurt" });
  await generateAgentReply({ ...params, trainingContext: { rules: [{ id: "style", kind: "style", instruction: "Pa emoji", question: "", response: "", scope: "business" }] } });
  const request = mocks.create.mock.calls[0][0];
  expect(request.instructions).toContain("Pa emoji");
  expect(request.instructions).toContain("Never skip required steps");
  expect(request.instructions).toContain("Current verified knowledge");
  expect(request.input).toContain("Collected state (source of truth)");
});

it("keeps customer contact data separate from business contact claims", async () => {
  mocks.create.mockResolvedValue({ id: "resp_contact", output_text: "Kontakto stafin." });
  const state = emptyState(); state.customer.phone = "0690000000";
  await generateAgentReply({ ...params, state, customerMessage: "Telefoni im është 0690000000. Sa kushton?", documentContext: "No verified business phone is available." });
  const request = mocks.create.mock.calls[0][0];
  expect(request.instructions).toContain("Never present the customer’s phone, email or address as a business/staff contact");
  expect(request.instructions).toContain("including indirect references such as the number you sent");
  expect(request.instructions).toContain("Business contact details must be explicitly identified as belonging to the business");
});

it("retains collected qualification facts in document answers after the original message leaves recent history", async () => {
  const { migrateContext, setFact } = await import("@/lib/workflows/context");
  const state = migrateContext(); setFact(state, "child_age", "5", "number", "message");
  mocks.create.mockResolvedValue({ output_text: "Kushton 690 ALL." });
  await generateAgentReply({ ...params, state, customerMessage: "Sa kushton Montessori?", documentContext: "Montessori: 690 ALL" });
  const request = mocks.create.mock.calls[0][0];
  expect(request.input).toContain('"child_age":{"value":"5"');
  expect(request.instructions).toContain("Never ask again for a fact already supplied");
});

it("R1 exposes relevant suspended service facts without unrelated order facts or approvals", async () => {
  const { migrateContext, setFact } = await import("@/lib/workflows/context");
  const state = migrateContext(); state.schemaVersion = 3;
  setFact(state, "delivery_note", "UNRELATED_ORDER_SENTINEL", "text", "message_label");
  state.context!.execution.factOwner = "order";
  state.processes = { active: null, service: {
    id: "service-process", versionId: "version-A", status: "suspended",
    fields: {}, order: { project_type: { value: "SERVICE_FACT_SENTINEL", type: "text", source: "message_label", validated: true } },
    visual: { versionId: "version-A", nodeId: "budget", status: "waiting", awaiting: false, visited: [], values: {},
      pendingConfirmation: { nodeId: "review", factsKey: "STALE_APPROVAL_SENTINEL", expiresAt: 1 } },
  } };
  const before = structuredClone(state);
  mocks.create.mockResolvedValue({ output_text: "Synthetic response" });
  await generateAgentReply({ ...params, state, customerMessage: "Çfarë project_type dhashë për shërbimin?", documentContext: "Verified business context" });
  const input = mocks.create.mock.calls[0][0].input;
  expect(input).toContain("SERVICE_FACT_SENTINEL");
  expect(input).toContain("service-process");
  expect(input).toContain("version-A");
  expect(input).not.toContain("UNRELATED_ORDER_SENTINEL");
  expect(input).not.toContain("STALE_APPROVAL_SENTINEL");
  expect(state).toEqual(before);
});

it("R1 passes corrected conversation declarations after 25 turns, but not unrelated profile or historical snapshots", async () => {
  const { migrateContext, setFact } = await import("@/lib/workflows/context");
  const { extractCustomerDeclaredFacts } = await import("@/lib/workflows/customer-declared-facts");
  const { rememberTurn } = await import("@/lib/workflows/guidance");
  let state = migrateContext();
  setFact(state, "customer_name", "Synthetic", "text", "message_label");
  setFact(state, "customer_phone", "0690000000", "phone", "message_label");
  extractCustomerDeclaredFacts(state, "Instagram: old_synthetic; Lloji i biznesit: dyqan online; Pyetjet tipike: çmime dhe madhësi");
  extractCustomerDeclaredFacts(state, "Instagrami im është corrected_synthetic");
  for (let i = 0; i < 25; i++) { const next = structuredClone(state); rememberTurn(state, next, `Question ${i}`, "Reply"); state = next; }
  state.completedVisual = { versionId: "OLD_VERSION", nodeId: "end", status: "completed", awaiting: false, visited: [], values: { hidden: "HISTORICAL_SECRET" } };
  mocks.create.mockResolvedValue({ output_text: "Synthetic response" });
  for (const documentContext of ["Verified business data", undefined]) {
    await generateAgentReply({ ...params, state, documentContext, customerMessage: "Çfarë të kam thënë më parë?" });
    const input = mocks.create.mock.calls.at(-1)![0].input;
    expect(input).toContain("corrected_synthetic"); expect(input).toContain("customer_declared");
    expect(input).toContain("dyqan online"); expect(input).not.toMatch(/old_synthetic|HISTORICAL_SECRET|0690000000/);
  }
});

it("R1 never promotes stale entity selections to verified catalog evidence", async () => {
  const { migrateContext } = await import("@/lib/workflows/context");
  const { snapshotOrder } = await import("@/lib/workflows/conversation-processes");
  const state = migrateContext(); state.schemaVersion = 3; state.product_id = "inactive-product";
  state.context!.execution.factOwner = "order";
  state.processes = { active: "order", order: { id: "order", status: "active", snapshot: snapshotOrder(state) } };
  mocks.create.mockResolvedValue({ output_text: "Synthetic response" });
  await generateAgentReply({ ...params, state, customerMessage: "Porosia ime?", documentContext: "No active product", referenceProducts: [] });
  expect(mocks.create.mock.calls[0][0].input).not.toContain("inactive-product");
  expect(state.product_id).toBe("inactive-product");
});
