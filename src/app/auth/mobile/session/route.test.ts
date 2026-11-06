import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.create }));
import { POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ data: { user: { id: "a" } }, error: null });
  m.session.mockResolvedValue({ data: { user: { id: "a" } }, error: null });
  m.create.mockReturnValue({ auth: { getUser: m.user, setSession: m.session } });
});
const request = (headers: Record<string, string> = {}, body = JSON.stringify({ access_token: "access", refresh_token: "refresh" })) => POST(new Request("https://agjenti.app/auth/mobile/session", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));
it("rejects cross-origin requests and HTML forms before touching auth", async () => {
  expect((await request({ origin: "https://other.test" })).status).toBe(403);
  expect((await request({ "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
  expect((await request({ "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect(m.create).not.toHaveBeenCalled();
});
it("validates the access token before setting any session", async () => {
  m.user.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
  expect((await request()).status).toBe(401);
  expect(m.session).not.toHaveBeenCalled();
});
it("rejects a mismatched refreshed session", async () => {
  m.session.mockResolvedValue({ data: { user: { id: "b" } }, error: null });
  const response = await request();
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie") ?? "").not.toContain("agjenti_native");
});
it("replaces a previous account's session cookies", async () => {
  m.create.mockImplementation((_url, _key, options) => ({ auth: { getUser: m.user, setSession: async () => {
    options.cookies.setAll([{ name: "sb-ref-auth-token.0", value: "new", options: {} }]);
    return m.session();
  } } }));
  const response = await request({ cookie: "sb-ref-auth-token=old; sb-ref-auth-token.0=old; sb-ref-auth-token.1=old; NEXT_LOCALE=sq" });
  const cookies = response.cookies.getAll();
  expect(cookies.find(c => c.name === "sb-ref-auth-token")?.value).toBe("");
  expect(cookies.find(c => c.name === "sb-ref-auth-token.1")?.value).toBe("");
  expect(cookies.find(c => c.name === "sb-ref-auth-token.0")?.value).toBe("new");
  expect(cookies.some(c => c.name === "NEXT_LOCALE")).toBe(false);
});
it("marks the web session as opened inside the native app", async () => {
  const cookie = (await request()).headers.get("set-cookie") ?? "";
  expect(cookie).toContain("agjenti_native=1");
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).not.toMatch(/Max-Age|Expires/i);
});
it("redirects without credentials in the URL only after authentication", async () => {
  const response = await request();
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://agjenti.app/auth/mobile/continue");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(m.session).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
});
it("bounds request size and rejects malformed payloads", async () => {
  expect((await request({}, "{")).status).toBe(400);
  expect((await request({}, "x".repeat(20001))).status).toBe(413);
  expect((await request({}, "{}")).status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
it("opens only an internal supported destination after session exchange", async () => {
  const internal = await request({}, JSON.stringify({ access_token: "access", refresh_token: "refresh", next: "/b/one/products" }));
  expect(internal.headers.get("location")).toBe("https://agjenti.app/b/one/products");
  const themed = await request({}, JSON.stringify({ access_token: "access", refresh_token: "refresh", next: "/account?theme=dark" }));
  expect(themed.headers.get("location")).toBe("https://agjenti.app/account?theme=dark");
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/account/../admin", "/onboarding#x"]) {
    const response = await request({}, JSON.stringify({ access_token: "access", refresh_token: "refresh", next }));
    expect(response.headers.get("location")).toBe("https://agjenti.app/auth/mobile/continue");
  }
});
