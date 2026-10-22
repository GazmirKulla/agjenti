/** Audit-only, no real network/database. The save RPC fixture matches
 * 20261010100000_business_services.sql:97 for cancellation without a recorded event ID.
 * This tests application compensation, not execution of that SQL migration.
 */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  rpc: vi.fn(), fetch: vi.fn(), failReceipt: false,
  booking: { id: "a1111111-1111-4111-8111-111111111111", service_id: "00000000-0000-4000-8000-000000000001", service_name: "Prerje", customer_name: "Test", customer_contact: "",
    starts_at: "2026-10-15T07:00:00Z", ends_at: "2026-10-15T07:30:00Z", blocked_until: "2026-10-15T07:30:00Z", status: "confirmed", notes: "", revision: 1,
    sync_status: "pending", google_event_id: null as string | null, google_calendar_id: null as string | null, google_connection_id: null as string | null },
  connection: { id: "connection", business_id: "business", calendar_id: "audit@example.com", connected: true,
    access_token_encrypted: "audit-not-a-token", refresh_token_encrypted: "audit-not-a-token", expires_at: "2099-01-01" },
}));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => {} }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: (value: string) => value, encryptSecret: (value: string) => value }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({
  rpc: m.rpc,
  from: (table: string) => {
    let update: Record<string, unknown> | undefined;
    const q = {
      select: () => q, eq: () => q,
      update: (value: Record<string, unknown>) => { update = value; return q; },
      single: async () => ({ data: structuredClone(table === "bookings" ? m.booking : m.connection), error: null }),
      maybeSingle: async () => ({ data: structuredClone(m.connection), error: null }),
      throwOnError: async () => {
        if (table === "bookings" && update?.sync_status === "synced" && m.failReceipt) {
          m.failReceipt = false;
          throw new Error("Simulated failed database receipt write after accepted Google POST");
        }
        Object.assign(m.booking, update); return { error: null };
      },
      then: (resolve: (value: { error: null }) => unknown) => {
        if (table === "bookings" && update) Object.assign(m.booking, update);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));
import { syncBooking, googleEventId } from "@/lib/calendar/google";
import { persistBooking } from "@/lib/calendar/service";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(m.booking, { status: "confirmed", revision: 1, sync_status: "pending", google_event_id: null, google_calendar_id: null, google_connection_id: null });
  m.failReceipt = false;
  m.rpc.mockImplementation(async (name: string) => {
    if (name === "claim_booking_sync") return { data: true, error: null };
    if (name === "save_calendar_booking") {
      // Exact returned status under the checked-in SQL cancellation expression.
      Object.assign(m.booking, { status: "cancelled", sync_status: "local", revision: 2 });
      return { data: structuredClone(m.booking), error: null };
    }
    throw new Error(`Unexpected mocked RPC: ${name}`);
  });
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("singleEvents")) return new Response(JSON.stringify({ items: [], timeZone: "Europe/Tirane" }), { status: 200 });
    if (init?.method === "POST") return new Response(JSON.stringify({ id: googleEventId(m.booking.id) }), { status: 200 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("reconciles a possible deterministic Google event when its local booking is cancelled after receipt failure", async () => {
  m.failReceipt = true;
  await expect(syncBooking("business", m.booking.id)).rejects.toThrow("u ruajt në panel");
  expect(m.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  expect(m.booking).toMatchObject({ google_event_id: null, sync_status: "error" });
  m.fetch.mockClear();
  await persistBooking("business", { id: m.booking.id, revision: 1, serviceId: m.booking.service_id, name: "Test", contact: "",
    start: m.booking.starts_at, status: "cancelled", notes: "" });
  expect(m.booking.status).toBe("cancelled");
  expect(m.fetch.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url).endsWith(googleEventId(m.booking.id))),
    "Cancelled local booking must not abandon a Google event whose create receipt was lost").toBe(true);
});

it("the synchronization adapter must delete by deterministic ID even without a recorded provider receipt", async () => {
  // Unit-level compensator invariant, separate from the SQL claim/transition gap.
  m.booking.status = "cancelled"; m.booking.sync_status = "error";
  await syncBooking("business", m.booking.id);
  expect(m.fetch.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url).endsWith(googleEventId(m.booking.id))),
    "Known deterministic ID is sufficient for an idempotent DELETE (404/410 already allowed)").toBe(true);
});
