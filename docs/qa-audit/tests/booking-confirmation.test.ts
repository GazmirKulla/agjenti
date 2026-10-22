/** Audit-only regression tests. Every provider/database boundary is mocked.
 * These assert safety invariants, so the two change cases should fail until fixed.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  extract: vi.fn(), slots: vi.fn(), persist: vi.fn(),
  cfg: { agent_booking_enabled: true, timezone: "Europe/Tirane", confirmation_mode: "automatic" },
  services: [{ id: "00000000-0000-4000-8000-000000000001", business_id: "business", name: "Prerje", duration_minutes: 30,
    buffer_minutes: 0, is_active: true, booking_enabled: true }],
}));
vi.mock("@/lib/calendar/agent-parser", () => ({ extractBookingDetails: m.extract }));
vi.mock("@/lib/calendar/service", () => ({ availableSlots: m.slots, persistBooking: m.persist }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: async () => ({ enabledModules: ["bookings", "services"] }) }));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => {} }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "audit-no-provider" }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: async () => null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: (table: string) => {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: async () => ({ data: structuredClone(m.cfg), error: null }),
      order: async () => ({ data: table === "booking_services" ? structuredClone(m.services.filter(service =>
        filters.every(([key, value]) => service[key as keyof typeof service] === value))) : [], error: null }),
    };
    return q;
  } }),
}));

import { processBookingTurn } from "@/lib/calendar/agent";
const guard = { jobId: 7, leaseToken: "audit-lease", conversationId: "conversation", revision: 4 };
const params = { businessId: "business", mode: "production" as const, routed: true, conversationKey: "conversation", bookingGuard: guard,
  canAct: async () => true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Audit forbids real network access"); }));
  m.cfg.timezone = "Europe/Tirane"; m.cfg.confirmation_mode = "automatic";
  m.services[0].duration_minutes = 30; m.services[0].buffer_minutes = 0;
  m.extract.mockResolvedValue({ bookingIntent: true, cancel: false, serviceId: m.services[0].id, date: "2026-10-15", time: "09:00", name: "Klienti", contact: "+355691111111" });
  m.slots.mockResolvedValue([{ start: "2026-10-15T07:00:00Z", end: "2026-10-15T07:30:00Z", blockedUntil: "2026-10-15T07:30:00Z" }]);
  m.persist.mockImplementation(async (_businessId: string, input: { serviceId: string; name: string; contact: string; start: string; status: string }) => ({
    booking: { id: "audit-booking", service_id: input.serviceId, service_name: m.services[0].name, customer_name: input.name,
      customer_contact: input.contact, starts_at: input.start, status: input.status }, syncError: null,
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function requestReview() {
  const reviewed = await processBookingTurn({ ...params, message: "Dua rezervim" });
  expect(reviewed?.reply).toContain("30 min");
  expect(reviewed?.reply).toContain("09:00");
  expect(m.persist).not.toHaveBeenCalled();
  return reviewed!.nextState;
}

it("control: unchanged production booking confirmation reaches the guarded persistence adapter", async () => {
  const state = await requestReview();
  const result = await processBookingTurn({ ...params, state, message: "Konfirmoj" });
  expect(m.persist).toHaveBeenCalledExactlyOnceWith("business", expect.objectContaining({
    start: "2026-10-15T07:00:00.000Z", status: "confirmed", serviceId: m.services[0].id,
  }), guard);
  expect(result?.reply).toContain("Rezervimi u konfirmua");
  expect(fetch).not.toHaveBeenCalled();
});

it("requires a fresh review when service duration changes after the customer saw 30 minutes", async () => {
  const state = await requestReview();
  m.services[0].duration_minutes = 60;
  m.slots.mockResolvedValue([{ start: "2026-10-15T07:00:00Z", end: "2026-10-15T08:00:00Z", blockedUntil: "2026-10-15T08:00:00Z" }]);
  const result = await processBookingTurn({ ...params, state, message: "Konfirmoj" });
  expect(m.persist, "Changed duration must not acquire permission to persist from the old review").not.toHaveBeenCalled();
  expect(result?.reply).toContain("60 min");
  expect(result?.reply).toContain("Konfirmon");
  await processBookingTurn({ ...params, state: result!.nextState, message: "Konfirmoj" });
  expect(m.persist).toHaveBeenCalledTimes(1);
});

it("requires a fresh review when calendar timezone changes and 09:00 now means another instant", async () => {
  const state = await requestReview();
  m.cfg.timezone = "UTC";
  m.slots.mockResolvedValue([{ start: "2026-10-15T09:00:00Z", end: "2026-10-15T09:30:00Z", blockedUntil: "2026-10-15T09:30:00Z" }]);
  const result = await processBookingTurn({ ...params, state, message: "Konfirmoj" });
  expect(m.persist, "Old Europe/Tirane review must not authorize a 09:00 UTC booking").not.toHaveBeenCalled();
  expect(result?.reply).toContain("Konfirmon");
  expect(result?.reply).toContain("UTC");
  await processBookingTurn({ ...params, state: result!.nextState, message: "Konfirmoj" });
  expect(m.persist).toHaveBeenCalledExactlyOnceWith("business", expect.objectContaining({ start: "2026-10-15T09:00:00.000Z" }), guard);
});

it("requires fresh review for historical confirmation keys without service/calendar terms", async () => {
  const state = await requestReview();
  const draft = state.fields.booking as import("@/lib/calendar/agent").BookingDraft;
  draft.review = { factsKey: JSON.stringify(["business", null, draft.nonce, draft.serviceId, draft.date, draft.time, draft.name, draft.contact]) };
  const result = await processBookingTurn({ ...params, state, message: "Konfirmoj" });
  expect(m.persist).not.toHaveBeenCalled();
  expect(result?.reply).toContain("Konfirmon");
  expect((result?.nextState.fields.booking as typeof draft).nonce).toBe(draft.nonce);
});

it("does not turn a reviewed manual request into automatic approval without a new review", async () => {
  m.cfg.confirmation_mode = "manual";
  const state = await requestReview();
  m.cfg.confirmation_mode = "automatic";
  expect((await processBookingTurn({ ...params, state, message: "Konfirmoj" }))?.reply).toContain("Konfirmon");
  expect(m.persist).not.toHaveBeenCalled();
});
