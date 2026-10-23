import { beforeEach, expect, it, vi } from "vitest";
import { configurationRead, instructionHash, observeAgentEffect, requireAgentConfigurationAccess } from "./configuration";
const m = vi.hoisted(() => ({ from: vi.fn(), calls: [] as unknown[][], results: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
beforeEach(() => {
  m.calls = []; m.results = []; m.from.mockImplementation((table: string) => {
    const result = m.results.shift();
    const q = { select: (...args: unknown[]) => { m.calls.push([table, "select", ...args]); return q; },
      eq: (...args: unknown[]) => { m.calls.push([table, "eq", ...args]); return q; },
      or: () => q, limit: () => q, maybeSingle: async () => result,
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
  });
});
const target = { id: "target", name: "Synthetic", instructions: "Current", is_active: true };
it.each([
  [[target], "effective", true],
  [[{ ...target, is_active: false }], "inactive", false],
  [[{ ...target, is_active: false }, { ...target, id: "other" }], "superseded", false],
  [[{ ...target, instructions: "Concurrent edit" }], "superseded", false],
  [[], "unverified", null],
  [[target, { ...target, id: "other" }], "unverified", null],
] as const)("observes effectiveness without changing configuration: %s", async (data, status, effective) => {
  m.results.push({ data });
  const result = await observeAgentEffect("tenant-a", "target", "Current");
  expect(result).toMatchObject({ saved: true, status, effective, behaviorVerified: false, instructionHash: instructionHash("Current") });
  expect(m.calls).toContainEqual(["ai_agents", "eq", "business_id", "tenant-a"]);
  expect(result).not.toHaveProperty("instructions");
});
it("keeps acknowledged persistence separate from a failed effectiveness read", async () => {
  m.results.push({ error: { code: "unavailable" } });
  expect(await observeAgentEffect("a", "target", "Current")).toMatchObject({ saved: true, effective: null, status: "unverified" });
  m.from.mockImplementationOnce(() => { throw new Error("timeout"); });
  expect(await observeAgentEffect("a", "target", "Current")).toMatchObject({ status: "unverified" });
});
it("rejects revoked membership and unreadable authorization before any write", async () => {
  for (const result of [{ data: null }, { data: null, error: { code: "failed" } }]) {
    m.results.push(result, { data: null });
    await expect(requireAgentConfigurationAccess("tenant-a", "revoked")).rejects.toThrow("qasje");
  }
  expect(m.calls).toContainEqual(["business_users", "eq", "business_id", "tenant-a"]);
  expect(m.calls).toContainEqual(["business_users", "eq", "user_id", "revoked"]);
});
it("retains member/admin access and hashes content, not timestamps", async () => {
  m.results.push({ data: { business_id: "a" } }, { data: null });
  await expect(requireAgentConfigurationAccess("a", "owner")).resolves.toBeUndefined();
  m.results.push({ data: null }, { data: { user_id: "admin" } });
  await expect(requireAgentConfigurationAccess("a", "admin")).resolves.toBeUndefined();
  expect(configurationRead(target)).toMatchObject({ agentId: "target", active: true, instructionHash: instructionHash("Current"), fallbackReason: null });
  expect(configurationRead({ ...target, instructions: "Changed" }).instructionHash).not.toBe(configurationRead(target).instructionHash);
  expect(configurationRead(null)).toMatchObject({ agentId: null, active: null, instructionHash: null, fallbackReason: "no_active_agent" });
});
