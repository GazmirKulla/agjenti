import { beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "@/lib/workflows/engine";
const m = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), calls: [] as { table: string; filters: Record<string, unknown> }[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: m.create }));
import { customerOrderStatus, isOrderStatusFollowUp, isOrderStatusRequest, readOrderStatusLookup } from "./customer-status";
const orderA = "aaaaaaaa-0000-4000-8000-000000000001", orderB = "bbbbbbbb-0000-4000-8000-000000000002";
const identity = { conversationId: "conversation-a", instagramParticipantId: "ig-a", instagramConnectionId: "connection-a" };
const row = (id = orderA, status = "confirmed") => ({ id, status, created_at: "2026-10-10T10:00:00Z" });
beforeEach(() => {
  vi.clearAllMocks(); m.calls.length = 0;
  m.run.mockImplementation((table, filters) => {
    if (table === "conversations") return { data: filters.id ? { id: "conversation-a", customer_id: "untrusted-linked-customer" } : [{ id: "conversation-a" }, { id: "conversation-old" }], error: null };
    if (table === "customers") return { data: { id: "customer-a" }, error: null };
    return { data: [row()], error: null };
  });
  m.create.mockImplementation(() => ({ from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      in: (key: string, value: unknown) => { filters[key] = value; return query; }, order: () => query, limit: () => query, maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => { m.calls.push({ table, filters }); return Promise.resolve(m.run(table, filters)).then(resolve, reject); } };
    return query;
  } }));
});
const run = (message: string, state = emptyState(), extra = {}) => customerOrderStatus({ businessId: "business-a", message, state, identity, ...extra });

