import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnParams, AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "@/lib/workflows/engine";
import type { VisualGraph, VisualNode, VisualRunState, VisualVersion } from "@/lib/workflows/visual/types";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), extract: vi.fn(), entity: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => [...MODULE_IDS] };
});
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: mocks.profile }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: mocks.load }));
vi.mock("@/lib/workflows/visual/entity-routing", async original => ({ ...await original<object>(), resolveVisualEntity: mocks.entity }));
vi.mock("@/lib/workflows/extract-facts", async original => ({ ...await original<object>(), extractMessageFacts: mocks.extract }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "audit-model" }));
import { executeVisualTurn } from "@/lib/workflows/visual/execute";

const node = (id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode => ({ id, kind, label: id, position: { x: 0, y: 0 }, config });
function linear(...steps: VisualNode[]): VisualGraph {
  const nodes = [node("start", "start"), ...steps, node("end", "end")];
  return { version: 1, name: "audit", nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `e${i}`, source: n.id, target: nodes[i + 1].id, port: "next" as const })) };
}
const version = (graph: VisualGraph, id = "audit-version"): VisualVersion => ({ id, businessId: "audit-business", graph, createdAt: "2026-10-15T00:00:00Z" });
const waiting = (nodeId: string, versionId = "audit-version"): VisualRunState => ({ versionId, nodeId, status: "waiting", visited: ["start", nodeId], values: {}, awaiting: true });
const response = (p: AgentTurnParams, reply = "Knowledge reply"): AgentTurnResult => ({ reply, nextState: structuredClone(p.state ?? emptyState()), previousResponseId: null, workflowId: null, productName: null, workflowProgress: [], debug: { model: "audit-model", source: "ai", fallbackReason: null, agentConfigured: true, knowledgeCount: 1, productCount: 0, workflowSteps: [], elapsedMs: 0 } });
const params = (graph: VisualGraph, message: string, state?: ReturnType<typeof emptyState>): AgentTurnParams => ({ businessId: "audit-business", mode: "test", message, hasPhoto: false, state, visualPreview: version(graph) });

beforeEach(() => { vi.clearAllMocks(); mocks.profile.mockResolvedValue({ enabledModules: ["workflows", "products", "bookings", "services", "knowledge"] }); mocks.extract.mockResolvedValue(0); mocks.entity.mockResolvedValue({}); mocks.load.mockResolvedValue(null); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("audit orchestration: executeVisualTurn with synthetic retail/quote graphs", () => {
  it("retail persists cursor and declared size/quantity across real orchestration turns", async () => {
    const g = linear(node("size", "collect", { fieldKey: "size", fieldType: "text", prompt: "Size?" }), node("quantity", "collect", { fieldKey: "quantity", fieldType: "number", prompt: "Quantity?" }));
    const legacy = vi.fn(async (p: AgentTurnParams) => response(p));
    const first = await executeVisualTurn(params(g, "start"), legacy);
    expect(first.nextState.visual).toMatchObject({ nodeId: "size", awaiting: true, values: {} });
    const second = await executeVisualTurn(params(g, "M", first.nextState), legacy);
    expect(second.nextState.visual).toMatchObject({ nodeId: "quantity", values: { size: "M" }, awaiting: true });
    const third = await executeVisualTurn(params(g, "2", second.nextState), legacy);
    expect(third.nextState.visual?.values).toEqual({ size: "M", quantity: "2" });
    expect(third.nextState.visual?.status).toBe("completed");
    expect(third.nextState.visual?.values).not.toHaveProperty("child_age");
  });

  it("invalid numeric input stays pending and an informational interruption does not consume the field", async () => {
    const g = linear(node("budget", "collect", { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }));
    const legacy = vi.fn(async (p: AgentTurnParams) => response(p, "Informational answer"));
    const first = await executeVisualTurn(params(g, "start"), legacy);
    const invalid = await executeVisualTurn(params(g, "unknown", first.nextState), legacy);
    expect(invalid.nextState.visual).toMatchObject({ nodeId: "budget", values: {} });
    const interrupted = await executeVisualTurn({ ...params(g, "Sa kushton?", invalid.nextState), informationRequest: true }, legacy);
    expect(interrupted.nextState.visual).toMatchObject({ nodeId: "budget", values: {} });
    const resumed = await executeVisualTurn(params(g, "12000", interrupted.nextState), legacy);
    expect(resumed.nextState.visual?.values).toEqual({ budget: "12000" });
    expect(resumed.nextState.visual?.status).toBe("completed");
  });

  it("fails closed before an action executor when the required module is off", async () => {
    vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "audit-business");
    mocks.profile.mockResolvedValue({ enabledModules: ["knowledge"] });
    const g = linear(node("product", "product"));
    mocks.load.mockResolvedValue(version(g, "audit-old"));
    const state = { ...emptyState(), visual: waiting("product", "audit-old") };
    const legacy = vi.fn(async (p: AgentTurnParams) => response(p));
    await expect(executeVisualTurn({ ...params(g, "Dua produkt", state), mode: "production", visualPreview: undefined, orderRequest: true }, legacy)).rejects.toMatchObject({ code: "module_disabled" });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("rejects missing graph configuration before orchestration", async () => {
    const invalid = { version: 1, name: "", nodes: [], edges: [] } as unknown as VisualGraph;
    await expect(executeVisualTurn(params(invalid, "hello"), async p => response(p))).rejects.toThrow("invalid_visual_workflow");
  });
});
