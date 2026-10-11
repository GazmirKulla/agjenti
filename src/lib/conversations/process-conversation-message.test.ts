import { beforeEach, expect, it, vi } from "vitest";
import { emptyState, type ConversationStatePayload } from "@/lib/workflows/engine";
import { advanceSharedOrder, extractExplicitFacts, migrateContext, setFact, sharedPrompt } from "@/lib/workflows/context";
import { migrateConversationProcesses } from "@/lib/workflows/conversation-processes";
import { rememberTurn } from "@/lib/workflows/guidance";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), info: vi.fn(), booking: vi.fn(), guidance: vi.fn(), extract: vi.fn(), version: vi.fn(), status: vi.fn(), entity: vi.fn() }));
vi.mock("@/lib/workflows/visual/entity-routing", async original => ({ ...await original<object>(), resolveVisualEntity: mocks.entity }));
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
  vi.unstubAllEnvs();
  mocks.guidance.mockResolvedValue({ action: "continue", target: null, source: "rules" });
  mocks.version.mockResolvedValue(null);
  mocks.entity.mockResolvedValue({});
  mocks.extract.mockResolvedValue(0);
  mocks.status.mockImplementation(async ({ state }) => ({ reply: "Status i verifikuar.", nextState: structuredClone(state), pending: false }));
  mocks.agent.mockImplementation(async ({ state }) => result(state));
  mocks.info.mockImplementation(async ({ state }) => result(state, "Çmimi është 20 euro."));
  mocks.booking.mockImplementation(async ({ state }) => { const next = structuredClone(state); next.fields.booking = { nonce: "booking-1", phase: "collect", serviceId: "service", date: "2026-10-15", expires: Date.now() + 60000 }; next.step_key = "booking_request"; return result(next, "Në çfarë ore?"); });
});
const turn = (message: string, state?: ConversationStatePayload) => processConversationMessage({ businessId: "business", message, state, hasPhoto: false, mode: "test" });
it.each([true, false])("migrates a production booking using its pinned graph (draft=%s)", async withDraft => {
  const state = emptyState(); state.schemaVersion = 2;
  state.visual = { versionId: "old-booking", nodeId: "booking", status: "waiting", awaiting: true, visited: ["booking"], values: { note: "Keep me" } };
  if (withDraft) { state.step_key = "booking_request"; state.fields.booking = { nonce: "legacy-booking", phase: "collect", date: "2026-10-15", expires: 1900000000000 }; }
  mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "new-publication"));
  const guard = { jobId: 1, leaseToken: "lease", conversationId: "conversation", revision: 2 };
  const next = await processConversationMessage({ businessId: "business", message: "09:00", state, hasPhoto: false, source: "whatsapp", bookingGuard: guard });
  expect(mocks.version).toHaveBeenCalledWith("business", "old-booking");
  expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ bookingRequest: true, bookingGuard: guard,
    state: expect.objectContaining({ visual: state.visual }), entityVersion: expect.objectContaining({ id: "old-booking" }) }));
  expect(next.nextState.processes?.order).toBeUndefined();
  expect(next.nextState.processes?.booking?.visual).toEqual(state.visual);
  expect(next.nextState.processes?.booking?.versionId).toBe("old-booking");
});

it("preserves a legacy booking cursor when migration starts with an order-status interruption", async () => {
  const state = emptyState(); state.schemaVersion = 2;
  state.visual = { versionId: "old-booking", nodeId: "booking", status: "waiting", awaiting: true, visited: [], values: {} };
  mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "new-publication"));
  const answer = await turn("Ku eshte porosia ime?", state);
  expect(answer.nextState.processes?.booking?.visual).toEqual(state.visual);
  expect(answer.nextState.processes?.booking?.versionId).toBe("old-booking");
  expect(answer.nextState.processes?.order).toBeUndefined();
  expect(answer.nextState.processes?.promptOwner).toBeNull();
});

it("resumes the migrated booking's pinned cursor after switching to an order", async () => {
  const state = emptyState(); state.schemaVersion = 2;
  state.visual = { versionId: "old-booking", nodeId: "booking", status: "waiting", awaiting: true, visited: ["booking"], values: { note: "Kontroll" } };
  state.step_key = "booking_request";
  state.fields.booking = { nonce: "legacy-booking", phase: "collect", date: "2026-10-15", expires: 1900000000000 };
  mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "new-publication"));
  mocks.agent.mockImplementation(async params => {
    const next = structuredClone(params.state);
    if (!params.bookingRequest) {
      next.product_id = "puzzle"; next.step_key = "size"; delete next.fields.booking;
      next.visual = { versionId: "new-publication", nodeId: "product", status: "waiting", awaiting: true, visited: ["product"], values: {} };
    }
    return result(next);
  });
  const orderTurn = await turn("Dua të porosis", state);
  expect(orderTurn.nextState.processes?.booking?.status).toBe("suspended");
  const resumed = await turn("Vazhdo rezervimin", orderTurn.nextState);
  expect(resumed.conversationRouting?.action).toBe("resume");
  expect(resumed.nextState.processes?.booking).toMatchObject({ id: "legacy-booking", versionId: "old-booking", visual: state.visual, draft: state.fields.booking });
  expect(resumed.nextState.processes?.order?.status).toBe("suspended");
  expect(mocks.agent.mock.lastCall![0].state.visual).toEqual(state.visual);
});

