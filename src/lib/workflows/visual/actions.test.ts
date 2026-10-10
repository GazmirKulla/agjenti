import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), rpc: vi.fn(), load: vi.fn(), version: vi.fn(), readiness: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("./store", () => ({ loadVisualWorkspace: m.load, loadVisualVersion: m.version }));
vi.mock("../readiness", () => ({ loadWorkflowReadiness: m.readiness }));
import { publishVisualWorkflow, saveVisualWorkflow, setVisualWorkflowEnabled } from "./actions";
import { starterVisualGraph, upgradeVisualGraph } from "./model";

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "user-a" });
  m.access.mockResolvedValue({ business: { id: "business-a" } });
  m.rpc.mockResolvedValue({ error: null });
  m.load.mockResolvedValue({ graph: starterVisualGraph(), revision: 4 });
  m.version.mockResolvedValue({ graph: starterVisualGraph() });
  m.readiness.mockResolvedValue({ready:false,blockers:["Konfiguro rikuperimin."]});
});

describe("visual workflow mutations", () => {
  it("denies anonymous and unauthorized writes before RPC", async () => {
    m.user.mockResolvedValueOnce(null);
    expect(await publishVisualWorkflow("studio", 0, starterVisualGraph())).toHaveProperty("error");
    expect(m.access).not.toHaveBeenCalled();
    m.access.mockResolvedValueOnce(null);
    expect(await saveVisualWorkflow("studio", 0, starterVisualGraph())).toHaveProperty("error");
    m.access.mockResolvedValueOnce(null);
    expect(await setVisualWorkflowEnabled("studio", 0, true)).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.load).not.toHaveBeenCalled();
  });
  it("uses the authorized tenant and user, ignoring payload identities", async () => {
    const graph = { ...starterVisualGraph(), businessId: "foreign", userId: "foreign-user" };
    expect(await publishVisualWorkflow("studio", 3, graph)).toHaveProperty("workspace.revision", 4);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("save_visual_workflow", {
      p_business: "business-a", p_user: "user-a", p_revision: 3, p_graph: starterVisualGraph(), p_operation: "publish",
    });
    expect(m.load).toHaveBeenCalledWith("business-a");
    expect(m.revalidate).toHaveBeenCalledWith("/b/studio", "layout");
  });
  it("permits saving an incomplete draft but blocks publishing it", async () => {
    const graph = { ...starterVisualGraph(), edges: [] };
    expect(await saveVisualWorkflow("studio", 0, graph)).toHaveProperty("workspace");
    expect(m.rpc.mock.calls[0][1].p_operation).toBe("draft");
    m.rpc.mockClear();
    const result = await publishVisualWorkflow("studio", 1, graph);
    expect(result.error).toBeTruthy();
    expect(result.errors?.some(error => error.nodeId === "start")).toBe(true);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, Number.NaN])("refuses an invalid revision %s", async revision => {
    expect(await saveVisualWorkflow("studio", revision, starterVisualGraph())).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("maps missing migration and stale saves to actionable messages", async () => {
    m.rpc.mockResolvedValueOnce({ error: { code: "PGRST202", message: "function missing" } });
    expect((await saveVisualWorkflow("studio", 0, starterVisualGraph())).error).toContain("20261010110000_visual_workflows.sql");
    m.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "stale_workflow" } });
    expect((await publishVisualWorkflow("studio", 2, starterVisualGraph())).error).toContain("Rifresko");
    expect(m.load).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });
  it("does not expose private database errors", async () => {
    m.rpc.mockResolvedValue({ error: { code: "XX000", message: "internal private SQL detail" } });
    const result = await setVisualWorkflowEnabled("studio", 2, false);
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("private SQL");
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_operation: "disable", p_graph: null });
  });
});


it("blocks publishing v2 when runtime is not ready without claiming the draft was saved", async () => {
  const result=await publishVisualWorkflow("studio",3,upgradeVisualGraph(starterVisualGraph()));
  expect(result.error).toContain("Ruaje si draft");
  expect(result.error).toContain("Konfiguro rikuperimin");
  expect(result.error).not.toContain("ruhet si draft");
  expect(m.readiness).toHaveBeenCalledExactlyOnceWith("business-a");
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.revalidate).not.toHaveBeenCalled();
});

it("enabling a published v2 uses its version even when the current draft is v1", async () => {
  m.load.mockResolvedValue({graph:starterVisualGraph(),revision:4,publishedVersionId:"published-v2"});
  m.version.mockResolvedValue({graph:upgradeVisualGraph(starterVisualGraph())});
  expect((await setVisualWorkflowEnabled("studio",4,true)).error).toContain("Para aktivizimit");
  expect(m.version).toHaveBeenCalledExactlyOnceWith("business-a","published-v2");
  expect(m.rpc).not.toHaveBeenCalled();
});

it("does not impose v2 readiness on a published v1 because of a newer v2 draft", async () => {
  m.load.mockResolvedValue({graph:upgradeVisualGraph(starterVisualGraph()),revision:4,publishedVersionId:"published-v1"});
  m.version.mockResolvedValue({graph:starterVisualGraph()});
  expect(await setVisualWorkflowEnabled("studio",4,true)).toHaveProperty("workspace");
  expect(m.readiness).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("save_visual_workflow",{p_business:"business-a",p_user:"user-a",p_revision:4,p_graph:null,p_operation:"enable"});
});

it("can save a v2 draft before runtime activation is ready", async () => {
  expect(await saveVisualWorkflow("studio",4,upgradeVisualGraph(starterVisualGraph()))).toHaveProperty("workspace");
  expect(m.readiness).not.toHaveBeenCalled();
  expect(m.rpc.mock.calls[0][1]).toMatchObject({p_operation:"draft",p_revision:4,p_graph:{version:2}});
});

it("publishes ready v2 with the authorized identities and unchanged expected revision", async () => {
  const graph=upgradeVisualGraph(starterVisualGraph());
  m.readiness.mockResolvedValue({ready:true,blockers:[]});
  expect(await publishVisualWorkflow("studio",7,graph)).toHaveProperty("workspace");
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("save_visual_workflow",{p_business:"business-a",p_user:"user-a",p_revision:7,p_graph:graph,p_operation:"publish"});
});
