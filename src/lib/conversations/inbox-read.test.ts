import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInboxPage } from "./inbox-read";

const business = "10000000-0000-4000-8000-000000000001";
const ids = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"];

function conversation(id: string, unread = 1) {
  return {
    id, channel: "instagram", status: "active", last_message_preview: "Hi", last_message_at: "2026-11-15T10:00:00Z",
    unread_count: unread, participant_display_name: null, participant_username: "ana", customers: null,
  };
}

/** A fake client: the list query returns `rows`; the signals RPC returns `signals`. */
function fakeDb(rows: ReturnType<typeof conversation>[], signals: { data: unknown; error: unknown }) {
  const filters: [string, unknown][] = [];
  const query: Record<string, unknown> = {};
  for (const method of ["select", "or", "is", "lt", "order"]) query[method] = () => query;
  query.eq = (column: string, value: unknown) => (filters.push([column, value]), query);
  query.limit = () => Promise.resolve({ data: rows, error: null });
  const rpc = vi.fn().mockResolvedValue(signals);
  return { db: { from: () => query, rpc } as unknown as SupabaseClient, rpc, filters };
}

const signal = (id: string, extra: Record<string, unknown> = {}) => ({
  conversation_id: id, last_customer_at: "2026-11-15T09:00:00Z", last_reply_at: null,
  has_phone: false, has_email: false, order_count: 0, lead_status: null, customer_linked: false, ...extra,
});

describe("Inbox list reply state and indicators", () => {
  it("counts a later business reply (agent, panel, Instagram app or imported) as answered", async () => {
    const { db, rpc } = fakeDb(ids.map((id) => conversation(id)), {
      error: null,
      data: [
        signal(ids[0], { last_reply_at: "2026-11-15T09:05:00Z" }), // replied from the Instagram app after the customer
        signal(ids[1], { last_reply_at: "2026-11-15T08:00:00Z" }), // customer wrote again after the reply
        signal(ids[2], { last_customer_at: null, last_reply_at: "2026-11-15T08:00:00Z" }), // business opened the chat
      ],
    });
    const { rows } = await loadInboxPage(db, business);
    expect(rpc).toHaveBeenCalledWith("inbox_row_signals", { p_business: business, p_conversations: ids });
    expect(rows.map((row) => [row.awaitingReply, row.unread])).toEqual([[false, 0], [true, 1], [false, 0]]);
  });

  it("passes contact, order, lead and customer indicators through as validated values", async () => {
    const { db } = fakeDb([conversation(ids[0])], {
      error: null,
      data: [signal(ids[0], { has_phone: true, has_email: true, order_count: 2, lead_status: "contacted", customer_linked: true })],
    });
    const [row] = (await loadInboxPage(db, business)).rows;
    expect(row.signals).toEqual({ phone: true, email: true, orders: 2, lead: "contacted", customer: true });
  });

  it("ignores signals for conversations outside the page and unknown values", async () => {
    const foreign = "30000000-0000-4000-8000-000000000009";
    const { db, filters } = fakeDb([conversation(ids[0])], {
      error: null,
      data: [signal(foreign, { has_phone: true }), signal(ids[0], { lead_status: "drop table", order_count: -3 })],
    });
    const [row] = (await loadInboxPage(db, business)).rows;
    expect(filters).toContainEqual(["business_id", business]);
    expect(row.signals).toEqual({ phone: false, email: false, orders: 0, lead: null, customer: false });
  });

  it("still lists conversations when the signals cannot be read, without claiming a reply state", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb([conversation(ids[0], 1)], { data: null, error: { message: "function missing" } });
    const [row] = (await loadInboxPage(db, business)).rows;
    expect(row).toMatchObject({ awaitingReply: null, signals: null, unread: 1 });
    warn.mockRestore();
  });

  it("does not call the signals read for an empty page", async () => {
    const { db, rpc } = fakeDb([], { data: [], error: null });
    expect((await loadInboxPage(db, business)).rows).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
