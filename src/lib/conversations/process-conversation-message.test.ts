import { beforeEach, expect, it, vi } from "vitest";
import { emptyState, type ConversationStatePayload } from "@/lib/workflows/engine";
import { migrateContext, setFact } from "@/lib/workflows/context";
import { migrateConversationProcesses } from "@/lib/workflows/conversation-processes";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), info: vi.fn(), booking: vi.fn(), guidance: vi.fn(), extract: vi.fn(), version: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/orders/customer-status", async original => ({ ...await original<object>(), customerOrderStatus: mocks.status }));
vi.mock("./process-agent-turn", () => ({ processAgentTurn: mocks.agent, processLegacyAgentTurn: mocks.info }));
vi.mock("@/lib/calendar/agent", () => ({ processBookingTurn: mocks.booking }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
vi.mock("@/lib/workflows/extract-facts", () => ({ extractMessageFacts: mocks.extract, profileExtractionFields: [] }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: mocks.version }));
vi.mock("@/lib/workflows/guidance", async original => ({ ...await original<object>(), chooseGuidance: mocks.guidance }));
import { processConversationMessage } from "./process-conversation-message";
function result(state: ConversationStatePayload, reply = "Vazhdo") {
  return { reply, nextState: structuredClone(state), previousResponseId: null, workflowId: "linear-version-1", productName: "Produkt", workflowProgress: [], debug: { model: "test", source: "fallback", fallbackReason: null, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } };
}
function order() {
  const state = migrateContext({ ...emptyState(), product_id: "product", step_key: "size", fields: { size: "L" } });
  state.context!.execution.linear = { id: "linear", versionId: "v1", name: "Order", steps: [{ key: "size", kind: "choice" }] };
  setFact(state, "customer_name", "Ana", "text", "message");
  return state;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guidance.mockResolvedValue({ action: "continue", target: null, source: "rules" });
  mocks.version.mockResolvedValue(null);
  mocks.extract.mockResolvedValue(0);
  mocks.status.mockImplementation(async ({ state }) => ({ reply: "Status i verifikuar.", nextState: structuredClone(state), pending: false }));
  mocks.agent.mockImplementation(async ({ state }) => result(state));
  mocks.info.mockImplementation(async ({ state }) => result(state, "Çmimi është 20 euro."));
  mocks.booking.mockImplementation(async ({ state }) => { const next = structuredClone(state); next.fields.booking = { nonce: "booking-1", phase: "collect", serviceId: "service", date: "2026-10-15", expires: Date.now() + 60000 }; next.step_key = "booking_request"; return result(next, "Në çfarë ore?"); });
});
const turn = (message: string, state?: ConversationStatePayload) => processConversationMessage({ businessId: "business", message, state, hasPhoto: false, mode: "test" });
it("returns from WhatsApp referral to ordering without losing customer context", async () => {
  const state = order(); state.visual = { versionId: "visual-v1", nodeId: "whatsapp", status: "handoff", awaiting: false, visited: ["whatsapp"], values: {}, advisory: true };
  const next = await turn("Fola me stafin në WhatsApp, tani dua të porosis", state);
  expect(next.conversationRouting?.process).toBe("order");
  expect(next.nextState.customer.name).toBe("Ana");
  expect(next.nextState.processes?.order?.snapshot.execution.linear?.versionId).toBe("v1");
});
it("preserves order and booking through information interruptions and task resumption", async () => {
  const info = await turn("Telefoni im është 0691234567; sa kushton?", order());
  expect(info.nextState.customer.phone).toBe("0691234567");
  expect(info.nextState.step_key).toBe("size");
  const booking = await turn("Dua rezervim më 2026-10-15", info.nextState);
  expect(booking.nextState.processes?.order?.status).toBe("suspended");
  expect(booking.nextState.processes?.booking?.draft?.date).toBe("2026-10-15");
  const resumed = await turn("Vazhdo porosinë", booking.nextState);
  expect(resumed.nextState.step_key).toBe("size");
  expect(resumed.nextState.fields.size).toBe("L");
  expect(resumed.nextState.processes?.booking?.status).toBe("suspended");
  expect(resumed.nextState.context?.execution.linear?.versionId).toBe("v1");
  expect(resumed.nextState.customer.phone).toBe("0691234567");
});
it("does not let yes after an informational question confirm an earlier task", async () => {
  const info = await turn("Sa kushton?", order());
  const next = await turn("Po", info.nextState);
  expect(next.conversationRouting?.action).toBe("clarify");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.booking).not.toHaveBeenCalled();
});
it("asks before replacing unfinished work, and a no resumes it", async () => {
  const first = await turn("Dua porosi të re", order());
  expect(first.nextState.processes?.pendingChoice?.kind).toBe("replace");
  expect(mocks.agent).not.toHaveBeenCalled();
  const next = await turn("Jo", first.nextState);
  expect(next.nextState.product_id).toBe("product");
  expect(next.nextState.processes?.pendingChoice).toBeUndefined();
});
it("asks which independent task first and keeps original booking details for the chosen task", async () => {
  const first = await turn("Dua të porosis dhe dua rezervim më 2026-10-15 në 09:00", order());
  expect(first.conversationRouting?.action).toBe("clarify");
  await turn("Rezervim", first.nextState);
  expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("2026-10-15 në 09:00") }));
});
it("treats booking price questions as information and mixed purchase+price as both", async () => {
  const answer = await turn("Sa kushton rezervimi?", order());
  expect(answer.conversationRouting?.process).toBe("information");
  expect(mocks.booking).not.toHaveBeenCalled();
  const mixed = await turn("Dua të porosis; sa kushton?", order());
  expect(mixed.reply).toContain("Çmimi është 20 euro");
  expect(mixed.reply).toContain("Vazhdo");
  expect(mixed.conversationRouting?.process).toBe("order");
});
it("uses configured information flow guidance without advancing a task", async () => {
  mocks.version.mockResolvedValue({ id: "v2", graph: { version: 2, flows: [{ kind: "information", entryNodeId: "info" }], nodes: [{ id: "info", kind: "knowledge", config: { prompt: "Shpjego transportin" } }] } });
  await turn("Sa kushton?", order());
  expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ informationRequest: true }));
  expect(mocks.info).not.toHaveBeenCalled();
});
it("denies actions after staff took control and does not invoke booking", async () => {
  await expect(processConversationMessage({ businessId: "b", message: "Dua rezervim", hasPhoto: false, state: order(), canAct: async () => false })).rejects.toThrow("conversation_manually_paused");
  expect(mocks.booking).not.toHaveBeenCalled();
});
it("a new order keeps the suspended booking and shared profile", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.step_key = "order_ready";
  state.processes!.order!.status = "completed";
  state.processes!.booking = { id: "booking-1", status: "suspended", draft: { nonce: "booking-1", phase: "collect", date: "2026-10-15", expires: Date.now()+60000 } };
  const next = await turn("Dua të porosis", state);
  expect(next.nextState.product_id).toBeNull();
  expect(next.nextState.customer.name).toBe("Ana");
  expect(next.nextState.processes?.booking?.draft?.date).toBe("2026-10-15");
});

