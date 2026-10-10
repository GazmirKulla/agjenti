import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), busy: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("./google", () => ({ googleBusy: m.busy, syncBooking: m.sync, googleConnection: vi.fn(), writableCalendars: vi.fn() }));
import { persistBooking } from "./service";

const input = { serviceId: "00000000-0000-4000-8000-000000000001", name: "Demo", contact: "0690000000", start: "2026-11-01T10:00:00Z", status: "pending" as const, notes: "", requestKey: "ig:conversation:stable-task" };
const guard = { jobId: 7, leaseToken: "lease", conversationId: "conversation", revision: 4 };
const booking = { id: "booking", status: "pending", sync_status: "local" };
let previous: unknown = null;
beforeEach(() => {
  vi.clearAllMocks(); previous = null;
  m.from.mockImplementation((table: string) => {
    const chain = { select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: previous, error: null }),
      single: async () => ({ data: table === "booking_services" ? { duration_minutes: 30, buffer_minutes: 0 } : null, error: null }) };
    return chain;
  });
  m.busy.mockResolvedValue([]);
  m.rpc.mockResolvedValue({ data: booking, error: null });
  m.sync.mockResolvedValue(undefined);
});
it("uses the lease/revision/identity guarded RPC for an Instagram booking", async () => {
  await persistBooking("business", input, guard);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("save_workflow_booking", expect.objectContaining({ p_job: 7, p_token: "lease", p_conversation: "conversation", p_revision: 4, p_request_key: input.requestKey }));
  expect(m.busy).toHaveBeenCalledOnce();
});
it("reconciles a committed booking after checkpoint failure without rejecting its own occupied slot", async () => {
  previous = booking;
  expect((await persistBooking("business", input, guard)).booking.id).toBe("booking");
  expect(m.busy).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledWith("save_workflow_booking", expect.objectContaining({ p_request_key: input.requestKey }));
});
it("still checks ownership on replay and preserves the guard failure", async () => {
  previous = booking;
  m.rpc.mockResolvedValue({ data: null, error: { message: "ownership_lost" } });
  await expect(persistBooking("business", input, guard)).rejects.toThrow("ownership_lost");
  expect(m.sync).not.toHaveBeenCalled();
});
it("rejects a request key from another conversation before persistence", async () => {
  await expect(persistBooking("business", { ...input, requestKey: "ig:someone-else:task" }, guard)).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});
it("retries failed Google sync for an already saved booking and reports its local success", async () => {
  previous = { ...booking, sync_status: "error" };
  m.sync.mockRejectedValue(new Error("Google unavailable"));
  const result = await persistBooking("business", input);
  expect(result.booking.id).toBe("booking"); expect(result.syncError).toBe("Google unavailable");
  expect(m.rpc).not.toHaveBeenCalled();
});
