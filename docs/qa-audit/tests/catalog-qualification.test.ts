import { beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "@/lib/workflows/state";
import { runIsolated } from "@/lib/runtime/isolated-run";
const m = vi.hoisted(() => ({ retrieve: vi.fn(), compose: vi.fn(), interpret: vi.fn() }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: async () => null }));
vi.mock("@/lib/orchestration/version-store", async original => ({ ...await original<object>(), loadCurrentLinearVersions: async () => [] }));
vi.mock("@/lib/orchestration/interpret", () => ({ interpretCustomer: m.interpret }));
vi.mock("@/lib/orchestration/respond", () => ({ composeProcessReply: m.compose }));
vi.mock("@/lib/orchestration/training-context", () => ({ processTrainingContext: async () => ({ rules: [] }) }));
vi.mock("@/lib/capabilities/enforcement", async original => ({ ...await original<object>(), runtimeModules: async () => [] }));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: m.retrieve }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => {
 const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
 return { from: () => chain };
} }));
vi.mock("@/lib/agents/business-grounding", () => ({ readBusinessGrounding: async () => ({
 knowledge: { status: "no_match", records: [] }, products: { status: "unavailable", records: [] }, services: { status: "unavailable", records: [] },
}) }));
import { processConversation } from "@/lib/orchestration/conversation";
const context = { query: "Industrial pumps catalog", requirements: {}, pending: "market", turns: 0 };
const clarification = "Në cilin shtet do ta përdorni?";
beforeEach(() => {
 vi.clearAllMocks();
 m.interpret.mockImplementation(async ({ state }: { state: { revision: number } }) => ({ observation: { revision: state.revision, commands: [], needsClarification: false }, model: "test", inputTokens: 1, outputTokens: 1 }));
 m.retrieve.mockResolvedValue({ context: structuredClone(context), clarification, documents: [], evidence: "" });
 m.compose.mockResolvedValue({ reply: clarification, targetIds: [], responseId: "reply", inputTokens: 1, outputTokens: 1 });
});
it("passes withheld documents and the required qualifier to the native composer, retaining context for the next turn", async () => {
 const first = await runIsolated(() => processConversation({ businessId: "audit-tenant", message: "Industrial pumps catalog", hasPhoto: false, mode: "test", state: emptyState() }));
 expect(m.compose).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ documents: { records: [], evidence: "", clarification } }) }));
 expect(first.nextState.runtime?.retrieval).toEqual(context);
 await runIsolated(() => processConversation({ businessId: "audit-tenant", message: "Germany", hasPhoto: false, mode: "test", state: first.nextState }));
 expect(m.retrieve).toHaveBeenLastCalledWith("audit-tenant", "Germany", context, expect.any(Function), undefined, expect.objectContaining({ semanticRouting: true }));
});
