// Existing scenarios run with the default platform policy: all modules allowed.
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => mocks.denyModules ? [] : [...MODULE_IDS], requireModuleAllowed: async () => {} };
});
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type ConversationStatePayload } from "@/lib/workflows/engine";
import { advanceSharedOrder, extractExplicitFacts, migrateContext, setFact, sharedPrompt } from "@/lib/workflows/context";
import { migrateConversationProcesses } from "@/lib/workflows/conversation-processes";
import { rememberTurn } from "@/lib/workflows/guidance";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import type { AgentTurnParams, AgentTurnResult } from "./process-agent-turn";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), info: vi.fn(), booking: vi.fn(), guidance: vi.fn(), extract: vi.fn(), version: vi.fn(), status: vi.fn(), entity: vi.fn(), denyModules: false }));
vi.mock("@/lib/workflows/visual/entity-routing", async original => ({ ...await original<object>(), resolveVisualEntity: mocks.entity }));
vi.mock("@/lib/orders/customer-status", async original => ({ ...await original<object>(), customerOrderStatus: mocks.status }));
vi.mock("./process-agent-turn", () => ({ processAgentTurn: mocks.agent, processLegacyAgentTurn: mocks.info }));
vi.mock("@/lib/calendar/agent", () => ({ processBookingTurn: mocks.booking }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
vi.mock("@/lib/workflows/extract-facts", () => ({ extractMessageFacts: mocks.extract, profileExtractionFields: [] }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: mocks.version }));
vi.mock("@/lib/workflows/guidance", async original => ({ ...await original<object>(), chooseGuidance: mocks.guidance }));
import { processConversationMessage } from "./process-conversation-message";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
function result(state: ConversationStatePayload, reply = "Vazhdo"): AgentTurnResult {
  return { reply, nextState: structuredClone(state), previousResponseId: null, workflowId: "linear-version-1", productName: "Produkt", workflowProgress: [], debug: { model: "test", source: "fallback", fallbackReason: null, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } };
}
function order() {
  const state = migrateContext({ ...emptyState(), product_id: "product", step_key: "size", fields: { size: "L" } });
  state.context!.execution.linear = { id: "linear", versionId: "v1", name: "Order", steps: [{ key: "size", kind: "choice" }] };
  setFact(state, "customer_name", "Ana", "text", "message");
  return state;
}
it("preserves pinned execution and collected values when the runtime denies a disabled module", async () => {
  const state = order(); const snapshot = structuredClone(state);
  mocks.agent.mockRejectedValue(new CapabilityEnforcementError("module_disabled", "Moduli është çaktivizuar; progresi është ruajtur."));
  const blocked = await processConversationMessage({ businessId: "business", message: "L", hasPhoto: false, state, mode: "production", source: "instagram" });
  expect(blocked.reply).toContain("çaktivizuar");
  expect(blocked.nextState.context).toEqual(snapshot.context);
  expect(blocked.nextState.fields).toEqual(snapshot.fields);
  expect(blocked.nextState.step_key).toBe(snapshot.step_key);
  expect(blocked.nextState.product_id).toBe(snapshot.product_id);
  expect(state).toEqual(snapshot);
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.denyModules = false;
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
it.each(["Më kujto preferencat për porosinë.", "Rikujto emrin dhe Instagramin."])("P1 recall is information, never a pending field answer: %s", async message => {
  const state = order(), before = structuredClone(state.context);
  const reply = await turn(message, state);
  expect(reply.conversationRouting?.process).toBe("information");
  expect(reply.turnDecision?.intent).toBe("information");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(reply.nextState.context?.order).toEqual(before?.order);
  expect(reply.nextState.processes?.order?.snapshot.execution.linear?.versionId).toBe("v1");
});
describe("R3 server-owned customer question boundary", () => {
  async function ask() {
    mocks.info.mockImplementation(async ({ state }) => ({ ...result(state, "[[ask_customer:name,business_type,instagram_handle,stated_needs]]"),
      previousResponseId: "unrendered-provider-response", debug: { ...result(state).debug, source: "ai" } }));
    const question = await turn("Cilat të dhëna të duhen?", migrateContext());
    expect(question.nextState.pendingCustomerQuestion?.fields).toEqual(["name", "business_type", "instagram_handle", "stated_needs"]);
    expect(question.previousResponseId).toBeNull();
    expect(question.nextState.recentMessages?.at(-1)?.content).toBe(question.reply);
    return question;
  }
  it("consumes the original response exactly once without a second extractor or process dispatch", async () => {
    const question = await ask(), before = structuredClone(question.nextState);
    vi.clearAllMocks();
    const answer = await turn("Miqail\n\nShitje rrobash online\n\nfiliz_studio_\n\nKam pyetje per masat, a eshte gjendje etj", question.nextState);
    expect(question.nextState).toEqual(before);
    expect(answer.nextState.context?.profile.name?.value).toBe("Miqail");
    expect(answer.nextState.customerDeclaredFacts?.business_type?.value).toBe("Shitje rrobash online");
    expect(answer.nextState.pendingCustomerQuestion).toBeUndefined();
    expect(answer.conversationRouting?.reason).toBe("customer_question_answer");
    expect(answer.turnDecision?.executor).toBe("coordinator");
    expect(answer.nextState.recentMessages).toHaveLength(4);
    expect(mocks.extract).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.info).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
  });
  it("staff takeover cannot consume a pending customer answer", async () => {
    const question = await ask(); question.nextState.staffHandoff = true;
    const answer = await turn("Miqail\nShitje rrobash online", question.nextState);
    expect(answer.nextState.customerDeclaredFacts).toBeUndefined();
    expect(answer.nextState.context?.profile.name).toBeUndefined();
    expect(answer.nextState.pendingCustomerQuestion).toBeUndefined();
    expect(answer.nextState.staffHandoff).toBe(true);
  });
  it("module revocation discards candidate checkpoint facts rather than committing a false acknowledgement", async () => {
    const question = await ask(), original = structuredClone(question.nextState);
    mocks.denyModules = true;
    const answer = await turn("Emri: Elira; Pyetjet tipike: sa kushton?", question.nextState);
    expect(answer.turnDecision?.kind).toBe("blocked");
    expect(answer.reply).toContain("çaktivizuar");
    expect(answer.nextState.context?.profile.name).toBeUndefined();
    expect(answer.nextState.customerDeclaredFacts).toBeUndefined();
    expect(question.nextState).toEqual(original);
  });
});
describe("R1 conversation-only declarations", () => {
  it("preserves declaration corrections across information, booking and order resume without process field contamination", async () => {
    const start = order();
    const declared = await turn("Instagram: synthetic_shop", start);
    expect(declared.nextState.customerDeclaredFacts?.instagram_handle?.value).toBe("synthetic_shop");
    const booking = await turn("Dua rezervim", declared.nextState);
    const corrected = await turn("Instagrami im është corrected_shop", booking.nextState);
    const resumed = await turn("Vazhdo porosinë", corrected.nextState);
    expect(resumed.nextState.customerDeclaredFacts?.instagram_handle?.value).toBe("corrected_shop");
    expect(resumed.nextState.context?.profile).not.toHaveProperty("instagram_handle");
    expect(resumed.nextState.context?.order).not.toHaveProperty("instagram_handle");
    expect(resumed.nextState.context?.execution.linear?.versionId).toBe("v1");
    expect(resumed.nextState.context?.execution.orderConfirmed).not.toBe(true);
  });
  it("does not extract declarations or change ownership during staff handoff", async () => {
    const state = order(); state.staffHandoff = true;
    const result = await turn("Instagram: synthetic_shop", state);
    expect(result.nextState.customerDeclaredFacts).toBeUndefined();
    expect(result.nextState.staffHandoff).toBe(true); expect(mocks.agent).not.toHaveBeenCalled();
  });
});
describe("W2 process ownership journeys", () => {
  it("preserves corrected phone and order facts across booking, information, and resume", async () => {
    const start = order(); setFact(start, "customer_phone", "0691111111", "phone", "message");
    const booking = await turn("Dua rezervim", start);
    expect(booking.nextState.context!.order.size).toBeUndefined();
    const info = await turn("Telefon: 0692222222. Sa kushton?", booking.nextState);
    const resumed = await turn("Vazhdo porosinë", info.nextState);
    expect(resumed.nextState.customer.phone).toBe("0692222222");
    expect(resumed.nextState.fields.size).toBe("L");
    expect(resumed.nextState.context!.order.booking).toBeUndefined();
    expect(resumed.nextState.context!.execution.linear!.versionId).toBe("v1");
    expect(resumed.nextState.context!.execution.orderConfirmed).not.toBe(true);
    expect(resumed.nextState.processes!.booking!.draft!.serviceId).toBe("service");
  });
  it("does not offer order or unrelated flow fields to extraction during an informational interruption", async () => {
    const state = order(); const before = structuredClone(state.context!.order);
    await turn("Sa kushton shërbimi?", state);
    for (const call of mocks.extract.mock.calls) expect(call[2]).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "size" })]));
    expect(state.context!.order).toEqual(before);
  });
});
describe("W1 pending clarification and turn ownership", () => {
  const ask = async (state = order()) => {
    const paused = { ...state, conversationPaused: true };
    const reply = await turn("dua te vazhdoj", paused);
    expect(reply.debug.fallbackReason).toBe("resume_requires_intent");
    expect(reply.nextState.processes?.pendingClarification?.kind).toBe("resume_process");
    return reply;
  };

  it.each(["informacion", "kerkesen e meparshme", "leje fare"])("consumes the exact reproduced choice: %s", async message => {
    const clarification = await ask();
    const before = structuredClone(clarification.nextState);
    const answer = await turn(message, clarification.nextState);
    expect(answer.reply).not.toBe(clarification.reply);
    expect(answer.nextState.processes?.pendingClarification).toBeUndefined();
    expect(answer.conversationRouting?.reason).toBe(`clarification_${message === "informacion" ? "information" : message === "leje fare" ? "cancel" : "resume"}`);
    expect(clarification.nextState).toEqual(before);
    expect(answer.nextState.recentMessages?.slice(-2)).toEqual([{ role: "user", content: message }, { role: "assistant", content: answer.reply }]);
    if (message === "kerkesen e meparshme") {
      expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ message: "", orderRequest: true }));
      expect(mocks.extract).not.toHaveBeenCalled();
      expect(answer.nextState.fields.size).toBe("L");
    } else expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("keeps an information-only follow-up informational without consuming order fields", async () => {
    const clarification = await ask();
    const answer = await turn("informacion", clarification.nextState);
    expect(answer.nextState.processes).toMatchObject({ active: null, promptOwner: null, informationOnly: true, order: { status: "suspended" } });
    const snapshot = structuredClone(answer.nextState.processes!.order!.snapshot);
    mocks.guidance.mockResolvedValue({ action: "order", source: "ai" });
    const followup = await turn("materialet per femije", answer.nextState);
    expect(followup.conversationRouting?.process).toBe("information");
    expect(followup.nextState.processes?.order?.snapshot).toEqual(snapshot);
    expect(followup.nextState.fields).toEqual(answer.nextState.fields);
    expect(mocks.agent).not.toHaveBeenCalled();
    expect(mocks.booking).not.toHaveBeenCalled();
    const resumed = await turn("Vazhdo porosinë", followup.nextState);
    expect(resumed.conversationRouting?.action).toBe("resume");
    expect(resumed.nextState.processes?.informationOnly).toBeUndefined();
    expect(resumed.nextState.conversationPaused).toBeUndefined();
  });

  it("resumes an existing suspended order without inventing a selected product", async () => {
    const state = migrateConversationProcesses(order(), () => "unselected-order");
    state.product_id = null; state.step_key = "choose_product";
    state.processes!.order!.snapshot.product_id = null;
    state.processes!.order!.snapshot.step_key = "choose_product";
    state.processes!.order!.status = "suspended"; state.processes!.active = null;
    const clarification = await ask(state);
    const answer = await turn("kërkesën e mëparshme", clarification.nextState);
    expect(answer.nextState.product_id).toBeNull();
    expect(answer.nextState.processes?.order?.id).toBe("unselected-order");
    expect(mocks.agent.mock.lastCall![0]).toMatchObject({ message: "", orderRequest: true, state: { product_id: null, step_key: "choose_product" } });
  });

  it("dismisses only the pending order, keeps booking/profile/history, and cannot resurrect it", async () => {
    const state = migrateConversationProcesses(order(), () => "order-1");
    state.processes!.booking = { id: "booking-1", status: "suspended", draft: { nonce: "booking-1", phase: "collect", expires: Date.now() + 60000 } };
    state.completedVisual = { versionId: "history", nodeId: "end", status: "completed", awaiting: false, visited: [], values: {} };
    const clarification = await ask(state);
    const cancelled = await turn("leje fare", clarification.nextState);
    expect(cancelled.nextState.processes?.order).toBeUndefined();
    expect(cancelled.nextState.processes?.booking).toEqual(state.processes!.booking);
    expect(cancelled.nextState.context?.profile).toEqual(state.context!.profile);
    expect(cancelled.nextState.completedVisual).toEqual(state.completedVisual);
    expect(cancelled.nextState.product_id).toBeNull();
    expect(cancelled.nextState.processes?.informationOnly).toBe(true);
    const staleResume = await turn("kerkesen e meparshme", cancelled.nextState);
    expect(staleResume.conversationRouting?.reason).toBe("clarification_stale");
    expect(mocks.agent).not.toHaveBeenCalled();
    expect(mocks.booking).not.toHaveBeenCalled();
  });

  it.each(["Po", "Jo", "Ok"])("does not interpret ambiguous %s as approval or navigation", async message => {
    const clarification = await ask();
    const uncertain = await turn(message, clarification.nextState);
    expect(uncertain.nextState.processes?.pendingClarification).toEqual(clarification.nextState.processes!.pendingClarification);
    expect(uncertain.reply).toBe(clarification.reply);
    expect(mocks.agent).not.toHaveBeenCalled();
    const answer = await turn("informacion", uncertain.nextState);
    expect(answer.conversationRouting?.reason).toBe("clarification_information");
  });

  it.each(["expired", "replaced", "completed", "cursor", "version", "missing"])("rejects a %s clarification binding", async change => {
    const clarification = await ask();
    const state = clarification.nextState;
    if (change === "expired") state.processes!.pendingClarification!.expiresAt = Date.now() - 1;
    if (change === "replaced") state.processes!.order!.id = "new-task";
    if (change === "completed") state.processes!.order!.status = "completed";
    if (change === "cursor") state.processes!.order!.snapshot.step_key = "another-step";
    if (change === "version") state.processes!.order!.snapshot.execution.linear!.versionId = "new-version";
    if (change === "missing") delete state.processes!.order;
    const before = structuredClone(state);
    const answer = await turn("kerkesen e meparshme", state);
    expect(answer.conversationRouting?.reason).toBe("clarification_stale");
    expect(answer.nextState.fields).toEqual(before.fields);
    expect(answer.nextState.conversationPaused).toBe(true);
    expect(answer.nextState.processes?.pendingClarification).toBeUndefined();
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
  });

  it("does not select arbitrarily between two suspended processes", async () => {
    const state = migrateConversationProcesses(order(), () => "order-1");
    state.processes!.active = null; state.processes!.order!.status = "suspended";
    state.processes!.booking = { id: "booking", status: "suspended", draft: { phase: "collect", nonce: "booking", expires: Date.now() + 60000 } };
    const clarification = await ask(state);
    expect(clarification.nextState.processes?.pendingClarification?.target).toBeNull();
    const answer = await turn("kerkesen e meparshme", clarification.nextState);
    expect(answer.conversationRouting?.reason).toBe("clarification_stale");
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
  });

  it.each(["informacion", "kerkesen e meparshme", "leje fare"])("repeats a consumed %s response without executing the next step", async message => {
    const clarification = await ask();
    const first = await turn(message, clarification.nextState);
    mocks.agent.mockClear(); mocks.booking.mockClear(); mocks.extract.mockClear();
    const second = await turn(message, first.nextState);
    expect(second.reply).toBe(first.reply);
    expect(second.nextState.fields).toEqual(first.nextState.fields);
    expect(second.nextState.context).toEqual(first.nextState.context);
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled(); expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("requires independently delivered clarification evidence in production", async () => {
    const clarification = await ask();
    const params = { businessId: "business", source: "instagram" as const, message: "kerkesen e meparshme", hasPhoto: false, state: clarification.nextState };
    const blocked = await processConversationMessage({ ...params, deliveredReply: null });
    expect(blocked.conversationRouting?.reason).toBe("clarification_stale");
    expect(mocks.agent).not.toHaveBeenCalled();
    const resumed = await processConversationMessage({ ...params, deliveredReply: clarification.reply });
    expect(resumed.conversationRouting?.action).toBe("resume");
  });

  it.each(["staffHandoff", "cursorHandoff", "permission"])("does not override staff ownership: %s", async ownership => {
    const clarification = await ask(); const state = clarification.nextState;
    if (ownership === "staffHandoff") state.staffHandoff = true;
    if (ownership === "cursorHandoff") state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, values: {}, visited: [] };
    const params = { businessId: "business", message: "kerkesen e meparshme", hasPhoto: false, mode: "test" as const, state };
    if (ownership === "permission") await expect(processConversationMessage({ ...params, canAct: async () => false })).rejects.toThrow("conversation_manually_paused");
    else {
      const answer = await processConversationMessage(params);
      expect(answer.conversationRouting?.reason).toBe("clarification_staff_owned");
      expect(answer.nextState.staffHandoff).toBe(state.staffHandoff);
      expect(answer.nextState.processes?.order).toEqual(state.processes?.order);
      expect(answer.nextState.conversationPaused).toBe(true);
    }
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
  });

  it.each([undefined, 2, 3] as const)("migrates schema %s without changing the pinned visual/linear version", async schemaVersion => {
    const state = order(); state.schemaVersion = schemaVersion; state.product_id = "puzzle";
    state.visual = { versionId: "pinned-old", nodeId: "product", status: "waiting", awaiting: true, values: { size: "L" }, visited: ["product"], binding: { flowId: "order-flow", entity: { kind: "product", id: "puzzle" } } };
    mocks.version.mockImplementation(async (_business, id) => entityVersion(id ?? "latest-new"));
    if (schemaVersion === 3) state.processes = migrateConversationProcesses(state, () => "old-order").processes;
    const clarification = await ask(state);
    mocks.version.mockClear();
    const resumed = await turn("kerkesen e meparshme", clarification.nextState);
    expect(resumed.nextState.visual?.versionId).toBe("pinned-old");
    expect(resumed.nextState.context?.execution.linear?.versionId).toBe("v1");
    expect(mocks.agent.mock.lastCall![0].entityVersion?.id).toBe("pinned-old");
    expect(mocks.version.mock.calls.every(call => call[1] === "pinned-old")).toBe(true);
  });

  it("resumes a booking as navigation/review, never as confirmation", async () => {
    const state = migrateConversationProcesses(emptyState(), () => "id");
    state.processes!.active = "booking";
    state.processes!.booking = { id: "booking-1", status: "active", draft: { nonce: "booking-1", phase: "confirm", serviceId: "service", name: "Ana", date: "2026-10-15", time: "09:00", expires: Date.now() + 60000 } };
    const clarification = await ask(state);
    const resumed = await turn("kerkesen e meparshme", clarification.nextState);
    expect(resumed.conversationRouting).toMatchObject({ process: "booking", action: "resume" });
    expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ message: "Vazhdo rezervimin", resume: true, routed: true }));
    expect(resumed.nextState.fields.booking).toMatchObject({ phase: "collect" });
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("does not adopt a new visual publication while resuming a pinned linear order", async () => {
    const clarification = await ask();
    mocks.version.mockResolvedValue(entityVersion("new-publication"));
    const resumed = await turn("kerkesen e meparshme", clarification.nextState);
    expect(resumed.nextState.context?.execution.linear?.versionId).toBe("v1");
    expect(mocks.agent.mock.lastCall![0].entityVersion).toBeNull();
  });

  it.each(["collect", "confirm"] as const)("executes the existing visual runtime without consuming resume as %s input", async kind => {
    vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
    const graph: VisualGraph = { version: 2, name: "W1 fixture", nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "pending", kind, label: "Pending", position: { x: 0, y: 100 }, config: kind === "collect" ? { fieldKey: "note", fieldType: "text", prompt: "Shënimi?" } : { prompt: "Konfirmon porosinë?" } },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 200 }, config: {} },
    ], edges: [{ id: "entry", source: "start", target: "pending", port: "next" },
      ...(kind === "collect" ? [{ id: "next", source: "pending", target: "end", port: "next" as const }]
        : [{ id: "yes", source: "pending", target: "end", port: "yes" as const }, { id: "no", source: "pending", target: "end", port: "no" as const }])],
    flows: [{ id: "order", kind: "order", label: "Order", entryNodeId: "pending", nodeIds: ["pending", "end"] }] };
    const state = migrateConversationProcesses(order(), () => "order-1");
    state.visual = { versionId: "pinned", nodeId: "pending", status: "waiting", awaiting: true, values: {}, visited: ["pending"] };
    state.processes!.order!.snapshot.visual = structuredClone(state.visual);
    mocks.version.mockResolvedValue({ id: "pinned", businessId: "business", graph, createdAt: "now" });
    const { executeVisualTurn } = await import("@/lib/workflows/visual/execute");
    mocks.agent.mockImplementation(params => executeVisualTurn(params, async adapter => result(adapter.state!)));
    const clarification = await ask(state);
    const resumed = await turn("kerkesen e meparshme", clarification.nextState);
    expect(resumed.reply).toBe(kind === "collect" ? "Shënimi?" : "Konfirmon porosinë?");
    expect(resumed.nextState.visual).toMatchObject({ versionId: "pinned", nodeId: "pending", status: "waiting", awaiting: true });
    expect(resumed.nextState.visual?.values.note).toBeUndefined();
    expect(resumed.nextState.visual?.values.pending).toBeUndefined();
    expect(resumed.nextState.context?.execution.orderConfirmed).not.toBe(true);
    const answered = await turn(kind === "collect" ? "Shënim i klientit" : "Po", resumed.nextState);
    const cursor = answered.nextState.visual ?? answered.nextState.completedVisual;
    expect(cursor?.values[kind === "collect" ? "note" : "pending"]).toBe(kind === "collect" ? "Shënim i klientit" : "po");
    expect(cursor?.nodeId).toBe("end");
  });

  it("a delayed duplicate choice cannot become a field answer after an informational turn", async () => {
    const clarification = await ask();
    const resumed = await turn("kerkesen e meparshme", clarification.nextState);
    const info = await turn("Sa kushton?", resumed.nextState);
    mocks.agent.mockClear(); mocks.extract.mockClear();
    const duplicate = await turn("kerkesen e meparshme", info.nextState);
    expect(duplicate.conversationRouting?.reason).toBe("clarification_stale");
    expect(duplicate.nextState.fields).toEqual(info.nextState.fields);
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("dismisses a clarification with no resumable task without inventing a cancellation", async () => {
    const clarification = await ask(emptyState());
    const dismissed = await turn("leje fare", clarification.nextState);
    expect(dismissed.conversationRouting?.reason).toBe("clarification_cancel");
    expect(dismissed.nextState.processes?.pendingClarification).toBeUndefined();
    expect(dismissed.nextState.processes?.order).toBeUndefined();
    expect((await turn("materialet", dismissed.nextState)).conversationRouting?.process).toBe("information");
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("shares clarification control with the scoped linear preview without routing external capabilities", async () => {
    const state = order(); state.conversationPaused = true;
    state.context!.execution.linear!.versionId = "linear-preview:fixture";
    const preview = (message: string, state: ConversationStatePayload) => processConversationMessage({ businessId: "business", message, state, hasPhoto: false, mode: "test", linearPreview: true });
    const clarification = await preview("vazhdo", state);
    const info = await preview("informacion", clarification.nextState);
    const details = await preview("materialet", info.nextState);
    expect(details.nextState.context).toEqual(info.nextState.context);
    expect(mocks.agent).not.toHaveBeenCalled();
    const again = await preview("vazhdo", clarification.nextState);
    const resumed = await preview("kerkesen e meparshme", again.nextState);
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ linearPreview: true, orderRequest: true, message: "" }));
    expect(resumed.nextState.context?.execution.linear?.versionId).toBe("linear-preview:fixture");
    expect(resumed.nextState.processes?.promptOwner).toBe("order");
    expect(mocks.booking).not.toHaveBeenCalled(); expect(mocks.version).not.toHaveBeenCalled();
  });

  it("does not let an information-only choice bypass the existing linear preview boundary", async () => {
    const state = migrateConversationProcesses(order(), () => "task");
    state.processes!.informationOnly = true;
    await expect(processConversationMessage({ businessId: "business", message: "informacion", state, hasPhoto: false, mode: "production", linearPreview: true })).rejects.toThrow("invalid_linear_preview");
    expect(mocks.info).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not import informational adapter mutations into order facts (graph=%s)", async configured => {
    const state = migrateConversationProcesses(order(), () => "order-1");
    if (configured) mocks.version.mockResolvedValue({ id: "v-info", graph: { version: 2, flows: [{ kind: "information", entryNodeId: "info" }], nodes: [{ id: "info", kind: "knowledge", config: {} }] } });
    const answer = async ({ state: adapter }: { state: ConversationStatePayload }) => {
      setFact(adapter, "size", "WRONG", "text", "information"); adapter.product_id = "wrong-product";
      adapter.context!.execution.orderConfirmed = true;
      return result(adapter, "Informacion");
    };
    mocks.info.mockImplementation(answer); mocks.agent.mockImplementation(answer);
    const next = await turn("Sa kushton transporti?", state);
    expect(next.nextState.product_id).toBe(state.product_id);
    expect(next.nextState.context?.order).toEqual(state.context!.order);
    expect(next.nextState.context?.execution).toEqual(state.context!.execution);
    expect(next.nextState.processes?.order?.snapshot).toEqual(state.processes!.order!.snapshot);
    expect(next.nextState.processes?.promptOwner).toBeNull();
  });
});
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
  const [bookingParams] = mocks.booking.mock.calls[0] ?? [];
  expect(bookingParams).toEqual(expect.objectContaining({ businessId: "business", message: "Dua rezervim", mode: "production" }));
  expect(bookingParams.routed).toBeUndefined();
});
it.each(["instagram", "whatsapp"] as const)("routes %s through business conversation handling without a pilot flag", async source => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  const bookingGuard = { jobId: 1, leaseToken: "lease", conversationId: "conversation", revision: 4 };
  const next = await processConversationMessage({ businessId: "business", source, message: "Pershendetje", hasPhoto: false, state: emptyState(), mode: "production", bookingGuard });
  expect(next.nextState.schemaVersion).toBe(3);
  expect(next.conversationRouting?.process).toBe("information");
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business", bookingGuard, source }));
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.booking).not.toHaveBeenCalled();
});

