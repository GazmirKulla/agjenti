import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  admin: vi.fn(),
  rpc: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  deleteBusiness: vi.fn(),
  writes: [] as { table: string; op: string; payload?: unknown; filters: unknown[][] }[],
  rows: {} as Record<string, unknown>,
}));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: m.admin }));
vi.mock("@/lib/businesses/delete-business", () => ({ deleteBusinessCompletely: m.deleteBusiness }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    rpc: m.rpc,
    auth: { admin: { updateUserById: m.updateUser, deleteUser: m.deleteUser, signOut: m.signOut } },
    from: (table: string) => {
      const write = { table, op: "", payload: undefined as unknown, filters: [] as unknown[][] };
      const chain: Record<string, unknown> = {};
      for (const name of ["eq", "neq", "limit", "select", "in"])
        chain[name] = (...args: unknown[]) => { write.filters.push([name, ...args]); return chain; };
      chain.maybeSingle = () => Promise.resolve(m.rows[`${table}:${write.op}`] ?? { data: null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(m.rows[`${table}:${write.op}:${JSON.stringify(write.filters)}`] ?? m.rows[`${table}:${write.op}`] ?? { data: [], error: null }).then(resolve);
      return {
        select: (...args: unknown[]) => { write.op = "select"; write.filters.push(["select", ...args]); return chain; },
        delete: () => { write.op = "delete"; m.writes.push(write); return chain; },
        update: (payload: unknown) => { write.op = "update"; write.payload = payload; m.writes.push(write); return chain; },
      };
    },
  }),
}));
import { purgeDueAccountDeletions, restoreAccountDeletion, scheduleAccountDeletion } from "./deletion";

const user = "f0f5b4a3-2100-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  m.writes.length = 0;
  m.rows = {};
  m.admin.mockResolvedValue(false);
  m.updateUser.mockResolvedValue({ error: null });
  m.deleteUser.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValue({ error: null });
  m.deleteBusiness.mockResolvedValue({ ok: true, slug: "s", name: "n" });
  m.rpc.mockImplementation((name: string) => name === "schedule_account_deletion"
    ? { single: () => Promise.resolve({ data: { purge_after: "2026-12-06T00:00:00Z", created: true }, error: null }) }
    : Promise.resolve({ data: [user], error: null }));
});

it("never schedules platform administrators", async () => {
  m.admin.mockResolvedValue(true);
  expect(await scheduleAccountDeletion(user, "token")).toMatchObject({ ok: false, status: 403 });
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.updateUser).not.toHaveBeenCalled();
});

it("bans the account, removes devices and revokes sessions", async () => {
  expect(await scheduleAccountDeletion(user, "token")).toEqual({ ok: true, purgeAfter: "2026-12-06T00:00:00Z" });
  expect(m.rpc).toHaveBeenCalledWith("schedule_account_deletion", { p_user: user, p_days: 30 });
  expect(m.updateUser).toHaveBeenCalledWith(user, { ban_duration: "876000h" });
  expect(m.writes).toContainEqual(expect.objectContaining({ table: "mobile_devices", op: "delete" }));
  expect(m.signOut).toHaveBeenCalledWith("token", "global");
});

it("withdraws a new schedule when the account cannot be disabled", async () => {
  m.updateUser.mockResolvedValue({ error: { message: "down" } });
  expect(await scheduleAccountDeletion(user, "token")).toMatchObject({ ok: false, status: 503 });
  expect(m.writes).toContainEqual(expect.objectContaining({ table: "account_deletions", op: "delete" }));
  expect(m.signOut).not.toHaveBeenCalled();
});

it("keeps an existing schedule when repeating a request fails", async () => {
  m.rpc.mockReturnValue({ single: () => Promise.resolve({ data: { purge_after: "x", created: false }, error: null }) });
  m.updateUser.mockResolvedValue({ error: { message: "down" } });
  await scheduleAccountDeletion(user);
  expect(m.writes.filter(w => w.table === "account_deletions")).toEqual([]);
});

it("restores only a pending deletion and lifts the ban", async () => {
  m.rows["account_deletions:update"] = { data: { user_id: user }, error: null };
  expect(await restoreAccountDeletion(user)).toEqual({ error: null });
  expect(m.updateUser).toHaveBeenCalledWith(user, { ban_duration: "none" });
});

it("does not lift the ban when nothing is pending", async () => {
  expect(await restoreAccountDeletion(user)).toEqual({ error: { code: "not_scheduled" } });
  expect(m.updateUser).not.toHaveBeenCalled();
});

it("returns the schedule when lifting the ban fails", async () => {
  m.rows["account_deletions:update"] = { data: { user_id: user }, error: null };
  m.updateUser.mockResolvedValue({ error: { message: "down" } });
  expect(await restoreAccountDeletion(user)).toEqual({ error: { code: "failed" } });
  expect(m.writes.at(-1)).toMatchObject({ table: "account_deletions", payload: expect.objectContaining({ status: "scheduled" }) });
});

const otherMembers = (business: string, data: unknown[]) => {
  m.rows[`business_users:select:${JSON.stringify([["select", "user_id"], ["eq", "business_id", business], ["neq", "user_id", user], ["limit", 1]])}`] = { data, error: null };
};

it("deletes businesses without other members and keeps shared ones", async () => {
  m.rows["business_users:select"] = { data: [{ business_id: "solo" }, { business_id: "shared" }], error: null };
  otherMembers("solo", []);
  otherMembers("shared", [{ user_id: "other" }]);
  expect(await purgeDueAccountDeletions()).toEqual({ completed: 1, failed: 0 });
  expect(m.deleteBusiness).toHaveBeenCalledTimes(1);
  expect(m.deleteBusiness).toHaveBeenCalledWith("solo");
  expect(m.deleteUser).toHaveBeenCalledWith(user);
  expect(m.writes.at(-1)).toMatchObject({ table: "account_deletions", payload: expect.objectContaining({ status: "completed" }) });
});

it("returns a failed purge to the schedule without deleting the user", async () => {
  m.rows["business_users:select"] = { data: [{ business_id: "solo" }], error: null };
  otherMembers("solo", []);
  m.deleteBusiness.mockResolvedValue({ ok: false, status: 500, error: "x" });
  expect(await purgeDueAccountDeletions()).toEqual({ completed: 0, failed: 1 });
  expect(m.deleteUser).not.toHaveBeenCalled();
  expect(m.writes.at(-1)).toMatchObject({ table: "account_deletions", payload: expect.objectContaining({ status: "scheduled" }) });
});
