import { beforeEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { responses = { create: provider }; } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test-model" }));
import { interpretProcessOffer } from "./interpret-process-offer";
const context = { message: "Procediamo con la registrazione", offer: { flowId: "registration", prompt: "Vuoi iniziare?" }, history: [] };
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", "unit-test-only"); provider.mockReset(); });
it("sends context to the semantic interpreter and accepts its validated reference", async () => {
  provider.mockResolvedValue({ output_text: JSON.stringify({ relation: "accept", flowId: "registration", evidence: context.message }) });
  expect(await interpretProcessOffer(context)).toEqual({ relation: "accept", flowId: "registration", evidence: context.message });
  expect(JSON.parse(provider.mock.calls[0][0].input)).toEqual(context);
  expect(provider.mock.calls[0][0].store).toBe(false);
});
it.each([
  { relation: "accept", flowId: "other-business-flow", evidence: context.message },
  { relation: "accept", flowId: "registration", evidence: "invented evidence" },
  { relation: "accept", flowId: "registration", evidence: "" },
  { relation: "execute", flowId: "registration", evidence: context.message },
  { relation: "accept", flowId: "registration", evidence: context.message, execute: true },
])("rejects invalid evidence/authority: %j", async value => {
  provider.mockResolvedValue({ output_text: JSON.stringify(value) });
  expect(await interpretProcessOffer(context)).toBeNull();
});
it("fails closed on provider failure even for a familiar affirmative", async () => {
  provider.mockRejectedValue(new Error("unavailable"));
  expect(await interpretProcessOffer({ ...context, message: "po" })).toBeNull();
});
it("does not substitute lexical interpretation when no model is configured", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(await interpretProcessOffer({ ...context, message: "yes" })).toBeNull();
  expect(provider).not.toHaveBeenCalled();
});
