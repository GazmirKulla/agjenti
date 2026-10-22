import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Audit-only reproductions. Real coordinator/adapter; mocked tenant DB, retrieval,
// and final model. No provider, network, database, or transport calls are possible.
const mocks = vi.hoisted(() => ({ from: vi.fn(), generate: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => [...MODULE_IDS], requireModuleAllowed: async () => {} };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/agents/generate", () => ({ generateAgentReply: mocks.generate, agentModel: () => "audit-mock" }));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: mocks.retrieve }));
import { processConversationMessage } from "@/lib/conversations/process-conversation-message";
import { processLegacyAgentTurn } from "@/lib/conversations/process-agent-turn";
import { usesSharedCoordinator } from "@/lib/conversations/coordinator-policy";
import type { ConversationStatePayload } from "@/lib/workflows/engine";

const context = { query: "Industrial pumps catalog", requirements: {}, pending: "market", turns: 0 };
const clarification = "Në cilin shtet do ta përdorni?";
const fixtures: Record<string, unknown> = {
  products: [], ai_agents: { instructions: "Answer only from verified business facts." },
  knowledge_entries: [], agent_training_memories: [], business_discovery: null,
  visual_workflows: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
  mocks.from.mockImplementation((table: string) => {
    const result = () => ({ data: fixtures[table] ?? null, error: null });
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain,
      range: () => chain, limit: () => chain, maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  });
  mocks.retrieve.mockResolvedValue({ context: structuredClone(context), clarification, documents: [], evidence: "" });
  mocks.generate.mockResolvedValue({ reply: "Tell me more about your request.", responseId: null, source: "ai", fallbackReason: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["instagram", "whatsapp"] as const)("catalog qualification reaches the shared coordinator on %s without a pilot flag", source => {
  expect(usesSharedCoordinator({ businessId: "audit-tenant", source, mode: "production" })).toBe(true);
});

it("preserves a required catalog clarification on successful model availability", async () => {
  const answer = await processLegacyAgentTurn({ businessId: "audit-tenant", message: "Industrial pumps catalog", hasPhoto: false, informational: "Answer the informational request." });
  // Retrieval has explicitly withheld documents pending a mandatory qualifier.
  // A generic generated answer must not replace that server-owned question.
  expect(answer.reply).toBe(clarification);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it.each(["instagram", "whatsapp"] as const)("retains catalog qualification context through the normal %s coordinator", async source => {
  const answer = await processConversationMessage({ businessId: "audit-tenant", source, mode: "production", message: "Industrial pumps catalog", hasPhoto: false });
  expect(answer.conversationRouting?.process).toBe("information");
  expect(answer.nextState.fields.catalog_context).toEqual(context);
});

it("passes the prior catalog query and pending market into the second live turn", async () => {
  const turn = (message: string, state?: ConversationStatePayload) => processConversationMessage({
    businessId: "audit-tenant", source: "instagram", mode: "production", message, state, hasPhoto: false,
  });
  const first = await turn("Industrial pumps catalog");
  await turn("Germany", first.nextState);
  expect(mocks.retrieve).toHaveBeenLastCalledWith("audit-tenant", "Germany", context);
});
