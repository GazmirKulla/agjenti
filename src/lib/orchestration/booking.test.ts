import { beforeEach, expect, it, vi } from "vitest";
import { bookingAdapter } from "./booking";
import type { Action } from "./contracts";
import { bookingFields } from "./booking-definition";
import { runIsolated } from "@/lib/runtime/isolated-run";
const m = vi.hoisted(() => ({ slots: vi.fn(), persist: vi.fn(), modules: vi.fn(), read: vi.fn(), version: vi.fn(), compile: vi.fn() }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: m.version }));
vi.mock("./visual-definition", () => ({ compileVisualProcesses: m.compile }));
vi.mock("@/lib/calendar/service", () => ({ availableSlots: m.slots, persistBooking: m.persist }));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: m.modules }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, maybeSingle: () => m.read(table) }; return query;
} }) }));
const terms = { serviceId: "service", serviceName: "Consultation", durationMinutes: 30, bufferMinutes: 10, timezone: "UTC", confirmationMode: "manual" };
const action: Action = { id: "action", instanceId: "instance", stepId: bookingFields("book").key("create"), tool: "booking.create", toolVersion: 1, inputDigest: "digest", status: "prepared",
  input: { ...terms, date: "2026-12-01", time: "10:00", name: "Example Customer", contact: "customer@example.test" } };
const context = { businessId: "business", conversationId: "conversation", revision: 8, signal: new AbortController().signal };
const adapter = () => bookingAdapter({ businessId: "business", conversationId: "conversation", lease: { jobId: 5, leaseToken: "lease" }, definitionForInstance: () => ({ versionId: "version", definitionId: "flow" }) });
beforeEach(() => {
  vi.clearAllMocks();
  m.modules.mockResolvedValue(undefined);
  m.version.mockResolvedValue({ graph: { version: 2, nodes: [{ id: "book", kind: "booking" }], flows: [{ id: "flow", nodeIds: ["book"], serviceIds: ["service"] }] } });
  m.compile.mockReturnValue([{ id: "flow", steps: [{ id: action.stepId, kind: "effect", tool: "booking.create" }] }]);
  m.read.mockImplementation((table: string) => Promise.resolve({ error: null, data: table === "booking_services"
    ? { id: terms.serviceId, name: terms.serviceName, duration_minutes: terms.durationMinutes, buffer_minutes: terms.bufferMinutes }
    : { timezone: terms.timezone, confirmation_mode: terms.confirmationMode, agent_booking_enabled: true } }));
  m.slots.mockResolvedValue([{ start: "2026-12-01T10:00:00+00:00" }]);
  m.persist.mockResolvedValue({ booking: { id: "booked", status: "pending", starts_at: "2026-12-01T10:00:00Z", service_name: "Consultation", sync_status: "local" } });
});
it("accepts equivalent timestamp formats and binds the write to the claimed revision and action", async () => {
  expect(await adapter().execute(action, context)).toMatchObject({ status: "succeeded", output: { status: "pending" } });
  expect(m.persist).toHaveBeenCalledWith("business", expect.objectContaining({ requestKey: "ig:conversation:action", status: "pending" }),
    { jobId: 5, leaseToken: "lease", conversationId: "conversation", revision: 8 });
});
it("refuses changed terms before checking availability or writing", async () => {
  expect(await adapter().execute({ ...action, input: { ...action.input, durationMinutes: 45 } }, context)).toMatchObject({ status: "failed", output: { code: "booking_terms_changed" } });
  expect(m.slots).not.toHaveBeenCalled(); expect(m.persist).not.toHaveBeenCalled();
});
it("does not book an unavailable slot or when availability cannot be verified", async () => {
  m.slots.mockResolvedValue([]);
  expect(await adapter().execute(action, context)).toMatchObject({ status: "failed", output: { code: "slot_unavailable" } });
  m.slots.mockRejectedValue(new Error("offline"));
  expect(await adapter().execute(action, context)).toMatchObject({ status: "failed", output: { code: "availability_unverified" } });
  expect(m.persist).not.toHaveBeenCalled();
});
it("does not misclassify an uncertain write as a definite failure", async () => {
  m.persist.mockRejectedValue(new Error("response lost"));
  await expect(adapter().execute(action, context)).rejects.toThrow("response lost");
});
it("refuses foreign scope, isolated live execution and cancellation", async () => {
  await expect(adapter().execute(action, { ...context, businessId: "other" })).rejects.toThrow("effect_scope_mismatch");
  await expect(runIsolated(() => adapter().execute(action, context))).rejects.toThrow("effect_scope_mismatch");
  const controller = new AbortController(); controller.abort();
  expect(await adapter().execute(action, { ...context, signal: controller.signal })).toMatchObject({ status: "failed" });
  expect(m.persist).not.toHaveBeenCalled();
});
it("simulates without reads, availability queries or writes", async () => {
  expect(await runIsolated(() => adapter().simulate!(action))).toMatchObject({ status: "simulated", availability: "unverified" });
  expect(m.read).not.toHaveBeenCalled(); expect(m.slots).not.toHaveBeenCalled(); expect(m.persist).not.toHaveBeenCalled();
});
it("rechecks the published workflow service binding before the write", async () => {
  m.version.mockResolvedValue({ graph: { version: 2, nodes: [{ id: "book", kind: "booking" }], flows: [{ id: "flow", nodeIds: ["book"], serviceIds: ["other-service"] }] } });
  expect(await adapter().execute(action, context)).toMatchObject({ status: "failed", output: { code: "booking_definition_unavailable" } });
  expect(m.persist).not.toHaveBeenCalled();
});
