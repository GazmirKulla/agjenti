import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => { throw new Error("no live database in tests"); } }));
import { prospectTurnContext } from "./turn-context";
import type { ProspectScan } from "./instagram-scan";

const scan = (fields: Partial<ProspectScan> = {}): ProspectScan => ({ id: "scan-1", business_id: "agjenti", conversation_id: "chat", username: "dyqani.al",
  status: "queued", profile: null, posts: null, stats: null, error: null, fetched_at: null, updated_at: "now", ...fields });
const base = { businessId: "agjenti", conversationId: "chat", deadline: Date.now() + 38_000 };
const allowed = vi.fn().mockResolvedValue({ allowed: true, monthlyLimit: 50 });

it("does nothing for a business that is not allowed to scan", async () => {
  const request = vi.fn();
  await expect(prospectTurnContext({ ...base, message: "@dyqani.al" }, { policy: vi.fn().mockResolvedValue({ allowed: false, monthlyLimit: 0 }), request })).resolves.toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});

it("queues the named account, wakes the worker and waits briefly for the read", async () => {
  const request = vi.fn().mockResolvedValue({ kind: "queued", scan: scan() });
  const wake = vi.fn().mockResolvedValue(true);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  const wait = vi.fn().mockResolvedValue(scan({ status: "ready", profile: { name: "Dyqani", biography: "Rroba për fëmijë" }, posts: [] }));
  const context = await prospectTurnContext({ ...base, message: "faqja jonë është @dyqani.al" }, { policy: allowed, request, wake, wait, ownUsername: async () => "agjenti.app" });
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ username: "dyqani.al", monthlyLimit: 50 }));
  expect(wake).toHaveBeenCalledWith("scan-1", "https://app.test");
  vi.unstubAllEnvs();
  expect(context).toMatchObject({ status: "ready", profile: { name: "Dyqani" } });
});

it("does not wait when the reply has no time left, and keeps the chat's earlier read", async () => {
  const wait = vi.fn();
  const context = await prospectTurnContext({ ...base, deadline: Date.now() + 10_000, message: "@dyqani.al" },
    { policy: allowed, request: vi.fn().mockResolvedValue({ kind: "existing", scan: scan() }), wait, ownUsername: async () => null });
  expect(wait).not.toHaveBeenCalled();
  expect(context).toMatchObject({ status: "queued" });
  const later = await prospectTurnContext({ ...base, message: "sa kushton?" }, { policy: allowed, ownUsername: async () => null,
    latest: async () => scan({ status: "ready", profile: { name: "Dyqani", biography: "Rroba për fëmijë" }, posts: [] }) });
  expect(later).toMatchObject({ status: "ready", username: "dyqani.al" });
});

it("never breaks the reply when the scan fails", async () => {
  await expect(prospectTurnContext({ ...base, message: "@dyqani.al" }, { policy: allowed, ownUsername: async () => null, request: vi.fn().mockRejectedValue(new Error("db")) })).resolves.toBeUndefined();
});

it("reads the customer's Instagram from Real chat Inputs when the message names none", async () => {
  const request = vi.fn().mockResolvedValue({ kind: "existing", scan: scan({ status: "ready", profile: { name: "Dyqani", biography: "Rroba" }, posts: [] }) });
  const context = await prospectTurnContext({ ...base, message: "Përshëndetje", sender: "@Dyqani.AL" }, { policy: allowed, request, latest: async () => null, ownUsername: async () => "agjenti.app" });
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ username: "dyqani.al" }));
  expect(context).toMatchObject({ status: "ready" });
  // The account the chat already talked about stays; the business's own account is never read.
  const other = vi.fn();
  await prospectTurnContext({ ...base, message: "sa kushton?", sender: "dyqani.al" }, { policy: allowed, request: other, latest: async () => scan({ username: "salloni_ana" }), ownUsername: async () => null });
  await prospectTurnContext({ ...base, message: "hej", sender: "agjenti.app" }, { policy: allowed, request: other, latest: async () => null, ownUsername: async () => "agjenti.app" });
  expect(other).not.toHaveBeenCalled();
});

it("reads the DM sender from the first message, and goes on by asking while there is nothing usable", async () => {
  const queued = vi.fn().mockResolvedValue({ kind: "queued", scan: scan() });
  const first = await prospectTurnContext({ ...base, deadline: Date.now() + 10_000, message: "Përshëndetje", sender: "dyqani.al" },
    { policy: allowed, request: queued, wake: vi.fn().mockResolvedValue(true), latest: async () => null, ownUsername: async () => "agjenti.app" });
  expect(queued).toHaveBeenCalledWith(expect.objectContaining({ username: "dyqani.al" }));
  expect(first).toMatchObject({ status: "manual" });
  expect((first as { guidance: string }).guidance).toContain("Mos e përmend leximin");
  for (const status of ["not_found", "failed"] as const) {
    const later = await prospectTurnContext({ ...base, message: "sa kushton?", sender: "dyqani.al" }, { policy: allowed, ownUsername: async () => null, latest: async () => scan({ status }) });
    expect(later).toMatchObject({ status: "manual" });
  }
  const taken = await prospectTurnContext({ ...base, message: "hej", sender: "dyqani.al" }, { policy: allowed, ownUsername: async () => null, latest: async () => null,
    request: vi.fn().mockResolvedValue({ kind: "refused", reason: "already_registered", username: "dyqani.al" }) });
  expect(taken).toMatchObject({ status: "manual" });
  // An account the customer named keeps its own guidance.
  const named = await prospectTurnContext({ ...base, message: "@salloni_ana", sender: "dyqani.al" }, { policy: allowed, ownUsername: async () => null,
    request: vi.fn().mockResolvedValue({ kind: "existing", scan: scan({ username: "salloni_ana", status: "not_found" }) }) });
  expect(named).toMatchObject({ status: "not_found" });
});
