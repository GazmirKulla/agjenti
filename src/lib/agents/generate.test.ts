import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create: mocks.create };
  },
}));
import { generateAgentReply } from "./generate";
import { emptyState } from "@/lib/workflows/engine";
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
describe("reply source diagnostics", () => {
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

it("observes the exact provider request and response only when explicitly opted in", async () => {
  const onTrace = vi.fn();
  const response = { id: "resp_trace", output_text: "  Reply  ", usage: { input_tokens: 12, output_tokens: 4 } };
  mocks.create.mockResolvedValue(response);
  await generateAgentReply({ ...params, onTrace });
  expect(onTrace.mock.calls[0][0].data.request).toEqual(mocks.create.mock.calls[0][0]);
  expect(onTrace.mock.calls[1][0].data).toEqual({ response, parsed: { text: "Reply" }, usage: response.usage });
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