it("continues a business discovery answer without inventing an order", async () => {
  const state = emptyState();
  state.recentMessages = [{ role: "user", content: "si funksionon" }, { role: "assistant", content: "Çfarë lloj biznesi keni?" }];
  const next = await turn("kam nje klinike dentare", state);
  expect(next.conversationRouting?.process).toBe("information");
  expect(next.nextState.processes?.active).toBeNull();
  expect(next.nextState.processes?.order).toBeUndefined();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.guidance).toHaveBeenCalledWith(expect.objectContaining({ current: expect.objectContaining({ prompt: "Çfarë lloj biznesi keni?", kind: "information" }) }));
  expect(mocks.info.mock.lastCall![0].state.recentMessages).toEqual(expect.arrayContaining(state.recentMessages!));
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("without starting an order") }));
});
it.each(["Përshëndetje", "Kam një biznes", "Faleminderit"])("does not default %s to product selection", async message => {
  const next = await turn(message);
  expect(next.conversationRouting?.process).toBe("information");
  expect(mocks.agent).not.toHaveBeenCalled();
});
it("still starts ordering when requested after business discovery", async () => {
  const state = (await turn("kam nje klinike dentare")).nextState;
  const next = await turn("Dua të porosis", state);
  expect(next.conversationRouting?.process).toBe("order");
  expect(mocks.agent).toHaveBeenCalled();
});
it("keeps ordinary field answers in an active order", async () => {
  const next = await turn("M", order());
  expect(next.conversationRouting?.process).toBe("order");
  expect(mocks.agent).toHaveBeenCalled();
});
it("gives the router the actual pending field and last question", async () => {
  const state = order();
  state.context!.execution.linear!.steps = [{ key: "size", kind: "choice", label: "Madhësia", fieldKey: "size", prompt: "Çfarë madhësie dëshironi?" }];
  state.recentMessages = [{ role: "assistant", content: "Çfarë madhësie dëshironi?" }];
  await turn("Medium", state);
  expect(mocks.guidance).toHaveBeenCalledWith(expect.objectContaining({ current: expect.objectContaining({ id: "order", fieldKey: "size", prompt: "Çfarë madhësie dëshironi?" }) }));
});
it("clarifies uncertain navigation without consuming the pending field or inventing a process choice", async () => {
  const state = order(), before = structuredClone(state);
  mocks.guidance.mockResolvedValue({ action: "clarify", target: null, source: "ai" });
  const next = await turn("Dua të ndryshoj diçka", state);
  expect(next.conversationRouting).toMatchObject({ process: "clarify", action: "clarify", source: "ai" });
  expect(next.nextState.processes?.pendingChoice).toBeUndefined();
  expect(next.reply).not.toContain("porosinë apo rezervimin");
  expect(next.nextState.fields).toEqual(before.fields);
  expect(next.nextState.step_key).toBe(before.step_key);
  expect(mocks.agent).not.toHaveBeenCalled();
});
it.each(["Pse duhet rezervimi?", "Çfarë shërbimesh keni", "Pse ju duhet adresa"])("answers the interruption without executing a task: %s", async message => {
  const next = await turn(message, order());
  expect(next.conversationRouting?.process).toBe("information");
  expect(next.nextState.step_key).toBe("size");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.booking).not.toHaveBeenCalled();
});
it("answers a question during replacement confirmation and requires a fresh decision", async () => {
  const proposal = await turn("Dua porosi të re", order());
  const info = await turn("Sa kushton?", proposal.nextState);
  expect(info.conversationRouting?.process).toBe("information");
  expect(info.nextState.product_id).toBe("product");
  expect(info.nextState.processes?.pendingChoice).toBeUndefined();
  expect((await turn("Po", info.nextState)).conversationRouting?.action).toBe("answer");
  expect(mocks.agent).not.toHaveBeenCalled();
  const resume = await turn("Vazhdo porosinë", info.nextState);
  expect(resume.nextState.product_id).toBe("product");
});
it("preserves details of a mixed request while answering a question before process selection", async () => {
  const first = await turn("Dua të porosis dhe dua rezervim më 2026-10-15 në 09:00", order());
  const info = await turn("Çfarë shërbimesh keni?", first.nextState);
  expect(info.conversationRouting?.process).toBe("information");
  expect(mocks.booking).not.toHaveBeenCalled();
  await turn("Rezervim", info.nextState);
  expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("2026-10-15 në 09:00") }));
});
it.each(["A mund të rezervoj nesër?", "Dua edhe një rezervim"])("switches to an explicitly requested booking and resumes the pinned order: %s", async message => {
  const next = await turn(message, order());
  expect(next.conversationRouting).toMatchObject({ process: "booking", suspended: "order" });
  const info = await turn("Çfarë shërbimesh keni", next.nextState);
  expect(info.conversationRouting?.process).toBe("information");
  expect(info.nextState.processes?.booking?.draft).toEqual(next.nextState.processes?.booking?.draft);
  const resume = await turn("Vazhdo porosinë", info.nextState);
  expect(resume.conversationRouting).toMatchObject({ process: "order", action: "resume", suspended: "booking" });
  expect(resume.nextState.context?.execution.linear?.versionId).toBe("v1");
  expect(resume.nextState.fields.size).toBe("L");
});
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
  expect(next.conversationRouting?.action).toBe("answer");
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
it("keeps legacy Instagram routing while passing the queue guard to effects", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  const bookingGuard = { jobId: 1, leaseToken: "lease", conversationId: "conversation", revision: 4 };
  const state = emptyState();
  mocks.booking.mockResolvedValueOnce(null);
  await processConversationMessage({ businessId: "business", source: "instagram", message: "M", hasPhoto: false, state, mode: "production", bookingGuard });
  expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ state, bookingGuard }));
  expect(mocks.guidance).not.toHaveBeenCalled();
  expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ bookingGuard }));
});

