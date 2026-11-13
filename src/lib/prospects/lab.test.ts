import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => { throw new Error("no live database in tests"); } }));
import { labProspectRead } from "./lab";

const allowed = vi.fn().mockResolvedValue({ allowed: true, monthlyLimit: 50 });
const base = { businessId: "agjenti", previous: null };
const ready = { status: "ready" as const, profile: { name: "Dyqani", biography: "Rroba për fëmijë" }, posts: [{ id: "1", caption: "Koleksioni i ri", imageUrl: null, permalink: null, mediaType: "IMAGE" }], stats: { followers: 10 }, error: null, fetched_at: "2026-11-13T10:00:00Z" };
const deps = { policy: allowed, connected: vi.fn().mockResolvedValue(false), ownUsername: async () => "agjenti.app" };

describe("labProspectRead", () => {
  it("does nothing for a business that may not read prospects", async () => {
    const read = vi.fn();
    await expect(labProspectRead({ ...base, message: "@dyqani.al" }, { ...deps, policy: vi.fn().mockResolvedValue({ allowed: false, monthlyLimit: 0 }), read })).resolves.toMatchObject({ context: undefined, trace: null });
    expect(read).not.toHaveBeenCalled();
  });
  it("reads the named account, shows the read and keeps it for the next test message", async () => {
    const read = vi.fn().mockResolvedValue(ready);
    const first = await labProspectRead({ ...base, message: "faqja jonë @dyqani.al" }, { ...deps, read });
    expect(read).toHaveBeenCalledWith("dyqani.al");
    expect(first.context).toMatchObject({ status: "ready", profile: { name: "Dyqani" } });
    expect(first.trace).toMatchObject({ username: "dyqani.al", result: "ready", source: "read" });
    const later = await labProspectRead({ ...base, message: "sa kushton?", previous: first.scan }, { ...deps, read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(later.trace).toMatchObject({ source: "reused" });
  });
  it("applies the live rules: connected elsewhere, private and empty accounts", async () => {
    const read = vi.fn();
    const taken = await labProspectRead({ ...base, message: "@dyqani.al" }, { ...deps, connected: vi.fn().mockResolvedValue(true), read });
    expect(taken.context).toMatchObject({ status: "not_read" });
    expect(read).not.toHaveBeenCalled();
    const missing = await labProspectRead({ ...base, message: "@dyqani.al" }, { ...deps, read: vi.fn().mockResolvedValue({ ...ready, status: "not_found", profile: null, posts: null }) });
    expect(missing.context).toMatchObject({ status: "not_found" });
    const empty = await labProspectRead({ ...base, message: "@dyqani.al" }, { ...deps, read: vi.fn().mockResolvedValue({ ...ready, profile: { name: "Dyqani" }, posts: [] }) });
    expect(empty.context).toMatchObject({ status: "empty" });
    expect(empty.trace).toMatchObject({ result: "empty" });
  });
  it("reports a read that takes too long instead of holding the test", async () => {
    const slow = await labProspectRead({ ...base, message: "@dyqani.al" }, { ...deps, timeoutMs: 10, read: () => new Promise(() => {}) });
    expect(slow.context).toMatchObject({ status: "failed" });
  });
});
