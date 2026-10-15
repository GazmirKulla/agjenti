import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ profile: vi.fn(), from: vi.fn(), rpc: vi.fn(), workspace: vi.fn(), version: vi.fn(), user: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualWorkspace: m.workspace, loadVisualVersion: m.version }));
vi.mock("@/lib/workflows/readiness", () => ({ loadWorkflowReadiness: async () => ({ ready: true, blockers: [] }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { enforceWorkflowCapabilities, requireActiveBindings } from "./workflow";
import { graphRequirements } from "./graph";
import { moduleEnforcementEnabled } from "./enforcement";
import { assessBusinessCapabilities } from "./assessment";
import { writeVisualWorkflow } from "@/lib/workflows/visual/mutations";
import { buildAutomationProposal } from "@/lib/business-assistant/automation-proposal";
import { saveProductsWithVisualFlow } from "@/lib/products/visual-selection";
import { POST } from "@/app/api/workflows/visual/route";
import type { VisualGraphV2 } from "@/lib/workflows/visual/types";
const productId = "00000000-0000-4000-8000-000000000001";
const serviceId = "00000000-0000-4000-8000-000000000002";
function graph(): VisualGraphV2 {
  return { version: 2, name: "Porosi", nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "name", kind: "collect", label: "Emri", position: { x: 1, y: 0 }, config: { fieldKey: "customer_name", fieldType: "text", prompt: "Emri?" } },
    { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 }, config: {} },
  ], edges: [{ id: "a", source: "start", target: "name", port: "next" }, { id: "b", source: "name", target: "end", port: "next" }],
  flows: [{ id: "order", kind: "order", label: "Porosi", entryNodeId: "name", nodeIds: ["name"], productIds: [productId] }] };
}
let membership: boolean, active: boolean, count: number;
let connection: { connected: boolean; calendar_id: string | null } | null;
let filters: [string, string, unknown][];
function query(table: string) {
  const values: Record<string, unknown> = {};
  const result = () => {
    const data = table === "business_users" ? membership ? { business_id: "tenant-a" } : null
      : table === "platform_admins" ? null
      : table === "products" || table === "booking_services" ? (active || values.is_active !== true) && values.business_id === "tenant-a" ? [{ id: table === "products" ? productId : serviceId }] : []
      : table === "business_calendar_settings" ? { agent_booking_enabled: true }
      : table === "google_calendar_connections" ? connection : null;
    return { data, error: null, count };
  };
  const q = { select: () => q, eq: (key: string, value: unknown) => { values[key] = value; filters.push([table, key, value]); return q; }, in: () => q,
    maybeSingle: async () => result(), then: (resolve: (v: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
  return q;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "tenant-a");
  membership = true; active = true; count = 1; filters = []; connection = null;
  m.profile.mockResolvedValue({ source: "manual", enabledModules: ["products", "orders", "workflows"] });
  m.from.mockImplementation(query);
  m.rpc.mockImplementation(async (_name, input) => ({ data: input.p_revision + 1, error: null }));
  m.workspace.mockResolvedValue({ graph: graph(), revision: 2, publishedVersionId: "old-version" });
  m.version.mockResolvedValue({ id: "old-version", businessId: "tenant-a", graph: graph() });
  m.user.mockResolvedValue({ id: "actor" }); m.access.mockResolvedValue({ business: { id: "tenant-a" } });
});
afterEach(() => vi.unstubAllEnvs());
it("maps order and custom-bound flows without product nodes to preparation, never execution", () => {
  const candidate = graph();
  expect(graphRequirements(candidate).capabilityKeys).toEqual(expect.arrayContaining(["order.prepare", "product.search"]));
  candidate.flows[0].kind = "custom";
  expect(graphRequirements(candidate).capabilityKeys).toContain("order.prepare");
  candidate.flows[0].kind = "order"; delete candidate.flows[0].productIds;
  expect(graphRequirements(candidate).capabilityKeys).toEqual(["order.prepare"]);
  expect(graphRequirements(candidate).capabilityKeys).not.toContain("order.create");
});
it.each(["draft", "publish", "enable"] as const)("blocks disabled orders at %s, including an old published version", async operation => {
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  const saved = structuredClone(graph());
  const result = await writeVisualWorkflow("tenant-a", "actor", 2, saved, operation);
  expect(result.publication).toMatchObject({ canPublish: false, findings: [{ code: "module_disabled", message: expect.any(String) }] });
  expect(m.rpc).not.toHaveBeenCalled(); expect(saved).toEqual(graph());
  if (operation === "enable") expect(m.version).toHaveBeenCalledWith("tenant-a", "old-version");
});
it("checks action permissions alongside module permissions before publishing", async () => {
  const candidate = graph();
  candidate.flows[0].kind = "custom";
  delete candidate.flows[0].productIds;
  candidate.nodes[1] = { ...candidate.nodes[1], kind: "action", config: {
    action: { actionKey: "business.provision", actionVersion: 1, inputs: { name: "business_name", email: "business_email" } },
  } };
  m.rpc.mockResolvedValue({ data: false, error: null });
  await expect(enforceWorkflowCapabilities("tenant-a", "actor", candidate, "publish")).rejects.toMatchObject({ code: "missing_configuration" });
  expect(m.rpc).toHaveBeenCalledWith("can_execute_business_action", { p_business: "tenant-a", p_user: null, p_action: "business.provision", p_automated: true });
  m.rpc.mockResolvedValue({ data: true, error: null });
  await expect(enforceWorkflowCapabilities("tenant-a", "actor", candidate, "publish")).resolves.toEqual([
    expect.objectContaining({ capabilityKey: "business.provision", status: "ready" }),
  ]);
});
it("AI and manual publishing enforce identical capability restrictions before any commit", async () => {
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  const manual = await writeVisualWorkflow("tenant-a", "actor", 2, graph(), "publish");
  const ai = await writeVisualWorkflow("tenant-a", "actor", 2, graph(), "publish", "confirmation");
  expect(ai.publication?.findings).toEqual(manual.publication?.findings); expect(m.rpc).not.toHaveBeenCalled();
});
it("a direct HTTP request cannot bypass current modules or forge the tenant", async () => {
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  const response = await POST(new Request("https://app.test/api/workflows/visual", { method: "POST", headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify({ slug: "shop", revision: 2, graph: graph(), operation: "publish", businessId: "foreign", MODULE_ENFORCEMENT_BUSINESS_IDS: "" }) }));
  expect(await response.json()).toHaveProperty("error"); expect(m.profile).toHaveBeenCalledWith("tenant-a", { requireExplicit: true });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not let an AI proposal advertise a disabled flow as executable", async () => {
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  const proposal = await buildAutomationProposal({ businessId: "tenant-a", userId: "actor", revision: 2, publishedVersionId: "old", before: graph(), after: graph(), request: "Përgatit porosinë", operations: [] });
  expect(proposal).toMatchObject({ readiness: "needs_setup", canSaveDraft: false, operations: [] });
  expect(proposal.requiredCapabilities.find(c => c.capabilityKey === "order.prepare")).toMatchObject({ availability: "module_disabled" });
});
it("does not assess or block on unrelated disabled modules for a valid product-only flow", async () => {
  const candidate = graph(); candidate.flows[0].kind = "information";
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  expect((await writeVisualWorkflow("tenant-a", "actor", 2, candidate, "publish")).savedRevision).toBe(3);
  expect(m.from.mock.calls.map(call => call[0])).not.toContain("business_calendar_settings");
  expect(m.from.mock.calls.map(call => call[0])).not.toContain("knowledge_entries");
});
it.each(["inactive", "foreign"])("rejects %s product and service bindings on save", async kind => {
  if (kind === "inactive") active = false;
  const badId = kind === "foreign" ? "00000000-0000-4000-8000-000000000009" : productId;
  await expect(requireActiveBindings("tenant-a", [badId], [])).rejects.toMatchObject({ code: "binding_unavailable" });
  await expect(requireActiveBindings("tenant-a", [], [kind === "foreign" ? badId : serviceId])).rejects.toMatchObject({ code: "binding_unavailable" });
  expect(filters).toContainEqual(["products", "business_id", "tenant-a"]); expect(filters).toContainEqual(["products", "is_active", true]);
  expect(filters).toContainEqual(["booking_services", "business_id", "tenant-a"]); expect(filters).toContainEqual(["booking_services", "is_active", true]);
});
it("allows inactive owned bindings through the draft-only product/flow API", async () => {
  active = false;
  m.rpc.mockResolvedValue({ data: 1, error: null });
  expect(await saveProductsWithVisualFlow("tenant-a", "actor", { flowId: "order", revision: 2 }, "bind", [{ id: productId }])).toHaveProperty("success");
  expect(m.rpc).toHaveBeenCalledWith("save_products_with_visual_flow", expect.objectContaining({ p_business: "tenant-a", p_mode: "bind", p_revision: 2 }));
});
it("refuses revoked/cross-tenant membership even when module configuration is ready", async () => {
  membership = false;
  await expect(enforceWorkflowCapabilities("tenant-a", "foreign-user", graph(), "publish")).rejects.toMatchObject({ code: "unverified" });
  expect(m.profile).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it("allows incomplete configuration only in drafts; activation requires current readiness", async () => {
  count = 0; const candidate = graph(); delete candidate.flows[0].productIds;
  await expect(enforceWorkflowCapabilities("tenant-a", "actor", candidate, "draft")).resolves.toEqual([expect.objectContaining({ availability: "missing_configuration" })]);
  await expect(enforceWorkflowCapabilities("tenant-a", "actor", candidate, "publish")).rejects.toMatchObject({ code: "missing_configuration" });
});
it("distinguishes unsupported capabilities without inventing executors", async () => {
  expect(await assessBusinessCapabilities("tenant-a", { userId: "actor" }, { keys: ["inventory.check"] })).toEqual([expect.objectContaining({ availability: "unsupported", status: "unsupported" })]);
});
it("fails closed on profile failures without exposing diagnostics", async () => {
  m.profile.mockRejectedValue(new Error("private credentials"));
  const result = await writeVisualWorkflow("tenant-a", "actor", 2, graph(), "publish");
  expect(result.error).toBeTruthy(); expect(JSON.stringify(result)).not.toContain("credentials"); expect(m.rpc).not.toHaveBeenCalled();
  expect(result.publication?.result).toBe("UNVERIFIED");
});
it("rechecks current modules after the assessment rather than trusting earlier readiness", async () => {
  m.profile.mockResolvedValueOnce({ enabledModules: ["products", "orders", "workflows"] }).mockResolvedValue({ enabledModules: ["products", "workflows"] });
  const result = await writeVisualWorkflow("tenant-a", "actor", 2, graph(), "publish");
  expect(result.publication?.findings[0].code).toBe("module_disabled"); expect(m.rpc).not.toHaveBeenCalled();
});
it("keeps rollout explicit and leaves unenrolled legacy saves compatible", async () => {
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "other, *");
  expect(moduleEnforcementEnabled("tenant-a")).toBe(false);
  await expect(enforceWorkflowCapabilities("tenant-a", "actor", graph(), "publish")).resolves.toBeUndefined();
  expect(m.profile).not.toHaveBeenCalled();
});
it("distinguishes an unavailable optional integration from missing local configuration", async () => {
  m.profile.mockResolvedValue({ enabledModules: ["bookings", "services", "workflows"] });
  connection = { connected: true, calendar_id: null };
  const assess = () => assessBusinessCapabilities("tenant-a", { userId: "actor" }, { keys: ["booking.create"] });
  expect(await assess()).toEqual([expect.objectContaining({ availability: "integration_unavailable", status: "needs_setup", missingRequirements: ["integration:google_calendar"] })]);
  connection = null;
  expect(await assess()).toEqual([expect.objectContaining({ availability: "ready", status: "ready" })]);
  count = 0;
  expect(await assess()).toEqual([expect.objectContaining({ availability: "missing_configuration" })]);
});
it.each([undefined, "confirmation"])("blocks unsupported graph claims for manual/AI confirmation %s", async confirmation => {
  const candidate = graph(); candidate.nodes[1].config.prompt = "Check inventory and notify when back in stock";
  const result = await writeVisualWorkflow("tenant-a", "actor", 2, candidate, "publish", confirmation);
  expect(result.publication?.findings[0].code).toBe("unsupported"); expect(m.rpc).not.toHaveBeenCalled();
});
it("fails closed when the published graph cannot be loaded for reactivation", async () => {
  m.version.mockResolvedValue(null);
  expect(await writeVisualWorkflow("tenant-a", "actor", 2, null, "enable")).toHaveProperty("error");
  expect(m.rpc).not.toHaveBeenCalled();
});