it("treats a bare contact channel after handoff as support rather than an order", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
  const next = await turn("WhatsApp", state);
  expect(next.conversationRouting?.process).toBe("support");
  expect(next.nextState.processes?.order).toBeUndefined();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("after being referred to staff") }));
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
  expect((await turn("Po", next.nextState)).conversationRouting?.action).toBe("answer");
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
  expect(next.conversationRouting?.action).toBe("answer");
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

function entityVersion(id = "bound-v1") {
  return { id, businessId: "business", createdAt: "now", graph: { version: 2, name: "Bound", edges: [], nodes: [
    { id: "product", kind: "product", config: {} }, { id: "details", kind: "collect", config: { fieldKey: "details" } },
    { id: "booking", kind: "booking", config: {} },
  ], flows: [
    { id: "order-flow", kind: "order", entryNodeId: "product", nodeIds: ["product"], productIds: ["puzzle"] },
    { id: "service-flow", kind: "custom", entryNodeId: "details", nodeIds: ["details"], serviceIds: ["consult"] },
    { id: "booking-flow", kind: "booking", entryNodeId: "booking", nodeIds: ["booking"], serviceIds: ["session"] },
  ] } };
}
function entityResult(id: "puzzle" | "consult" | "session") {
  const kind = id === "puzzle" ? "product" : "service";
  return { selected: { entity: { id, kind, name: id, bookingEnabled: id === "session" }, binding: { flowId: id === "puzzle" ? "order-flow" : id === "consult" ? "service-flow" : "booking-flow", entity: { id, kind } } } };
}
function boundState() {
  const state = order(); state.product_id = "puzzle";
  state.visual = { versionId: "bound-v1", nodeId: "product", status: "waiting", awaiting: true, visited: ["product"], values: {}, binding: { flowId: "order-flow", entity: { id: "puzzle", kind: "product" } } };
  return migrateConversationProcesses(state, () => "order-task");
}
it("routes a named bound product out of an active booking before adapting state", async () => {
  const state = migrateConversationProcesses(emptyState(), () => "id");
  state.processes!.active = "booking"; state.processes!.promptOwner = "booking";
  state.processes!.booking = { id: "b", status: "active", draft: { nonce: "b", phase: "collect", serviceId: "session", expires: Date.now()+60000 } };
  mocks.version.mockResolvedValue(entityVersion()); mocks.entity.mockResolvedValue(entityResult("puzzle"));
  const next = await turn("Puzzle", state);
  expect(next.conversationRouting?.process).toBe("order");
  expect(next.nextState.processes?.booking?.status).toBe("suspended");
  expect(mocks.agent).toHaveBeenCalledWith(expect.not.objectContaining({ bookingRequest: true }));
  expect(mocks.booking).not.toHaveBeenCalled();
});
it("resumes an order's pinned graph after visiting a service on a newer publication", async () => {
  const state = boundState(); state.processes!.order!.status = "suspended"; state.processes!.active = null;
  state.visual = { versionId: "bound-v2", nodeId: "details", status: "waiting", awaiting: true, visited: ["details"], values: {}, binding: { flowId: "service-flow", entity: { id: "consult", kind: "service" } } };
  state.processes!.service = { id: "s", versionId: "bound-v2", status: "active", visual: state.visual, fields: {}, order: {} };
  mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "bound-v2"));
  mocks.entity.mockImplementation(async (_b, _g, message) => message.includes("Puzzle") ? entityResult("puzzle") : {});
  const next = await turn("Vazhdo porosinë Puzzle", state);
  expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: expect.objectContaining({ id: "bound-v1" }), state: expect.objectContaining({ visual: expect.objectContaining({ versionId: "bound-v1" }) }) }));
  expect(next.nextState.processes?.order?.snapshot.visual?.versionId).toBe("bound-v1");
  expect(next.nextState.processes?.service?.status).toBe("suspended");
});
it("uses latest bindings for a new service while keeping the previous order snapshot", async () => {
  const state = boundState();
  mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "bound-v2"));
  mocks.entity.mockImplementation(async (_b, graph, message) => message === "Konsultë" && graph ? entityResult("consult") : {});
  mocks.agent.mockImplementation(async ({ state }) => { const next = structuredClone(state); next.visual.status = "waiting"; return result(next, "Çfarë të duhet?"); });
  const next = await turn("Konsultë", state);
  expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: expect.objectContaining({ id: "bound-v2" }), state: expect.objectContaining({ product_id: null, fields: {} }) }));
  expect(next.nextState.processes?.order?.snapshot.visual?.versionId).toBe("bound-v1");
  expect(next.nextState.processes?.order?.status).toBe("suspended");
  expect(next.nextState.processes?.service?.versionId).toBe("bound-v2");
});
it("does not turn product price questions into new orders or bookings", async () => {
  mocks.version.mockResolvedValue(entityVersion());
  const next = await turn("Sa kushton Puzzle?");
  expect(next.conversationRouting?.process).toBe("information");
  expect(next.nextState.processes?.order).toBeUndefined(); expect(next.nextState.processes?.booking).toBeUndefined();
  expect(mocks.entity).not.toHaveBeenCalled();
});
it("resumes isolated nonbookable service fields using their original graph and rejects stale yes", async () => {
  const state = boundState(); state.processes!.order!.status = "suspended"; state.processes!.active = null;
  const visual = { versionId: "service-old", nodeId: "details", status: "waiting" as const, awaiting: true, visited: ["details"], values: { details: "Help" }, binding: { flowId: "service-flow", entity: { id: "consult", kind: "service" as const } } };
  state.processes!.service = { id: "s", versionId: "service-old", status: "suspended", visual, fields: { details: "Help" }, order: {} };
  mocks.version.mockImplementation(async (_b, id) => entityVersion(id ?? "latest"));
  mocks.entity.mockImplementation(async (_b, _g, message, saved) => message === "Konsultë" || saved?.entity.id === "consult" ? entityResult("consult") : {});
  const next = await turn("Konsultë", state);
  expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: expect.objectContaining({ id: "service-old" }), state: expect.objectContaining({ product_id: null, fields: { details: "Help" } }) }));
  const info = await turn("Sa kushton?", next.nextState);
  mocks.agent.mockClear();
  const stale = await turn("Po", info.nextState);
  expect(stale.reply).toBe("Në rregull 😊"); expect(mocks.agent).not.toHaveBeenCalled();
  expect(stale.nextState.processes?.order?.snapshot.product_id).toBe("puzzle");
});
it("requires replacement confirmation before changing a booked service", async () => {
  const state = migrateConversationProcesses(emptyState(), () => "id"); state.processes!.active = "booking";
  state.processes!.booking = { id: "b", status: "active", draft: { nonce: "b", phase: "collect", serviceId: "other", expires: Date.now()+60000 } };
  mocks.version.mockResolvedValue(entityVersion()); mocks.entity.mockResolvedValue(entityResult("session"));
  const next = await turn("Session", state);
  expect(next.nextState.processes?.pendingChoice?.kind).toBe("replace");
  expect(next.nextState.processes?.booking?.draft?.serviceId).toBe("other");
  expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
});
it.each(["removed", "disabled"])("does not reuse a completed product's old binding when latest publication is %s", async scenario => {
  const state = boundState(); state.step_key = "order_ready"; state.visual!.status = "completed";
  state.processes!.order!.status = "completed"; state.processes!.active = null;
  const latest = scenario === "disabled" ? null : entityVersion("latest");
  if (latest) latest.graph.flows.forEach(flow => { flow.productIds = []; });
  mocks.version.mockImplementation(async (_b, id) => id ? entityVersion(id) : latest);
  mocks.entity.mockImplementation(async (_b, graph) => graph.flows.some((flow: { productIds?: string[] }) => flow.productIds?.includes("puzzle")) ? entityResult("puzzle") : {});
  await turn("Puzzle", state);
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: latest }));
  expect(state.processes!.order!.status).toBe("completed");
});
it.each(["removed", "disabled"])("does not restart a completed service on an obsolete graph when publication is %s", async scenario => {
  const state = migrateConversationProcesses(emptyState(), () => "id");
  state.visual = { versionId: "old", nodeId: "details", status: "completed", awaiting: false, visited: ["details"], values: {}, binding: { flowId: "service-flow", entity: { id: "consult", kind: "service" } } };
  state.processes!.service = { id: "s", versionId: "old", status: "completed", visual: state.visual, fields: {}, order: {} };
  const latest = scenario === "disabled" ? null : entityVersion("latest");
  if (latest) latest.graph.flows.forEach(flow => { flow.serviceIds = []; });
  mocks.version.mockImplementation(async (_b, id) => id ? entityVersion(id) : latest);
  mocks.entity.mockImplementation(async (_b, graph) => graph.flows.some((flow: { serviceIds?: string[] }) => flow.serviceIds?.includes("consult")) ? entityResult("consult") : {});
  await turn("Konsultë", state);
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: latest }));
  expect(state.processes!.service!.status).toBe("completed");
});
it.each(["removed", "disabled"])("a completed booking cannot reuse its old capability after latest publication is %s", async scenario => {
  const state = migrateConversationProcesses(emptyState(), () => "id");
  state.visual = { versionId: "old", nodeId: "booking", status: "completed", awaiting: false, visited: ["booking"], values: {}, binding: { flowId: "booking-flow", entity: { id: "session", kind: "service" } } };
  state.processes!.booking = { id: "old-booking", versionId: "old", status: "completed", visual: state.visual };
  const latest = scenario === "disabled" ? null : entityVersion("latest");
  if (latest) { latest.graph.flows = latest.graph.flows.filter(flow => flow.kind !== "booking"); latest.graph.nodes = latest.graph.nodes.filter(node => node.kind !== "booking"); }
  mocks.version.mockImplementation(async (_b, id) => id ? entityVersion(id) : latest);
  mocks.entity.mockImplementation(async (_b, graph) => graph.flows.some((flow: { serviceIds?: string[] }) => flow.serviceIds?.includes("session")) ? entityResult("session") : {});
  const next = await turn("Dua rezervim session", state);
  expect(mocks.booking).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled();
  expect(next.nextState.processes?.booking).toBeUndefined();
  expect(next.reply).toContain("kontakto stafin");
});
it("a new booking uses latest version and a fresh task after the previous booking completed", async () => {
  const state = migrateConversationProcesses(emptyState(), () => "id");
  state.visual = { versionId: "old", nodeId: "booking", status: "completed", awaiting: false, visited: ["booking"], values: {}, binding: { flowId: "booking-flow", entity: { id: "session", kind: "service" } } };
  state.processes!.booking = { id: "old-booking", versionId: "old", status: "completed", visual: state.visual };
  mocks.version.mockImplementation(async (_b, id) => entityVersion(id ?? "latest")); mocks.entity.mockResolvedValue(entityResult("session"));
  mocks.agent.mockImplementation(async ({ state, entityVersion }) => { const next = structuredClone(state); next.visual = { versionId: entityVersion.id, nodeId: "booking", status: "waiting", awaiting: true, values: {}, visited: ["booking"] }; next.fields.booking = { nonce: "new-nonce", phase: "collect" }; return result(next); });
  const next = await turn("Dua rezervim session", state);
  expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: expect.objectContaining({ id: "latest" }), state: expect.objectContaining({ visual: undefined }) }));
  expect(next.nextState.processes?.booking?.id).toBe("new-nonce"); expect(next.nextState.processes?.booking?.versionId).toBe("latest");
});
it("declining a product replacement restores the old graph instead of using the new publication", async () => {
  const state = boundState(); state.processes!.pendingChoice = { kind: "replace", process: "order", message: "Dua Poster" };
  state.recentMessages=[{role:"assistant",content:"Ta zëvendësojmë porosinë me Poster? Shkruaj Po ose Jo."}];
  mocks.version.mockImplementation(async (_b, id) => entityVersion(id ?? "latest"));
  await turn("Jo", state);
  expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ entityVersion: undefined, message: "Vazhdo porosinë", state: expect.objectContaining({ visual: expect.objectContaining({ versionId: "bound-v1" }) }) }));
});
it("an ambiguous entity question cannot leave an older confirmation owned by the order", async () => {
  const state = boundState(); state.context!.execution.awaitingOrderConfirmation = true;
  mocks.version.mockResolvedValue(entityVersion());
  mocks.entity.mockResolvedValue({ choices: [{ kind: "product", id: "a", name: "Puzzle" }, { kind: "service", id: "b", name: "Puzzle" }] });
  const onTrace = vi.fn();
  const next = await processConversationMessage({ businessId: "business", message: "Puzzle", state, mode: "test", hasPhoto: false, onTrace });
  expect(next.nextState.processes?.promptOwner).toBeNull();
  expect(next.conversationRouting).toMatchObject({ process: "clarify", action: "clarify" });
  expect(next.nextState.processes?.lastDecision).toEqual(next.conversationRouting);
  expect(onTrace.mock.calls.filter(([event]) => event.label === "Conversation process selected")).toHaveLength(1);
  expect(onTrace.mock.calls.find(([event]) => event.label === "Conversation coordinator completed")![0].data).toMatchObject({ process: "clarify", action: "clarify" });
  expect(next.nextState.recentMessages?.slice(-2)).toEqual([{ role: "user", content: "Puzzle" }, { role: "assistant", content: next.reply }]);
  mocks.entity.mockResolvedValue({});
  mocks.info.mockImplementationOnce(async ({ state }) => {
    expect(state.recentMessages).toEqual(next.nextState.recentMessages);
    return result(state, "Sqarimi");
  });
  await turn("ku?", next.nextState);
  expect(mocks.info).toHaveBeenCalledOnce();
  expect((await turn("Po", next.nextState)).conversationRouting?.action).toBe("answer");
});
it("remembers a stale service confirmation refusal before the next question", async () => {
  const state = boundState();
  state.recentMessages = [{ role: "assistant", content: "Ta konfirmojmë porosinë?" }];
  state.processes!.service = { id: "s", versionId: "bound-v1", status: "suspended", promptCurrent: false,
    visual: { versionId: "bound-v1", nodeId: "details", status: "waiting", awaiting: true, visited: ["details"], values: {}, binding: { flowId: "service-flow", entity: { id: "consult", kind: "service" } } }, fields: {}, order: {} };
  mocks.version.mockResolvedValue(entityVersion());
  mocks.entity.mockResolvedValue(entityResult("consult"));
  const next = await turn("Po", state);
  expect(next.reply).toContain("Cilën kërkesë");
  expect(next.conversationRouting).toMatchObject({ process: "clarify", action: "clarify" });
  expect(next.nextState.processes?.lastDecision).toEqual(next.conversationRouting);
  expect(next.nextState.recentMessages?.slice(-2)).toEqual([{ role: "user", content: "Po" }, { role: "assistant", content: next.reply }]);
  expect(next.nextState.processes?.order?.snapshot).toEqual(state.processes?.order?.snapshot);
  mocks.entity.mockResolvedValue({});
  mocks.info.mockImplementationOnce(async ({ state }) => {
    expect(state.recentMessages).toEqual(next.nextState.recentMessages);
    return result(state, "Sqarimi");
  });
  await turn("Çfarë do të thotë?", next.nextState);
  expect(mocks.info).toHaveBeenCalledOnce();
});
it("finalizes only the final reply from an already-recorded nested processor with bounded history", async () => {
  const state = order();
  state.recentMessages = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `Previous ${index}` }));
  const original = structuredClone(state);
  mocks.agent.mockImplementation(async ({ state, message }) => {
    const answer = result(state, "Hapi tjetër");
    rememberTurn(state, answer.nextState, message, answer.reply);
    return answer;
  });
  const message = "Dua të porosis, sa kushton?";
  const next = await turn(message, state);
  expect(next.reply).toBe("Çmimi është 20 euro.\n\nHapi tjetër");
  expect(next.nextState.recentMessages).toEqual([...original.recentMessages!.slice(2), { role: "user", content: message }, { role: "assistant", content: next.reply }]);
  expect(state).toEqual(original);
});
it("does not record a failed processor as a completed conversation turn", async () => {
  const state = order(), original = structuredClone(state), onTrace = vi.fn();
  mocks.agent.mockRejectedValueOnce(new Error("processor_failed"));
  await expect(processConversationMessage({ businessId: "business", message: "M", state, mode: "test", hasPhoto: false, onTrace })).rejects.toThrow("processor_failed");
  expect(state).toEqual(original);
  expect(onTrace.mock.calls.some(([event]) => event.label === "Conversation coordinator completed")).toBe(false);
});
it.each(["test", "instagram", "whatsapp"] as const)("keeps one history pair per completed %s turn, including repeated messages", async channel => {
  let state = order();
  const expected: NonNullable<ConversationStatePayload["recentMessages"]> = [];
  for (const message of ["Sa kushton?", "Dua të flas me stafin", "OK", "OK"]) {
    const before = structuredClone(state);
    const params = { businessId: "business", message, state, hasPhoto: false, ...(channel === "test" ? { mode: "test" as const } : { source: channel }) };
    const next = await processConversationMessage(params);
    // Retry the same input state; it must not gain a second pair before commit.
    const retry = await processConversationMessage(params);
    expected.push({ role: "user", content: message }, { role: "assistant", content: next.reply.slice(0, 1200) });
    expect(next.nextState.recentMessages).toEqual(expected);
    expect(retry.nextState.recentMessages).toEqual(expected);
    expect(state).toEqual(before);
    state = next.nextState;
  }
});
it.each(["test", "production"] as const)("derives inactive entity preview access only from trusted %s mode", async mode => {
  mocks.version.mockResolvedValue(entityVersion()); mocks.entity.mockResolvedValue(entityResult("puzzle"));
  await processConversationMessage({ businessId: "business", message: "Puzzle", mode, hasPhoto: false, state: migrateConversationProcesses(emptyState(), () => "id") });
  expect(mocks.entity).toHaveBeenCalled();
  expect(mocks.entity.mock.calls.every(call => call[4] === (mode === "test"))).toBe(true);
});
it("reuses phone followed by a staff sentence after the turn processor extracts it again", async () => {
  const customerSteps = [{ key: "collect_customer", kind: "customer" as const }];
  mocks.agent.mockImplementation(async ({ state, message }) => {
    const next = structuredClone(state);
    // processAgentTurn deliberately repeats this extraction at its public boundary.
    extractExplicitFacts(next, message);
    if (message.includes("Dua të flas")) {
      next.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
      return result(next, "Po ia kaloj kërkesën stafit.");
    }
    next.product_id = "puzzle"; next.step_key = "collect_customer";
    const orderState = advanceSharedOrder(next, "", false, customerSteps, true);
    return result(orderState, sharedPrompt(orderState, customerSteps));
  });
  const first = await turn("Telefoni: 0690000000. Dua të flas me stafin.");
  expect(first.nextState.customer.phone).toBe("0690000000");
  expect(first.nextState.context?.execution.invalidFields ?? []).toEqual([]);
  const next = await turn("Fola me stafin në WhatsApp. Tani dua të porosis Puzzle.", first.nextState);
  expect(next.conversationRouting?.process).toBe("order");
  expect(next.reply).toContain("emrin"); expect(next.reply).not.toContain("telefonin");
  expect(next.reply).not.toContain("Kontrollo");
  expect(next.nextState.customer.phone).toBe("0690000000");
});

