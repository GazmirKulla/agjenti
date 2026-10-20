import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ response: vi.fn(), profile: vi.fn(), from: vi.fn(), rpc: vi.fn(), user: vi.fn(), access: vi.fn(), write: vi.fn(), revalidate: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: m.response }; } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "synthetic-test" }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { POST } from "@/app/api/business-assistant/route";
import { buildAutomationProposal, recheckAutomation } from "./automation-proposal";
import { readProposal } from "./model";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
import { encryptSecret } from "@/lib/crypto/tokens";
import type { ActionPlan } from "./action-plan";

// Real route → planner → proposal → capability assessment. Only auth/session,
// provider output and database transport are synthetic; this is NOT a PostgreSQL test.
type Fixture = { data: unknown; count?: number; error?: { message: string } };
let fixtures: Record<string, Fixture>;
let queries: { table: string; eq: ReturnType<typeof vi.fn> }[];
const intent = (keys: string[], questions: string[] = []) => ({
  requestedBehaviors: keys.map(key => ({ description: `Kërkesa sintetike për ${key}`, capabilityKeys: [key], readiness: "ready", supported: true })),
  assumptions: [], clarificationQuestions: questions,
});
function respond(keys: string[], questions: string[] = []) {
  m.response.mockResolvedValue({ output_text: JSON.stringify({ action: "automation_plan", id: null, changes: [],
    message: "Gjithçka u aktivizua dhe u publikua", automation: intent(keys, questions), readiness: "READY", approved: true }) });
}
const request = (body: unknown) => new Request("http://localhost/api/business-assistant?slug=synthetic", {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});
async function plan(text = "Përgatit vetëm planin e punës së agjentit") {
  const response = await POST(request({ mode: "plan", text, businessId: "foreign-tenant", approved: true, context: { page: "home", entryPoint: "home" } }));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.token).toBeUndefined(); expect(data.saved).toBeUndefined(); expect(data.workflow).toBeUndefined();
  expect(data.message).not.toContain("Gjithçka u aktivizua");
  expect(m.write).not.toHaveBeenCalled(); expect(m.revalidate).not.toHaveBeenCalled();
  expect(m.rpc.mock.calls.every(([name]) => name === "can_execute_business_action")).toBe(true);
  return data.actionPlan as ActionPlan;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-no-network");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "synthetic-plan-test-only");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "tenant-a");
  m.user.mockResolvedValue({ id: "owner-a" });
  m.access.mockResolvedValue({ business: { id: "tenant-a", catalog_source: "internal" } });
  m.profile.mockResolvedValue({ enabledModules: ["knowledge", "products", "orders", "workflows", "services", "bookings", "staff"] });
  m.rpc.mockResolvedValue({ data: false, error: null });
  fixtures = {
    business_users: { data: { business_id: "tenant-a" } }, platform_admins: { data: null },
    products: { data: [], count: 1 }, knowledge_entries: { data: [], count: 1 }, booking_services: { data: [], count: 1 },
    business_calendar_settings: { data: { agent_booking_enabled: true, timezone: "Europe/Tirane" } },
    visual_workflows: { data: { enabled: true, published_version_id: "v-a" } },
    visual_workflow_versions: { data: { id: "v-a", graph: starterVisualGraph(), created_at: "2026-01-01" } },
  };
  queries = [];
  m.from.mockImplementation((table: string) => {
    let many = false;
    const result = () => {
      const fixture = fixtures[table] ?? { data: null };
      return { ...fixture, error: fixture.error ?? null, data: many ? Array.isArray(fixture.data) ? fixture.data : [] : fixture.data };
    };
    const q = {
      select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), gte: vi.fn(() => q), limit: vi.fn(() => q),
      returns: vi.fn(() => { many = true; return q; }), maybeSingle: vi.fn(async () => result()),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      insert: m.write, update: m.write, upsert: m.write, delete: m.write,
    };
    queries.push({ table, eq: q.eq }); return q;
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "Luna", "Migo", "D'Art"])("uses the personal name %s in the real owner planner, separately from business data", async name => {
  m.profile.mockResolvedValue({ enabledModules: ["settings"] });
  fixtures.businesses = { data: [{ id: "tenant-a", name: "Filiz Studio" }] };
  m.response.mockResolvedValue({ output_text: JSON.stringify({ action: "clarify", id: null, changes: [], message: "Përgjigje sintetike." }) });
  const response = await POST(request({ mode: "plan", text: "Si e ke emrin?", assistantName: name,
    history: [{ role: "assistant", content: 'Unë jam Agjenti "Filiz Studio".' }] }));
  expect(response.status).toBe(200);
  const call = m.response.mock.calls[0][0];
  expect(JSON.parse(call.input).assistant).toEqual({ name: name ?? "Asistenti AI" });
  expect(JSON.parse(call.input).data.profile.rows[0].name).toBe("Filiz Studio");
  expect(call.instructions).not.toContain("Your display name is Agjenti followed by the current business name");
  expect(call.instructions).toContain("assistant.name");
  expect(m.write).not.toHaveBeenCalled();
});

