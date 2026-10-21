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
  expect((await request()).status).toBe(401);
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
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
    const response = await request({}, JSON.stringify({ access_token: "access", refresh_token: "refresh", next }));
    expect(response.headers.get("location")).toBe("https://agjenti.app/auth/mobile/continue");
  }
});
