import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentTurnResult } from "./process-agent-turn";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { VisualGraphV2, VisualNode, VisualVersion } from "@/lib/workflows/visual/types";

const mocks = vi.hoisted(() => ({ from: vi.fn(), generate: vi.fn(), booking: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test", generateAgentReply: mocks.generate }));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: async () => null }));
vi.mock("@/lib/calendar/agent", () => ({ processBookingTurn: mocks.booking }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: mocks.profile }));
// These version-selection scenarios use the default platform policy: all modules allowed.
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => [...MODULE_IDS], requireModuleAllowed: async () => {} };
});

// Keep coordinator, agent turn, version store, entity router and visual executor real.
import { processConversationMessage } from "./process-conversation-message";
import { migrateContext, setFact } from "@/lib/workflows/context";
import { snapshotOrder } from "@/lib/workflows/conversation-processes";
import { validateVisualGraph } from "@/lib/workflows/visual/model";

const businessId = "business-a";
const productId = "00000000-0000-4000-8000-000000000001";
let published: string;
let versions: Record<string, VisualVersion>;
let products: { id: string; business_id: string; name: string; is_active: boolean; price_amount: number; currency: string }[];
let queries: { table: string; filters: Record<string, unknown> }[];

function version(id: string): VisualVersion {
  const node = (key: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode =>
    ({ id: key, kind, label: key, config, position: { x: 0, y: 0 } });
  const graph: VisualGraphV2 = {
    version: 2, name: `Workflow ${id}`,
    nodes: [node("start", "start"), node("details", "collect", { fieldKey: `detail_${id}`, prompt: `Detajet ${id}?` }),
      node("confirm", "confirm", { prompt: `Konfirmon ${id}?` }), node("information", "knowledge"), node("booking", "booking"), node("end", "end")],
    edges: [
      { id: "start", source: "start", target: "details", port: "next" },
      { id: "details", source: "details", target: "confirm", port: "next" },
      { id: "yes", source: "confirm", target: "end", port: "yes" },
      { id: "no", source: "confirm", target: "details", port: "no" },
      { id: "information", source: "information", target: "end", port: "next" },
      { id: "booking", source: "booking", target: "end", port: "next" },
    ],
    flows: [
      { id: "order", kind: "order", label: "Porosi", entryNodeId: "details", nodeIds: ["details", "confirm"] },
      { id: "information", kind: "information", label: "Informacion", entryNodeId: "information", nodeIds: ["information"] },
      { id: "booking", kind: "booking", label: "Rezervim", entryNodeId: "booking", nodeIds: ["booking"] },
    ],
  };
  expect(validateVisualGraph(graph).errors).toEqual([]);
  return { id, businessId, graph, createdAt: "2026-10-14T00:00:00Z" };
}

function order(): ConversationStatePayload {
  const state = migrateContext();
  state.schemaVersion = 3;
  state.context!.execution.factOwner = "order";
  setFact(state, "customer_name", "Ana", "text", "message");
  state.visual = { versionId: "A", nodeId: "details", status: "waiting", awaiting: true, values: { customer_name: "Ana" }, visited: ["start", "details"] };
  state.processes = { active: "order", promptOwner: "order", order: { id: "order-a", status: "active", snapshot: snapshotOrder(state) } };
  return state;
}

const turn = (message: string, state = order(), source: "instagram" | "whatsapp" = "instagram", preview?: VisualVersion) =>
  processConversationMessage({ businessId, message, state, source, hasPhoto: false, mode: preview ? "test" : "production", visualPreview: preview });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  published = "B";
  versions = { A: version("A"), B: version("B"), C: version("C") };
  products = [{ id: productId, business_id: businessId, name: "Bluzë", is_active: true, price_amount: 20, currency: "EUR" }];
  queries = [];
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    queries.push({ table, filters });
    const result = () => {
      if (table === "visual_workflows") return { data: { published_version_id: published, enabled: true }, error: null };
      if (table === "visual_workflow_versions") {
        const found = versions[String(filters.id)];
        return { data: found?.businessId === filters.business_id ? { id: found.id, graph: found.graph, created_at: found.createdAt } : null, error: null };
      }
      if (table === "products") return { data: products.filter(product => product.business_id === filters.business_id && product.is_active === filters.is_active), error: null };
      if (["booking_services", "knowledge_entries", "agent_training_memories"].includes(table)) return { data: [], error: null };
      if (table === "ai_agents") return { data: { instructions: "Përgjigju vetëm për biznesin." }, error: null };
      if (table === "business_discovery") return { data: null, error: null };
      throw new Error(`Unexpected table: ${table}`);
    };
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      in: () => chain, order: () => chain, limit: () => chain, range: () => chain,
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain; // Deliberately no write methods or RPCs.
  });
  mocks.generate.mockResolvedValue({ reply: "Informacion i biznesit.", responseId: null, source: "ai", fallbackReason: null });
  mocks.profile.mockResolvedValue({ enabledModules: ["workflows", "products", "orders", "services", "bookings", "knowledge"] });
  // Booking's external action adapter is outside this version-selection regression.
  mocks.booking.mockImplementation(async ({ state }: { state: ConversationStatePayload }): Promise<AgentTurnResult> => ({
    reply: "Në çfarë date?", nextState: { ...structuredClone(state), step_key: "booking_request", fields: { ...state.fields,
      booking: { nonce: "booking-b", phase: "collect", serviceId: "service-b", expires: Date.now() + 1800000 } } },
    previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
    debug: { model: "test", source: "fallback", fallbackReason: null, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 },
  }));
});
afterEach(() => vi.unstubAllEnvs());