it.each([
  ["retail", ["product.search", "order.prepare"], "Dua përzgjedhjen e produktit, masës dhe sasisë dhe përgatitjen e porosisë për stafin"],
  ["salon", ["booking.availability.read", "booking.create"], "Dua që salloni të ofrojë orare për shërbimet dhe të rezervojë takime"],
  ["information", ["knowledge.answer"], "Dua vetëm përgjigje për informacionin e biznesit"],
])("builds a server-assessed %s plan without unrelated steps or mutations", async (_industry, keys, text) => {
  respond(keys);
  const result = await plan(text);
  expect(result.steps.map(step => step.requiredCapability)).toEqual(keys);
  expect(result.steps.every(step => step.readiness === "READY" && step.supported)).toBe(true);
  for (const { table, eq } of queries) {
    if (table !== "platform_admins") expect(eq).toHaveBeenCalledWith("business_id", "tenant-a");
    if (["business_users", "platform_admins"].includes(table)) expect(eq).toHaveBeenCalledWith("user_id", "owner-a");
    expect(eq).not.toHaveBeenCalledWith("business_id", "foreign-tenant");
  }
  expect(m.response.mock.calls[0][0].instructions).toContain("business.provision creates a business invitation, NOT a customer or a lead");
});

it("keeps agency leads, quotes and customer registration unsupported alongside a supported answer step", async () => {
  respond(["lead.capture", "quote.create", "customer.create", "knowledge.answer"]);
  const result = await plan("Agjencia do përgjigje, regjistrim klientësh, lead-e dhe oferta");
  expect(result.steps.map(s => s.readiness)).toEqual(["UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED", "READY"]);
  expect(result.steps.slice(0, 3).every(s => !s.supported && !s.approvalRequired)).toBe(true);
  expect(result.steps.some(s => s.requiredCapability === "business.provision")).toBe(false);
  expect(result.steps[2].title).toBe("Regjistrimi automatik i klientit");
  expect(result.steps.slice(0, 3).every(s => !s.title.includes(".create") && !s.title.includes(".capture"))).toBe(true);
});

it("names automatic order creation without substituting order preparation or enabling it", async () => {
  respond(["order.create", "order.prepare"]);
  const result = await plan("Dua krijimin automatik të porosisë dhe përgatitjen për stafin");
  expect(result.steps[0]).toMatchObject({ title: "Krijimi automatik i porosisë", requiredCapability: "order.create", readiness: "UNSUPPORTED", supported: false, approvalRequired: false });
  expect(result.steps[1]).toMatchObject({ requiredCapability: "order.prepare", readiness: "READY", supported: true });
});

it("plans disabled capabilities without requiring the workflows module or trusting model readiness", async () => {
  m.profile.mockResolvedValue({ enabledModules: [] }); respond(["order.prepare", "booking.create"]);
  const result = await plan();
  expect(result.steps.every(s => s.readiness === "DISABLED" && s.supported)).toBe(true);
  expect(queries.some(q => q.table.startsWith("visual_workflow"))).toBe(false);
});

it("distinguishes missing configuration from an unavailable integration and denied automation permission", async () => {
  fixtures.knowledge_entries.count = 0;
  fixtures.google_calendar_connections = { data: { connected: true, calendar_id: null } };
  respond(["knowledge.answer", "booking.create", "business.provision"]);
  const result = await plan();
  expect(result.steps.map(s => s.readiness)).toEqual(["NEEDS_CONFIGURATION", "BLOCKED", "BLOCKED"]);
  expect(result.steps[0].missingConfiguration).toEqual(["Shto ose aktivizo njohuritë e biznesit."]);
});

