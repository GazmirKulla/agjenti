/** Audit-only regression tests. Every provider/database boundary is mocked. */
import { beforeEach, expect, it, vi } from "vitest";
import { bookingAdapter } from "@/lib/orchestration/booking";
import { bookingFields } from "@/lib/orchestration/booking-definition";
import type { Action } from "@/lib/orchestration/contracts";

const m = vi.hoisted(() => ({ slots: vi.fn(), persist: vi.fn(), modules: vi.fn(), read: vi.fn(), version: vi.fn(), compile: vi.fn() }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: m.version }));
vi.mock("@/lib/orchestration/visual-definition", () => ({ compileVisualProcesses: m.compile }));
vi.mock("@/lib/calendar/service", () => ({ availableSlots: m.slots, persistBooking: m.persist }));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: m.modules }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, maybeSingle: () => m.read(table) }; return query;
} }) }));

const terms = { serviceId: "service", serviceName: "Consultation", durationMinutes: 30, bufferMinutes: 0, timezone: "UTC", confirmationMode: "automatic" as const };
const action: Action = { id: "action", instanceId: "instance", stepId: bookingFields("book").key("create"), tool: "booking.create", toolVersion: 1, inputDigest: "digest", status: "prepared",
  input: { ...terms, date: "2026-12-01", time: "10:00", name: "Klienti", contact: "+355691111111" } };
const context = { businessId: "business", conversationId: "conversation", revision: 4, signal: new AbortController().signal };
const adapter = () => bookingAdapter({ businessId: "business", conversationId: "conversation", lease: { jobId: 7, leaseToken: "audit-lease" }, definitionForInstance: () => ({ versionId: "version", definitionId: "flow" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Audit forbids real network access"); }));
  m.modules.mockResolvedValue(undefined);
  m.version.mockResolvedValue({ graph: { version: 2, nodes: [{ id: "book", kind: "booking" }], flows: [{ id: "flow", nodeIds: ["book"], serviceIds: ["service"] }] } });
  m.compile.mockReturnValue([{ id: "flow", steps: [{ id: action.stepId, kind: "effect", tool: "booking.create" }] }]);
  m.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === "booking_services"
    ? { id: terms.serviceId, name: terms.serviceName, duration_minutes: terms.durationMinutes, buffer_minutes: terms.bufferMinutes }
    : { timezone: terms.timezone, confirmation_mode: terms.confirmationMode, agent_booking_enabled: true } }));
  m.slots.mockResolvedValue([{ start: "2026-12-01T10:00:00+00:00" }]);
  m.persist.mockResolvedValue({ booking: { id: "audit-booking", status: "confirmed", starts_at: "2026-12-01T10:00:00Z", service_name: "Consultation", sync_status: "local" } });
});

it("control: unchanged production booking confirmation reaches the guarded persistence adapter", async () => {
  expect(await adapter().execute(action, context)).toMatchObject({ status: "succeeded" });
  expect(m.persist).toHaveBeenCalledExactlyOnceWith("business", expect.objectContaining({
    requestKey: "ig:conversation:action", status: "confirmed",
  }), { jobId: 7, leaseToken: "audit-lease", conversationId: "conversation", revision: 4 });
  expect(fetch).not.toHaveBeenCalled();
});

it("requires a fresh review when service duration changes after the customer saw 30 minutes", async () => {
  expect(await adapter().execute({ ...action, input: { ...action.input, durationMinutes: 60 } }, context)).toMatchObject({ status: "failed", output: { code: "booking_terms_changed" } });
  expect(m.persist).not.toHaveBeenCalled();
});

it("requires a fresh review when calendar timezone changes", async () => {
  m.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === "booking_services"
    ? { id: terms.serviceId, name: terms.serviceName, duration_minutes: terms.durationMinutes, buffer_minutes: terms.bufferMinutes }
    : { timezone: "Europe/Tirane", confirmation_mode: terms.confirmationMode, agent_booking_enabled: true } }));
  expect(await adapter().execute(action, context)).toMatchObject({ status: "failed", output: { code: "booking_terms_changed" } });
  expect(m.persist).not.toHaveBeenCalled();
});

it("does not turn a reviewed manual request into automatic approval without matching current terms", async () => {
  m.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === "booking_services"
    ? { id: terms.serviceId, name: terms.serviceName, duration_minutes: terms.durationMinutes, buffer_minutes: terms.bufferMinutes }
    : { timezone: terms.timezone, confirmation_mode: "manual", agent_booking_enabled: true } }));
  expect(await adapter().execute(action, context)).toMatchObject({ status: "failed", output: { code: "booking_terms_changed" } });
  expect(m.persist).not.toHaveBeenCalled();
});