it("retains explicitly collected order facts across an informational detour", async () => {
  const state = order(); state.context!.execution.linear!.steps = [{ key: "size", kind: "choice", label: "Madhësia", options: ["M", "L"] }];
  const first = await turn("Madhësia: M; sa kushton?", state);
  expect(first.nextState.processes?.order?.snapshot.order.size.value).toBe("M");
  const next = await turn("Vazhdo porosinë", first.nextState);
  expect(next.nextState.fields.size).toBe("M");
});
it("stores a photo accompanying a question only for the pending photo step", async () => {
  const state = order(); state.step_key = "photo"; state.context!.execution.linear!.steps = [{ key: "photo", kind: "photo" }];
  const first = await processConversationMessage({ businessId: "business", message: "Sa kushton?", hasPhoto: true, state, mode: "test" });
  expect(first.nextState.processes?.order?.snapshot.order.photo.value).toBe("photo_received");
  expect(first.nextState.processes?.order?.snapshot.fields.photo).toBe(true);
  const unrelated = await processConversationMessage({ businessId: "business", message: "Sa kushton?", hasPhoto: true, state: order(), mode: "test" });
  expect(unrelated.nextState.context?.order.photo).toBeUndefined();
});

it("accepts a named order confirmation after information only when that task awaits confirmation", async () => {
  const state = order(); state.context!.execution.awaitingOrderConfirmation = true;
  const first = await turn("Sa kushton?", state);
  await turn("Konfirmoj porosinë", first.nextState);
  expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ message: "Konfirmoj", orderRequest: false }));
  mocks.agent.mockClear();
  const next = await turn("Konfirmoj porosinë", order());
  expect(next.conversationRouting?.action).toBe("clarify");
  expect(mocks.agent).not.toHaveBeenCalled();
});
it("does not invoke a booking capability removed from a v2 definition", async () => {
  mocks.version.mockResolvedValue({ id: "v2", graph: { version: 2, flows: [{ kind: "order", entryNodeId: "product" }], nodes: [{ id: "product", kind: "product", config: {} }] } });
  const next = await turn("Dua rezervim", order());
  expect(mocks.booking).not.toHaveBeenCalled();
  expect(next.conversationRouting?.process).toBe("information");
  expect(next.nextState.processes?.order?.status).toBe("active");
});
it("keeps pre-pilot production booking behavior behind the single entry point", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  await processConversationMessage({ businessId: "business", message: "Dua rezervim", hasPhoto: false, state: emptyState(), mode: "production" });
  expect(mocks.booking).toHaveBeenCalledWith(expect.not.objectContaining({ routed: true }));
});

