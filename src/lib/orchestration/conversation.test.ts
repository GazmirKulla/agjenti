import { beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot } from "./contracts";
import { emptyState } from "@/lib/workflows/state";
import { runIsolated } from "@/lib/runtime/isolated-run";
import { processConversation } from "./conversation";

const { load, interpret, compose, slots, persist, fixture } = vi.hoisted(() => ({
  load: vi.fn(), interpret: vi.fn(), compose: vi.fn(), slots: vi.fn(), persist: vi.fn(),
  fixture: { enabled: false, serviceId: "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/lib/campaigns/service", () => ({ campaignContext: async () => [] }));
vi.mock("@/lib/calendar/service", async original => ({ ...await original<object>(), availableSlots: slots, persistBooking: persist }));

vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: load }));
vi.mock("./version-store", async original => ({ ...await original<object>(), loadCurrentLinearVersions: async () => [] }));
vi.mock("./interpret", () => ({ interpretCustomer: interpret }));
vi.mock("./training-context", () => ({ processTrainingContext: async () => ({ rules: [] }) }));
vi.mock("./persistence", () => ({
  commitProcessCheckpoint: async (input: { transition: { state: unknown } }) => ({ state: input.transition.state, replayed: false }),
  processExecutionStore: () => ({ claim: async (state: unknown) => ({ state, replayed: false }), finish: vi.fn() }),
}));
vi.mock("@/lib/capabilities/enforcement", async original => ({ ...await original<object>(), requireRuntimeModules: async () => {}, runtimeModules: async () => fixture.enabled ? ["services", "workflows", "bookings"] : [] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => {
  return { from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({
      data: fixture.enabled && table === "business_calendar_settings" ? { timezone: "UTC", agent_booking_enabled: true, confirmation_mode: "manual" } :
        fixture.enabled && table === "booking_services" ? { id: fixture.serviceId, name: "Konsultë", duration_minutes: 30, buffer_minutes: 0 } : null, error: null,
    }) };
    return chain;
  } };
} }));
vi.mock("@/lib/agents/business-grounding", () => ({ readBusinessGrounding: async () => ({
  knowledge: { status: "no_match", records: [] }, products: { status: "unavailable", records: [] }, services: { status: "complete", records: fixture.enabled ? [{ id: fixture.serviceId, name: "Konsultë", booking_enabled: true }] : [] },
}) }));
vi.mock("./respond", () => ({ composeProcessReply: compose }));
beforeEach(() => { vi.clearAllMocks(); fixture.enabled = false; load.mockResolvedValue(null);
  compose.mockResolvedValue({ reply: "Information answer", targetIds: [], responseId: "reply", inputTokens: 1, outputTokens: 1 }); });
const params = () => ({ businessId: "business", message: "Continue", hasPhoto: false, mode: "test" as const,
  state: { ...emptyState(), runtime: initialSnapshot("business", "conversation", "test") } });

it("never falls back to legacy parsing for a v4 session outside isolated execution", async () => {
  await expect(processConversation(params())).rejects.toThrow("process_transport_cutover_required");
  expect(interpret).not.toHaveBeenCalled();
});
it("never hands a v4 session to the linear preview adapter", async () => {
  const input = { ...params(), linearPreview: {} as NonNullable<Parameters<typeof processConversation>[0]["linearPreview"]> };
  await expect(runIsolated(() => processConversation(input))).rejects.toThrow("process_preview_required");
  expect(load).not.toHaveBeenCalled();
});
it("rejects a foreign preview before loading configuration or interpreting the message", async () => {
  const input = { ...params(), visualPreview: { businessId: "foreign" } as NonNullable<Parameters<typeof processConversation>[0]["visualPreview"]> };
  await expect(runIsolated(() => processConversation(input))).rejects.toThrow("definition_scope_mismatch");
  expect(interpret).not.toHaveBeenCalled();
});
it("requires durable transport even for a new live session", async () => {
  await expect(processConversation({ ...params(), state: emptyState(), mode: "production" })).rejects.toThrow("process_transport_cutover_required");
  expect(load).not.toHaveBeenCalled();
});
it("handles information without a configured workflow through the new engine", async () => {
  interpret.mockResolvedValue({ observation: { revision: 0, commands: [], needsClarification: false }, model: "test", responseId: "observation", inputTokens: 1, outputTokens: 1 });
  const result = await runIsolated(() => processConversation({ ...params(), state: emptyState() }));
  expect(result?.reply).toBe("Information answer");
  expect(result?.nextState.runtime).toMatchObject({ schemaVersion: 4, revision: 1, instances: {}, offers: {} });
  expect(interpret).toHaveBeenCalledOnce();
  expect(result?.nextState.recentMessages).toHaveLength(2);
});
it("routes an authenticated live turn through checkpoint preparation without marking prompts delivered", async () => {
  interpret.mockResolvedValue({ observation: { revision: 0, commands: [], needsClarification: false }, model: "test", responseId: "observation", inputTokens: 1, outputTokens: 1 });
  const result = await processConversation({ ...params(), state: emptyState(), mode: "production",
    processTransport: { jobId: 10, leaseToken: "lease", conversationId: "conversation", revision: 0 } });
  expect(result?.nextState.runtime).toMatchObject({ mode: "live", revision: 2, conversationId: "conversation" });
  expect(result?.nextState.runtime?.pendingTurn).toBeUndefined();
  expect(result?.processCheckpoint).toMatchObject({ event: { id: "job:10:reply" }, expectedRevision: 1, targetIds: [] });
});

