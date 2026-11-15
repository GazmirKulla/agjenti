import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transcript } from "@/lib/conversation-learning/transcripts";
import { addHistoryToInbox, parseAnalysisOptions, parseHistoryOptions, URL_BUDGET, urlChunks } from "./inbox-import";

const BUSINESS = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
const OTHER = "11111111-2222-3333-4444-555555555555";
const CONNECTION = "c0000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
/** A small in-memory stand-in for the tables this module reads and writes. */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { messages: [], message_transport_parts: [], conversations: [], ...seed };
  let n = 0;
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let action: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] = [];
    let returning = false;
    const run = () => {
      const rows = tables[table];
      if (action === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `id-${++n}`, ...r }));
        if (table === "messages") {
          const key = (r: Row) => `${r.instagram_connection_id}:${r.external_message_id}`;
          const seen = new Set(rows.map(key));
          if (list.some((r) => seen.has(key(r)) || list.filter((o) => key(o) === key(r)).length > 1)) return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows.push(...list);
        return { data: returning ? list : null, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (action === "update") { for (const r of matched) Object.assign(r, payload); return { data: null, error: null }; }
      return { data: matched, error: null };
    };
    const query = {
      select() { if (action === "insert") returning = true; return query; },
      insert(value: Row | Row[]) { action = "insert"; payload = value; return query; },
      update(value: Row) { action = "update"; payload = value; return query; },
      eq(column: string, value: unknown) { filters.push((r) => r[column] === value); return query; },
      in(column: string, values: unknown[]) { filters.push((r) => values.includes(r[column])); return query; },
      lte(column: string, value: string) { filters.push((r) => String(r[column]) <= value); return query; },
      order() { return query; },
      then(resolve: (value: unknown) => void) { resolve(run()); },
    };
    return query;
  };
  return { db: { from } as unknown as SupabaseClient, tables };
}

const thread = (customer: string, lines: [Transcript["lines"][number]["speaker"], string, string, string][], username = "arber"): Transcript => ({
  key: `instagram:${customer}`, channel: "instagram", lastAt: lines.at(-1)![2],
  customer: { id: customer, username },
  lines: lines.map(([speaker, text, at, id]) => ({ speaker, text, at, id })),
});

describe("import and analysis options", () => {
  it("import: only the offered periods, and adding is off unless asked", () => {
    expect(parseHistoryOptions({ days: 30 })).toEqual({ days: 30, addToInbox: false });
    expect(parseHistoryOptions({ days: 180, addToInbox: true })).toEqual({ days: 180, addToInbox: true });
    expect(parseHistoryOptions({})).toEqual({ days: 90, addToInbox: false });
    for (const days of [0, 7, 60, 365, "30", null]) expect(parseHistoryOptions({ days })).toBeNull();
    expect(parseHistoryOptions({ days: 30, addToInbox: "yes" })).toBeNull();
  });

  it("analysis: at most 50 conversations, contacts only when asked", () => {
    expect(parseAnalysisOptions(undefined)).toEqual({ limit: 50, onlyContacts: false });
    expect(parseAnalysisOptions({ limit: 10, onlyContacts: true })).toEqual({ limit: 10, onlyContacts: true });
    for (const limit of [0, 51, 100, 600, "50"]) expect(parseAnalysisOptions({ limit })).toBeNull();
    expect(parseAnalysisOptions({ onlyContacts: 1 })).toBeNull();
  });
});