it("suspends an unfinished order for explicit WhatsApp contact without repeating its product prompt", async () => {
  const state = order();
  const next = await turn("nuk dua produkt, dua te kontaktohem ne whatsapp", state);
  expect(next.conversationRouting?.process).toBe("support");
  expect(next.nextState.processes?.active).toBeNull();
  expect(next.nextState.processes?.order?.status).toBe("suspended");
  expect(next.nextState.processes?.order?.snapshot.product_id).toBe("product");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info.mock.calls[0][0].informational).toContain("Do not ask for a product");
});

it.each(["ku?", "si?", "ne cilin numer?", "where?"])("keeps %s on the staff-contact request without entering product qualification", async message => {
  const state = emptyState();
  state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
  state.recentMessages = [{ role: "user", content: "dua te kontaktoj me stafin ne whatsapp" }, { role: "assistant", content: "Kontakto stafin." }];
  const next = await turn(message, state);
  expect(next.conversationRouting?.process).toBe("support");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("immediately preceding contact request") }));
});

it("does not route a new catalog question to staff just because an earlier handoff exists", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: [], values: {} };
  expect((await turn("Sa kushton Montessori?", state)).conversationRouting?.process).toBe("information");
});

it("resolves a short follow-up against the latest topic, not a historical staff handoff", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: [], values: {} };
  const catalog = await turn("Sa kushton Montessori?", state);
  expect((await turn("ku?", catalog.nextState)).conversationRouting?.process).toBe("information");
});