it.each([
  { message: "A ka vend pasdite për konsultë?", evidence: "pasdite", permitted: true },
  { message: "¿Tienen una hora libre?", evidence: "hora libre", permitted: true },
  { message: "Non voglio prenotare.", evidence: "tomorrow", permitted: false },
])("checks the calendar for a grounded inquiry without creating a booking: $message", async ({ message, evidence, permitted }) => {
  fixture.enabled = true;
  const { automaticGraph, automaticReadiness } = await import("./automatic-process");
  const graph = automaticGraph(automaticReadiness({ modules: ["services", "workflows", "bookings"], orderableProducts: false, bookingCalendar: true, bookableServices: true }));
  load.mockResolvedValue({ id: "version", businessId: "business", graph });
  interpret.mockResolvedValue({ observation: { revision: 0, commands: [], needsClarification: false,
    availabilityQuery: { versionId: "version", definitionId: "auto_booking", serviceId: fixture.serviceId, date: "2026-12-01", evidence } } });
  slots.mockResolvedValue(Array.from({ length: 16 }, (_, i) => ({ start: new Date(Date.UTC(2026, 11, 1, 9, i * 15)).toISOString() })));
  const result = await processConversation({ ...params(), message, mode: "production", state: emptyState(),
    processTransport: { jobId: 10, leaseToken: "lease", conversationId: "conversation", revision: 0 } });
  const { availability } = compose.mock.calls[0][0].context;
  if (permitted) {
    expect(slots).toHaveBeenCalledWith("business", fixture.serviceId, "2026-12-01", undefined);
    expect(availability[0].starts).toContain("2026-12-01 12:45");
    expect(result.capabilityEvents).toContainEqual(expect.objectContaining({ capability: "customer.availability", point: "available" }));
  } else {
    expect(slots).not.toHaveBeenCalled();
    expect(availability).toEqual([]);
  }
  expect(result.nextState.runtime?.instances).toEqual({});
});

it("keeps customer details when a slot is busy and saves only the corrected, delivered review", async () => {
  fixture.enabled = true;
  const { automaticGraph, automaticReadiness } = await import("./automatic-process");
  const { bookingFields } = await import("./booking-definition");
  const { recordPresentation } = await import("./transition");
  const graph = automaticGraph(automaticReadiness({ modules: ["services", "workflows", "bookings"], orderableProducts: false, bookingCalendar: true, bookableServices: true }));
  load.mockResolvedValue({ id: "v", businessId: "business", graph });
  const { key } = bookingFields("auto_booking");
  const customer = { serviceId: fixture.serviceId, date: "2026-12-01", time: "10:00", name: "Arta", contact: "0690000000" };
  const values = Object.entries(customer).map(([name, value]) => ({ fieldId: key(name), value, evidence: name === "serviceId" ? "Konsultë" : value }));
  slots.mockResolvedValue([{ start: "2026-12-01T15:00:00Z" }]);
  persist.mockResolvedValue({ booking: { id: "saved", status: "pending", starts_at: "2026-12-01T15:00:00Z", service_name: "Konsultë", sync_status: "local" } });
  const start = { kind: "start", definitionId: "auto_booking", versionId: "v", initialFacts: values, evidence: "Rezervo" };
  let state = emptyState(), jobId = 1;
  async function turn(message: string, commands: unknown[]) {
    const revision = state.runtime?.revision ?? 0;
    interpret.mockResolvedValue({ observation: { revision, needsClarification: false, commands } });
    const answer = await processConversation({ ...params(), state, message, mode: "production", processTransport: { jobId: jobId++, conversationId: "conversation", leaseToken: "lease", revision } });
    state = answer.nextState;
    return compose.mock.lastCall![0].notices as import("./contracts").RuntimeNotice[];
  }
  let notices = await turn("Rezervo Konsultë 2026-12-01 10:00 Arta 0690000000", [start]);
  expect(notices).toContainEqual(expect.objectContaining({ reason: "slot_unavailable" }));
  expect(notices.some(n => n.kind === "approval")).toBe(false);
  const instanceId = state.runtime!.focusId!;
  notices = await turn("Alle 15:00 invece", [{ kind: "facts", instanceId, values: [{ fieldId: key("time"), value: "15:00", evidence: "15:00" }] }]);
  const waitId = notices.find(n => n.kind === "approval")?.targetId;
  expect(waitId).toBeTruthy();
  expect(persist).not.toHaveBeenCalled();
  state.runtime = recordPresentation(state.runtime!, [waitId!], Date.now());
  await turn("Confermo", [{ kind: "approve", instanceId, waitId, evidence: "Confermo" }]);
  expect(persist).toHaveBeenCalledWith("business", expect.objectContaining({ start: "2026-12-01T15:00:00.000Z", name: "Arta", status: "pending" }), expect.objectContaining({ conversationId: "conversation" }));
  expect(state.runtime!.instances[instanceId].action?.status).toBe("succeeded");
});
