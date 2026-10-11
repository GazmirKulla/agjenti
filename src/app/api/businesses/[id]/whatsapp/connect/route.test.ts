import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), from: vi.fn(), graph: vi.fn(), fetch: vi.fn(), upsert: vi.fn(), member: true }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, isPlatformAdmin: m.admin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/crypto/tokens", () => ({ encryptSecret: (v: string) => `encrypted:${v}` }));
vi.mock("@/lib/whatsapp/api", () => ({ whatsappGraph: m.graph, whatsappGraphVersion: () => "v26.0" }));
import { POST } from "./route";
const body = { code: "authorization-code", wabaId: "123456", phoneId: "987654", pin: "123456" };
const request = (origin = "https://app.test") => new Request("https://app.test/api/businesses/biz/whatsapp/connect", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "biz" }) };
beforeEach(() => {
 vi.clearAllMocks(); m.member = true; m.user.mockResolvedValue({ id: "user" }); m.admin.mockResolvedValue(false);
 vi.stubEnv("META_APP_ID", "meta-app"); vi.stubEnv("META_APP_SECRET", "meta-secret"); vi.stubGlobal("fetch", m.fetch);
 m.fetch.mockResolvedValue(Response.json({ access_token: "server-only-token" }));
 m.upsert.mockResolvedValue({ error: null });
 m.from.mockImplementation((table: string) => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "business_users" && m.member ? { user_id: "user" } : null, error: null }), upsert: m.upsert }; return q; });
 m.graph.mockImplementation(async (path: string) => path.includes("phone_numbers") ? { data: [{ id: "987654", display_phone_number: "+355691234567", verified_name: "Biznesi" }] } : { success: true });
});
it("rejects foreign origins before exchanging authorization codes", async () => { expect((await POST(request("https://other.test"), context)).status).toBe(403); expect(m.fetch).not.toHaveBeenCalled(); });
it("requires membership in the requested business", async () => { m.member = false; expect((await POST(request(), context)).status).toBe(403); expect(m.fetch).not.toHaveBeenCalled(); });
it("rejects phone IDs outside the authorized WABA", async () => { m.graph.mockResolvedValue({ data: [{ id: "111111" }] }); expect((await POST(request(), context)).status).toBe(400); expect(m.upsert).not.toHaveBeenCalled(); });
it("subscribes, registers and stores only the encrypted token without returning it", async () => {
 const result = await POST(request(), context);
 expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true });
 expect(m.graph).toHaveBeenCalledWith("123456/subscribed_apps", "server-only-token", {});
 expect(m.graph).toHaveBeenCalledWith("987654/register", "server-only-token", { messaging_product: "whatsapp", pin: "123456" });
 expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ business_id: "biz", phone_number_id: "987654", access_token_ciphertext: "encrypted:server-only-token" }), { onConflict: "business_id" });
});