it.each(["instagram", "whatsapp"] as const)("uses the business agent for ambiguous %s messages without inventing workflow changes", async source => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  mocks.guidance.mockResolvedValue({ action: "clarify", target: null, source: "ai" });
  mocks.info.mockImplementation(async ({ state }) => result(state, "Përshëndetje! Si mund t’ju ndihmojmë?"));
  let state = emptyState();
  for (const message of ["Shsnsj", "Helpo", "Pershendetje"]) {
    const before = structuredClone(state);
    const next = await processConversationMessage({ businessId: "business", source, mode: "production", message, state, hasPhoto: false });
    expect(state).toEqual(before);
    expect(next.reply).toBe("Përshëndetje! Si mund t’ju ndihmojmë?");
    expect(next.conversationRouting?.process).toBe("information");
    expect(next.nextState.processes?.active).toBeNull();
    expect(next.nextState.processes?.order).toBeUndefined();
    expect(next.nextState.processes?.booking).toBeUndefined();
    expect(mocks.info).toHaveBeenLastCalledWith(expect.objectContaining({ businessId: "business", message, informational: expect.stringContaining("configured agent's tone") }));
    state = next.nextState;
  }
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.booking).not.toHaveBeenCalled();
});

it("keeps task clarification for ambiguous corrections to an active order", async () => {
  mocks.guidance.mockResolvedValue({ action: "clarify", target: null, source: "ai" });
  const state = order();
  const next = await turn("ndrysho", state);
  expect(next.conversationRouting?.process).toBe("clarify");
  expect(next.nextState.processes?.order?.snapshot.product_id).toBe("product");
  expect(next.nextState.fields.size).toBe("L");
  expect(mocks.info).not.toHaveBeenCalled();
});

