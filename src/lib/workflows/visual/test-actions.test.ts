import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnParams } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "../engine";

const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), process: vi.fn(), send: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/conversations/process-agent-turn", () => ({ processAgentTurn: m.process }));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: m.send }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: m.db }));
import { simulateVisualWorkflow } from "./test-actions";
import { starterVisualGraph } from "./model";
import { readTestSession } from "@/lib/agents/test-chat/session";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  m.user.mockResolvedValue({ id: "user-a" });
  m.access.mockResolvedValue({ business: { id: "business-a" } });
  m.db.mockImplementation(() => { throw new Error("Unexpected persistence during simulation"); });
  m.process.mockImplementation(async (p: AgentTurnParams) => ({
    reply: "Cilin produkt?", previousResponseId: "response-1", workflowId: null, productName: null, workflowProgress: [], debug: {},
    nextState: { ...emptyState(), visual: { versionId: p.visualPreview!.id, nodeId: "product", status: "waiting", awaiting: true, visited: ["start", "product"], values: {} } },
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("visual workflow preview sessions", () => {
  it("requires authorization before AI, token processing or writes", async () => {
    m.user.mockResolvedValueOnce(null);
    expect(await simulateVisualWorkflow("studio", starterVisualGraph(), "Hi")).toHaveProperty("error");
    expect(m.access).not.toHaveBeenCalled();
    m.access.mockResolvedValueOnce(null);
    expect(await simulateVisualWorkflow("studio", starterVisualGraph(), "Hi", "malformed")).toHaveProperty("error");
    expect(m.process).not.toHaveBeenCalled();
    expect(m.db).not.toHaveBeenCalled();
  });
  it("runs only test mode with a hashed graph and a user/tenant-bound encrypted session", async () => {
    const graph = starterVisualGraph();
    const result = await simulateVisualWorkflow("studio", graph, "  Dua të porosis  ");
    expect(result.error).toBeUndefined();
    expect(m.process).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business-a", mode: "test", message: "Dua të porosis", visualPreview: expect.objectContaining({ businessId: "business-a", id: expect.stringMatching(/^preview:[a-f0-9]{64}$/), graph }) }));
    expect(readTestSession(result.session!, "user-a", "business-a")).toMatchObject({ turns: 1, previousResponseId: "response-1", state: result.turn!.nextState });
    expect(m.send).not.toHaveBeenCalled();
    expect(m.db).not.toHaveBeenCalled();
  });
  it("resumes the same graph from sealed state and previous AI response", async () => {
    const graph = starterVisualGraph();
    const first = await simulateVisualWorkflow("studio", graph, "Dua të porosis");
    await simulateVisualWorkflow("studio", graph, "Produkt A", first.session);
    expect(m.process.mock.calls[1][0]).toMatchObject({ state: first.turn!.nextState, previousResponseId: "response-1", visualPreview: { id: m.process.mock.calls[0][0].visualPreview.id } });
  });
  it("rejects a changed graph until the preview is restarted", async () => {
    const graph = starterVisualGraph();
    const first = await simulateVisualWorkflow("studio", graph, "Dua të porosis");
    graph.nodes.find(n => n.kind === "knowledge")!.config.prompt = "Përgjigju shkurt.";
    m.process.mockClear();
    expect((await simulateVisualWorkflow("studio", graph, "Hi", first.session)).error).toContain("Rrjedha ndryshoi");
    expect(m.process).not.toHaveBeenCalled();
    expect(await simulateVisualWorkflow("studio", graph, "Hi", null)).toHaveProperty("turn");
  });
  it("rejects preview session replay by another user or business", async () => {
    const first = await simulateVisualWorkflow("studio", starterVisualGraph(), "Hi");
    m.process.mockClear();
    m.access.mockResolvedValueOnce({ business: { id: "business-b" } });
    expect(await simulateVisualWorkflow("other", starterVisualGraph(), "Hi", first.session)).toHaveProperty("error");
    m.user.mockResolvedValueOnce({ id: "user-b" });
    expect(await simulateVisualWorkflow("studio", starterVisualGraph(), "Hi", first.session)).toHaveProperty("error");
    expect(m.process).not.toHaveBeenCalled();
  });
  it("rejects unfinished graphs, oversized inputs and unavailable encryption before AI", async () => {
    expect(await simulateVisualWorkflow("studio", { ...starterVisualGraph(), edges: [] }, "Hi")).toHaveProperty("error");
    expect(await simulateVisualWorkflow("studio", starterVisualGraph(), "x".repeat(2001))).toHaveProperty("error");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect((await simulateVisualWorkflow("studio", starterVisualGraph(), "Hi")).error).toContain("çelësin");
    expect(m.process).not.toHaveBeenCalled();
  });
});
