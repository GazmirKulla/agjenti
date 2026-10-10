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
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
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
  m.rpc.mockImplementation(async (_name: string, input: { p_revision: number }) => ({ data: input.p_revision + 1, error: null }));
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
    "apply_assistant_visual_workflow",
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
it("disables a published workflow and activates a disabled published version", async () => {
  const disable = await prepareWorkflow(
    access,
    proposal("workflow_disable"),
    3,
  );
  expect(disable.preview?.title).toBe("Çaktivizo rrjedhën");
  expect(openTicket(disable.token!, access)).toMatchObject({
    action: "workflow_disable",
    values: { operation: "disable" },
  });
  await executeTicket(access, disable.token!);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith(
    "apply_assistant_visual_workflow",
    expect.objectContaining({
      p_business: "business-a",
      p_operation: "disable",
      p_revision: 3,
    }),
  );

  m.workspace.mockResolvedValue({
    graph: starterVisualGraph(),
    revision: 4,
    publishedVersionId: "version-a",
    enabled: false,
    available: true,
    generated: false,
  });
  m.rpc.mockClear();
  const enable = await prepareWorkflow(access, proposal("workflow_enable"), 4);
  expect(enable.preview?.title).toBe("Aktivizo versionin e publikuar");
  expect(openTicket(enable.token!, access)).toMatchObject({
    action: "workflow_enable",
    values: { operation: "enable" },
  });
  await executeTicket(access, enable.token!);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith(
    "apply_assistant_visual_workflow",
    expect.objectContaining({
      p_operation: "enable",
      p_revision: 4,
    }),
  );
});
it("returns without a ticket when enable or disable is already the current state", async () => {
  const alreadyEnabled = await prepareWorkflow(
    access,
    proposal("workflow_enable"),
    3,
  );
  expect(alreadyEnabled.message).toBe("Rrjedha është tashmë në këtë gjendje.");
  expect(alreadyEnabled.token).toBeUndefined();
  m.workspace.mockResolvedValue({
    graph: starterVisualGraph(),
    revision: 3,
    publishedVersionId: "version-a",
    enabled: false,
    available: true,
    generated: false,
  });
  const alreadyDisabled = await prepareWorkflow(
    access,
    proposal("workflow_disable"),
    3,
  );
  expect(alreadyDisabled.message).toBe("Rrjedha është tashmë në këtë gjendje.");
  expect(alreadyDisabled.token).toBeUndefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("refuses enable or disable when no published version exists", async () => {
  m.workspace.mockResolvedValue({
    graph: starterVisualGraph(),
    revision: 1,
    publishedVersionId: null,
    enabled: false,
    available: true,
    generated: false,
  });
  await expect(
    prepareWorkflow(access, proposal("workflow_enable"), 1),
  ).rejects.toThrow("publikuar");
  await expect(
    prepareWorkflow(access, proposal("workflow_disable"), 1),
  ).rejects.toThrow("publikuar");
  expect(m.rpc).not.toHaveBeenCalled();
});

it("previews and confirms an actual order-status capability as a draft, without changing unrelated nodes", async () => {
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: JSON.stringify([
    { op: "upgrade" },
    { op: "put_node", node: { id: "status", kind: "order_status", label: "Statusi i porosisë", position: { x: 800, y: 0 }, config: {} } },
    { op: "put_edge", edge: { id: "status-end", source: "status", target: "end", port: "next" } },
    { op: "put_flow", flow: { id: "status", kind: "information", label: "Statusi i porosisë", entryNodeId: "status", nodeIds: ["status"] } },
  ]) }]), 3);
  expect(m.rpc).not.toHaveBeenCalled();
  const ticket = openTicket(result.token!, access);
  expect(ticket).toMatchObject({ action: "workflow_draft", before: { revision: 3 }, values: { operation: "draft", graph: { version: 2 } } });
  expect(result.workflow?.proposed?.nodes.find(node => node.id === "status")?.kind).toBe("order_status");
  expect(result.workflow?.proposed?.nodes.filter(node => node.id !== "status")).toEqual(starterVisualGraph().nodes);
  expect(result.preview?.fields.some(field => field.after.includes("Lexon vetëm statusin"))).toBe(true);
  await executeTicket(access, result.token!);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("apply_assistant_visual_workflow", expect.objectContaining({
    p_operation: "draft", p_revision: 3,
    p_graph: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ kind: "order_status" })]) }),
  }));
});

it("previews verified visual bindings including inactive catalog entries without creating linear workflows", async () => {
  const productId = "00000000-0000-4000-8000-000000000001";
  const serviceId = "00000000-0000-4000-8000-000000000002";
  const graph = upgradeVisualGraph(starterVisualGraph());
  m.workspace.mockResolvedValue({ graph, revision: 3, publishedVersionId: null, enabled: false, available: true });
  const tenants: string[] = [];
  m.from.mockImplementation((table: string) => {
    const query = {
      select: () => query, eq: (_key: string, tenant: string) => { tenants.push(tenant); return query; }, order: () => query,
      limit: async () => ({ data: [], error: null }),
      in: async () => ({ data: table === "products" ? [{ id: productId, name: "Filxhan", is_active: false }] : [{ id: serviceId, name: "Personalizim", is_active: false, booking_enabled: false }], error: null }),
    }; return query;
  });
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: JSON.stringify([{ op: "put_flow", flow: { ...graph.flows[0], productIds: [productId], serviceIds: [serviceId] } }]) }]), 3);
  const preview = JSON.stringify(result.preview);
  expect(preview).toContain("Filxhan"); expect(preview).toContain("Personalizim");
  expect(preview).not.toContain(productId); expect(preview).not.toContain(serviceId);
  expect(openTicket(result.token!, access).values).toMatchObject({ operation: "draft", graph: { flows: [expect.objectContaining({ productIds: [productId], serviceIds: [serviceId] }), ...graph.flows.slice(1)] } });
  expect(tenants.every(tenant => tenant === access.businessId)).toBe(true);
  expect(m.rpc).not.toHaveBeenCalled();
});

it.each(["productIds", "serviceIds"])("rejects foreign or missing %s before creating a proposal and permits removing stale bindings", async field => {
  const targetId = "00000000-0000-4000-8000-000000000001";
  const graph = upgradeVisualGraph(starterVisualGraph());
  const boundFlow = { ...graph.flows[0], [field]: [targetId] };
  m.workspace.mockResolvedValue({ graph, revision: 3, publishedVersionId: null, enabled: false, available: true });
  m.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: [], error: null }), in: async () => ({ data: [], error: null }) }; return query;
  });
  await expect(prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: JSON.stringify([{ op: "put_flow", flow: boundFlow }]) }]), 3)).rejects.toThrow("nuk gjendet në këtë biznes");
  graph.flows[0] = boundFlow;
  await expect(prepareWorkflow(access, proposal("workflow_publish"), 3)).rejects.toThrow("nuk gjendet në këtë biznes");
  const removal = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: JSON.stringify([{ op: "put_flow", flow: { ...boundFlow, [field]: [] } }]) }]), 3);
  expect(removal.token).toBeTruthy();
  expect(JSON.stringify(removal.preview)).toContain("padisponueshëm");
  expect(m.rpc).not.toHaveBeenCalled();
});
