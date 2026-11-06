import { beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot } from "./contracts";
import { emptyState } from "@/lib/workflows/state";
import { runIsolated } from "@/lib/runtime/isolated-run";
import { tryProcessConversation } from "./conversation";

const { load, interpret } = vi.hoisted(() => ({ load: vi.fn(), interpret: vi.fn() }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: load }));
vi.mock("./interpret", () => ({ interpretCustomer: interpret }));
vi.mock("./persistence", () => ({
  commitProcessCheckpoint: async (input: { transition: { state: unknown } }) => ({ state: input.transition.state, replayed: false }),
  processExecutionStore: () => ({ claim: vi.fn(), finish: vi.fn() }),
}));
vi.mock("@/lib/capabilities/enforcement", async original => ({ ...await original<object>(), runtimeModules: async () => [] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
  return { from: () => chain };
} }));
vi.mock("@/lib/agents/business-grounding", () => ({ readBusinessGrounding: async () => ({
  knowledge: { status: "no_match", records: [] }, products: { status: "unavailable", records: [] }, services: { status: "unavailable", records: [] },
}) }));
vi.mock("./respond", () => ({ composeProcessReply: async () => ({ reply: "Information answer", targetIds: [], responseId: "reply", inputTokens: 1, outputTokens: 1 }) }));
beforeEach(() => { vi.clearAllMocks(); load.mockResolvedValue(null); });
const params = () => ({ businessId: "business", message: "Continue", hasPhoto: false, mode: "test" as const,
  state: { ...emptyState(), runtime: initialSnapshot("business", "conversation", "test") } });

it("never falls back to legacy parsing for a v4 session outside isolated execution", async () => {
  await expect(tryProcessConversation(params())).rejects.toThrow("process_transport_cutover_required");
  expect(interpret).not.toHaveBeenCalled();
});
it("never hands a v4 session to the linear preview adapter", async () => {
  const input = { ...params(), linearPreview: {} as NonNullable<Parameters<typeof tryProcessConversation>[0]["linearPreview"]> };
  await expect(runIsolated(() => tryProcessConversation(input))).rejects.toThrow("process_session_restart_required");
  expect(load).not.toHaveBeenCalled();
});
it("rejects a foreign preview before loading configuration or interpreting the message", async () => {
  const input = { ...params(), visualPreview: { businessId: "foreign" } as NonNullable<Parameters<typeof tryProcessConversation>[0]["visualPreview"]> };
  await expect(runIsolated(() => tryProcessConversation(input))).rejects.toThrow("definition_scope_mismatch");
  expect(interpret).not.toHaveBeenCalled();
});
it("keeps an unconverted live session on its existing transport during construction", async () => {
  await expect(tryProcessConversation({ ...params(), state: emptyState(), mode: "production" })).resolves.toBeNull();
  expect(load).not.toHaveBeenCalled();
});
it("handles information without a configured workflow through the new engine", async () => {
  interpret.mockResolvedValue({ observation: { revision: 0, commands: [], needsClarification: false }, model: "test", responseId: "observation", inputTokens: 1, outputTokens: 1 });
  const result = await runIsolated(() => tryProcessConversation({ ...params(), state: emptyState() }));
  expect(result?.reply).toBe("Information answer");
  expect(result?.nextState.runtime).toMatchObject({ schemaVersion: 4, revision: 1, instances: {}, offers: {} });
  expect(interpret).toHaveBeenCalledOnce();
  expect(result?.nextState.recentMessages).toHaveLength(2);
});
it("routes an authenticated live turn through checkpoint preparation without marking prompts delivered", async () => {
  interpret.mockResolvedValue({ observation: { revision: 0, commands: [], needsClarification: false }, model: "test", responseId: "observation", inputTokens: 1, outputTokens: 1 });
  const result = await tryProcessConversation({ ...params(), state: emptyState(), mode: "production",
    processTransport: { jobId: 10, leaseToken: "lease", conversationId: "conversation", revision: 0 } });
  expect(result?.nextState.runtime).toMatchObject({ mode: "live", revision: 2, conversationId: "conversation" });
  expect(result?.nextState.runtime?.pendingTurn).toBeUndefined();
  expect(result?.processCheckpoint).toMatchObject({ event: { id: "job:10:reply" }, expectedRevision: 1, targetIds: [] });
});
