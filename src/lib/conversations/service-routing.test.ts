import { beforeEach, expect, it, vi } from "vitest";
import { emptyState, type ConversationStatePayload } from "@/lib/workflows/engine";
import { resolveServiceReference } from "@/lib/products/entity-bridge";
import { processConversationMessage } from "./process-conversation-message";
import type { AgentTurnParams } from "./process-agent-turn";
const m = vi.hoisted(() => ({ execute: vi.fn(), version: vi.fn(), booking: vi.fn(), guidance: vi.fn() }));
const services = [{ id: "s1", name: "Consult Basic" }, { id: "s2", name: "Consult Plus" }];
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: m.version }));
vi.mock("@/lib/products/resolve-reference", () => ({
  resolveCurrentServiceReference: async (args: Parameters<typeof resolveServiceReference>[0]) => resolveServiceReference({ ...args, services }),
  resolveCurrentProductReference: async () => ({ status: "none" }),
}));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => {}, CapabilityEnforcementError: class extends Error {} }));
vi.mock("./process-agent-turn", () => ({ processAgentTurn: m.execute, processLegacyAgentTurn: async ({ state }: AgentTurnParams) => answer(state!, "Information") }));
vi.mock("@/lib/calendar/agent", () => ({ processBookingTurn: m.booking }));
vi.mock("@/lib/workflows/extract-facts", () => ({ extractMessageFacts: async () => 0, profileExtractionFields: [] }));
vi.mock("@/lib/workflows/guidance", async original => ({ ...await original<object>(), chooseGuidance: m.guidance }));
vi.mock("@/lib/workflows/visual/entity-routing", async original => ({ ...await original<object>(),
  resolveVisualEntity: async (_b: string, _g: unknown, message: string, saved?: { entity: { id: string } }, _test?: boolean, reference?: { selectedServiceId?: string }) => {
    const id = reference?.selectedServiceId ?? saved?.entity.id;
    const matches = services.filter(s => id ? s.id === id : message.includes(s.name) || /Consult$/.test(message));
    if (matches.length > 1) return { choices: matches.map(s => ({ ...s, kind: "service" })) };
    return matches.length ? { selected: { entity: { ...matches[0], kind: "service" }, binding: { flowId: "custom", entity: { id: matches[0].id, kind: "service" } } } } : {};
  },
}));
function answer(state: ConversationStatePayload, reply: string) {
  return { reply, nextState: structuredClone(state), previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
    debug: { model: "test", source: "fallback", fallbackReason: null, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.guidance.mockResolvedValue({ action: "continue", source: "rules", target: null });
  m.version.mockImplementation(async (_b, id) => ({ id: id ?? "version-a", businessId: "tenant", graph: { version: 2, nodes: [{ id: "detail", kind: "collect", config: { fieldKey: "detail" } }],
    flows: [{ id: "custom", kind: "custom", serviceIds: ["s1", "s2"], entryNodeId: "detail", nodeIds: ["detail"] }] } }));
  m.execute.mockImplementation(async ({ state }: AgentTurnParams) => { const next = structuredClone(state!); next.visual!.status = "waiting"; next.visual!.awaiting = true; return answer(next, "Details?"); });
});
const turn = (message: string, state?: ConversationStatePayload, extra = {}) => processConversationMessage({ businessId: "tenant", message, state, hasPhoto: false, mode: "test", ...extra });
async function list(process = true) { return turn(process ? "Dua të vazhdoj me Consult" : "Consult"); }

it.each(["Më trego shërbimin e dytë", "shërbimin e dytë"])("does not grant service process intent from an informational list: %s", async text => {
  const offered = await list(false); expect(offered.nextState.processes?.pendingServiceSelection).toBeUndefined();
  const result = await turn(text, offered.nextState);
  expect(result.nextState.processes?.service).toBeUndefined(); expect(m.execute).not.toHaveBeenCalled();
  expect(result.turnDecision?.entity).toMatchObject({ kind: "service", id: "s2" });
});
it("preserves explicit process intent for a relative reference", async () => {
  const offered = await list(false);
  const result = await turn("Dua të vazhdoj me shërbimin e dytë", offered.nextState);
  expect(result.reply).toBe("Details?"); expect(result.turnDecision).toMatchObject({ kind: "new_process", intent: "service", process: "service" });
  expect(m.execute.mock.lastCall![0].turnDecision).toBe(result.turnDecision);
});
it.each(["shërbimin e dytë", "Consult Plus"])("consumes an explicit pending selection once, preserving version: %s", async text => {
  const offered = await list(); const original = structuredClone(offered.nextState);
  expect(offered.nextState.processes?.pendingServiceSelection?.versionId).toBe("version-a");
  const result = await turn(text, offered.nextState);
  expect(result.nextState.processes?.pendingServiceSelection).toBeUndefined();
  expect(result.nextState.processes?.service?.visual).toMatchObject({ versionId: "version-a", nodeId: "detail", binding: { entity: { kind: "service", id: "s2" } } });
  expect(result.turnDecision).toMatchObject({ intent: "service", kind: "new_process" });
  expect(offered.nextState).toEqual(original);
});
it.each(["expired", "tenant", "undelivered", "changed_prompt", "information", "cancel", "paused", "staff"])("cannot reuse a %s process selection", async reason => {
  const offered = await list(); const state = offered.nextState;
  if (reason === "expired") state.processes!.pendingServiceSelection!.expiresAt = 0;
  if (reason === "tenant") state.processes!.pendingServiceSelection!.businessId = "foreign";
  if (reason === "changed_prompt") state.processes!.pendingServiceSelection!.prompt = "other prompt";
  if (reason === "paused") state.conversationPaused = true;
  if (reason === "staff") state.staffHandoff = true;
  const result = await turn(reason === "information" ? "Më trego shërbimin e dytë" : reason === "cancel" ? "leje fare" : "shërbimin e dytë", state,
    reason === "undelivered" ? { mode: "production", source: "instagram", deliveredReply: "not delivered" } : {});
  expect(result.nextState.processes?.service).toBeUndefined(); expect(m.execute).not.toHaveBeenCalled();
  expect(result.nextState.processes?.pendingServiceSelection).toBeUndefined();
});
it("does not select an ambiguous service or act without reference evidence", async () => {
  const offered = await list(); expect(offered.nextState.entityPresentation?.entities).toHaveLength(2);
  expect(m.execute).not.toHaveBeenCalled();
  const result = await turn("shërbimin e dytë", emptyState());
  expect(result.turnDecision?.kind).toBe("clarification"); expect(m.execute).not.toHaveBeenCalled();
});
it("keeps booking intent separate from custom-service continuation", async () => {
  const offered = await list(false);
  m.version.mockResolvedValue({ id: "booking-a", businessId: "tenant", graph: { version: 2,
    nodes: [{ id: "detail", kind: "booking", config: {} }], flows: [{ id: "custom", kind: "booking", entryNodeId: "detail", nodeIds: ["detail"], serviceIds: ["s1", "s2"] }] } });
  m.execute.mockImplementation(async ({ state }: AgentTurnParams) => answer(state!, "Booking adapter"));
  const service = await turn("Dua të vazhdoj me shërbimin e dytë", offered.nextState);
  expect(service.nextState.processes?.booking).toBeUndefined(); expect(m.execute).not.toHaveBeenCalled();
  const booking = await turn("Dua të rezervoj shërbimin e dytë", offered.nextState);
  expect(booking.turnDecision).toMatchObject({ intent: "booking", kind: "new_process", entity: { id: "s2", kind: "service" } });
  expect(m.execute.mock.lastCall![0]).toMatchObject({ bookingRequest: true, selectedServiceId: "s2" });
});
it("rejects a missing pinned version rather than falling back to the latest graph", async () => {
  const offered = await list(); m.version.mockResolvedValue(null);
  const result = await turn("shërbimin e dytë", offered.nextState);
  expect(result.reply).toContain("Versioni"); expect(result.turnDecision?.kind).toBe("clarification"); expect(m.execute).not.toHaveBeenCalled();
});
it("cannot reinterpret an unsupported service process as an order", async () => {
  m.version.mockResolvedValue(null); m.guidance.mockResolvedValue({ action: "order", source: "ai", target: null });
  const result = await turn("Dua të vazhdoj me Consult");
  expect(m.guidance).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled(); expect(m.booking).not.toHaveBeenCalled();
  expect(result.nextState.processes?.order).toBeUndefined(); expect(result.nextState.processes?.service).toBeUndefined();
});
it.each(["vazhdo", "rifillo", "resume"])("%s resumes the interrupted service without consuming navigation as field data", async message => {
  const offered = await list(); const selected = await turn("shërbimin e dytë", offered.nextState);
  const information = await turn("Sa kushton?", selected.nextState);
  expect(information.nextState.processes?.service?.status).toBe("suspended");
  m.execute.mockClear();
  const resumed = await turn(message, information.nextState);
  expect(m.execute.mock.lastCall![0]).toMatchObject({ message: "", turnDecision: { kind: "resume" }, state: { visual: { versionId: "version-a", nodeId: "detail", awaiting: false } } });
  expect(resumed.nextState.processes?.service?.visual.binding?.entity.id).toBe("s2");
});