it.each(["test", "production"] as const)("stops acknowledgement before either router in %s", async mode => {
 const state=order(); state.recentMessages=[{role:"assistant",content:"Material PDF. Porosite në website."}];
 const next=await processConversationMessage({businessId:"business",message:"Ok",state,hasPhoto:false,mode,source:"instagram"});
 expect(next.reply).toBe("Në rregull 😊"); expect(next.nextState.product_id).toBe(state.product_id);
 expect(next.nextState.step_key).toBe(state.step_key);
 expect(mocks.booking).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.extract).not.toHaveBeenCalled();
});
it("retains the draft across deferral and resumes only on a clear order request",async()=>{
 const paused=await turn("Ok, jo tani",order());
 expect(paused.nextState.product_id).toBe("product");
 expect(mocks.agent).not.toHaveBeenCalled();
 const thanks=await turn("Faleminderit",paused.nextState);
 const resumed=await turn("Vazhdo porosinë",thanks.nextState);
 expect(mocks.agent).toHaveBeenCalledOnce();
 expect(resumed.nextState.conversationPaused).toBeUndefined();
});

const channelCases = [
  { source: "instagram" as const, mode: "production" as const, guarded: false },
  { source: "instagram" as const, mode: "production" as const, guarded: true },
  { source: "whatsapp" as const, mode: "production" as const, guarded: false },
  { source: "whatsapp" as const, mode: "production" as const, guarded: true },
  { source: "admin_chat_lab" as const, mode: "test" as const, guarded: false },
];
it.each(channelCases)("shares routing and task resumption in $source / guard=$guarded", async ({ source, mode, guarded }) => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business");
  const bookingGuard = guarded ? { jobId: 1, leaseToken: "lease", conversationId: "conversation", revision: 4 } : undefined;
  const run = (message: string, state: ConversationStatePayload) => processConversationMessage({ businessId: "business", source, mode, bookingGuard, message, state, hasPhoto: false });
  const original = order();
  const before = structuredClone(original);
  const booking = await run("Dua rezervim më 2026-10-15", original);
  expect(original).toEqual(before);
  expect(booking.conversationRouting).toMatchObject({ process: "booking", action: "start", suspended: "order" });
  expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ routed: true, bookingGuard, mode }));
  const info = await run("Sa kushton?", booking.nextState);
  expect(info.conversationRouting?.process).toBe("information");
  expect(info.nextState.processes?.booking?.draft?.date).toBe("2026-10-15");
  const ack = await run("Ok", info.nextState);
  expect(ack.conversationRouting?.action).toBe("answer");
  expect(ack.nextState.conversationPaused).toBe(true);
  const resumed = await run("Vazhdo porosinë", ack.nextState);
  expect(resumed.conversationRouting).toMatchObject({ process: "order", action: "resume" });
  expect(resumed.nextState.processes?.booking?.status).toBe("suspended");
  expect(resumed.nextState.product_id).toBe("product");
  expect(resumed.nextState.fields.size).toBe("L");
  expect(resumed.nextState.customer.name).toBe("Ana");
  expect(resumed.nextState.context?.execution.linear?.versionId).toBe("v1");
  const support = await run("Dua të flas me stafin", resumed.nextState);
  expect(support.conversationRouting?.process).toBe("support");
  expect(support.nextState.processes?.order?.snapshot.product_id).toBe("product");
  expect(support.nextState.processes?.order?.status).toBe("suspended");
});
it("stops enrolling new Instagram threads when the pilot is removed but preserves migrated work", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business");
  const migrated = await processConversationMessage({ businessId: "business", source: "instagram", message: "M", state: order(), hasPhoto: false });
  expect(migrated.nextState.schemaVersion).toBe(3);
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  const continued = await processConversationMessage({ businessId: "business", source: "instagram", message: "L", state: migrated.nextState, hasPhoto: false });
  expect(continued.conversationRouting?.process).toBe("order");
  expect(continued.nextState.processes?.order?.snapshot.execution.linear?.versionId).toBe("v1");
  mocks.booking.mockClear();
  await processConversationMessage({ businessId: "business", source: "instagram", message: "Dua rezervim", state: emptyState(), hasPhoto: false });
  expect(mocks.booking).toHaveBeenCalledWith(expect.not.objectContaining({ routed: true }));
});