it("reassesses changed configuration and does not reuse prior local approval or snapshot", async () => {
  respond(["knowledge.answer"]);
  const first = await plan(); expect(first.steps[0].readiness).toBe("READY");
  m.profile.mockResolvedValue({ enabledModules: [] });
  const second = await plan();
  expect(second.id).not.toBe(first.id); expect(second.steps[0].readiness).toBe("DISABLED");
  expect(second.steps[0]).not.toHaveProperty("approved");
});

it.each(["revoked membership", "read error"])("fails closed on %s without private diagnostic leakage", async condition => {
  fixtures.business_users = condition === "revoked membership" ? { data: null } : { data: null, error: { message: "private-db-secret" } };
  respond(["knowledge.answer"]);
  const result = await plan();
  expect(result.steps[0].readiness).toBe("BLOCKED");
  expect(JSON.stringify(result)).not.toContain("private-db-secret");
});

it("rejects unauthenticated/cross-tenant requests before invoking the planner", async () => {
  m.user.mockResolvedValueOnce(null);
  expect((await POST(request({ mode: "plan", text: "Test" }))).status).toBe(401);
  m.access.mockResolvedValueOnce(null);
  expect((await POST(request({ mode: "plan", text: "Test" }))).status).toBe(403);
  expect(m.response).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});

it("keeps ambiguous goals blocked and asks only the supplied unresolved decision", async () => {
  respond(["knowledge.answer"], ["Në cilën gjuhë duhet të përgjigjet agjenti?"]);
  const result = await plan();
  expect(result.steps[0].readiness).toBe("BLOCKED");
  expect(result.questions).toEqual(["Në cilën gjuhë duhet të përgjigjet agjenti?"]);
  expect(result.steps[0].capabilityReadiness).toBe("ready"); // A question cannot rewrite the server assessment.
});

it("does not treat an unmapped behavior as ready", async () => {
  m.response.mockResolvedValue({ output_text: JSON.stringify({ action: "automation_plan", id: null, changes: [], message: "Gati", automation: {
    requestedBehaviors: [{ description: "Bëj diçka tjetër", capabilityKeys: [] }], assumptions: [], clarificationQuestions: [],
  } }) });
  const result = await plan(); expect(result.steps[0]).toMatchObject({ readiness: "BLOCKED", supported: false, requiredCapability: null });
});

it("retains the existing unsupported-request backstop even when omitted by the model", async () => {
  respond(["product.search"]);
  const result = await plan("Check inventory and notify when back in stock");
  expect(result.steps.filter(s => s.readiness === "UNSUPPORTED").map(s => s.requiredCapability)).toEqual(expect.arrayContaining(["inventory.check", "back_in_stock.notify"]));
});

it("never turns a plan into a save ticket, even if artificially sealed by trusted test code", async () => {
  const proposal = await buildAutomationProposal({ mode: "plan", businessId: "tenant-a", userId: "owner-a", request: "Plan", intent: intent(["knowledge.answer"]) });
  expect(proposal.canSaveDraft).toBe(false); expect(proposal.operations).toEqual([]);
  await expect(recheckAutomation("tenant-a", "owner-a", proposal)).rejects.toThrow("sqarim");
  const token = encryptSecret(JSON.stringify({ purpose: "business-assistant-v1", action: "automation_plan", userId: "owner-a", businessId: "tenant-a", expires: Date.now() + 60000, id: "test-plan", values: {}, before: null }));
  const response = await POST(request({ mode: "confirm", token }));
  expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining("vetëm për shqyrtim") });
  expect(m.write).not.toHaveBeenCalled(); expect(m.revalidate).not.toHaveBeenCalled();
});

it("rejects plan mutations and missing intent at the deterministic model boundary", () => {
  const base = { action: "automation_plan", id: null, message: "Plan", changes: [], automation: intent(["knowledge.answer"]) };
  expect(() => readProposal({ ...base, changes: [{ field: "operations", value: "[]" }] })).toThrow();
  expect(() => readProposal({ ...base, automation: null })).toThrow();
  expect(() => readProposal({ ...base, id: "00000000-0000-4000-8000-000000000001" })).toThrow();
});
