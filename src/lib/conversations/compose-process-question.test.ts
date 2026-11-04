import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), from: vi.fn(), memories: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create }; } }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/agents/training/load", () => ({ loadActiveTrainingMemories: mocks.memories }));
import { composeProcessQuestion } from "./compose-process-question";
import { emptyState } from "@/lib/workflows/engine";
import { defaultCommunicationPolicy } from "@/lib/agents/communication-policy";
import type { AgentTurnParams } from "./process-agent-turn";
const params: AgentTurnParams = { businessId: "tenant-a", message: "not an email", hasPhoto: false, mode: "test", state: emptyState() };
const question = { kind: "collect" as const, field: "owner_email", label: "Owner email", format: "email" as const, guidance: "Which email should receive the invitation?", invalid: true };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "synthetic"); mocks.memories.mockResolvedValue([]);
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: { id: "agent-a", instructions: "Be helpful", communication: { ...defaultCommunicationPolicy, language: "en" }, configuration_revision: 2 }, error: null })) };
  mocks.from.mockReturnValue(query);
});
afterEach(() => vi.unstubAllEnvs());
it("phrases only the selected question without changing the cursor, fields or confirmation", async () => {
  mocks.create.mockResolvedValue({ output_text: JSON.stringify({ field: "owner_email", text: "Which email can we use for your invitation?" }) });
  const before = structuredClone(params);
  expect(await composeProcessQuestion(params, question)).toMatchObject({ source: "ai", reply: "Which email can we use for your invitation?" });
  expect(params).toEqual(before);
  expect(mocks.from).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0].text.format.schema.properties.field.enum).toEqual(["owner_email"]);
});
it.each([
  { field: "password", text: "Your password?" },
  { field: "owner_email", text: "Email? Phone?" },
  { field: "owner_email", text: "Email?", action: "business.provision" },
  { field: "owner_email", text: "Open https://evil.test?" },
  { field: "owner_email", text: "Your business was created." },
])("falls back without effects for rejected output %j", async value => {
  mocks.create.mockResolvedValue({ output_text: JSON.stringify(value) });
  expect(await composeProcessQuestion(params, question)).toEqual({ source: "fallback", reason: "invalid_communication_contract", configured: true, reply: "Which email should receive the invitation? Please provide a valid email address." });
});
it("retains the configured fallback language when the provider fails", async () => {
  mocks.create.mockRejectedValue(Error("unavailable"));
  expect(await composeProcessQuestion(params, question)).toMatchObject({ source: "fallback", reason: "process_communication_unavailable", reply: expect.stringContaining("valid email") });
});
it.each(["production", "test"] as const)("rejects foreign draft configuration in %s even without a provider key", async mode => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const configurationPreview = { businessId: "other", agentId: "a", name: "a", instructions: "x", communication: defaultCommunicationPolicy, revision: 1, updatedAt: "x" };
  await expect(composeProcessQuestion({ ...params, mode, configurationPreview }, question)).rejects.toThrow("invalid_configuration_preview");
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