it("treats a bare contact channel after handoff as support rather than an order", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
  const next = await turn("WhatsApp", state);
  expect(next.conversationRouting?.process).toBe("support");
  expect(next.nextState.processes?.order).toBeUndefined();
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("no handoff, staff notification or callback has been performed") }));
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
  expect(next.nextState.processes?.order).toEqual({ ...snapshot.order, status: "suspended" });
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
  expect(next.nextState.processes?.order).toEqual({ ...state.processes?.order, status: "suspended" });
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
  const next = await turn("Dua të porosis Puzzle", state);
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
  mocks.entity.mockImplementation(async (_b, graph, message) => message === "Dua të vazhdoj me Konsultë" && graph ? entityResult("consult") : {});
  mocks.agent.mockImplementation(async ({ state }) => { const next = structuredClone(state); next.visual.status = "waiting"; return result(next, "Çfarë të duhet?"); });
  const next = await turn("Dua të vazhdoj me Konsultë", state);
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
  expect(mocks.entity).toHaveBeenCalledWith("business", expect.anything(), "Sa kushton Puzzle?", undefined, true, expect.anything());
});
it("2A named bookable service information does not book; explicit booking uses the same typed decision", async () => {
  mocks.version.mockResolvedValue(entityVersion()); mocks.entity.mockResolvedValue(entityResult("session"));
  const info = await turn("Më trego Session");
  expect(info.turnDecision).toMatchObject({ kind: "entity_reference", intent: "information", entity: { status: "resolved", kind: "service", id: "session" } });
  expect(info.nextState.processes?.booking).toBeUndefined(); expect(mocks.booking).not.toHaveBeenCalled();
  const booked = await turn("Dua të rezervoj Session", info.nextState);
  expect(booked.turnDecision).toMatchObject({ kind: "new_process", intent: "booking" });
  expect(mocks.agent.mock.calls.at(-1)![0].turnDecision).toBe(booked.turnDecision);
});
it("2A a bare bound product cannot silently replace an active booking with an order", async () => {
  const state = migrateConversationProcesses(emptyState(), () => "id");
  state.processes!.active = "booking"; state.processes!.promptOwner = "booking";
  state.processes!.booking = { id: "b", status: "active", draft: { nonce: "b", phase: "collect", serviceId: "session", expires: Date.now() + 60000 } };
  mocks.version.mockResolvedValue(entityVersion()); mocks.entity.mockResolvedValue(entityResult("puzzle"));
  const result = await turn("Puzzle", state);
  expect(result.turnDecision).toMatchObject({ kind: "interruption", entity: { status: "resolved", id: "puzzle" } });
  expect(result.nextState.processes?.order).toBeUndefined();
  expect(result.nextState.processes?.booking?.draft).toEqual(state.processes!.booking!.draft);
  expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
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
  const next = await turn("Dua të rezervoj Session", state);
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
  mocks.version.mockResolvedValue(entityVersion());
  const customerSteps = [{ key: "collect_customer", kind: "customer" as const }];
  mocks.agent.mockImplementation(async ({ state, message }) => {
    const next = structuredClone(state);
    // processAgentTurn deliberately repeats this extraction at its public boundary.
    extractExplicitFacts(next, message);
    if (message.includes("Dua të flas")) {
      next.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
      return { ...result(next, "Kontakto stafin në kanalin e biznesit."), handoff: true, advisoryHandoff: true };
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
  expect(mocks.info).not.toHaveBeenCalled();
  expect(next).toMatchObject({ handoff: true, advisoryHandoff: false });
});

it.each(["ku?", "si?", "ne cilin numer?", "where?"])("keeps %s on the staff-contact request without entering product qualification", async message => {
  const state = emptyState();
  state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: {}, advisory: true };
  state.recentMessages = [{ role: "user", content: "dua te kontaktoj me stafin ne whatsapp" }, { role: "assistant", content: "Kontakto stafin." }];
  const next = await turn(message, state);
  expect(next.conversationRouting?.process).toBe("support");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("staff/contact question") }));
});