it.each(["instagram", "whatsapp"] as const)("preserves a migrated booking's pinned graph through an order detour in %s production", async source => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business");
  const state = emptyState(); state.schemaVersion = 2;
  state.visual = { versionId: "old-booking", nodeId: "booking", status: "waiting", awaiting: true, visited: ["booking"], values: { note: "Keep" } };
  state.step_key = "booking_request";
  state.fields.booking = { nonce: "legacy-booking", phase: "collect", date: "2026-10-15", expires: 1900000000000 };
  mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "new-publication"));
  mocks.agent.mockImplementation(async params => {
    const next = structuredClone(params.state);
    if (!params.bookingRequest) {
      next.product_id = "puzzle"; next.step_key = "size"; delete next.fields.booking;
      next.visual = { versionId: "new-publication", nodeId: "product", status: "waiting", awaiting: true, visited: ["product"], values: {} };
    }
    return result(next);
  });
  const run = (message: string, state: ConversationStatePayload) => processConversationMessage({ businessId: "business", source, message, state, hasPhoto: false });
  const first = await run("Dua të porosis", state);
  const resumed = await run("Vazhdo rezervimin", first.nextState);
  expect(resumed.conversationRouting?.action).toBe("resume");
  expect(resumed.nextState.processes?.booking).toMatchObject({ id: "legacy-booking", versionId: "old-booking", visual: state.visual, draft: state.fields.booking });
  expect(resumed.nextState.processes?.order?.status).toBe("suspended");
  expect(mocks.agent.mock.lastCall![0].state.visual).toEqual(state.visual);
});
it("emits bounded coordinator metadata for an early acknowledgement without customer text", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business");
  const onTrace = vi.fn();
  const state = order(); state.recentMessages = [{ role: "assistant", content: "Informacion privat" }];
  await processConversationMessage({ businessId: "business", source: "instagram", message: "Ok", state, hasPhoto: false, onTrace,
    bookingGuard: { jobId: 1, leaseToken: "secret-lease", conversationId: "conversation", revision: 4 } });
  const event = onTrace.mock.calls.map(([e]) => e).find(e => e.label === "Conversation coordinator completed");
  expect(event.data).toEqual({ coordinator: "shared_v3", channel: "instagram", revision: 4, workflowVersion: "v1", process: "information", action: "answer", elapsedMs: expect.any(Number) });
  expect(JSON.stringify(event)).not.toMatch(/secret-lease|Informacion privat|Ana/);
});
