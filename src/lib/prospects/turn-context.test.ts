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