it("keeps a catalog question with staff while a non-advisory handoff owns the conversation", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: [], values: {} };
  expect((await turn("Sa kushton Montessori?", state)).conversationRouting?.process).toBe("support");
  expect(mocks.info).not.toHaveBeenCalled();
});

it("resolves a short follow-up against the latest topic, not a historical staff handoff", async () => {
  const state = emptyState(); state.visual = { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: [], values: {}, advisory: true };
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
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
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
it("keeps both migrated and new Instagram threads on the shared coordinator without a pilot", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business");
  const migrated = await processConversationMessage({ businessId: "business", source: "instagram", message: "M", state: order(), hasPhoto: false });
  expect(migrated.nextState.schemaVersion).toBe(3);
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  const continued = await processConversationMessage({ businessId: "business", source: "instagram", message: "L", state: migrated.nextState, hasPhoto: false });
  expect(continued.conversationRouting?.process).toBe("order");
  expect(continued.nextState.processes?.order?.snapshot.execution.linear?.versionId).toBe("v1");
  mocks.booking.mockClear();
  await processConversationMessage({ businessId: "business", source: "instagram", message: "Dua rezervim", state: emptyState(), hasPhoto: false });
  expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ routed: true }));
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
  expect(event.data).toEqual({ coordinator: "shared_v3", businessId: "business", executionMode: "live", channel: "instagram", revision: 4, workflowVersion: "v1", process: "information", action: "answer", elapsedMs: expect.any(Number) });
  expect(JSON.stringify(event)).not.toMatch(/secret-lease|Informacion privat|Ana/);
});

