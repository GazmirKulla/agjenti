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
        instructions: params.instructions,
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
