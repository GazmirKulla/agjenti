import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  from: vi.fn(),
  google: vi.fn(),
  slots: vi.fn(),
  queries: [] as { table: string; calls: [string, unknown[]][] }[],
  responses: [] as unknown[],
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: m.from }),
}));
vi.mock("./google", () => ({
  googleBusy: m.google,
  googleConnection: vi.fn(),
  syncBooking: vi.fn(),
  writableCalendars: vi.fn(),
}));
vi.mock("./model", async () => {
  const original = await vi.importActual<typeof import("./model")>("./model");
  return { ...original, slotCandidates: m.slots };
});
import { availableSlots } from "./service";
beforeEach(() => {
  vi.clearAllMocks();
  m.queries.length = 0;
  m.responses.length = 0;
  m.google.mockResolvedValue([]);
  m.slots.mockReturnValue([
    { start: "2026-10-12T08:00:00Z", blockedUntil: "2026-10-12T08:30:00Z" },
  ]);
  m.from.mockImplementation((table: string) => {
    const calls: [string, unknown[]][] = [];
    m.queries.push({ table, calls });
    const result = m.responses.shift();
    const chain: Record<string, unknown> = {
      then: (resolve: (r: unknown) => void) =>
        Promise.resolve(result).then(resolve),
    };
    for (const name of [
      "select",
      "eq",
      "neq",
      "in",
      "lt",
      "gt",
      "single",
      "maybeSingle",
    ])
      chain[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return chain;
      };
    return chain;
  });
});
it("excludes only the tenant-owned current booking and its Google event while rescheduling", async () => {
  m.responses.push(
    { data: { google_event_id: "google-event" } },
    { data: { timezone: "Europe/Tirane" } },
    { data: { id: "service" } },
    { data: [] },
  );
  const slots = await availableSlots(
    "business",
    "service",
    "2026-10-12",
    "booking",
  );
  expect(slots).toHaveLength(1);
  expect(m.queries[0].calls).toContainEqual([
    "eq",
    ["business_id", "business"],
  ]);
  expect(m.queries[0].calls).toContainEqual(["eq", ["id", "booking"]]);
  expect(m.queries[3].calls).toContainEqual(["neq", ["id", "booking"]]);
  expect(m.google).toHaveBeenCalledWith(
    "business",
    expect.any(String),
    expect.any(String),
    "google-event",
  );
});
it("rejects a foreign booking instead of excluding another tenant's appointment", async () => {
  m.responses.push({ data: null, error: { message: "not found" } });
  await expect(
    availableSlots("business", "service", "2026-10-12", "foreign"),
  ).rejects.toThrow();
  expect(m.google).not.toHaveBeenCalled();
});
it("fails closed if Google availability cannot be verified", async () => {
  m.responses.push(
    { data: { timezone: "Europe/Tirane" } },
    { data: { id: "service" } },
    { data: [] },
  );
  m.google.mockRejectedValue(new Error("Google unavailable"));
  await expect(
    availableSlots("business", "service", "2026-10-12"),
  ).rejects.toThrow("Google unavailable");
});