it.each(["instagram", "whatsapp"] as const)("%s continues general order A after B is published", async source => {
  const state = order(); const before = structuredClone(state);
  const result = await turn("Vazhdo porosinë", state, source);
  expect(result.nextState.visual).toMatchObject({ versionId: "A", nodeId: "details" });
  expect(result.reply).toBe("Detajet A?");
  expect(result.nextState.processes?.order?.id).toBe("order-a");
  expect(result.nextState.context?.order.detail_B).toBeUndefined();
  expect(state).toEqual(before);
});

it("accepts the next ordinary field answer on A rather than interpreting it using B", async () => {
  const result = await turn("E kuqe");
  expect(result.nextState.visual).toMatchObject({ versionId: "A", nodeId: "confirm", values: { detail_A: "E kuqe" } });
  expect(result.nextState.context?.order.detail_A.value).toBe("E kuqe");
  expect(result.nextState.context?.order.detail_B).toBeUndefined();
});

it("preserves A and canonical profile through information-only interruption and resume", async () => {
  const info = await turn("Sa kushton?");
  expect(info.nextState.processes?.order?.status).toBe("suspended");
  expect(info.nextState.processes?.order?.snapshot.visual?.versionId).toBe("A");
  const resumed = await turn("Vazhdo porosinë", info.nextState);
  expect(resumed.reply).toBe("Detajet A?");
  expect(resumed.nextState.customer.name).toBe("Ana");
  expect(resumed.conversationRouting?.action).toBe("resume");
});

it("switches order A to booking B and back without replacing either pin", async () => {
  const booking = await turn("Dua rezervim");
  expect(booking.nextState.processes?.booking?.versionId).toBe("B");
  expect(booking.nextState.processes?.order?.snapshot.visual?.versionId).toBe("A");
  published = "C";
  const resumedOrder = await turn("Vazhdo porosinë", booking.nextState);
  expect(resumedOrder.nextState.visual?.versionId).toBe("A");
  expect(resumedOrder.nextState.fields.booking).toBeUndefined();
  const resumedBooking = await turn("Vazhdo rezervimin", resumedOrder.nextState);
  expect(resumedBooking.nextState.visual?.versionId).toBe("B");
  expect(resumedBooking.nextState.processes?.order?.snapshot.visual?.versionId).toBe("A");
});

it.each(["missing", "other tenant"])("refuses a %s pin on resume from booking, without falling back to B", async unavailable => {
  const booking = await turn("Dua rezervim");
  const before = structuredClone(booking.nextState);
  if (unavailable === "missing") delete versions.A;
  else versions.A.businessId = "business-other";
  await expect(turn("Vazhdo porosinë", booking.nextState)).rejects.toThrow("Versioni i rrjedhës nuk është i disponueshëm.");
  expect(booking.nextState).toEqual(before);
  expect(queries).toContainEqual({ table: "visual_workflow_versions", filters: { business_id: businessId, id: "A" } });
});

it("uses published B for a genuinely new order after A is completed", async () => {
  const state = order();
  state.step_key = "order_ready";
  state.visual = { ...state.visual!, nodeId: "end", status: "completed", awaiting: false };
  state.processes!.order = { ...state.processes!.order!, status: "completed", snapshot: snapshotOrder(state) };
  state.processes!.active = null; state.processes!.promptOwner = null;
  const result = await turn("Dua të porosis", state);
  expect(result.nextState.visual?.versionId).toBe("B");
  expect(result.reply).toBe("Detajet B?");
  expect(result.nextState.processes?.order?.id).not.toBe("order-a");
});

it("preserves preview precedence and isolation while live continuation uses A", async () => {
  const preview = await turn("Vazhdo porosinë", order(), "instagram", versions.A);
  expect(preview.nextState.visual?.versionId).toBe("A");
  expect(queries.filter(query => query.table.startsWith("visual_workflow"))).toEqual([]);
  const live = await turn("Vazhdo porosinë");
  expect(live.reply).toBe(preview.reply);
  await expect(turn("Vazhdo porosinë", order(), "instagram", { ...versions.A, businessId: "other" })).rejects.toThrow("invalid_workflow_preview");
});

it.each(["disabled", "deleted"])("does not revive a %s product binding while continuing A", async availability => {
  for (const saved of Object.values(versions)) (saved.graph as VisualGraphV2).flows[0].productIds = [productId];
  if (availability === "disabled") products[0].is_active = false;
  else products = [];
  const state = order(); state.product_id = productId;
  state.visual!.binding = { flowId: "order", entity: { kind: "product", id: productId } };
  state.processes!.order!.snapshot = snapshotOrder(state);
  const result = await turn("Vazhdo porosinë", state);
  expect(result.reply).toContain("nuk është më aktiv");
  expect(result.nextState.visual).toEqual(state.visual);
  expect(result.nextState.context?.order).toEqual(state.context?.order);
  expect(mocks.booking).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});
