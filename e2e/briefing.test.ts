/** Real disposable Auth, PostgREST and RLS. Only transport errors are injected;
 * no schema changes, DDL, triggers, AI calls or real providers. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localKeys, verifyContainers, sql, work } from "./local.mjs";
let session: SupabaseClient, owner: SupabaseClient, outsider: SupabaseClient;
let failTable = "", requests: { path: string; method: string }[] = [];
let revokeDuringRead = false, deniedModule = "";
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { loadBriefing } from "@/lib/business-assistant/briefing";
import { POST as chat } from "@/app/api/business-assistant/route";
import { GET } from "@/app/api/business-assistant/briefing/route";
import { reportingRange } from "@/lib/business-assistant/briefing-model";
const f = JSON.parse(readFileSync(`${work}/fixtures.json`, "utf8"));
const retail = f.tenants.find((t: {kind: string}) => t.kind === "retail");
const foreign = f.tenants.find((t: {kind: string}) => t.kind === "appointment");
const business = randomUUID(), slug = `briefing-${randomUUID()}`, conversation = randomUUID(), customer = randomUUID(), connection = randomUUID(), service = randomUUID();
const enabled = ["inbox", "products", "orders", "customers", "services", "bookings"];
const profile = JSON.stringify({ version: 1, source: "manual", enabledModules: enabled });
const now = new Date("2026-10-20T12:00:00Z");
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const originalFetch = globalThis.fetch;
beforeAll(async () => {
  verifyContainers();
  const keys = localKeys();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", keys.api);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", keys.service);
  vi.stubEnv("OPENAI_API_KEY", "");
  const guard = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== keys.api) throw Error("EXTERNAL_PROVIDER_FORBIDDEN");
    requests.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (url.pathname === `/rest/v1/${failTable}`) return Response.json({ message: "synthetic transport failure" }, { status: 503 });
    if (deniedModule && url.pathname.endsWith("/current_user_module_allowed") && String(init?.body).includes(deniedModule))
      return Response.json(false);
    if (revokeDuringRead && url.pathname === "/rest/v1/messages") {
      revokeDuringRead = false;
      sql(`delete from public.business_users where business_id='${business}' and user_id='${retail.userId}';`);
    }
    return originalFetch(input, init);
  };
  vi.stubGlobal("fetch", guard);
  const client = () => createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guard } });
  owner = client(); outsider = client();
  expect((await owner.auth.signInWithPassword({ email: retail.email, password: f.password })).error).toBeNull();
  expect((await outsider.auth.signInWithPassword({ email: foreign.email, password: f.password })).error).toBeNull();
  sql(`insert into public.businesses(id,name,slug,timezone,dashboard_profile) values('${business}','Synthetic briefing',${quote(slug)},'Europe/Tirane','${profile}');
    insert into public.business_users(business_id,user_id,role) values('${business}','${retail.userId}','owner');
    insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values('${connection}','${business}','briefing-${business}','synthetic-not-a-token','connected');
    insert into public.customers(id,business_id,display_name,created_at) values('${customer}','${business}','Synthetic CRM','2026-10-19T22:30Z');
    insert into public.conversations(id,business_id,customer_id,instagram_connection_id,status,created_at) values('${conversation}','${business}','${customer}','${connection}','paused','2026-10-19T22:30Z');
    insert into public.conversation_states(conversation_id,business_id,collected) values('${conversation}','${business}','{"staffHandoff":true}');
    insert into public.messages(business_id,conversation_id,instagram_connection_id,external_message_id,direction,source,created_at) values
      ('${business}','${conversation}','${connection}','briefing-1','inbound','customer','2026-10-19T22:00Z'),
      ('${business}','${conversation}','${connection}','briefing-2','inbound','customer','2026-10-20T11:59Z'),
      ('${business}','${conversation}','${connection}','briefing-before','inbound','customer','2026-10-19T21:59:59Z'),
      ('${business}','${conversation}','${connection}','briefing-future','inbound','customer','2026-10-20T23:00Z'),
      ('${business}','${conversation}','${connection}','briefing-ai','outbound','agent','2026-10-20T10:00Z'),
      ('${business}','${conversation}','${connection}','briefing-staff','outbound','staff','2026-10-20T10:01Z');
    insert into public.orders(business_id,status,created_at) values('${business}','draft','2026-10-20T10:00Z'),('${business}','failed','2026-10-20T10:01Z');
    insert into public.booking_services(id,business_id,name,duration_minutes) values('${service}','${business}','Synthetic briefing service',30);
    insert into public.bookings(business_id,service_id,service_name,customer_name,starts_at,ends_at,blocked_until,status,created_at) values
      ('${business}','${service}','Synthetic service','Synthetic customer','2030-01-01T10:00Z','2030-01-01T10:30Z','2030-01-01T10:30Z','pending','2026-10-20T10:00Z');
    insert into public.integration_logs(business_id,direction,target,status,created_at) values('${business}','outbound','orders','failed','2026-10-20T10:00Z');`);
});
beforeEach(() => { session = owner; failTable = ""; requests = []; revokeDuringRead = false; deniedModule = ""; });
afterAll(() => {
  sql(`delete from public.businesses where id='${business}';`);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
it("counts real same-tenant records by recording time, excludes outbound and future events, no writes/providers", async () => {
  const result = await loadBriefing(slug, "today", now);
  expect(Object.fromEntries(Object.entries(result.metrics).map(([k, v]) => [k, v.count]))).toEqual({ messages: 2, orders: 2, customers: 1, bookings: 1 });
  expect(result.attention.handoffs.count).toBe(1);
  expect(result.attention.integrationFailures.count).toBe(1);
  expect(requests.filter(r => !["GET", "HEAD"].includes(r.method)).every(r => r.path.endsWith("/current_user_module_allowed") || r.path.endsWith("/allowed_business_modules"))).toBe(true);
  expect(requests.some(r => /write_|save_|submit_|queue|functions/.test(r.path))).toBe(false);
});
it("real channel uniqueness rejects duplicate events without increasing metrics", async () => {
  const before = (await loadBriefing(slug, "today", now)).metrics.messages.count;
  expect(() => sql(`insert into public.messages(business_id,conversation_id,instagram_connection_id,external_message_id,direction,source) values('${business}','${conversation}','${connection}','briefing-1','inbound','customer');`)).toThrow(/duplicate key/);
  expect((await loadBriefing(slug, "today", now)).metrics.messages.count).toBe(before);
});
it("does not count paused conversations without a real handoff", async () => {
  sql(`update public.conversation_states set collected='{}' where conversation_id='${conversation}';`);
  try { expect((await loadBriefing(slug, "today", now)).attention.handoffs.count).toBe(0); }
  finally { sql(`update public.conversation_states set collected='{"staffHandoff":true}' where conversation_id='${conversation}';`); }
});
it("real RLS and API reject foreign tenants and revoked membership", async () => {
  session = outsider;
  expect((await outsider.from("messages").select("id").eq("business_id", business)).data).toEqual([]);
  await expect(loadBriefing(slug, "today", now)).rejects.toMatchObject({ status: 403 });
  session = owner;
  sql(`delete from public.business_users where business_id='${business}' and user_id='${retail.userId}';`);
  try { await expect(loadBriefing(slug, "today", now)).rejects.toMatchObject({ status: 403 }); }
  finally { sql(`insert into public.business_users(business_id,user_id,role) values('${business}','${retail.userId}','owner');`); }
});
it("revocation during aggregation discards RLS-empty counts rather than returning zero", async () => {
  revokeDuringRead = true;
  try { await expect(loadBriefing(slug, "today", now)).rejects.toMatchObject({ status: 403 }); }
  finally { sql(`insert into public.business_users(business_id,user_id,role) values('${business}','${retail.userId}','owner') on conflict do nothing;`); }
});
it("module OFF does not query the disabled source; denied entitlements are not zero", async () => {
  const changed = JSON.stringify({ version: 1, source: "manual", enabledModules: enabled.filter(m => m !== "orders") });
  sql(`update public.businesses set dashboard_profile='${changed}' where id='${business}';`);
  try {
    const result = await loadBriefing(slug, "today", now);
    expect(result.metrics.orders).toMatchObject({ status: "disabled", count: null });
    expect(requests.some(r => r.path === "/rest/v1/orders")).toBe(false);
  } finally { sql(`update public.businesses set dashboard_profile='${profile}' where id='${business}';`); }
  deniedModule = "orders"; requests = [];
  expect((await loadBriefing(slug, "today", now)).metrics.orders.status).toBe("disabled");
  expect(requests.some(r => r.path === "/rest/v1/orders")).toBe(false);
});
it("partial transport failure remains unavailable while verified zero remains zero", async () => {
  failTable = "orders";
  const result = await loadBriefing(slug, "yesterday", now);
  expect(result.metrics.orders).toMatchObject({ status: "unavailable", count: null, reason: "query_failed" });
  expect(result.metrics.customers).toMatchObject({ status: "available", count: 0 });
  expect(result.metrics.messages.count).toBe(1);
});
it("invalid timezone fails closed without metric period queries", async () => {
  sql(`update public.businesses set timezone='Invalid/Timezone' where id='${business}';`);
  try {
    const result = await loadBriefing(slug, "today", now);
    expect(result).toMatchObject({ range: null, configurationError: "timezone_invalid" });
    expect(result.metrics.messages.count).toBeNull();
    expect(requests.some(r => r.path === "/rest/v1/messages")).toBe(false);
  } finally { sql(`update public.businesses set timezone='Europe/Tirane' where id='${business}';`); }
});
it("day/week endpoints use the same service; explicit chat works without any model key", async () => {
  const r = await GET(new Request(`http://localhost/api/business-assistant/briefing?slug=${slug}&period=week`));
  expect(r.status).toBe(200);
  const result = await loadBriefing(slug, "week", now);
  expect(result.range).toEqual(reportingRange("week", "Europe/Tirane", now));
  const answer = await chat(new Request(`http://localhost/api/business-assistant?slug=${slug}`, { method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ mode: "plan", text: "Sa porosi kemi dje?", language: "en" }) }));
  expect(answer.status).toBe(200);
  expect(await answer.json()).toMatchObject({ briefing: { period: "yesterday" }, message: expect.stringContaining("Orders created:") });
  expect(requests.some(r => /write_|save_|submit_|queue/.test(r.path))).toBe(false);
});
it("explicit stored questions preserve the exact unfinished plan and its revision, including duplicate requests", async () => {
  const id = randomUUID(), initialRequest = randomUUID(), requestId = randomUUID();
  const snapshot = { version: 1, request: "Plan sintetik i papërfunduar", message: "Shqyrto ndryshimin.",
    context: { page: "products", entryPoint: "contextual", entityType: "product", entityId: randomUUID() },
    target: { kind: "product", id: randomUUID(), updatedAt: "2026-01-01T00:00Z" } };
  sql(`select public.write_assistant_conversation('${business}','${retail.userId}','${id}','create');
    select public.write_assistant_conversation('${business}','${retail.userId}','${id}','begin',0,'${initialRequest}','{"content":"Plan sintetik","fingerprint":"${"a".repeat(64)}"}');
    select public.write_assistant_conversation('${business}','${retail.userId}','${id}','finish',null,'${initialRequest}',${quote(JSON.stringify({ content: "Propozim sintetik", snapshot }))}::jsonb);`);
  const before = sql(`select jsonb_build_object('plan',plan_revision,'revision',revision) from public.assistant_conversations where id='${id}';`);
  const request = () => new Request(`http://localhost/api/business-assistant?slug=${slug}`, { method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ mode: "plan", text: "Sa mesazhe morëm sot?", conversationId: id, requestId,
      revision: JSON.parse(before).revision, context: { page: "home", entryPoint: "home" } }) });
  const response = await chat(request());
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.token).toBeUndefined(); expect(data.saved).not.toBe(true);
  expect(data.persistence.plan.snapshot).toEqual(snapshot);
  expect(data.persistence.conversation.plan_revision).toBe(JSON.parse(before).plan);
  const repeated = await chat(request());
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).persistence.messages).toHaveLength(4);
  expect(requests.some(r => /save_|submit_|queue|booking/.test(r.path) && r.method !== "GET" && r.method !== "HEAD")).toBe(false);
});
it("WhatsApp uniqueness also prevents retry double-counting; unlinked participants are not CRM customers", async () => {
  const wa = randomUUID(), convo = randomUUID();
  const before = await loadBriefing(slug, "today", now);
  sql(`insert into public.whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext) values('${wa}','${business}','synthetic-${wa}','synthetic','not-a-token');
    insert into public.conversations(id,business_id,channel,whatsapp_connection_id,whatsapp_participant_id,customer_id) values('${convo}','${business}','whatsapp','${wa}','synthetic-participant',null);
    insert into public.messages(business_id,conversation_id,whatsapp_connection_id,external_message_id,direction,source,created_at) values('${business}','${convo}','${wa}','wa-briefing','inbound','customer','2026-10-20T11:00Z');`);
  const after = await loadBriefing(slug, "today", now);
  expect(after.metrics.messages.count).toBe(before.metrics.messages.count! + 1);
  expect(after.metrics.customers.count).toBe(before.metrics.customers.count);
  expect(() => sql(`insert into public.messages(business_id,conversation_id,whatsapp_connection_id,external_message_id,direction,source) values('${business}','${convo}','${wa}','wa-briefing','inbound','customer');`)).toThrow(/duplicate key/);
});
it("application DST boundaries agree with real PostgreSQL timezone conversion", () => {
  for (const date of ["2026-03-29", "2026-10-25"]) {
    const app = reportingRange("today", "Europe/Tirane", new Date(`${date}T12:00Z`));
    const pg = JSON.parse(sql(`select jsonb_build_object('start', '${date}'::date::timestamp at time zone 'Europe/Tirane',
      'end', ('${date}'::date+1)::timestamp at time zone 'Europe/Tirane');`));
    expect(new Date(pg.start).toISOString()).toBe(app.from);
    expect(new Date(pg.end).toISOString()).toBe(app.to);
  }
});
