import { expect, it, vi } from "vitest";
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: (v: string) => v }));
import { runAvatarBackfill, AVATAR_ACTIVE_WINDOW_MS } from "./avatar-backfill";
import { AVATAR_REFRESH_MS } from "./participant-avatar";

const NOW = Date.parse("2026-11-16T04:40:00Z");
type Call = { table: string; op: string; args: unknown[] };

function fakeDb(candidates: Record<string, string>[], connections: Record<string, string>[]) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const record = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return chain; };
      const chain: Record<string, unknown> = {
        select: record("select"), eq: record("eq"), not: record("not"), gte: record("gte"), or: record("or"),
        order: record("order"), limit: record("limit"), in: record("in"), update: record("update"),
        then: (resolve: (v: unknown) => void) => resolve({ data: table === "conversations" ? candidates : connections, error: null }),
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const row = (conn: string, participant: string, business = "biz-1") =>
  ({ business_id: business, instagram_connection_id: conn, instagram_participant_id: participant });

it("looks up each participant once, active contacts only, never-checked or week-old checks first", async () => {
  const refresh = vi.fn(async () => "stored" as const);
  const { db, calls } = fakeDb([row("c1", "p1"), row("c1", "p1"), row("c1", "p2")], [{ id: "c1", business_id: "biz-1", access_token_ciphertext: "tok" }]);
  const summary = await runAvatarBackfill(db, { now: NOW, refresh });
  expect(summary).toMatchObject({ candidates: 2, stored: 2 });
  expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz-1", connectionId: "c1", participantId: "p1", accessToken: "tok" }));
  expect(calls).toContainEqual({ table: "conversations", op: "gte", args: ["last_message_at", new Date(NOW - AVATAR_ACTIVE_WINDOW_MS).toISOString()] });
  expect(calls).toContainEqual({ table: "conversations", op: "or", args: [`participant_avatar_checked_at.is.null,participant_avatar_checked_at.lt.${new Date(NOW - AVATAR_REFRESH_MS).toISOString()}`] });
  expect(calls).toContainEqual({ table: "instagram_connections", op: "eq", args: ["status", "connected"] });
});

it("caps lookups per business account and per run", async () => {
  const refresh = vi.fn(async () => "none" as const);
  const rows = [...Array.from({ length: 5 }, (_, i) => row("c1", `a${i}`)), ...Array.from({ length: 5 }, (_, i) => row("c2", `b${i}`))];
  const { db } = fakeDb(rows, [{ id: "c1", business_id: "biz-1", access_token_ciphertext: "t" }, { id: "c2", business_id: "biz-1", access_token_ciphertext: "t" }]);
  expect((await runAvatarBackfill(db, { now: NOW, refresh, perConnection: 2, total: 3 })).candidates).toBe(3);
  expect(refresh).toHaveBeenCalledTimes(3);
});

it("never looks up through a disconnected account or another business's connection", async () => {
  const refresh = vi.fn(async () => "stored" as const);
  const { db } = fakeDb([row("gone", "p1"), row("c1", "p2", "biz-other")], [{ id: "c1", business_id: "biz-1", access_token_ciphertext: "t" }]);
  expect(await runAvatarBackfill(db, { now: NOW, refresh })).toMatchObject({ unreachable: 2, stored: 0 });
  expect(refresh).not.toHaveBeenCalled();
});

it("waits a week after a lookup that does not answer, instead of retrying every run", async () => {
  const refresh = vi.fn(async () => "skipped" as const);
  const { db, calls } = fakeDb([row("c1", "p1")], [{ id: "c1", business_id: "biz-1", access_token_ciphertext: "t" }]);
  expect(await runAvatarBackfill(db, { now: NOW, refresh })).toMatchObject({ skipped: 1 });
  expect(calls).toContainEqual({ table: "conversations", op: "update", args: [{ participant_avatar_checked_at: new Date(NOW).toISOString() }] });
  expect(calls.filter((c) => c.op === "eq" && c.table === "conversations").map((c) => c.args)).toEqual(expect.arrayContaining([
    ["business_id", "biz-1"], ["instagram_connection_id", "c1"], ["instagram_participant_id", "p1"],
  ]));
});

it("starts no lookups once the time budget is spent", async () => {
  const refresh = vi.fn(async () => "stored" as const);
  const { db } = fakeDb([row("c1", "p1")], [{ id: "c1", business_id: "biz-1", access_token_ciphertext: "t" }]);
  await runAvatarBackfill(db, { now: NOW, budgetMs: -1, refresh });
  expect(refresh).not.toHaveBeenCalled();
});
