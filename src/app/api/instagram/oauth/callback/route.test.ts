import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ state: vi.fn(), exchange: vi.fn(), subscribe: vi.fn(), settings: vi.fn(), enqueue: vi.fn(), from: vi.fn(), after: vi.fn(), saved: { error: null as object | null } }));
vi.mock("@/lib/instagram/oauth", () => ({ verifyOAuthState: m.state, exchangeInstagramCode: m.exchange, subscribeInstagramAccountWebhooks: m.subscribe }));
vi.mock("@/lib/crypto/tokens", () => ({ encryptSecret: () => "encrypted" }));
vi.mock("@/lib/platform/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/discovery/queue", () => ({ enqueueDiscovery: m.enqueue, runDiscoveryQueue: vi.fn() }));
vi.mock("next/server", () => ({ after: m.after, NextResponse: { redirect: (url: URL) => new Response(null, { status: 307, headers: { location: url.href } }) } }));
import { GET } from "./route";
const request = () => new Request("http://localhost/api/instagram/oauth/callback?state=valid&code=valid");
beforeEach(() => {
  vi.clearAllMocks(); m.saved.error = null;
  m.state.mockReturnValue({ businessId: "business", userId: "verified-user" });
  m.exchange.mockResolvedValue({ userId: "ig-user", accessToken: "SECRET-TOKEN", username: "studio" });
  m.subscribe.mockResolvedValue({ ok: true }); m.settings.mockResolvedValue({ onboarding_enabled: true }); m.enqueue.mockResolvedValue("job");
  m.from.mockImplementation(() => { const q = { update: () => q, eq: () => q, neq: async () => ({ error: null }), upsert: async () => m.saved, select: () => q, maybeSingle: async () => ({ data: { slug: "studio" } }) }; return q; });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
describe("Instagram discovery handoff", () => {
  it("queues analysis only after the connection is stored, then redirects to sources", async () => {
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("http://localhost/b/studio/sources?connected=1");
    expect(m.enqueue).toHaveBeenCalledWith("business", "verified-user", "instagram");
    expect(m.after).toHaveBeenCalled();
  });
  it("leaves the connection usable when discovery fails and honors disabled automatic onboarding", async () => {
    m.enqueue.mockRejectedValue(new Error("queue unavailable"));
    expect((await GET(request())).headers.get("location")).toBe("http://localhost/b/studio/instagram?connected=1");
    m.enqueue.mockClear(); m.settings.mockResolvedValue({ onboarding_enabled: false });
    expect((await GET(request())).headers.get("location")).toBe("http://localhost/b/studio/instagram?connected=1");
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("does not queue work or report success when connection storage fails", async () => {
    m.saved.error = { code: "database_error" };
    expect((await GET(request())).headers.get("location")).toBe("http://localhost/auth/continue?ig=error");
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});
