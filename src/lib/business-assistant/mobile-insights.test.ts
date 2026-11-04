import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  cookie: vi.fn(), native: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(),
  reads: [] as { table: string; filters: [string, unknown][] }[],
  fail: "", closed: false,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.native }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: m.cookie }));
vi.mock("@/lib/tenant/access", () => ({ requireBusinessAccess: m.access }));
import { GET as briefing } from "@/app/api/business-assistant/briefing/route";
import { GET as attention } from "@/app/api/business-assistant/attention/route";

const req = (authorization?: string, slug = "shop") => new Request(`https://app.test/api/business-assistant?slug=${slug}`, {
  headers: authorization === undefined ? {} : { authorization, "x-user-id": "forged" },
});
beforeEach(() => {
  vi.clearAllMocks(); m.reads = []; m.fail = ""; m.closed = false;
  m.user.mockResolvedValue({ data: { user: { id: "verified-owner" } }, error: null });
  m.access.mockResolvedValue({ business: { id: "tenant", slug: "shop" } });
  m.rpc.mockResolvedValue({ data: true, error: null });
  const db = { auth: { getUser: m.user }, rpc: m.rpc, from(table: string) {
    const filters: [string, unknown][] = []; m.reads.push({ table, filters });
    const result = () => ({ error: m.fail === table ? Error("private database detail") : null, count: 2,
      data: table === "businesses" ? { id: "tenant", name: "Shop", slug: "shop", timezone: "Europe/Tirane", dashboard_profile: {} }
        : table === "assistant_conversations" ? (m.closed ? [] : [{ id: "chat", title: "Plan", plan_revision: 1 }])
        : table === "assistant_plan_snapshots" ? { snapshot: { version: 1, preview: { title: "Propozim", fields: [] } } } : null });
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      gte: () => q, lt: () => q, gt: () => q, is: () => q, or: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => result(), single: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  } };
  m.native.mockReturnValue(db); m.cookie.mockResolvedValue(db);
});

it.each([briefing, attention])("accepts a native-only session and keeps queries under its JWT", async get => {
  const response = await get(req("Bearer native.jwt.token"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(m.cookie).not.toHaveBeenCalled();
  expect(m.user).toHaveBeenCalledWith("native.jwt.token");
  expect(m.native.mock.calls[0][2]).toMatchObject({
    global: { headers: { Authorization: "Bearer native.jwt.token" } },
  });
  expect(m.access).toHaveBeenCalledWith("verified-owner", "shop");
  for (const read of m.reads.filter(read => read.table !== "businesses" && read.table !== "assistant_plan_snapshots"))
    expect(read.filters).toContainEqual(["business_id", "tenant"]);
});
it.each([briefing, attention])("retains cookie sessions for web callers", async get => {
  expect((await get(req())).status).toBe(200);
  expect(m.cookie).toHaveBeenCalledOnce(); expect(m.native).not.toHaveBeenCalled();
});
it.each([briefing, attention])("rejects malformed and revoked tokens without cookie fallback", async get => {
  expect((await get(req("Basic invalid"))).status).toBe(401);
  expect(m.user).not.toHaveBeenCalled();
  m.user.mockResolvedValue({ data: { user: null }, error: Error("revoked") });
  expect((await get(req("Bearer revoked"))).status).toBe(401);
  expect(m.cookie).not.toHaveBeenCalled(); expect(m.reads).toHaveLength(0);
});
it.each([briefing, attention])("rejects another business before reading any sources", async get => {
  m.access.mockResolvedValue(null);
  expect((await get(req("Bearer valid", "foreign"))).status).toBe(403);
  expect(m.reads).toHaveLength(0);
});
it("returns verified counts and marks a failed source unavailable, never zero", async () => {
  m.fail = "orders";
  const result = await (await briefing(req("Bearer valid"))).json();
  expect(result.metrics.messages).toMatchObject({ status: "available", count: 2 });
  expect(result.metrics.orders).toMatchObject({ status: "unavailable", count: null });
  expect(result.unavailableMetrics).toContain("orders");
});
it("resumes only private plans and removes the signal after closing one", async () => {
  let result = await (await attention(req("Bearer valid"))).json();
  expect(result.items).toContainEqual(expect.objectContaining({ conversationId: "chat" }));
  expect(m.reads.find(read => read.table === "assistant_conversations")?.filters).toContainEqual(["owner_user_id", "verified-owner"]);
  m.closed = true;
  result = await (await attention(req("Bearer valid"))).json();
  expect(result.items.some((item: { conversationId?: string }) => item.conversationId)).toBe(false);
});
it.each([briefing, attention])("discards readings if access is revoked during the request", async get => {
  m.rpc.mockResolvedValue({ data: false, error: null });
  if (get === briefing) for (let i = 0; i < 4; i++) m.rpc.mockResolvedValueOnce({ data: true, error: null });
  const response = await get(req("Bearer valid"));
  if (get === attention) expect(response.status).toBe(403);
  else {
    const result = await response.json();
    expect(Object.values(result.metrics)).toHaveLength(4);
    for (const reading of Object.values(result.metrics)) expect(reading).toMatchObject({ count: null, status: "disabled" });
  }
});
