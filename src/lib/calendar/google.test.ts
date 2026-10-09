import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: {
    id: "connection",
    business_id: "business",
    calendar_id: "calendar@example.com",
    calendar_name: "Demo",
    connected: true,
    access_token_encrypted: "access",
    refresh_token_encrypted: "refresh",
    expires_at: "2099-01-01",
  },
  booking: {
    id: "a1111111-1111-4111-8111-111111111111",
    service_name: "Prerje",
    customer_name: "Test",
    starts_at: "2026-10-15T07:00Z",
    ends_at: "2026-10-15T07:30Z",
    blocked_until: "2026-10-15T07:45Z",
    status: "confirmed",
    notes: "",
    google_event_id: null,
    google_calendar_id: null,
    google_connection_id: null,
  },
  writes: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));
vi.mock("@/lib/crypto/tokens", () => ({
  decryptSecret: (s: string) => s,
  encryptSecret: (s: string) => `encrypted-${s}`,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: (v: Record<string, unknown>) => {
          mocks.writes.push(v);
          return chain;
        },
        single: async () => ({
          data: table === "bookings" ? mocks.booking : mocks.connection,
        }),
        maybeSingle: async () => ({ data: mocks.connection }),
        throwOnError: async () => ({}),
      };
      return chain;
    },
  }),
}));
import { googleBusy, googleEventId, syncBooking } from "./google";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  mocks.rpc.mockResolvedValue({ data: true });
  mocks.connection.connected = true;
  mocks.booking.status = "confirmed";
});
afterEach(() => vi.unstubAllGlobals());
it("treats Google availability errors as unknown, never free", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            calendars: {
              "calendar@example.com": { errors: [{ reason: "notFound" }] },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  await expect(
    googleBusy("business", "2026-10-15T07:00Z", "2026-10-15T08:00Z"),
  ).rejects.toThrow("Nuk u verifikuan");
});
it("does not send Google requests without an active connection", async () => {
  mocks.connection.connected = false;
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    await googleBusy("business", "2026-10-15T07:00Z", "2026-10-15T08:00Z"),
  ).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("uses the same deterministic event after a lost response, avoiding duplicates", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("singleEvents"))
        return new Response(
          JSON.stringify({ items: [], timeZone: "Europe/Tirane" }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({ id: googleEventId(mocks.booking.id) }),
        { status: 200 },
      );
    }),
  );
  await syncBooking("business", mocks.booking.id);
  expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  expect(calls.some((c) => c.startsWith("PATCH"))).toBe(true);
  expect(mocks.writes).toContainEqual(
    expect.objectContaining({
      sync_status: "synced",
      google_event_id: googleEventId(mocks.booking.id),
    }),
  );
});
it("does not claim synchronization succeeded if Google fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 })),
  );
  await expect(syncBooking("business", mocks.booking.id)).rejects.toThrow(
    "u ruajt në panel",
  );
  expect(mocks.writes).toContainEqual(
    expect.objectContaining({ sync_status: "error", sync_lease: null }),
  );
  expect(mocks.writes.some((w) => w.sync_status === "synced")).toBe(false);
});
it("does not perform a second sync while another worker owns the lease", async () => {
  mocks.rpc.mockResolvedValue({ data: false });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(syncBooking("business", mocks.booking.id)).rejects.toThrow(
    "në vazhdim",
  );
  expect(fetch).not.toHaveBeenCalled();
});
