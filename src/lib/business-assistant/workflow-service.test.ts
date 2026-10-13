import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  workspace: vi.fn(),
  version: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  assess: vi.fn(),
}));
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: m.assess, summarizeCapabilityAssessments: (v: unknown) => v }));
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
import { encryptSecret } from "@/lib/crypto/tokens";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import * as visualRuntime from "@/lib/workflows/visual/runtime";
function localGraph(): VisualGraph {
  return { version: 1, name: "Local only", nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "end", kind: "end", label: "End", position: { x: 0, y: 100 }, config: {} },
  ], edges: [{ id: "next", source: "start", target: "end", port: "next" }] };
}
function useLocalGraph() {
  m.workspace.mockResolvedValue({ graph: localGraph(), revision: 3, publishedVersionId: "version-a", enabled: true, available: true, generated: false });
  m.version.mockResolvedValue({ graph: localGraph(), businessId: "business-a" });
}
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
  m.assess.mockResolvedValue(["knowledge.answer", "product.search", "product.recommend", "order.prepare", "booking.create", "booking.availability.read", "order.status.read", "staff.handoff"].map(capabilityKey => ({ capabilityKey, status: "ready", reasonCode: "configured", missingRequirements: [] })));
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
  m.version.mockResolvedValue({ graph: starterVisualGraph(), businessId: "business-a" });
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

it("returns unsupported behavior without a draft ticket or fabricated graph", async () => {
  const p = proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Stock"}]' }]);
  p.requestedText = "Check inventory and notify the customer when back in stock";
  const result = await prepareWorkflow(access, p, 3);
  expect(result.token).toBeUndefined(); expect(result.workflow?.proposed).toBeUndefined();
  expect(result.automation?.unsupportedActions).toContain("back_in_stock.notify");
  expect(result.workflow?.semanticSummary).toMatchObject({ blocked: true, changes: [], unsupportedCapabilities: expect.arrayContaining(["inventory.check", "back_in_stock.notify"]) });
  expect(m.rpc).not.toHaveBeenCalled();
});

it("rechecks authorization before even a metadata-only draft save", async () => {
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Test"}]' }]), 3);
  m.assess.mockRejectedValueOnce(new Error("membership revoked"));
  await expect(executeTicket(access, result.token!)).rejects.toThrow("qasja");
  expect(m.rpc).not.toHaveBeenCalled();
});

it("binds structured draft confirmations to both tenant and actor", async () => {
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Test"}]' }]), 3);
  expect(openTicket(result.token!, access).automation?.status).toBe("proposed");
  await expect(executeTicket({ ...access, businessId: "business-b" }, result.token!)).rejects.toThrow();
  await expect(executeTicket({ ...access, userId: "user-b" }, result.token!)).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled();
});

it("preserves the same idempotency identity and payload when a draft confirmation is retried", async () => {
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Test"}]' }]), 3);
  await executeTicket(access, result.token!);
  await executeTicket(access, result.token!);
  // The existing atomic SQL function deduplicates this identical p_request/payload.
  expect(m.rpc.mock.calls[1]).toEqual(m.rpc.mock.calls[0]);
  expect(m.rpc.mock.calls[0][1].p_request).toBe(openTicket(result.token!, access).id);
});

