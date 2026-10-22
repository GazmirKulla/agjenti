import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ modules: ["services"] as string[], from: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/dashboard/modules/entitlements", () => ({ loadAllowedModules: async () => mocks.modules }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/agents/generate", () => ({ generateAgentReply: mocks.generate, agentModel: () => "audit-mock" }));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: async () => null }));
import { processLegacyAgentTurn } from "@/lib/conversations/process-agent-turn";
import { canEnableModule } from "@/lib/dashboard/modules/dependencies";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
  mocks.modules = ["services"];
  const fixtures: Record<string, unknown> = {
    ai_agents: { instructions: "Answer from verified service information." },
    // This is exactly where sync_service_knowledge writes the active service.
    knowledge_entries: [{ title: "Dental cleaning", body: "Çmimi: 50 EUR", intent_key: "service" },
      { title: "Knowledge-only policy", body: "PRIVATE_KNOWLEDGE_FACT", intent_key: "general" }],
    agent_training_memories: [], business_discovery: null,
  };
  mocks.from.mockImplementation((table: string) => {
    const result = () => ({ data: fixtures[table] ?? [], error: null });
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return chain;
  });
  mocks.generate.mockResolvedValue({ reply: "Service response", responseId: null, source: "ai", fallbackReason: null });
});
afterEach(() => vi.unstubAllEnvs());

it("allows enabling services independently of the knowledge module", () => {
  expect(canEnableModule("services", new Set(["services"]))).toEqual({ ok: true });
});

it("provides an enabled service's canonical price without requiring the separate knowledge module", async () => {
  await processLegacyAgentTurn({ businessId: "audit-tenant", message: "How much is Dental cleaning?", hasPhoto: false, informational: "Answer from verified business facts." });
  expect(mocks.generate.mock.calls[0][0].documentContext).toContain("Dental cleaning: Çmimi: 50 EUR");
  expect(mocks.generate.mock.calls[0][0].documentContext).not.toContain("PRIVATE_KNOWLEDGE_FACT");
});

it("includes the same canonical service facts when knowledge is also enabled", async () => {
  mocks.modules = ["services", "knowledge"];
  await processLegacyAgentTurn({ businessId: "audit-tenant", message: "How much is Dental cleaning?", hasPhoto: false, informational: "Answer from verified business facts." });
  expect(mocks.generate.mock.calls[0][0].documentContext).toContain("Dental cleaning: Çmimi: 50 EUR");
});

it("does not expose service facts when only knowledge is allowed", async () => {
  mocks.modules = ["knowledge"];
  await processLegacyAgentTurn({ businessId: "audit-tenant", message: "Dental cleaning and policy?", hasPhoto: false, informational: "Information only." });
  expect(mocks.generate.mock.calls[0][0].documentContext).not.toContain("50 EUR");
  expect(mocks.generate.mock.calls[0][0].documentContext).toContain("PRIVATE_KNOWLEDGE_FACT");
});