it.each(["instagram", "whatsapp"] as const)("preserves a pausing handoff from the visual executor on %s", async source => {
  mocks.version.mockResolvedValue(entityVersion());
  mocks.agent.mockImplementation(async ({ state }) => ({ ...result(state, "Biseda iu kalua stafit. Përgjigjet automatike janë ndalur."), handoff: true, advisoryHandoff: false }));
  const next = await processConversationMessage({ businessId: "business", source, message: "Dua të flas me stafin", state: migrateConversationProcesses(order(), () => "order-1"), hasPhoto: false });
  expect(next).toMatchObject({ handoff: true, advisoryHandoff: false, reply: "Biseda iu kalua stafit. Përgjigjet automatike janë ndalur." });
  expect(next.nextState.staffHandoff).toBe(true);
  expect(next.nextState.processes?.order).toMatchObject({ status: "suspended", snapshot: { product_id: "product", fields: { size: "L" } } });
  expect(next.nextState.recentMessages?.at(-1)?.content).toBe(next.reply);
});
it("keeps contact advice advisory and retains its topic without a visual cursor", async () => {
  const contact = await turn("Cili është numri juaj?", order());
  expect(contact).toMatchObject({ handoff: true, advisoryHandoff: true });
  expect(contact.nextState.staffHandoff).toBeUndefined();
  const followup = await turn("ku?", contact.nextState);
  expect(followup.conversationRouting?.process).toBe("support");
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ informational: expect.stringContaining("no handoff") }));
});
it("supports a real handoff for a non-pilot business with no visual graph", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  const next = await processConversationMessage({ businessId: "business", source: "instagram", message: "Dua të flas me stafin", state: emptyState(), hasPhoto: false });
  expect(next).toMatchObject({ handoff: true, advisoryHandoff: false, nextState: { staffHandoff: true } });
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.booking).not.toHaveBeenCalled();
});