it("blocks saving after readiness changes and preserves the published version", async () => {
  const p = proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Test"}]' }]);
  p.automation = { requestedBehaviors: [{ description: "Katalogu", capabilityKeys: ["product.search"] }], assumptions: [], clarificationQuestions: [] };
  const result = await prepareWorkflow(access, p, 3);
  m.assess.mockResolvedValueOnce([{ capabilityKey: "product.search", status: "needs_setup", missingRequirements: ["active_products"] }]);
  await expect(executeTicket(access, result.token!)).rejects.toThrow("ndryshuan");
  expect(m.rpc).not.toHaveBeenCalled();
  expect(result.workflow?.published).toEqual(starterVisualGraph());
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
  expect(result.workflow?.semanticSummary).toMatchObject({ baseRevision: 3, publishedVersionId: "version-a", simulationRequired: false });
  expect(result.workflow?.semanticSummary?.changes[0]).toMatchObject({ subject: "workflow", kind: "updated" });
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
it("refuses stale semantic proposals at preparation and confirmation", async () => {
  const p = proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Test"}]' }]);
  await expect(prepareWorkflow(access, p, 2)).rejects.toThrow("gjatë analizës");
  const result = await prepareWorkflow(access, p, 3);
  expect(result.workflow?.semanticSummary?.baseRevision).toBe(3);
  m.rpc.mockResolvedValueOnce({ error: { message: "stale_workflow" } });
  await expect(executeTicket(access, result.token!)).rejects.toThrow("dritare tjetër");
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
  // This test exercises the atomic revision guard, so use an entirely local, simulatable graph.
  useLocalGraph();
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

it("runs simulation before draft confirmation, ties evidence to the candidate, and never writes during planning", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"New draft"}]' }]), 3);
  expect(result.workflow?.simulation).toMatchObject({ result: "PASS", canPublish: true, baseRevision: 3, proposalId: result.automation?.proposalId });
  expect(openTicket(result.token!, access).simulation?.candidateGraphHash).toBe(result.workflow?.simulation?.candidateGraphHash);
  expect(m.rpc).not.toHaveBeenCalled();
  await executeTicket(access, result.token!);
  expect(m.rpc).toHaveBeenCalledWith("apply_assistant_visual_workflow", expect.objectContaining({ p_operation: "draft", p_business: "business-a", p_revision: 3 }));
});
it("shows unverified scenarios and allows draft save, but offers no publish approval", async () => {
  const draft = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"New draft"}]' }]), 3);
  expect(draft.workflow?.simulation?.result).toBe("UNVERIFIED"); expect(draft.token).toBeTruthy();
  expect(draft.preview?.notice).toContain("nuk do të thotë");
  const publish = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  expect(publish.token).toBeUndefined(); expect(publish.workflow?.simulation?.canPublish).toBe(false);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("shows blocked unsupported and unavailable assessments without claiming execution", async () => {
  const unsupported = proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Draft"}]' }]);
  unsupported.requestedText = "Check inventory";
  const blocked = await prepareWorkflow(access, unsupported, 3);
  expect(blocked.workflow?.simulation?.result).toBe("BLOCKED"); expect(blocked.token).toBeUndefined();
  m.assess.mockRejectedValue(new Error("private-access-diagnostic"));
  const failed = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  expect(failed.workflow?.simulation?.result).toBe("BLOCKED"); expect(failed.token).toBeUndefined();
  expect(JSON.stringify(failed)).not.toContain("private-access-diagnostic"); expect(m.rpc).not.toHaveBeenCalled();
});
it.each(["hash", "revision", "proposal"])("rejects a mismatched simulation %s at confirmation without writing", async mismatch => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Draft"}]' }]), 3);
  const ticket = openTicket(result.token!, access);
  if (mismatch === "hash") (ticket.values.graph as VisualGraph).nodes[1].config.prompt = "Different";
  if (mismatch === "revision") ticket.simulation!.baseRevision++;
  if (mismatch === "proposal") ticket.simulation!.proposalId = "another-proposal";
  await expect(executeTicket(access, encryptSecret(JSON.stringify(ticket)))).rejects.toThrow("Simulimi nuk i përket");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rechecks current revision and tenant authorization before simulation-backed writes", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  expect(result.workflow?.simulation?.canPublish).toBe(true);
  m.workspace.mockResolvedValue({ graph: localGraph(), revision: 4 });
  await expect(executeTicket(access, result.token!)).rejects.toThrow("dritare tjetër");
  await expect(executeTicket({ ...access, businessId: "business-b" }, result.token!)).rejects.toThrow();
  m.assess.mockRejectedValue(new Error("access revoked"));
  await expect(executeTicket(access, result.token!)).rejects.toThrow("qasja");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("reruns simulation for legacy publish tickets and cannot bypass it by omitting evidence", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  const ticket = openTicket(result.token!, access);
  delete ticket.simulation; delete ticket.automation;
  delete ticket.publicationApproval;
  ticket.values.graph = starterVisualGraph();
  m.workspace.mockResolvedValue({ graph: starterVisualGraph(), revision: 3, publishedVersionId: "version-a" });
  await expect(executeTicket(access, encryptSecret(JSON.stringify(ticket)))).rejects.toMatchObject({ publication: { status: "unverified_external_action" } });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("refuses approval and confirmation when actual runtime scenarios fail", async () => {
  useLocalGraph();
  const prepared = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  const faulty = vi.spyOn(visualRuntime, "advanceVisualWorkflow").mockImplementation(() => { throw new Error("runtime failure"); });
  try {
    const blocked = await prepareWorkflow(access, proposal("workflow_publish"), 3);
    expect(blocked.workflow?.simulation?.result).toBe("FAIL"); expect(blocked.token).toBeUndefined();
    await expect(executeTicket(access, prepared.token!)).rejects.toMatchObject({ publication: { status: "simulation_failed" } });
    expect(m.rpc).not.toHaveBeenCalled();
  } finally { faulty.mockRestore(); }
});
it("permits explicit publication of a locally verified graph through the existing atomic RPC only", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  expect(result.workflow?.simulation?.result).toBe("PASS");
  expect(result.message).not.toContain("Propozim për draft");
  expect(m.rpc).not.toHaveBeenCalled();
  await executeTicket(access, result.token!);
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("apply_assistant_visual_workflow", expect.objectContaining({ p_operation: "publish", p_revision: 3, p_business: "business-a", p_user: "user-a" }));
});
it("binds publication approval to identity, request, graph and the published version", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  const ticket = openTicket(result.token!, access);
  expect(ticket.publicationApproval).toMatchObject({ businessId: access.businessId, userId: access.userId, requestId: ticket.id,
    proposalId: ticket.automation?.proposalId, baseRevision: 3, publishedVersionId: "version-a", candidateGraphHash: ticket.simulation?.candidateGraphHash });
  m.workspace.mockResolvedValue({ graph: localGraph(), revision: 3, publishedVersionId: "version-new" });
  await expect(executeTicket(access, result.token!)).rejects.toMatchObject({ publication: { status: "stale_proposal" } });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("cannot fall back to manual policy when the sealed request identity is missing", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  const ticket = openTicket(result.token!, access);
  ticket.id = "";
  await expect(executeTicket(access, encryptSecret(JSON.stringify(ticket)))).rejects.toThrow("identiteti");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects graph changes after review and an expired publication approval", async () => {
  useLocalGraph();
  const result = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  const ticket = openTicket(result.token!, access);
  (ticket.values.graph as VisualGraph).nodes[1].config.prompt = "Changed after approval";
  await expect(executeTicket(access, encryptSecret(JSON.stringify(ticket)))).rejects.toMatchObject({ publication: { status: "stale_proposal" } });
  const expired = openTicket(result.token!, access); expired.publicationApproval!.expires = Date.now() - 1;
  await expect(executeTicket(access, encryptSecret(JSON.stringify(expired)))).rejects.toMatchObject({ publication: { status: "stale_proposal" } });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects a replay after the committed publication revision has advanced", async () => {
  useLocalGraph();
  const prepared = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  m.rpc.mockImplementationOnce(async () => {
    m.workspace.mockResolvedValue({ graph: localGraph(), revision: 4, publishedVersionId: "version-new" });
    return { data: 4, error: null };
  });
  await executeTicket(access, prepared.token!);
  await expect(executeTicket(access, prepared.token!)).rejects.toMatchObject({ publication: { status: "stale_proposal" } });
  expect(m.rpc).toHaveBeenCalledTimes(1);
});
it("refreshes whole-graph capability readiness on every publication review", async () => {
  const initial = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  expect(initial.workflow?.publication?.status).toBe("unverified_external_action");
  const assessments = await m.assess();
  m.assess.mockResolvedValue(assessments.map((c: { capabilityKey: string }) => c.capabilityKey === "knowledge.answer" ? { ...c, status: "needs_setup", missingRequirements: ["active_knowledge"] } : c));
  const changed = await prepareWorkflow(access, proposal("workflow_publish"), 3);
  expect(changed.workflow?.publication?.status).toBe("needs_setup"); expect(changed.token).toBeUndefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("restores an old snapshot only as draft, with authorization and unchanged published history", async () => {
  const oldGraph = { ...starterVisualGraph(), name: "Historical" }, snapshot = structuredClone(oldGraph);
  m.version.mockImplementation(async (_business, id) => ({ graph: id === "old-version" ? oldGraph : starterVisualGraph(), businessId: "business-a" }));
  const result = await prepareWorkflow(access, proposal("workflow_restore", [{ field: "version_id", value: "old-version" }]), 3);
  await expect(executeTicket({ ...access, businessId: "business-b" }, result.token!)).rejects.toThrow();
  m.assess.mockRejectedValueOnce(new Error("membership revoked"));
  await expect(executeTicket(access, result.token!)).rejects.toThrow("qasja");
  expect(m.rpc).not.toHaveBeenCalled();
  await executeTicket(access, result.token!);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("apply_assistant_visual_workflow", expect.objectContaining({ p_business: "business-a", p_operation: "draft", p_revision: 3, p_graph: expect.objectContaining({ name: "Historical" }) }));
  expect(oldGraph).toEqual(snapshot);
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

function catalogCounts(count = 73, error: unknown = null) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  m.from.mockImplementation((table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      order: () => query,
      limit: async () => ({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count, error }).then(resolve),
    };
    return query;
  });
  return calls;
}

it("reports the live main name and exact tenant counts without binding or activating products", async () => {
  const calls = catalogCounts();
  m.workspace.mockResolvedValue({ graph: { ...starterVisualGraph(), name: "Draft i ri" }, revision: 3, publishedVersionId: "version-a", enabled: true, available: true, generated: false, hasUnpublishedChanges: true });
  m.version.mockResolvedValue({ graph: { ...upgradeVisualGraph(starterVisualGraph()), name: "Rrjedha e workflow 1" } });
  const result = await prepareWorkflow({ ...access, modules: ["workflows", "products"] }, proposal("workflow_catalog"));
  expect(result.message).toContain('“Rrjedha e workflow 1” është i publikuar dhe aktiv');
  expect(result.message).toContain("73 aktive, 73 joaktive");
  expect(result.message).toContain("ndryshime draft");
  expect(result.message).toContain("Nuk duhet t’i lidhësh një nga një");
  expect(result.token).toBeUndefined();
  expect(m.rpc).not.toHaveBeenCalled();
  expect(calls.filter(call => call.table === "products")).toEqual([
    { table: "products", filters: [["business_id", "business-a"], ["is_active", true]] },
    { table: "products", filters: [["business_id", "business-a"], ["is_active", false]] },
  ]);
  expect(calls.some(call => call.table === "booking_services")).toBe(false);
});

it.each([
  { generated: true, enabled: false, publishedVersionId: null, expected: "Nuk ka ende një workflow kryesor të ruajtur" },
  { generated: false, enabled: false, publishedVersionId: null, expected: "është draft; ende nuk është publikuar" },
  { generated: false, enabled: false, publishedVersionId: "version-a", expected: "është joaktiv" },
])("does not claim live inheritance for $expected", async ({ expected, ...state }) => {
  m.workspace.mockResolvedValue({ graph: starterVisualGraph(), revision: 3, available: true, ...state });
  const result = await prepareWorkflow(access, proposal("workflow_catalog"));
  expect(result.message).toContain(expected);
  expect(result.message.split("\n\n")[0]).not.toContain("është i publikuar dhe aktiv");
  expect(result.token).toBeUndefined();
  expect(m.rpc).not.toHaveBeenCalled();
});

it("preserves specific assignments and reports missing generic order capability", async () => {
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.flows = graph.flows.map(flow => flow.kind === "order" ? { ...flow, productIds: ["00000000-0000-4000-8000-000000000001"] } : flow);
  m.version.mockResolvedValue({ graph });
  const before = structuredClone(graph);
  const result = await prepareWorkflow(access, proposal("workflow_catalog"));
  expect(result.message).toContain("lidhje me degë të posaçme. Ato ruhen");
  expect(result.message).toContain("nuk ka degë të përgjithshme porosie");
  expect(graph).toEqual(before);
  expect(result.token).toBeUndefined();
  expect(m.rpc).not.toHaveBeenCalled();
});

it("fails closed instead of claiming an empty catalog when counts cannot be read", async () => {
  catalogCounts(0, { message: "Unavailable" });
  await expect(prepareWorkflow({ ...access, modules: ["workflows", "products"] }, proposal("workflow_catalog"))).rejects.toThrow("Gjendja e katalogut nuk u lexua");
  expect(m.rpc).not.toHaveBeenCalled();
});