it.each(["Ku është porosia ime?", "Dua statusin e porosisë", "A ka ardhur pakoja?", "Kontrollo porosinë", "Where is my order?", "Track my order", "When will my package arrive?"])("recognizes an existing status request: %s", message => expect(isOrderStatusRequest(message)).toBe(true));
it.each(["Dua të porosis", "Konfirmoj porosinë", "Sa kushton porosia?", "Po", "0691234567"])("does not confuse another request with status: %s", message => expect(isOrderStatusRequest(message)).toBe(false));
it("isolates tests even when trusted identity and forged lookup state are supplied", async () => {
  const result = await run("Ku është porosia?", emptyState(), { isolated: true });
  expect(result.reply).toContain("nuk lexoj porosi reale");
  expect(m.create).not.toHaveBeenCalled();
});
it("requires trusted identity and validates the conversation tuple before reading any orders", async () => {
  expect((await run("Ku është porosia?", emptyState(), { identity: undefined })).reply).toContain("Nuk mund ta verifikoj");
  expect(m.create).not.toHaveBeenCalled();
  m.run.mockReturnValueOnce({ data: null, error: null });
  expect((await run("Ku është porosia?")).reply).toContain("Nuk mund ta verifikoj");
  expect(m.calls).toEqual([{ table: "conversations", filters: { id: identity.conversationId, business_id: "business-a", instagram_participant_id: "ig-a", instagram_connection_id: "connection-a" } }]);
});
it("scopes every read to the tenant and never uses names, phone or unchecked customer links", async () => {
  const state = emptyState(); state.customer.phone = "0699999999"; state.customer.name = "Other customer";
  const result = await run(`Statusi i porosisë #${orderA}`, state);
  expect(result.reply).toContain("#AAAAAAAA");
  expect(m.calls.every(call => call.filters.business_id === "business-a")).toBe(true);
  expect(m.calls.filter(call => call.table === "orders")).toEqual([
    { table: "orders", filters: { business_id: "business-a", conversation_id: ["conversation-a", "conversation-old"] } },
    { table: "orders", filters: { business_id: "business-a", customer_id: "customer-a" } },
  ]);
  expect(JSON.stringify(m.calls)).not.toContain("0699999999");
  expect(JSON.stringify(m.calls)).not.toContain("untrusted-linked-customer");
});
it.each([["draft", "ende nuk është konfirmuar"], ["confirmed", "konfirmuar në sistem"], ["submitted", "nuk konfirmon nisjen"], ["failed", "nuk do të thotë që porosia është anuluar"]])("reports only the actual local status %s", async (status, text) => {
  const original = m.run.getMockImplementation()!;
  m.run.mockImplementation((table, filters) => table === "orders" ? { data: [row(orderA, status)], error: null } : original(table, filters));
  const result = await run("Ku është porosia?");
  expect(result.reply).toContain(text);
  expect(result.reply).toContain("Nuk kam informacion të verifikuar");
});
it("clarifies multiple own orders then re-reads scoped status before answering the chosen reference", async () => {
  const original = m.run.getMockImplementation()!;
  let status = "draft";
  m.run.mockImplementation((table, filters) => table === "orders" ? { data: [row(orderA), row(orderB, status)], error: null } : original(table, filters));
  const first = await run("Ku është porosia?");
  expect(first.pending).toBe(true);
  expect(first.reply).toContain("#BBBBBBBB");
  expect(isOrderStatusFollowUp("2", first.nextState)).toBe(true);
  expect(isOrderStatusFollowUp("Dua të porosis", first.nextState)).toBe(false);
  status = "submitted";
  const next = await run("#BBBBBBBB", first.nextState);
  expect(next.reply).toContain("dërguar te sistemi i porosive");
  expect(next.pending).toBe(false);
  expect(readOrderStatusLookup(next.nextState)).toBeUndefined();
});
it("never trusts a forged lookup ID and does not use yes as a selection", async () => {
  const state = emptyState(); state.fields.order_status_lookup = { createdAt: Date.now(), references: [{ id: orderB, reference: "BBBBBBBB" }] };
  const result = await run("1", state);
  expect(result.reply).not.toContain("Porosia #BBBBBBBB");
  expect(result.pending).toBe(true);
  expect((await run("Po", result.nextState)).pending).toBe(true);
  expect(m.calls.filter(call => call.table === "orders").every(call => !call.filters.id)).toBe(true);
});
it("does not present a different own order as the requested foreign reference", async () => {
  const result = await run(`Ku është porosia #${orderB}?`);
  expect(result.reply).toContain("Nuk e gjeta atë porosi");
  expect(result.reply).not.toContain("Porosia #AAAAAAAA është");
  expect(result.reply).not.toContain("#BBBBBBBB");
  expect(result.pending).toBe(true);
});
it("refreshes expired choices instead of interpreting a number using a stale list", async () => {
  const state = emptyState(); state.fields.order_status_lookup = { createdAt: Date.now() - 16 * 60 * 1000, references: [{ id: orderB, reference: "BBBBBBBB" }] };
  expect(isOrderStatusFollowUp("1", state)).toBe(true);
  expect(readOrderStatusLookup(state)).toBeUndefined();
  const result = await run("1", state);
  expect(result.reply).toContain("Lista e mëparshme ka skaduar");
  expect(result.reply).not.toContain("Porosia #AAAAAAAA është");
  expect(result.pending).toBe(true);
});
it("preserves pending process fields and reports lookup failures without pretending no orders exist", async () => {
  const state = emptyState(); state.step_key = "order_confirm"; state.fields.booking = { phase: "confirm" }; state.fields.photo = true;
  m.run.mockReturnValueOnce({ data: null, error: { message: "private SQL" } });
  const result = await run("Ku është porosia?", state);
  expect(result.reply).toContain("Nuk arrita ta kontrolloj");
  expect(result.reply).not.toContain("private SQL");
  expect(result.nextState).toEqual(state);
});
it("does not claim an unpersisted in-progress order is in the orders table", async () => {
  const original = m.run.getMockImplementation()!;
  m.run.mockImplementation((table, filters) => table === "orders" ? { data: [], error: null } : original(table, filters));
  const state = emptyState(); state.step_key = "order_ready";
  expect((await run("Ku është porosia?", state)).reply).toContain("Nuk gjeta porosi të regjistruara");
});