it("routes an explicitly named action flow and preserves an unfinished order",async()=>{
 const {addFlowTemplate}=await import("@/components/workflows/flow-templates");
 const {starterVisualGraph}=await import("@/lib/workflows/visual/model");
 const graph=addFlowTemplate(starterVisualGraph(),"business_provision","signup").graph;
 mocks.version.mockResolvedValue({id:"v-actions",businessId:"business",graph});
 mocks.agent.mockImplementation(async ({state})=>{const next=structuredClone(state);next.visual.status="waiting";next.visual.awaiting=true;return result(next,"Emri?");});
 const before=order();
 const guard={jobId:1,leaseToken:"lease",conversationId:"conversation",revision:2};
 const output=await processConversationMessage({businessId:"business",message:"Regjistrim biznesi",state:before,hasPhoto:false,mode:"test",bookingGuard:guard});
 expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({actionFlowRequest:true,actionGuard:guard}));
 expect(output.nextState.product_id).toBe(before.product_id);expect(output.nextState.fields.size).toBe("L");
 expect(output.nextState.processes?.actionFlow?.visual.nodeId).toBe("signup_name");
});
it("suspends a pending action confirmation after a question instead of consuming a later bare yes",async()=>{
 const {addFlowTemplate}=await import("@/components/workflows/flow-templates");const {starterVisualGraph}=await import("@/lib/workflows/visual/model");
 const graph=addFlowTemplate(starterVisualGraph(),"business_provision","signup").graph;
 mocks.version.mockResolvedValue({id:"v-actions",businessId:"business",graph});
 const state=migrateConversationProcesses(order(),()=>"task");
 state.processes!.actionFlow={versionId:"v-actions",promptCurrent:true,visual:{versionId:"v-actions",nodeId:"signup_confirm",status:"waiting",awaiting:true,visited:[],values:{}}};
 const answer=await turn("Sa kushton?",state);
 expect(answer.nextState.processes?.actionFlow?.promptCurrent).toBe(false);
 expect(mocks.agent.mock.calls.some(([p])=>p.actionFlowRequest)).toBe(false);
});

