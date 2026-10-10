import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  workspace: vi.fn(),
  version: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/workflows/visual/store", () => ({
  loadVisualWorkspace: m.workspace,
  loadVisualVersion: m.version,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }),
}));
import { prepareWorkflow, loadAssistantWorkflow } from "./workflow-service";
import { executeTicket, openTicket, type Access } from "./service";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
import type { Proposal } from "./model";
const access: Access = {
  businessId: "business-a",
  userId: "user-a",
  modules: ["workflows"],
  catalogSource: "internal",
};
const proposal = (
  action: Proposal["action"],
  changes: Proposal["changes"] = [],
): Proposal => ({ action, id: null, message: "Kontrollo rrjedhën.", changes });
beforeEach(() => {
  vi.clearAllMocks();
  m.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: async () => ({ data: [], error: null }),
    };
    return query;
  });
  process.env.TOKEN_ENCRYPTION_KEY = "workflow-test-key";
  m.workspace.mockResolvedValue({
    graph: starterVisualGraph(),
    revision: 3,
    publishedVersionId: "version-a",
    enabled: true,
    available: true,
    generated: false,
  });
  m.version.mockResolvedValue({ graph: starterVisualGraph() });
  m.rpc.mockResolvedValue({ error: null });
});
it("reads both draft and published without issuing a ticket or writing", async () => {
  const result = await prepareWorkflow(access, proposal("workflow_read"));
  expect(result.workflow?.published).toEqual(starterVisualGraph());
  expect(result.token).toBeUndefined();
  expect(m.workspace).toHaveBeenCalledWith("business-a");
  expect(m.version).toHaveBeenCalledWith("business-a", "version-a");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("confirms the exact draft through the existing atomic writer, without publishing", async () => {
  const result = await prepareWorkflow(
    access,
    proposal("workflow_draft", [
      {
        field: "operations",
        value: JSON.stringify([{ op: "rename", name: "Kontaktet" }]),
      },
    ]),
    3,
  );
  expect(m.rpc).not.toHaveBeenCalled();
  expect(openTicket(result.token!, access)).toMatchObject({
    before: { revision: 3 },
    values: { operation: "draft", graph: { name: "Kontaktet" } },
  });
  await executeTicket(access, result.token!);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith(
    "save_visual_workflow",
    expect.objectContaining({
      p_business: "business-a",
      p_user: "user-a",
      p_revision: 3,
      p_operation: "draft",
      p_graph: expect.objectContaining({ name: "Kontaktet" }),
    }),
  );
});
it("rejects disabled modules and missing migrations without manufacturing an active workflow", async () => {
  await expect(
    loadAssistantWorkflow({ ...access, modules: [] }),
  ).rejects.toThrow();
  expect(m.workspace).not.toHaveBeenCalled();
  m.workspace.mockResolvedValueOnce({ available: false });
  await expect(loadAssistantWorkflow(access)).resolves.toMatchObject({
    workspace: { available: false },
    published: null,
  });
  m.workspace.mockResolvedValueOnce({ available: false });
  await expect(
    prepareWorkflow(access, proposal("workflow_publish")),
  ).rejects.toThrow("konfiguruar");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("blocks stale analysis, stale confirmations and repeated publish writes", async () => {
  await expect(
    prepareWorkflow(access, proposal("workflow_publish"), 2),
  ).rejects.toThrow("gjatë analizës");
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  m.rpc.mockResolvedValueOnce({ error: { message: "stale_workflow" } });
  await expect(executeTicket(access, result.token!)).rejects.toThrow(
    "dritare tjetër",
  );
  await expect(
    executeTicket({ ...access, businessId: "business-b" }, result.token!),
  ).rejects.toThrow();
  await expect(
    executeTicket({ ...access, modules: [] }, result.token!),
  ).rejects.toThrow();
  expect(m.rpc).toHaveBeenCalledTimes(1);
});
it("allows incomplete drafts but refuses to publish a graph with broken paths", async () => {
  m.workspace.mockResolvedValue({
    graph: { ...starterVisualGraph(), edges: [] },
    revision: 3,
    publishedVersionId: null,
    enabled: false,
    available: true,
    generated: false,
  });
  await expect(
    prepareWorkflow(access, proposal("workflow_publish"), 3),
  ).rejects.toThrow("Lidh daljen");
  const result = await prepareWorkflow(
    access,
    proposal("workflow_draft", [
      { field: "operations", value: '[{"op":"rename","name":"Draft i ri"}]' },
    ]),
    3,
  );
  expect(result.preview?.notice).toContain("Para publikimit");
  expect(m.rpc).not.toHaveBeenCalled();
});

it("refines an unconfirmed draft while previewing all changes against saved state", async () => {
  const pending = { ...starterVisualGraph(), name: "Emri i propozuar" };
  const changed = {
    ...pending.nodes.find((n) => n.id === "handoff")!,
    label: "Fol me ekipin",
  };
  const result = await prepareWorkflow(
    access,
    proposal("workflow_draft", [
      {
        field: "operations",
        value: JSON.stringify([{ op: "put_node", node: changed }]),
      },
    ]),
    3,
    pending,
  );
  expect(
    result.preview?.fields.some((f) => f.after === "Emri i propozuar"),
  ).toBe(true);
  expect(
    result.preview?.fields.some((f) => f.after.includes("Fol me ekipin")),
  ).toBe(true);
  expect(openTicket(result.token!, access).values.graph).toMatchObject({
    name: "Emri i propozuar",
  });
});
it("restores a tenant-owned published graph only as a draft", async () => {
  m.version
    .mockResolvedValueOnce({ graph: starterVisualGraph() })
    .mockResolvedValueOnce({
      graph: { ...starterVisualGraph(), name: "Version i vjetër" },
    });
  const result = await prepareWorkflow(
    access,
    proposal("workflow_restore", [
      { field: "version_id", value: "11111111-1111-4111-8111-111111111111" },
    ]),
    3,
  );
  expect(m.version).toHaveBeenLastCalledWith(
    "business-a",
    "11111111-1111-4111-8111-111111111111",
  );
  expect(openTicket(result.token!, access)).toMatchObject({
    action: "workflow_draft",
    values: { operation: "draft", graph: { name: "Version i vjetër" } },
  });
});