describe("lookups by Instagram id", () => {
  it("split long ids so each request URL stays short, keeping every id once", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAx${String(i).padStart(4, "0")}${"x".repeat(110)}`);
    const parts = urlChunks(ids);
    expect(parts.flat()).toEqual(ids);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.map((v) => encodeURIComponent(`"${v}",`)).join("").length).toBeLessThanOrEqual(URL_BUDGET);
    expect(urlChunks([])).toEqual([]);
  });
});

describe("Instagram history into Conversations", () => {
  const history = [thread("ig-1", [
    ["klienti", "Sa kushton ora?", "2025-03-10T09:00:00.000Z", "m1"],
    ["biznesi", "120 euro.", "2025-03-10T09:05:00.000Z", "m2"],
    ["klienti", "Faleminderit", "2025-03-10T09:06:00.000Z", "m3"],
  ])];

  it("creates a completed conversation with ordinary customer and staff messages", async () => {
    const { db, tables } = fakeDb();
    const result = await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: history });
    expect(result).toEqual({ conversations: 1, created: 1, messages: 3 });
    expect(tables.conversations).toHaveLength(1);
    expect(tables.conversations[0]).toMatchObject({
      business_id: BUSINESS, channel: "instagram", instagram_participant_id: "ig-1", instagram_connection_id: CONNECTION,
      participant_username: "arber", status: "completed", auto_reply: null, unread_count: 0,
      last_message_at: "2025-03-10T09:06:00.000Z", last_inbound_at: "2025-03-10T09:06:00.000Z", last_message_preview: "Faleminderit",
    });
    expect(tables.messages.map((m) => [m.direction, m.source, m.sent_via, m.body, m.external_message_id, m.created_at])).toEqual([
      ["inbound", "customer", null, "Sa kushton ora?", "m1", "2025-03-10T09:00:00.000Z"],
      ["outbound", "staff", "instagram_app", "120 euro.", "m2", "2025-03-10T09:05:00.000Z"],
      ["inbound", "customer", null, "Faleminderit", "m3", "2025-03-10T09:06:00.000Z"],
    ]);
    expect(tables.messages.every((m) => m.business_id === BUSINESS && m.conversation_id === tables.conversations[0].id)).toBe(true);
  });

  it("adds nothing twice when imported again", async () => {
    const { db, tables } = fakeDb();
    await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: history });
    const again = await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: history });
    expect(again).toEqual({ conversations: 0, created: 0, messages: 0 });
    expect(tables.conversations).toHaveLength(1);
    expect(tables.messages).toHaveLength(3);
  });

  it("puts missing messages into the customer's existing conversation without changing its status", async () => {
    const { db, tables } = fakeDb({
      conversations: [{ id: "conv-live", business_id: BUSINESS, instagram_connection_id: CONNECTION, instagram_participant_id: "ig-1", status: "active", auto_reply: true, last_message_at: "2025-03-10T09:05:30.000Z", created_at: "2025-03-10T09:05:30.000Z" }],
      // The webhook already stored the first message.
      messages: [{ id: "existing", business_id: BUSINESS, conversation_id: "conv-live", instagram_connection_id: CONNECTION, external_message_id: "m1" }],
    });
    const result = await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: history });
    expect(result).toEqual({ conversations: 1, created: 0, messages: 2 });
    expect(tables.conversations).toHaveLength(1);
    expect(tables.conversations[0]).toMatchObject({ status: "active", auto_reply: true, last_message_at: "2025-03-10T09:06:00.000Z", last_message_preview: "Faleminderit" });
    expect(tables.messages.filter((m) => m.conversation_id === "conv-live").map((m) => m.external_message_id)).toEqual(["m1", "m2", "m3"]);
  });

  it("skips what Agjenti sent, and agent lines it cannot find", async () => {
    const { db, tables } = fakeDb({ message_transport_parts: [{ business_id: BUSINESS, connection_id: CONNECTION, external_message_id: "m2" }] });
    const withAgent = [thread("ig-1", [
      ["klienti", "Sa kushton ora?", "2025-03-10T09:00:00.000Z", "m1"],
      ["biznesi", "120 euro.", "2025-03-10T09:05:00.000Z", "m2"],
      ["agjenti", "Mund ta porosisni këtu.", "2025-03-10T09:05:10.000Z", "m4"],
    ])];
    await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: withAgent });
    expect(tables.messages.map((m) => m.external_message_id)).toEqual(["m1"]);
  });

  it("never reuses another business's conversation or messages", async () => {
    const { db, tables } = fakeDb({
      conversations: [{ id: "conv-other", business_id: OTHER, instagram_connection_id: CONNECTION, instagram_participant_id: "ig-1", status: "active", last_message_at: "2025-03-10T10:00:00.000Z", created_at: "2025-03-10T10:00:00.000Z" }],
      messages: [{ id: "other-m1", business_id: OTHER, conversation_id: "conv-other", instagram_connection_id: CONNECTION, external_message_id: "m9" }],
    });
    await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: history });
    const created = tables.conversations.find((c) => c.business_id === BUSINESS);
    expect(created?.id).not.toBe("conv-other");
    expect(tables.messages.filter((m) => m.business_id === BUSINESS).every((m) => m.conversation_id === created?.id)).toBe(true);
  });

  it("keeps a webhook message that arrived during the import, row by row", async () => {
    const { db, tables } = fakeDb();
    const real = db.from.bind(db);
    let raced = false;
    (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "messages" && !raced) {
        // Between the lookup and the insert, the webhook stores m2.
        const query = real(table) as unknown as { then: (r: (v: unknown) => void) => void };
        const then = query.then.bind(query);
        query.then = (resolve) => then((value) => { raced = true; tables.messages.push({ id: "hook", business_id: BUSINESS, instagram_connection_id: CONNECTION, external_message_id: "m2" }); resolve(value); });
        return query;
      }
      return real(table);
    };
    const result = await addHistoryToInbox(db, { businessId: BUSINESS, connectionId: CONNECTION, threads: history });
    expect(result.messages).toBe(2);
    expect(tables.messages.filter((m) => m.external_message_id === "m2")).toHaveLength(1);
  });
});
