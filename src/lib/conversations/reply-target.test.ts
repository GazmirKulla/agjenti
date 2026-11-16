import { describe, expect, it } from "vitest";
import { loadReplyQuotes, replyTargetFrom } from "./reply-target";

describe("replyTargetFrom", () => {
  it("keeps a reply to a message or to the business's story", () => {
    expect(replyTargetFrom({ replyTo: { mid: "m-1" } })).toEqual({ mid: "m-1" });
    expect(replyTargetFrom({ replyTo: { story: { id: "s-1", url: "https://cdn.example/s" } } })).toEqual({ story: { id: "s-1", url: "https://cdn.example/s" } });
  });

  it("drops absent or malformed targets and never keeps a non-https link", () => {
    for (const context of [null, {}, { replyTo: "x" }, { replyTo: { mid: "" } }, { replyTo: { story: {} } }]) expect(replyTargetFrom(context)).toBeNull();
    expect(replyTargetFrom({ replyTo: { story: { id: "s-1", url: "javascript:alert(1)" } } })).toEqual({ story: { id: "s-1", url: null } });
  });
});

type Filter = [string, string, unknown];
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const reads: { table: string; filters: Filter[] }[] = [];
  return {
    reads,
    db: {
      from(table: string) {
        const filters: Filter[] = [];
        reads.push({ table, filters });
        const run = () => (tables[table] ?? []).filter((row) => filters.every(([op, col, val]) =>
          op === "eq" ? row[col] === val : (val as unknown[]).includes(row[col])));
        const chain = {
          select: () => chain,
          eq: (col: string, val: unknown) => { filters.push(["eq", col, val]); return chain; },
          in: (col: string, val: unknown[]) => { filters.push(["in", col, val]); return chain; },
          then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
        };
        return chain;
      },
    } as never,
  };
}

describe("loadReplyQuotes", () => {
  const messages = [
    { id: "a", business_id: "b", conversation_id: "c", body: "Sa kushton?", direction: "inbound", customer_deleted_at: null, external_message_id: "mid-a" },
    { id: "agent", business_id: "b", conversation_id: "c", body: "25 €", direction: "outbound", customer_deleted_at: null, external_message_id: null },
    { id: "gone", business_id: "b", conversation_id: "c", body: null, direction: "inbound", customer_deleted_at: "2026-11-16T10:00:00Z", external_message_id: "mid-gone" },
    { id: "foreign", business_id: "b", conversation_id: "other", body: "secret", direction: "inbound", customer_deleted_at: null, external_message_id: "mid-foreign" },
  ];
  const parts = [{ business_id: "b", external_message_id: "mid-part-2", message_id: "agent" }];

  it("quotes a customer message, our reply through its part id, and a deleted message without its text", async () => {
    const { db } = fakeDb({ messages, message_transport_parts: parts });
    const quotes = await loadReplyQuotes(db, "b", "c", [
      { id: "r1", reply_to: { mid: "mid-a" } }, { id: "r2", reply_to: { mid: "mid-part-2" } }, { id: "r3", reply_to: { mid: "mid-gone" } }, { id: "r4", reply_to: null },
    ]);
    expect(quotes.get("r1")).toEqual({ messageId: "a", body: "Sa kushton?", direction: "inbound", deleted: false });
    expect(quotes.get("r2")).toEqual({ messageId: "agent", body: "25 €", direction: "outbound", deleted: false });
    expect(quotes.get("r3")).toEqual({ messageId: "gone", body: null, direction: "inbound", deleted: true });
    expect(quotes.has("r4")).toBe(false);
  });

  it("never quotes a message from another conversation", async () => {
    const { db, reads } = fakeDb({ messages, message_transport_parts: [] });
    const quotes = await loadReplyQuotes(db, "b", "c", [{ id: "r1", reply_to: { mid: "mid-foreign" } }]);
    expect(quotes.get("r1")).toEqual({ messageId: null, body: null, direction: null, deleted: false });
    expect(reads.filter((r) => r.table === "messages").every((r) => r.filters.some(([, col, val]) => col === "conversation_id" && val === "c"))).toBe(true);
  });

  it("reads nothing when no message on the page is a reply", async () => {
    const { db, reads } = fakeDb({});
    await loadReplyQuotes(db, "b", "c", [{ id: "r1" }, { id: "r2", reply_to: { story: { id: "s" } } }]);
    expect(reads).toEqual([]);
  });
});
