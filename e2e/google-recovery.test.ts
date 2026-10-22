/** Real local PostgreSQL/PostgREST + real booking runtime; Google is an in-memory
 * fake. These are acceptance assertions, intentionally red for unresolved S2.
 * No SQL fault triggers, altered grants, hosted credentials or Google traffic.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { localKeys, verifyContainers } from "./local.mjs";
import { encryptSecret } from "@/lib/crypto/tokens";
import { googleEventId, syncBooking } from "@/lib/calendar/google";
import { persistBooking } from "@/lib/calendar/service";
import { runIsolated } from "@/lib/runtime/isolated-run";
import { IsolationViolation } from "@/lib/runtime/execution-context";

type Event = { id: string; extendedProperties?: { private?: { agjentiBookingId?: string } }; [key: string]: unknown };
const originalFetch = globalThis.fetch;
const calendar = "synthetic-s2@example.invalid";
let db: SupabaseClient;
let business: string, service: string, connection: string;
let loseResponse = false, failReceipt = false, providerFailure = false;
let postBarrier: (() => Promise<void>) | undefined;
const events = new Map<string, Event>();
const calls: string[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const eventKey = (id: string, cal = calendar) => `${cal}/${googleEventId(id)}`;

async function controlledFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.origin === "http://127.0.0.1:55321") {
    if (failReceipt && method === "PATCH" && url.pathname === "/rest/v1/bookings"
      && typeof init?.body === "string" && JSON.parse(init.body).sync_status === "synced") {
      failReceipt = false;
      // Controlled transport outage before dispatch; PostgreSQL stays unchanged.
      return json({ message: "synthetic receipt transport unavailable" }, 503);
    }
    return originalFetch(input, init);
  }
  if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/"))
    throw new Error(`Forbidden network destination: ${url.origin}`);
  calls.push(`${method} ${url.pathname}`);
  if (providerFailure) return json({}, 503);
  if (url.pathname.endsWith("/freeBusy")) return json({ calendars: { [calendar]: { busy: [] } } });
  const match = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) throw new Error("Unexpected fake-provider request");
  const cal = decodeURIComponent(match[1]);
  const key = `${cal}/${match[2]}`;
  if (method === "GET" && !match[2]) return json({ items: [], timeZone: "UTC" });
  if (method === "GET") return events.has(key) ? json(events.get(key)) : json({}, 404);
  if (method === "POST") {
    const event = JSON.parse(String(init?.body)) as Event;
    expect(event.id).toMatch(/^[0-9a-v]{5,1024}$/);
    if (postBarrier) await postBarrier();
    if (events.has(`${cal}/${event.id}`)) return json({}, 409);
    events.set(`${cal}/${event.id}`, event);
    if (loseResponse) { loseResponse = false; throw new TypeError("synthetic accepted POST response lost"); }
    return json(event);
  }
  if (method === "PATCH") {
    if (!events.has(key)) return json({}, 404);
    events.set(key, { ...events.get(key)!, ...JSON.parse(String(init?.body)) });
    return json(events.get(key));
  }
  if (method === "DELETE") {
    if (!events.delete(key)) return json({}, 404);
    return new Response(null, { status: 204 });
  }
  throw new Error("Unexpected fake-provider method");
}

beforeAll(() => {
  verifyContainers();
  const keys = localKeys();
  expect(keys.api).toBe("http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", keys.api);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", keys.service);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "s2-synthetic-test-key-never-use-outside-local");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
  vi.stubGlobal("fetch", controlledFetch);
  db = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: controlledFetch } });
});
beforeEach(async () => {
  business = randomUUID(); service = randomUUID(); connection = randomUUID();
  events.clear(); calls.length = 0;
  loseResponse = failReceipt = providerFailure = false; postBarrier = undefined;
  await db.from("businesses").insert({ id: business, name: "S2 synthetic", slug: `s2-${business}` }).throwOnError();
  await db.from("booking_services").insert({ id: service, business_id: business, name: "S2 service", duration_minutes: 30, buffer_minutes: 0, booking_enabled: true }).throwOnError();
  await db.from("business_calendar_settings").insert({ business_id: business, timezone: "UTC", hours: Array.from({ length: 7 }, (_, day) => ({ day, start: "00:00", end: "23:59" })) }).throwOnError();
  await db.from("google_calendar_connections").insert({ business_id: business, id: connection, calendar_id: calendar, connected: true,
    access_token_encrypted: encryptSecret("synthetic-access"), refresh_token_encrypted: encryptSecret("synthetic-refresh"), expires_at: "2099-01-01T00:00:00Z" }).throwOnError();
});
afterEach(async () => {
  failReceipt = false; providerFailure = false; postBarrier = undefined;
  await db.from("businesses").delete().eq("id", business).throwOnError();
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function input() {
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(12, 0, 0, 0);
  return { serviceId: service, name: "Synthetic customer", contact: "", notes: "", start: start.toISOString(), status: "confirmed" as const };
}
async function row(id: string) {
  return (await db.from("bookings").select("*").eq("business_id", business).eq("id", id).single().throwOnError()).data!;
}
async function cancel(id: string) {
  const b = await row(id);
  return persistBooking(business, { ...input(), id, revision: b.revision, status: "cancelled" });
}
async function pending() {
  const p = input();
  const r = await db.rpc("save_calendar_booking", { p_business: business, p_id: null, p_revision: 0, p_service: service, p_name: p.name, p_contact: "", p_start: p.start, p_status: p.status, p_notes: "", p_request_key: null }).throwOnError();
  return r.data as { id: string };
}
function barrier() {
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(r => { entered = r; });
  const wait = new Promise<void>(r => { release = r; });
  postBarrier = async () => { entered(); await wait; };
  return { reached, release };
}

it("S2 normal creation and cancellation reach the fake provider and persist real receipts", async () => {
  const { booking, syncError } = await persistBooking(business, input());
  expect(syncError).toBeNull(); expect(events.size).toBe(1);
  expect(await row(booking.id)).toMatchObject({ sync_status: "synced", google_calendar_id: calendar, google_connection_id: connection });
  expect((await cancel(booking.id)).syncError).toBeNull();
  expect(events.size).toBe(0); expect((await row(booking.id)).status).toBe("cancelled");
});

it.each(["response", "receipt"])("S2 lost %s followed by cancellation must not abandon the event", async mode => {
  loseResponse = mode === "response"; failReceipt = mode === "receipt";
  const { booking, syncError } = await persistBooking(business, input());
  expect(syncError).not.toBeNull(); expect(events.has(eventKey(booking.id))).toBe(true);
  expect(await row(booking.id)).toMatchObject({ sync_status: "error", google_event_id: null });
  await cancel(booking.id);
  expect(events.size, "Cancellation abandoned an accepted event after an uncertain create").toBe(0);
});

it("S2 retry after response loss uses the same event, without a second POST", async () => {
  loseResponse = true;
  const { booking } = await persistBooking(business, input());
  await syncBooking(business, booking.id);
  expect(events.size).toBe(1);
  expect(calls.filter(c => c.startsWith("POST") && !c.includes("freeBusy"))).toHaveLength(1);
  expect((await row(booking.id)).sync_status).toBe("synced");
});

it("S2 a changed connection cannot silently adopt an uncertain old event", async () => {
  loseResponse = true;
  const { booking } = await persistBooking(business, input());
  await db.from("google_calendar_connections").update({ id: randomUUID() }).eq("business_id", business).throwOnError();
  calls.length = 0;
  const result = await syncBooking(business, booking.id).then(() => "success", () => "blocked");
  expect(result).toBe("blocked"); expect(calls).toHaveLength(0);
});

it("S2 a changed calendar must not duplicate an uncertain event", async () => {
  loseResponse = true;
  const { booking } = await persistBooking(business, input());
  // Administrative mutation, not a claim that the normal selection UI permits it.
  await db.from("google_calendar_connections").update({ calendar_id: "replacement@example.invalid" }).eq("business_id", business).throwOnError();
  await syncBooking(business, booking.id).catch(() => undefined);
  expect(events.size, "One booking now has effects on two calendars").toBe(1);
});

it("S2 concurrent real PostgreSQL claims grant exactly one lease", async () => {
  const b = await pending();
  const results = await Promise.all(Array.from({ length: 8 }, () => db.rpc("claim_booking_sync", { p_business: business, p_booking: b.id, p_lease: randomUUID() }).throwOnError()));
  expect(results.filter(r => r.data === true)).toHaveLength(1);
});

it("S2 cancelled intent must survive an expired lease and a late provider completion", async () => {
  const b = await pending(), gate = barrier();
  const first = syncBooking(business, b.id);
  await gate.reached;
  try {
    await db.from("bookings").update({ sync_lease_until: "2000-01-01T00:00:00Z" }).eq("id", b.id).eq("business_id", business).throwOnError();
    await cancel(b.id);
  } finally { gate.release(); }
  await first.catch(() => undefined);
  expect((await row(b.id)).status).toBe("cancelled");
  expect(events.size, "Late creation survived a successful local cancellation").toBe(0);
});

it("S2 stale worker receipt cannot be reported as successfully persisted", async () => {
  const b = await pending(), gate = barrier();
  const first = syncBooking(business, b.id).then(() => "success", () => "rejected");
  await gate.reached;
  try {
    await db.from("bookings").update({ sync_lease_until: "2000-01-01T00:00:00Z" }).eq("id", b.id).eq("business_id", business).throwOnError();
    expect((await db.rpc("claim_booking_sync", { p_business: business, p_booking: b.id, p_lease: randomUUID() }).throwOnError()).data).toBe(true);
  } finally { gate.release(); }
  expect(await first).toBe("rejected");
});

it("S2 active lease rejects concurrent cancellation explicitly without pretending success", async () => {
  const b = await pending(), gate = barrier();
  const first = syncBooking(business, b.id);
  await gate.reached;
  try { await expect(cancel(b.id)).rejects.toThrow(); }
  finally { gate.release(); }
  await first;
  expect((await row(b.id)).status).toBe("confirmed");
  await cancel(b.id); expect(events.size).toBe(0);
});

it("S2 provider 404 during receipt-backed compensation is idempotent", async () => {
  const { booking } = await persistBooking(business, input());
  events.clear();
  expect((await cancel(booking.id)).syncError).toBeNull();
  expect((await row(booking.id)).sync_status).toBe("synced");
});

it("S2 temporary provider failure remains retryable and never claims sync success", async () => {
  const b = await pending(); providerFailure = true;
  await expect(syncBooking(business, b.id)).rejects.toThrow();
  expect((await row(b.id)).sync_status).toBe("error"); expect(events.size).toBe(0);
  providerFailure = false; await syncBooking(business, b.id);
  expect(events.size).toBe(1);
});

it("S2 wrong-tenant claim cannot access a booking or issue provider calls", async () => {
  const b = await pending();
  expect((await db.rpc("claim_booking_sync", { p_business: randomUUID(), p_booking: b.id, p_lease: randomUUID() }).throwOnError()).data).toBe(false);
  expect(calls).toHaveLength(0); expect((await row(b.id)).sync_lease).toBeNull();
});

it("S2 W6a refuses booking writes and provider calls before real database access", async () => {
  await runIsolated(async () => {
    await expect(syncBooking(business, randomUUID())).rejects.toBeInstanceOf(IsolationViolation);
    await expect(persistBooking(business, input())).rejects.toBeInstanceOf(IsolationViolation);
  });
  expect(calls).toHaveLength(0);
  expect((await db.from("bookings").select("id").eq("business_id", business).throwOnError()).data).toEqual([]);
});