it("treats a bare contact channel after handoff as support rather than an order", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
  const next = await turn("WhatsApp", state);
  expect(next.conversationRouting?.process).toBe("support");
  expect(next.nextState.processes?.order).toBeUndefined();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("selected a contact channel") }));
  expect(next.advisoryHandoff).toBe(true);
});

it("answers existing order status without consuming an order or booking confirmation", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.context!.execution.awaitingOrderConfirmation = true;
  state.processes!.order!.snapshot.execution.awaitingOrderConfirmation = true;
  state.processes!.booking = { id: "booking-1", status: "suspended", draft: { nonce: "booking-1", phase: "confirm", date: "2026-10-15", expires: Date.now() + 60000 } };
  const snapshot = structuredClone(state.processes!);
  const next = await turn("Ku është porosia ime?", state);
  expect(next.reply).toBe("Status i verifikuar.");
  expect(next.nextState.processes?.order).toEqual(snapshot.order);
  expect(next.nextState.processes?.booking).toEqual(snapshot.booking);
  expect(next.nextState.processes?.promptOwner).toBeNull();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.booking).not.toHaveBeenCalled();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect((await turn("Po", next.nextState)).conversationRouting?.action).toBe("clarify");
});
it("routes configured status nodes with the isolated callback and restores the active cursor", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.visual = { versionId: "pinned", nodeId: "size", awaiting: true, status: "waiting", values: {}, visited: ["size"] };
  mocks.version.mockResolvedValue({ id: "v2", graph: { version: 2, flows: [{ kind: "information", entryNodeId: "status" }], nodes: [{ id: "status", kind: "order_status", config: {} }] } });
  mocks.agent.mockImplementation(async params => {
    const answer = await params.orderStatusTurn(params.state);
    answer.nextState.visual = { versionId: "v2", nodeId: "end", awaiting: false, status: "completed", values: {}, visited: ["status", "end"] };
    return answer;
  });
  const next = await turn("Statusi i porosisë", state);
  expect(mocks.version).toHaveBeenCalledWith("business", undefined);
  expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ orderStatusRequest: true, state: expect.objectContaining({ visual: expect.objectContaining({ versionId: "v2", nodeId: "status" }) }) }));
  expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({ isolated: true }));
  expect(next.nextState.visual).toEqual(state.visual);
  expect(next.nextState.step_key).toBe("size");
});
it("processes current reference choice before routing or extraction, and ends it on unrelated requests", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.fields.order_status_lookup = { references: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", reference: "AAAAAAAA" }], createdAt: Date.now() };
  const next = await turn("1", state);
  expect(next.reply).toBe("Status i verifikuar.");
  expect(mocks.extract).not.toHaveBeenCalled();
  mocks.status.mockClear();
  const resumed = await turn("Vazhdo porosinë", state);
  expect(mocks.status).not.toHaveBeenCalled();
  expect(resumed.nextState.fields.order_status_lookup).toBeUndefined();
});
it.each(["replace", "process"] as const)("does not accept a stale %s choice after an order status interruption", async kind => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.processes!.pendingChoice = { kind, process: "order", message: "Dua porosi të re" };
  const status = await turn("Ku është porosia ime?", state);
  expect(status.nextState.processes?.pendingChoice).toBeUndefined();
  const next = await turn("Po", status.nextState);
  expect(next.conversationRouting?.action).toBe("clarify");
  expect(next.nextState.product_id).toBe("product");
  expect(next.nextState.processes?.order?.id).toBe("order-1");
  expect(mocks.agent).not.toHaveBeenCalled();
});
it("retains labelled profile facts in a status question without consuming the pending order field", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.processes!.order!.snapshot.execution.orderConfirmed = true;
  state.processes!.order!.snapshot.execution.awaitingOrderConfirmation = true;
  const next = await turn("Telefoni im është 0691234567; ku është porosia ime?", state);
  expect(next.nextState.customer.phone).toBe("0691234567");
  expect(next.nextState.fields.size).toBe("L");
  expect(next.nextState.step_key).toBe("size");
  expect(next.nextState.processes?.order?.snapshot.execution.orderConfirmed).toBe(false);
  expect(next.nextState.processes?.order?.snapshot.execution.awaitingOrderConfirmation).toBe(false);
  expect(mocks.extract).not.toHaveBeenCalled();
});
it("keeps a pending status lookup on its version after publication changes", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  const cursor = { versionId: "status-v1", nodeId: "old-status", awaiting: true, status: "waiting" as const, values: {}, visited: ["old-status"] };
  state.fields.order_status_lookup = { createdAt: Date.now(), references: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", reference: "AAAAAAAA" }], visual: cursor };
  mocks.version.mockResolvedValue({ id: "status-v1", graph: { version: 2, nodes: [{ id: "old-status", kind: "order_status" }] } });
  mocks.agent.mockImplementation(params => params.orderStatusTurn(params.state));
  await turn("1", state);
  expect(mocks.version).toHaveBeenCalledWith("business", "status-v1");
  expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ visual: cursor }) }));
});
it("keeps an expired status reference from answering an active numeric field", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  state.fields.order_status_lookup = { createdAt: Date.now() - 16 * 60 * 1000, references: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", reference: "AAAAAAAA" }] };
  await turn("2", state);
  expect(mocks.status).toHaveBeenCalled();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.extract).not.toHaveBeenCalled();
});
it("does not read real orders until the published workflow enables the status capability", async () => {
  const state = migrateConversationProcesses(order(), () => "order-1");
  mocks.version.mockResolvedValue({ id: "published-without-status", graph: { version: 2, nodes: [{ id: "information", kind: "knowledge" }] } });
  const next = await processConversationMessage({ businessId: "business", message: "Ku është porosia ime?", state, hasPhoto: false, mode: "production",
    customerIdentity: { conversationId: "verified-conversation", instagramParticipantId: "verified-instagram", instagramConnectionId: "verified-connection" } });
  expect(next.reply).toContain("nuk është aktiv");
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(next.nextState.processes?.order).toEqual(state.processes?.order);
});
