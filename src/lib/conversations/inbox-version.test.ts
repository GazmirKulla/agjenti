import { expect, it } from "vitest";
import { InboxVersionError, loadInboxVersion } from "./inbox-version";

type Rows = Record<string, unknown>[];
function fakeDb(tables: { conversations?: Rows; messages?: Rows; fail?: string }) {
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      const read = { table, filters: [] as [string, unknown][] };
      reads.push(read);
      const chain = {
        select: () => chain, order: () => chain, limit: () => chain,
        eq: (c: string, v: unknown) => { read.filters.push([c, v]); return chain; },
        then: (resolve: (v: unknown) => void) => resolve(tables.fail === table
          ? { data: null, error: { message: "down" } }
          : { data: (tables as Record<string, Rows>)[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  return { db: db as never, reads };
}

const list = [{ id: "c1", status: "active", last_message_at: "2026-11-16T22:00:00Z", last_message_preview: "Hey", unread_count: 1 }];
const thread = [{ id: "m1", delivery_status: "sent", customer_edited_at: null, customer_deleted_at: null }];

it("stays the same while nothing shown changes", async () => {
  const a = await loadInboxVersion(fakeDb({ conversations: list, messages: thread }).db, "b", "c1");
  const b = await loadInboxVersion(fakeDb({ conversations: structuredClone(list), messages: structuredClone(thread) }).db, "b", "c1");
  expect(a).toBe(b);
});

it("changes for a new message, a receipt, an edit or an unsend", async () => {
  const base = await loadInboxVersion(fakeDb({ conversations: list, messages: thread }).db, "b", "c1");
  const variants = [
    { conversations: [{ ...list[0], last_message_at: "2026-11-16T22:01:00Z", last_message_preview: "New" }], messages: thread },
    { conversations: list, messages: [{ ...thread[0], delivery_status: "read" }] },
    { conversations: list, messages: [{ ...thread[0], customer_edited_at: "2026-11-16T22:02:00Z" }] },
    { conversations: list, messages: [{ ...thread[0], customer_deleted_at: "2026-11-16T22:02:00Z" }] },
  ];
  for (const tables of variants) expect(await loadInboxVersion(fakeDb(tables).db, "b", "c1")).not.toBe(base);
});

it("reads only this business, and no messages when no conversation is open", async () => {
  const { db, reads } = fakeDb({ conversations: list });
  await loadInboxVersion(db, "b", null);
  expect(reads.map((r) => r.table)).toEqual(["conversations"]);
  expect(reads[0].filters).toEqual([["business_id", "b"]]);
  const open = fakeDb({ conversations: list, messages: thread });
  await loadInboxVersion(open.db, "b", "c1");
  expect(open.reads[1].filters).toEqual([["business_id", "b"], ["conversation_id", "c1"]]);
});

it("fails instead of returning a fingerprint that would hide changes", async () => {
  await expect(loadInboxVersion(fakeDb({ fail: "messages" }).db, "b", "c1")).rejects.toBeInstanceOf(InboxVersionError);
});
