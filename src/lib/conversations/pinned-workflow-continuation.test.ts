import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentTurnResult } from "./process-agent-turn";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { VisualGraphV2, VisualNode, VisualVersion } from "@/lib/workflows/visual/types";

const mocks = vi.hoisted(() => ({ from: vi.fn(), generate: vi.fn(), booking: vi.fn(), profile: vi.fn(), user: vi.fn(), access: vi.fn(), bookParse: vi.fn(), slots: vi.fn(), persistBooking: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: mocks.user, requireBusinessAccess: mocks.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test", generateAgentReply: mocks.generate }));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: async () => null }));
vi.mock("@/lib/calendar/agent", () => ({ processBookingTurn: mocks.booking }));
vi.mock("@/lib/calendar/agent-parser", () => ({ extractBookingDetails: mocks.bookParse }));
vi.mock("@/lib/calendar/service", () => ({ availableSlots: mocks.slots, persistBooking: mocks.persistBooking }));
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
import { simulateVisualWorkflow } from "@/lib/workflows/visual/test-actions";
import { readTestSession } from "@/lib/agents/test-chat/session";
import { recordEntityPresentation } from "@/lib/products/entity-bridge";

const businessId = "business-a";
const productId = "00000000-0000-4000-8000-000000000001";
let published: string;
let versions: Record<string, VisualVersion>;
let products: { id: string; business_id: string; name: string; sku?: string; is_active: boolean; price_amount: number; currency: string }[];
let services: { id: string; business_id: string; name: string; is_active: boolean; booking_enabled: boolean; duration_minutes: number; buffer_minutes: number }[];
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
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "b".repeat(64));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in synthetic regression"); }));
  mocks.user.mockResolvedValue({ id: "synthetic-user" });
  mocks.access.mockResolvedValue({ business: { id: businessId } });
  published = "B";
  versions = { A: version("A"), B: version("B"), C: version("C") };
  products = [{ id: productId, business_id: businessId, name: "Bluzë", is_active: true, price_amount: 20, currency: "EUR" }];
  services = [];
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
      if (table === "booking_services") return { data: services.filter(service => Object.entries(filters).every(([key, value]) => service[key as keyof typeof service] === value)), error: null };
      if (table === "business_calendar_settings") return { data: { agent_booking_enabled: true, timezone: "Europe/Tirane", confirmation_mode: "manual" }, error: null };
      if (["knowledge_entries", "agent_training_memories"].includes(table)) return { data: [], error: null };
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
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([
  ["Bluzë", false], ["Dua të porosis Bluzë", false], ["Bluzë", true],
])("blocks an unbound draft product before AI fallback: %s (other binding: %s)", async (message, otherBinding) => {
  const graph = structuredClone(versions.A.graph) as VisualGraphV2;
  graph.flows = [{ ...graph.flows[0], kind: "custom", productIds: otherBinding ? ["00000000-0000-4000-8000-000000000002"] : [] }];
  graph.nodes = graph.nodes.filter(node => !["information", "booking"].includes(node.id));
  graph.edges = graph.edges.filter(edge => !["information", "booking"].includes(edge.source));
  expect(validateVisualGraph(graph).errors).toEqual([]);
  const result = await simulateVisualWorkflow("studio", graph, message);
  expect(result.error).toBeUndefined();
  expect(result.turn?.debug.fallbackReason).toBe("preview_binding_missing");
  expect(result.turn?.nextState.context?.order).toEqual({});
  expect(result.turn?.nextState.visual).toBeUndefined();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(queries.filter(query => query.table.startsWith("visual_workflow"))).toEqual([]);
});

it("keeps general draft order flows usable without product-specific bindings", async () => {
  const result = await simulateVisualWorkflow("studio", versions.A.graph, "Dua të porosis Bluzë");
  expect(result.error).toBeUndefined();
  expect(result.turn?.reply).toBe("Detajet A?");
  expect(result.turn?.nextState.visual?.versionId).toMatch(/^preview:/);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("does not treat an information question about an unbound product as an order", async () => {
  const graph = structuredClone(versions.A.graph) as VisualGraphV2;
  graph.flows[0].kind = "custom";
  const result = await simulateVisualWorkflow("studio", graph, "Sa kushton Bluzë?");
  expect(result.error).toBeUndefined();
  expect(result.turn?.reply).toBe("Informacion i biznesit.");
  expect(result.turn?.nextState.context?.order).toEqual({});
});

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

// Database/catalog and LLM boundaries are fixtures; coordinator, routing, fact
// ownership, version selection and collection execute their production code.
function collecting(key: string, type: "number" | "text") {
  const graph = versions.A.graph as VisualGraphV2;
  graph.nodes.find(node => node.id === "details")!.config = { fieldKey: key, fieldType: type, prompt: `${key}?` };
  graph.flows[0].productIds = [productId];
  const state = order();
  state.product_id = productId;
  state.visual!.binding = { flowId: "order", entity: { kind: "product", id: productId } };
  state.processes!.order!.snapshot = snapshotOrder(state);
  return state;
}

it.each([
  ["quantity", "number", "4"], ["budget", "number", "1500.50"],
  ["size", "text", "M"], ["project_type", "text", "Website"],
  ["custom_reference", "text", "REF-42"],
] as const)("collects declared %s once through the real coordinator", async (key, type, input) => {
  const state = collecting(key, type);
  const result = await turn(input, state);
  expect(result.nextState.visual).toMatchObject({ versionId: "A", nodeId: "confirm", values: { [key]: input } });
  expect(result.nextState.context?.order[key]?.value).toBe(input);
  expect(result.nextState.processes?.order?.snapshot.order[key]?.value).toBe(input);
  expect(result.nextState.product_id).toBe(productId);
  expect(result.nextState.context?.order.child_age).toBeUndefined();
});

it.each([["quantity", "number", "4"], ["size", "text", "M"]] as const)(
  "does not let a catalog SKU intercept the active %s answer", async (key, type, input) => {
    const state = collecting(key, type);
    const otherId = "00000000-0000-4000-8000-000000000002";
    products.push({ ...products[0], id: otherId, name: "Other kit", sku: input });
    (versions.A.graph as VisualGraphV2).flows[0].productIds!.push(otherId);
    const result = await turn(input, state);
    expect(result.nextState.visual).toMatchObject({ nodeId: "confirm", values: { [key]: input } });
    expect(result.nextState.context?.order[key]?.value).toBe(input);
    expect(result.nextState.product_id).toBe(productId);
    expect(result.nextState.processes?.pendingChoice).toBeUndefined();
  });

it.each([["quantity", "number", "42", undefined], ["size", "text", "Large", "Large"]] as const)(
  "keeps a literal %s answer when a catalog name overlaps it", async (key, type, input, sku) => {
    const state = collecting(key, type);
    products.push({ ...products[0], id: "00000000-0000-4000-8000-000000000002", name: input, sku });
    (versions.A.graph as VisualGraphV2).flows[0].productIds!.push(products[1].id);
    const result = await turn(input, state);
    expect(result.nextState.context?.order[key]?.value).toBe(input);
    expect(result.nextState.product_id).toBe(productId);
    expect(result.nextState.processes?.pendingChoice).toBeUndefined();
  });

it.each(["four", "many", "I need 4"])("does not invent numeric extraction for unsupported raw input %s", async input => {
  const result = await turn(input, collecting("quantity", "number"));
  expect(result.nextState.visual?.nodeId).toBe("details");
  expect(result.nextState.context?.order.quantity).toBeUndefined();
});

it("gives collection priority over a bare SKU even with a recent presentation", async () => {
  const state = collecting("quantity", "number");
  products.push({ ...products[0], id: "00000000-0000-4000-8000-000000000002", name: "Other kit", sku: "4" });
  (versions.A.graph as VisualGraphV2).flows[0].productIds!.push(products[1].id);
  const reply = "Bluzë, Other kit";
  recordEntityPresentation(state, businessId, reply, products);
  state.recentMessages = [{ role: "assistant", content: reply }];
  const result = await turn("4", state);
  expect(result.nextState.visual?.nodeId).toBe("confirm");
  expect(result.nextState.context?.order.quantity.value).toBe("4");
  expect(result.nextState.product_id).toBe(productId);
});

it("invalidates a field-bound confirmation when its canonical quantity changes", async () => {
  const first = await turn("4", collecting("quantity", "number"));
  expect(first.nextState.visual?.pendingConfirmation).toBeDefined();
  const previous = first.nextState.visual!.pendingConfirmation!.factsKey;
  setFact(first.nextState, "quantity", "5", "number", "verified_correction");
  const result = await processConversationMessage({ businessId, message: "Po", state: first.nextState, hasPhoto: false, mode: "test" });
  expect(result.nextState.visual?.nodeId).toBe("confirm");
  expect(result.nextState.visual?.pendingConfirmation?.factsKey).not.toBe(previous);
  expect(result.nextState.visual?.confirmedConfirmation).toBeUndefined();
  expect(result.nextState.context?.order.quantity.value).toBe("5");
});

it("does not replay a duplicate numeric answer as confirmation", async () => {
  const first = await turn("4", collecting("quantity", "number"));
  const duplicate = await turn("4", first.nextState);
  expect(duplicate.nextState.visual?.nodeId).toBe("confirm");
  expect(duplicate.nextState.visual?.confirmedConfirmation).toBeUndefined();
  expect(duplicate.nextState.context?.order.quantity.value).toBe("4");
});

it.each(["leje fare", "kerkesen e meparshme", "informacion"])("preserves W1 pending clarification choice: %s", async choice => {
  const state = collecting("quantity", "number");
  const paused = await turn("jo tani", state, "instagram", versions.A);
  const pending = await turn("maybe later please", paused.nextState, "instagram", versions.A);
  expect(pending.nextState.processes?.pendingClarification).toBeDefined();
  const result = await turn(choice, pending.nextState, "instagram", versions.A);
  expect(result.conversationRouting?.reason).toBe(`clarification_${choice === "leje fare" ? "cancel" : choice === "informacion" ? "information" : "resume"}`);
  expect(result.nextState.processes?.pendingClarification).toBeUndefined();
  expect(result.nextState.context?.order.quantity).toBeUndefined();
  if (choice === "kerkesen e meparshme") expect(result.nextState.visual).toMatchObject({ versionId: "A", nodeId: "details" });
  if (choice === "leje fare") expect(result.nextState.processes?.order).toBeUndefined();
  if (choice === "informacion") expect(result.nextState.processes?.informationOnly).toBe(true);
});

it.each(["sku 4", "not Bluzë, Other kit"])("preserves explicit product correction during collection: %s", async message => {
  const state = collecting("quantity", "number");
  products.push({ ...products[0], id: "00000000-0000-4000-8000-000000000002", name: "Other kit", sku: "4" });
  (versions.A.graph as VisualGraphV2).flows[0].productIds!.push(products[1].id);
  const result = await turn(message, state);
  expect(result.nextState.context?.order.quantity).toBeUndefined();
  expect(result.nextState.product_id).toBe(productId);
  expect(result.nextState.processes?.pendingChoice?.kind).toBe("replace");
});

function retailGraph() {
  collecting("size", "text");
  const graph = versions.A.graph as VisualGraphV2;
  graph.nodes.push({ id: "quantity", kind: "collect", label: "Quantity", config: { fieldKey: "quantity", fieldType: "number", prompt: "Quantity?" }, position: { x: 0, y: 0 } });
  graph.edges.find(edge => edge.source === "details")!.target = "quantity";
  graph.edges.push({ id: "quantity-next", source: "quantity", target: "confirm", port: "next" });
  graph.flows[0].nodeIds.push("quantity");
  return graph;
}

it("round-trips a bound retail draft through the real server action, sealed session and coordinator", async () => {
  const graph = retailGraph();
  published = "missing"; // No published graph; this draft is the only execution source.
  const start = await simulateVisualWorkflow("synthetic-retail", graph, "Bluzë");
  expect(start.error).toBeUndefined();
  expect(start.turn!.reply).toBe("size?");
  expect(start.turn!.nextState.context?.order.size).toBeUndefined(); // Selecting a product is not a size answer.
  const size = await simulateVisualWorkflow("synthetic-retail", graph, "M", start.session);
  expect(size.turn!.reply).toBe("Quantity?");
  const invalid = await simulateVisualWorkflow("synthetic-retail", graph, "many", size.session);
  expect(invalid.turn!.nextState.visual?.nodeId).toBe("quantity");
  const info = await simulateVisualWorkflow("synthetic-retail", graph, "What does this product include?", invalid.session);
  expect(info.turn!.nextState.context?.order.size.value).toBe("M");
  expect(info.turn!.nextState.context?.order.quantity).toBeUndefined();
  const resume = await simulateVisualWorkflow("synthetic-retail", graph, "Vazhdo porosinë", info.session);
  expect(resume.turn!.reply).toBe("Quantity?");
  const quantity = await simulateVisualWorkflow("synthetic-retail", graph, "4", resume.session);
  expect(quantity.turn!.nextState.visual?.nodeId).toBe("confirm");
  const sealed = readTestSession(quantity.session!, "synthetic-user", businessId);
  expect(sealed.state.context?.order).toMatchObject({ size: { value: "M" }, quantity: { value: "4" } });
  expect(sealed.visualPreviewId).toBe(sealed.state.visual!.versionId);
  expect(sealed.state.processes?.order?.snapshot.visual?.versionId).toBe(sealed.visualPreviewId);
  expect(queries.filter(query => query.table.startsWith("visual_workflow"))).toEqual([]);
  expect(mocks.booking).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["products", "orders", "workflows"])("does not consume the pending field with %s disabled", async disabled => {
  const state = collecting("quantity", "number");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", businessId);
  mocks.profile.mockResolvedValue({ enabledModules: ["products", "orders", "workflows"].filter(module => module !== disabled) });
  const onTrace = vi.fn();
  const result = await processConversationMessage({ businessId, message: "4", state, hasPhoto: false, mode: "test", onTrace });
  expect(result.nextState.visual).toEqual(state.visual);
  expect(result.nextState.context?.order).toEqual(state.context?.order);
  expect(onTrace).toHaveBeenCalledWith(expect.objectContaining({ label: "Runtime capability blocked", data: expect.objectContaining({ reasonCode: "module_disabled", validation: "not_executed" }) }));
});

it("never resolves a bound product from another tenant while accepting a field", async () => {
  const state = collecting("quantity", "number");
  products[0].business_id = "other-tenant";
  const result = await turn("4", state);
  expect(result.nextState.context?.order.quantity).toBeUndefined();
  expect(result.nextState.visual?.nodeId).toBe("details");
  expect(queries.filter(query => query.table === "products").every(query => query.filters.business_id === businessId)).toBe(true);
});

it.each([1, 2, 3])("reads schema v%s without replaying completedVisual facts", async schemaVersion => {
  const state = collecting("quantity", "number");
  state.schemaVersion = schemaVersion as ConversationStatePayload["schemaVersion"];
  if (schemaVersion !== 3) delete state.processes;
  state.completedVisual = { ...structuredClone(state.visual!), status: "completed", values: { quantity: "99" } };
  const result = await turn("4", state);
  expect(result.nextState.context?.order.quantity.value).toBe("4");
  expect(result.nextState.visual?.versionId).toBe("A");
  expect(result.nextState.schemaVersion).toBe(3);
});

it("keeps an information-only business out of collection and action adapters", async () => {
  const graph: VisualGraphV2 = { version: 2, name: "Synthetic information", nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "info", kind: "knowledge", label: "Info", position: { x: 0, y: 0 }, config: {} },
    { id: "end", kind: "end", label: "End", position: { x: 0, y: 0 }, config: {} },
  ], edges: [{ id: "s", source: "start", target: "info", port: "next" }, { id: "e", source: "info", target: "end", port: "next" }],
    flows: [{ id: "info", label: "Information", kind: "information", entryNodeId: "info", nodeIds: ["info"] }] };
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", businessId);
  mocks.profile.mockResolvedValue({ enabledModules: ["workflows", "knowledge"] });
  const result = await simulateVisualWorkflow("synthetic-information", graph, "What are your hours?");
  expect(result.error).toBeUndefined();
  expect(result.turn!.nextState.context?.order).toEqual({});
  expect(result.turn!.nextState.processes?.order).toBeUndefined();
  expect(result.turn!.nextState.processes?.booking).toBeUndefined();
  expect(result.turn!.externalActions ?? []).toEqual([]);
  expect(mocks.booking).not.toHaveBeenCalled();
});

it("collects quote fields in their service process across interruption, without leaking into an order", async () => {
  const state = collecting("quantity", "number");
  setFact(state, "quantity", "7", "number", "test");
  state.processes!.order!.snapshot = snapshotOrder(state);
  const graph = versions.A.graph as VisualGraphV2;
  const serviceId = "00000000-0000-4000-8000-000000000003";
  services = [{ id: serviceId, business_id: businessId, name: "Web project", is_active: true, booking_enabled: false, duration_minutes: 30, buffer_minutes: 0 }];
  graph.nodes.push(
    { id: "project", kind: "collect", label: "Project", config: { fieldKey: "project_type", fieldType: "text", prompt: "Project type?" }, position: { x: 0, y: 0 } },
    { id: "budget", kind: "collect", label: "Budget", config: { fieldKey: "budget", fieldType: "number", prompt: "Budget?" }, position: { x: 0, y: 0 } },
    { id: "reference", kind: "collect", label: "Reference", config: { fieldKey: "custom_reference", prompt: "Reference?" }, position: { x: 0, y: 0 } },
  );
  graph.edges.push({ id: "project-budget", source: "project", target: "budget", port: "next" },
    { id: "budget-reference", source: "budget", target: "reference", port: "next" }, { id: "reference-end", source: "reference", target: "end", port: "next" });
  graph.flows.push({ id: "quote", kind: "custom", label: "Quote", entryNodeId: "project", nodeIds: ["project", "budget", "reference"], serviceIds: [serviceId] });
  const start = await turn("Web project", state, "instagram", versions.A);
  expect(start.reply).toBe("Project type?");
  const project = await turn("Website", start.nextState, "instagram", versions.A);
  expect(project.reply).toBe("Budget?");
  const info = await turn("What does this include?", project.nextState, "instagram", versions.A);
  expect(info.nextState.processes?.service?.order?.project_type.value).toBe("Website");
  const invalid = await turn("many", info.nextState, "instagram", versions.A);
  expect(invalid.nextState.processes?.service?.visual.nodeId).toBe("budget");
  // A historical product list must not impose Orders/Products permissions on a quote field.
  recordEntityPresentation(invalid.nextState, businessId, "Bluzë", products);
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", businessId);
  mocks.profile.mockResolvedValue({ enabledModules: ["services", "workflows", "knowledge"] });
  const budget = await turn("1500.50", invalid.nextState, "instagram", versions.A);
  expect(budget.reply).toBe("Reference?");
  expect(budget.nextState.processes?.service?.order).toMatchObject({ project_type: { value: "Website" }, budget: { value: "1500.50" } });
  expect(budget.nextState.context?.order.budget).toBeUndefined();
  expect(budget.nextState.processes?.order?.snapshot.order).toEqual({ quantity: expect.objectContaining({ value: "7" }) });
  expect(budget.nextState.processes?.service?.order?.quantity).toBeUndefined();
  expect(budget.externalActions ?? []).toEqual([]);
});

it("validates dates with the existing booking adapter, not a fictitious visual date type", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calendar/agent")>("@/lib/calendar/agent");
  mocks.booking.mockImplementation(actual.processBookingTurn);
  const serviceId = "00000000-0000-4000-8000-000000000003";
  services = [{ id: serviceId, business_id: businessId, name: "Consultation", is_active: true, booking_enabled: true, duration_minutes: 30, buffer_minutes: 0 }];
  const graph = versions.A.graph as VisualGraphV2;
  graph.flows.find(flow => flow.id === "booking")!.serviceIds = [serviceId];
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", businessId);
  mocks.profile.mockResolvedValue({ enabledModules: ["services", "bookings", "workflows", "knowledge"] });
  mocks.bookParse.mockResolvedValue({ bookingIntent: true, cancel: false, serviceId, date: null, time: null, name: null, contact: null });
  const start = await simulateVisualWorkflow("synthetic-appointments", graph, "Consultation");
  expect(start.error).toBeUndefined();
  expect(start.turn!.reply).toContain("dat");
  mocks.bookParse.mockResolvedValue({ bookingIntent: true, cancel: false, serviceId, date: "2026-02-30", time: null, name: null, contact: null });
  const invalid = await simulateVisualWorkflow("synthetic-appointments", graph, "2026-02-30", start.session);
  expect(invalid.turn!.nextState.processes?.booking?.draft?.date).toBeUndefined();
  expect(mocks.slots).not.toHaveBeenCalled();
  mocks.slots.mockResolvedValue([{ start: "2026-12-15T08:00:00Z", end: "2026-12-15T08:30:00Z", blockedUntil: "2026-12-15T08:30:00Z" }]);
  mocks.bookParse.mockResolvedValue({ bookingIntent: true, cancel: false, serviceId, date: "2026-12-15", time: null, name: null, contact: null });
  const valid = await simulateVisualWorkflow("synthetic-appointments", graph, "2026-12-15", invalid.session);
  expect(valid.turn!.nextState.processes?.booking?.draft?.date).toBe("2026-12-15");
  expect(valid.turn!.nextState.processes?.order).toBeUndefined();
  expect(valid.turn!.nextState.context?.order).toEqual({});
  expect(mocks.persistBooking).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
