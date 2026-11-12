import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistBusinessEcho } from "./business-echo";
import type { NormalizedBusinessEcho } from "@/lib/instagram/types";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> };
type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number };
/** Minimal PostgREST builder: every query resolves through `answer`. */
function fakeDb(answer: (call: Call) => Result) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const run = () => { calls.push(call); return Promise.resolve({ data: null, error: null, ...answer(call) }); };
      const builder: Record<string, unknown> = {};
      for (const name of ["eq", "in", "gte", "lte"]) builder[name] = (column: string, value: unknown) => { call.filters.push([name, column, value]); return builder; };
      for (const name of ["order", "limit"]) builder[name] = () => builder;
      builder.select = () => builder;
      builder.insert = (payload: unknown) => { call.op = "insert"; call.payload = payload; return builder; };
      builder.update = (payload: unknown) => { call.op = "update"; call.payload = payload; return builder; };
      builder.maybeSingle = run; builder.single = run;
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject);
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}
const has = (call: Call, column: string, value?: unknown) => call.filters.some(([, c, v]) => c === column && (value === undefined || v === value));
const echo: NormalizedBusinessEcho = { channel: "instagram", accountId: "ig-1", externalParticipantId: "customer-1", externalMessageId: "mid-1", text: "Po, e kemi në stok", attachments: [], timestamp: new Date("2026-11-12T10:00:00Z") };
const connection = { data: { id: "conn-1", business_id: "biz-1" } };

describe("business app echoes", () => {
  it("stores an app echo as an outbound staff message without touching the inbound window", async () => {
    const { db, calls } = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "conversations" && call.op === "select") return { data: { id: "conv-1" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db })).toBe("stored");
    const insert = calls.find(c => c.table === "messages" && c.op === "insert");
    expect(insert?.payload).toMatchObject({ business_id: "biz-1", conversation_id: "conv-1", instagram_connection_id: "conn-1", direction: "outbound", source: "staff", sent_via: "instagram_app", external_message_id: "mid-1", body: "Po, e kemi në stok", delivery_status: "sent" });
    const update = calls.find(c => c.table === "conversations" && c.op === "update");
    expect(update?.payload).not.toHaveProperty("last_inbound_at");
    expect(update?.payload).not.toHaveProperty("unread_count");
    expect(calls.some(c => c.table === "workflow_inbound_queue" && c.op === "insert")).toBe(false);
  });

  it("hands the conversation to staff when a person replies from the app", async () => {
    const { db, calls } = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "conversations" && call.op === "select") return { data: { id: "conv-1" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db })).toBe("stored");
    const pause = calls.find(c => c.table === "conversations" && c.op === "update" && (c.payload as Record<string, unknown>).status === "paused");
    expect(pause?.payload).toMatchObject({ status: "paused", auto_reply: false });
    expect(has(pause!, "id", "conv-1") && has(pause!, "business_id", "biz-1") && has(pause!, "status", "active")).toBe(true);
  });

  it("does not pause the agent for the echo of its own message", async () => {
    const { db, calls } = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "message_transport_parts") return { data: { id: "part-1" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db })).toBe("ours");
    expect(calls.some(c => c.table === "conversations" && c.op === "update")).toBe(false);
  });

  it("drops the echo of a message Agjenti itself sent (same mid)", async () => {
    const { db, calls } = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "message_transport_parts" && has(call, "external_message_id", "mid-1")) return { data: { id: "part-1" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db })).toBe("ours");
    expect(calls.some(c => c.op === "insert")).toBe(false);
  });

  it("drops the echo when a recent Agjenti part to the same customer has the same text", async () => {
    const { db, calls } = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "message_transport_parts" && has(call, "body", echo.text)) return { data: { id: "part-2" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db })).toBe("ours");
    expect(calls.some(c => c.op === "insert")).toBe(false);
  });

  it("waits for an in-flight Agjenti send to settle before deciding", async () => {
    let checks = 0;
    const sleep = vi.fn(async () => {});
    const { db } = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: checks++ === 0 ? 1 : 0 };
      if (call.table === "message_transport_parts" && has(call, "external_message_id", "mid-1")) return { data: { id: "part-1" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db, sleep, pollMs: 1 })).toBe("ours");
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("gives up rather than risk a duplicate when a send stays in flight", async () => {
    const { db, calls } = fakeDb(call => call.table === "instagram_connections" ? connection : call.table === "workflow_inbound_queue" ? { count: 1 } : {});
    expect(await persistBusinessEcho(echo, { db, waitMs: 0, sleep: async () => {} })).toBe("in_flight");
    expect(calls.some(c => c.op === "insert")).toBe(false);
  });

  it("treats a stored mid or a unique-index race as a duplicate", async () => {
    const stored = fakeDb(call => call.table === "instagram_connections" ? connection : call.table === "workflow_inbound_queue" ? { count: 0 } : call.table === "messages" && call.op === "select" ? { data: { id: "m-1" } } : {});
    expect(await persistBusinessEcho(echo, { db: stored.db })).toBe("duplicate");
    const race = fakeDb(call => {
      if (call.table === "instagram_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "conversations") return { data: { id: "conv-1" } };
      if (call.table === "messages" && call.op === "insert") return { error: { code: "23505", message: "duplicate" } };
      return {};
    });
    expect(await persistBusinessEcho(echo, { db: race.db })).toBe("duplicate");
  });

  it("opens a thread for a chat the owner started from WhatsApp Business", async () => {
    const wa: NormalizedBusinessEcho = { ...echo, channel: "whatsapp", accountId: "123456", externalParticipantId: "355691234567", externalMessageId: "wamid.1" };
    const { db, calls } = fakeDb(call => {
      if (call.table === "whatsapp_connections") return connection;
      if (call.table === "workflow_inbound_queue") return { count: 0 };
      if (call.table === "conversations" && call.op === "insert") return { data: { id: "conv-new" } };
      return {};
    });
    expect(await persistBusinessEcho(wa, { db })).toBe("stored");
    const created = calls.find(c => c.table === "conversations" && c.op === "insert");
    expect(created?.payload).toMatchObject({ whatsapp_participant_id: "355691234567", channel: "whatsapp", status: "paused", auto_reply: false, unread_count: 0 });
    expect(created?.payload).not.toHaveProperty("last_inbound_at");
    expect(calls.find(c => c.table === "messages" && c.op === "insert")?.payload).toMatchObject({ conversation_id: "conv-new", whatsapp_connection_id: "conn-1", sent_via: "whatsapp_app" });
  });

  it("ignores echoes for accounts that are not connected", async () => {
    const { db } = fakeDb(() => ({}));
    expect(await persistBusinessEcho(echo, { db })).toBe("unknown_connection");
  });
});