describe("C1/C2 authoritative turn ownership", () => {
  async function actionState(withOrder = false) {
    const { addFlowTemplate } = await import("@/components/workflows/flow-templates");
    const { starterVisualGraph } = await import("@/lib/workflows/visual/model");
    const { advanceVisualWorkflow } = await import("@/lib/workflows/visual/runtime");
    const { graph } = addFlowTemplate(starterVisualGraph(), "business_provision", "registration");
    const version = { id: "admin-pinned", businessId: "business", createdAt: "now", graph };
    mocks.version.mockResolvedValue(version);
    const cursor = advanceVisualWorkflow({ graph, versionId: version.id, message: "", hasPhoto: false, intent: "unknown",
      state: { versionId: version.id, nodeId: "registration_confirm", status: "running", awaiting: false, visited: [],
        values: { biz_registration: "Studio sintetik", email_registration: "owner@example.test" } } }).state;
    const state = migrateConversationProcesses(withOrder ? order() : emptyState(), () => "task");
    state.processes!.promptOwner = null;
    state.processes!.actionFlow = { versionId: version.id, visual: cursor, promptCurrent: true,
      fields: { private_detail: "administrative-only" }, order: {} };
    state.recentMessages = [{ role: "assistant", content: graph.nodes.find(n => n.id === cursor.nodeId)!.config.prompt! }];
    return { state, version };
  }

  async function realVisualExecutor() {
    const { executeVisualTurn } = await import("@/lib/workflows/visual/execute");
    mocks.agent.mockImplementation((params: AgentTurnParams) => executeVisualTurn(params, async p => result(p.state ?? emptyState())));
  }

  async function pinnedOrderJourney(informationFlow = false) {
    const productId = "11111111-1111-4111-8111-111111111111";
    const graph: VisualGraph = { version: 2, name: "Pinned order", nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "size", kind: "collect", label: "Size", position: { x: 0, y: 100 }, config: { fieldKey: "size", fieldType: "text", prompt: "Çfarë madhësie?" } },
      { id: "color", kind: "collect", label: "Color", position: { x: 0, y: 200 }, config: { fieldKey: "color", fieldType: "text", prompt: "Çfarë ngjyre?" } },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 300 }, config: {} },
    ], edges: [
      { id: "e1", source: "start", target: "size", port: "next" },
      { id: "e2", source: "size", target: "color", port: "next" },
      { id: "e3", source: "color", target: "end", port: "next" },
    ], flows: [{ id: "order-flow", kind: "order", label: "Porosia Puzzle", entryNodeId: "size", nodeIds: ["size", "color"], productIds: [productId] }] };
    if (informationFlow) {
      graph.nodes.push(
        { id: "info", kind: "knowledge", label: "Information", position: { x: 200, y: 0 }, config: {} },
        { id: "info_city", kind: "collect", label: "City", position: { x: 200, y: 100 }, config: { fieldKey: "shipping_city", fieldType: "text", prompt: "Për cilin qytet?" } },
      );
      graph.edges.push({ id: "e4", source: "info", target: "info_city", port: "next" }, { id: "e5", source: "info_city", target: "end", port: "next" });
      graph.flows.push({ id: "info-flow", kind: "information", label: "Dërgesat", entryNodeId: "info", nodeIds: ["info", "info_city"] });
    }
    const version = { id: "order-pinned", businessId: "business", createdAt: "now", graph };
    mocks.version.mockResolvedValue(version);
    const state = migrateConversationProcesses(migrateContext({ ...emptyState(), product_id: productId, step_key: "size",
      visual: { versionId: version.id, nodeId: "size", status: "waiting", awaiting: true, visited: ["size"], values: {},
        binding: { flowId: "order-flow", entity: { kind: "product", id: productId } } } }), () => "order-task", version);
    const entity = await vi.importActual<typeof import("@/lib/workflows/visual/entity-routing")>("@/lib/workflows/visual/entity-routing");
    mocks.entity.mockImplementation(entity.resolveVisualEntity);
    await realVisualExecutor();
    const service = await import("@/lib/supabase/service");
    const catalog = vi.spyOn(service, "createServiceSupabase").mockReturnValue({ from: (table: string) => {
      const query = { select: () => query, eq: () => query, order: () => query,
        range: async () => ({ data: table === "products" ? [{ id: productId, name: "Puzzle", price_amount: 20, currency: "EUR" }] : [], error: null }),
        in: async () => ({ data: [], error: null }) };
      return query;
    } } as unknown as ReturnType<typeof service.createServiceSupabase>);
    return { state, version, catalog };
  }

  it("keeps the interrupted order pinned when a newer version is published", async () => {
    const { state, version, catalog } = await pinnedOrderJourney();
    try {
      mocks.version.mockImplementation(async (_business, id) => id ? version : { ...version, id: "newly-published" });
      const info = await turn("Sa kushton?", state);
      const answer = await turn("Large", info.nextState);
      expect(answer.conversationRouting).toMatchObject({ process: "order", action: "continue" });
      expect(answer.nextState.visual).toMatchObject({ versionId: version.id, nodeId: "color", values: { size: "Large" } });
      expect(answer.externalActions).toBeUndefined();
    } finally { catalog.mockRestore(); }
  });

  it("restores the interrupted order after a multi-turn information flow completes", async () => {
    const { state, version, catalog } = await pinnedOrderJourney(true);
    try {
      const info = await turn("Sa kushton?", state);
      expect(info.nextState.processes?.auxiliary?.visual.nodeId).toBe("info_city");
      const completedInfo = await turn("Tiranë", info.nextState);
      expect(completedInfo.nextState.processes?.auxiliary).toBeUndefined();
      expect(completedInfo.conversationRouting?.suspended).toBe("order");
      expect(completedInfo.nextState.visual).toMatchObject({ versionId: version.id, nodeId: "size", values: {} });
      expect(completedInfo.nextState.processes?.order?.snapshot.fields.shipping_city).toBeUndefined();
      const answer = await turn("Large", completedInfo.nextState);
      expect(answer.conversationRouting).toMatchObject({ process: "order", action: "continue" });
      expect(answer.nextState.visual).toMatchObject({ nodeId: "color", values: { size: "Large" } });
      expect(answer.externalActions).toBeUndefined();
    } finally { catalog.mockRestore(); }
  });

  it("executes the real action once in isolation and ignores a duplicate confirmation", async () => {
    const { state } = await actionState(); await realVisualExecutor();
    const answer = await turn("po", state);
    expect(answer.externalActions?.filter(a => a.kind === "action.provision")).toEqual([
      expect.objectContaining({ disposition: "SIMULATED" }),
    ]);
    expect(answer.nextState.processes?.actionFlow).toBeUndefined();
    const repeated = await turn("po", answer.nextState);
    expect(repeated.externalActions).toBeUndefined();
    expect(mocks.agent).toHaveBeenCalledTimes(1);
  });

  it("rejects the real confirmation with jo and returns to correction without executing", async () => {
    const { state } = await actionState(); await realVisualExecutor();
    const answer = await turn("jo", state);
    expect(answer.externalActions).toBeUndefined();
    expect(answer.nextState.processes?.actionFlow?.visual).toMatchObject({ nodeId: "registration_name", awaiting: true });
  });

  it.each(["expiry", "facts", "missing"])("does not execute a %s action approval", async stale => {
    const { state } = await actionState(); await realVisualExecutor();
    const visual = state.processes!.actionFlow!.visual;
    if (stale === "expiry") visual.pendingConfirmation!.expiresAt = Date.now() - 1;
    if (stale === "facts") visual.values.biz_registration = "Klinikë tjetër";
    if (stale === "missing") delete visual.pendingConfirmation;
    const answer = await turn("po", state);
    expect(answer.externalActions).toBeUndefined();
    expect(answer.nextState.processes?.actionFlow?.visual.nodeId).toBe("registration_confirm");
  });

  it("requires delivery proof for a live action prompt", async () => {
    const { state } = await actionState();
    await processConversationMessage({ businessId: "business", message: "po", state, mode: "production", source: "instagram", hasPhoto: false, deliveredReply: null });
    expect(mocks.agent).not.toHaveBeenCalled();
    await processConversationMessage({ businessId: "business", message: "po", state, mode: "production", source: "instagram", hasPhoto: false, deliveredReply: state.recentMessages!.at(-1)!.content });
    expect(mocks.agent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actionFlowRequest: true, mode: "production" }));
  });

  it("re-prompts the pinned action after information and requires a new confirmation", async () => {
    const { state, version } = await actionState(); await realVisualExecutor();
    mocks.version.mockImplementation(async (_business, id) => id ? version : { ...version, id: "newly-published" });
    const info = await turn("Sa kushton?", state);
    const resumed = await turn("Regjistrim biznesi", info.nextState);
    expect(resumed.nextState.processes?.actionFlow?.visual).toMatchObject({ versionId: "admin-pinned", nodeId: "registration_confirm", awaiting: true });
    expect(resumed.externalActions).toBeUndefined();
    const approved = await turn("po", resumed.nextState);
    expect(approved.externalActions).toContainEqual(expect.objectContaining({ kind: "action.provision", disposition: "SIMULATED" }));
  });

  it.each([undefined, 2] as const)("restores an administrative cursor from schema %s before short-reply control", async schemaVersion => {
    const { state } = await actionState(); await realVisualExecutor();
    state.visual = state.processes!.actionFlow!.visual; delete state.processes; state.schemaVersion = schemaVersion;
    const answer = await turn("po", state);
    expect(answer.externalActions).toContainEqual(expect.objectContaining({ kind: "action.provision", disposition: "SIMULATED" }));
    expect(answer.nextState.schemaVersion).toBe(3);
  });

  it("keeps administrative fields out of a different named administrative flow", async () => {
    const { state, version } = await actionState();
    const { addFlowTemplate } = await import("@/components/workflows/flow-templates");
    const { graph } = addFlowTemplate(version.graph, "business_provision", "other");
    graph.flows.find(f => f.nodeIds.includes("other_name"))!.label = "Hapje laboratori";
    mocks.version.mockResolvedValue({ ...version, graph });
    await turn("Hapje laboratori", state);
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ fields: {}, visual: expect.objectContaining({ nodeId: "other_name", values: {} }) }) }));
  });

  it("remembers the administrative owner across information when an older order also exists", async () => {
    const { state } = await actionState(true);
    const info = await turn("Sa kushton?", state);
    expect(info.conversationRouting?.suspended).toBe("actionFlow");
    mocks.agent.mockClear();
    const acknowledged = await turn("po", info.nextState);
    const clarification = await turn("dua te vazhdoj", acknowledged.nextState);
    expect(clarification.nextState.processes?.pendingClarification?.target?.process).toBe("actionFlow");
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("accepts a real administrative field after information without copying order fields", async () => {
    const { state } = await actionState(true); await realVisualExecutor();
    const action = state.processes!.actionFlow!;
    action.visual.nodeId = "registration_name"; action.visual.values = {}; delete action.visual.pendingConfirmation;
    const info = await turn("Sa kushton?", state);
    const followUp = await turn("Ku jeni?", info.nextState);
    const next = await turn("Laborator sintetik", followUp.nextState);
    expect(next.nextState.processes?.actionFlow?.visual.values.biz_registration).toBe("Laborator sintetik");
    expect(next.nextState.processes?.actionFlow?.fields?.size).toBeUndefined();
    expect(next.nextState.processes?.order?.snapshot.fields.size).toBe("L");
    expect(next.externalActions).toBeUndefined();
  });

  it.each(["field", "name"])("restores a service after information for %s without confusing navigation and data", async input => {
    const state = migrateConversationProcesses(emptyState(), () => "task");
    state.processes!.service = { id: "consultation", status: "active", promptCurrent: true, versionId: "service-pinned", fields: {}, order: {},
      visual: { versionId: "service-pinned", nodeId: "details", status: "waiting", awaiting: true, visited: [], values: {}, binding: { flowId: "service-flow", entity: { kind: "service", id: "consult" } } } };
    mocks.version.mockResolvedValue(entityVersion("service-pinned")); mocks.entity.mockResolvedValue(entityResult("consult"));
    const info = await turn("Sa kushton?", state);
    const message = input === "name" ? "consult" : "Inspection";
    await turn(message, info.nextState);
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ message: input === "name" ? "" : message,
      state: expect.objectContaining({ visual: expect.objectContaining({ awaiting: input === "field" }) }) }));
  });

  it("fails closed when historical administrative and service prompts conflict", async () => {
    const { state } = await actionState();
    state.processes!.service = { id: "service", status: "active", promptCurrent: true, versionId: "service-v1", fields: {}, order: {},
      visual: { versionId: "service-v1", nodeId: "confirm", status: "waiting", awaiting: true, visited: [], values: {} } };
    const next = await turn("po", state);
    expect(next.externalActions).toBeUndefined(); expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled();
    expect(next.nextState.processes?.actionFlow?.promptCurrent).toBe(false);
    expect(next.nextState.processes?.service?.promptCurrent).toBe(false);
  });

  it("cancels only the selected administrative request and leaves an independent order intact", async () => {
    const { state } = await actionState(true);
    const paused = await turn("Jo tani", state);
    const clarification = await turn("dua te vazhdoj", paused.nextState);
    const cancelled = await turn("leje fare", clarification.nextState);
    expect(cancelled.nextState.processes?.actionFlow).toBeUndefined();
    expect(cancelled.nextState.processes?.order).toEqual(paused.nextState.processes?.order);
    expect(cancelled.externalActions).toBeUndefined(); expect(mocks.agent).not.toHaveBeenCalled();
  });

  it.each(["pause", "information-only"])("explicitly resumes the saved named action from %s", async control => {
    const { state } = await actionState();
    const paused = await turn("Jo tani", state);
    const controlled = control === "information-only" ? await turn("informacion", paused.nextState) : paused;
    const resumed = await turn("Vazhdo Regjistrim biznesi", controlled.nextState);
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ actionFlowRequest: true, message: "",
      entityVersion: expect.objectContaining({ id: "admin-pinned" }), state: expect.objectContaining({ visual: expect.objectContaining({ nodeId: "registration_confirm", awaiting: false }) }) }));
    expect(resumed.nextState.conversationPaused).toBeUndefined();
    expect(resumed.nextState.processes?.informationOnly).toBeUndefined();
  });

  it.each(["resume", "cancel"])("uses W1 %s for a suspended service without losing another task", async choice => {
    const state = migrateConversationProcesses(order(), () => "order-task");
    state.processes!.order!.status = "suspended"; state.processes!.active = null; state.processes!.promptOwner = null;
    state.processes!.service = { id: "consultation", status: "active", promptCurrent: true, versionId: "service-pinned", fields: { detail: "Inspection" }, order: {},
      visual: { versionId: "service-pinned", nodeId: "details", status: "waiting", awaiting: true, visited: [], values: { detail: "Inspection" }, binding: { flowId: "service-flow", entity: { kind: "service", id: "consult" } } } };
    mocks.version.mockResolvedValue(entityVersion("service-pinned")); mocks.entity.mockResolvedValue(entityResult("consult"));
    const paused = await turn("Jo tani", state);
    const clarification = await turn("dua te vazhdoj", paused.nextState);
    expect(clarification.nextState.processes?.pendingClarification?.target?.process).toBe("service");
    const answer = await turn(choice === "resume" ? "kerkesen e meparshme" : "leje fare", clarification.nextState);
    expect(answer.nextState.processes?.order).toEqual(state.processes!.order);
    if (choice === "cancel") { expect(answer.nextState.processes?.service).toBeUndefined(); expect(mocks.agent).not.toHaveBeenCalled(); }
    else expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ message: "", entityVersion: expect.objectContaining({ id: "service-pinned" }), state: expect.objectContaining({ visual: expect.objectContaining({ nodeId: "details", awaiting: false, values: { detail: "Inspection" } }) }) }));
  });

  it.each(["po", "jo"])("lets the current actionFlow consume %s before generic acknowledgement", async message => {
    const { state } = await actionState();
    await turn(message, state);
    expect(mocks.agent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actionFlowRequest: true, message }));
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.booking).not.toHaveBeenCalled();
  });

  it("suspends the old order when an administrative flow takes the turn", async () => {
    const { state } = await actionState(true);
    const answer = await turn("Regjistrim biznesi", state);
    expect(answer.nextState.processes?.active).toBeNull();
    expect(answer.nextState.processes?.order?.status).toBe("suspended");
    expect(answer.nextState.processes?.order?.snapshot.fields.size).toBe("L");
    expect(answer.nextState.processes?.order?.snapshot.fields.private_detail).toBeUndefined();
  });

  it.each(["Jo tani", "Sa kushton?", "Ku është porosia ime?"])("revokes action prompt ownership on interruption: %s", async message => {
    const { state } = await actionState();
    const answer = await turn(message, state);
    expect(answer.nextState.processes?.actionFlow?.promptCurrent).toBe(false);
    expect(answer.nextState.processes?.actionFlow?.visual).toEqual(state.processes!.actionFlow!.visual);
    mocks.agent.mockClear();
    await turn("po", answer.nextState);
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it.each(["order", "booking", "service"] as const)("suspends %s on information without losing its cursor", async kind => {
    const state = migrateConversationProcesses(order(), () => "task");
    if (kind === "booking") {
      state.processes!.order!.status = "suspended";
      state.processes!.active = "booking"; state.processes!.promptOwner = "booking";
      state.processes!.booking = { id: "appointment", status: "active", versionId: "booking-pinned",
        draft: { nonce: "appointment", phase: "collect", date: "2026-10-15", expires: Date.now() + 60000 } };
    }
    if (kind === "service") {
      state.processes!.order!.status = "suspended"; state.processes!.active = null; state.processes!.promptOwner = null;
      state.processes!.service = { id: "consultation", status: "active", promptCurrent: true, versionId: "service-pinned", fields: { reason: "Inspection" }, order: {},
        visual: { versionId: "service-pinned", nodeId: "details", status: "waiting", awaiting: true, visited: [], values: { reason: "Inspection" } } };
    }
    const answer = await turn("Sa kushton?", state);
    expect(answer.nextState.processes?.[kind]?.status).toBe("suspended");
    expect(answer.nextState.processes?.active).toBeNull();
    if (kind === "service") expect(answer.nextState.processes?.service?.visual).toEqual(state.processes!.service!.visual);
    if (kind === "booking") expect(answer.nextState.processes?.booking?.draft).toEqual(state.processes!.booking!.draft);
    if (kind === "order") expect(answer.nextState.processes?.order?.snapshot).toEqual(state.processes!.order!.snapshot);
  });

  it.each(["resume", "cancel"])("binds W1 %s to the suspended administrative request", async choice => {
    const { state } = await actionState();
    const paused = await turn("Jo tani", state);
    const clarification = await turn("dua te vazhdoj", paused.nextState);
    expect(clarification.nextState.processes?.pendingClarification?.target?.process).toBe("actionFlow");
    mocks.agent.mockClear();
    const answer = await turn(choice === "resume" ? "kerkesen e meparshme" : "leje fare", clarification.nextState);
    expect(answer.nextState.processes?.pendingClarification).toBeUndefined();
    if (choice === "cancel") {
      expect(answer.nextState.processes?.actionFlow).toBeUndefined();
      expect(mocks.agent).not.toHaveBeenCalled();
    } else {
      expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ actionFlowRequest: true, message: "", entityVersion: expect.objectContaining({ id: "admin-pinned" }),
        state: expect.objectContaining({ visual: expect.objectContaining({ nodeId: "registration_confirm", awaiting: false }) }) }));
    }
  });

  it("resumes a service cursor without consuming navigation as a field value", async () => {
    const state = migrateConversationProcesses(emptyState(), () => "task");
    state.processes!.service = { id: "consultation", status: "suspended", promptCurrent: false, versionId: "service-pinned", fields: {}, order: {},
      visual: { versionId: "service-pinned", nodeId: "details", status: "waiting", awaiting: true, visited: [], values: {}, binding: { flowId: "consult", entity: { kind: "service", id: "consult" } } } };
    mocks.version.mockResolvedValue(entityVersion("service-pinned"));
    mocks.entity.mockResolvedValue(entityResult("consult"));
    await turn("Konsultë", state);
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ message: "", state: expect.objectContaining({ visual: expect.objectContaining({ nodeId: "details", awaiting: false }) }) }));
  });

  it.each(["po", "Regjistrim biznesi", "Vazhdo porosinë", "Dua rezervim"])("staff ownership blocks AI continuation for %s", async message => {
    const { state } = await actionState(true); state.staffHandoff = true;
    const answer = await turn(message, state);
    expect(answer.reply).toContain("staf");
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.booking).not.toHaveBeenCalled(); expect(mocks.info).not.toHaveBeenCalled();
  });
});
