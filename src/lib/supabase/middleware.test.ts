import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.create }));
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { AUTH_CHECK_TIMEOUT_MS, deadlineFetch, updateSession } from "./middleware";
beforeEach(() => {
  vi.clearAllMocks();
  m.create.mockReturnValue({ auth: { getUser: m.user } });
  m.user.mockResolvedValue({ data: { user: null } });
});
it("serves public content and independently authenticated callbacks without auth network calls", async () => {
  for (const path of [
    "/",
    "/privacy",
    "/terms",
    "/data-deletion",
    "/api/webhooks/meta",
    "/api/meta/data-deletion",
    "/api/meta/deauthorize",
    "/api/cron/refresh-instagram-tokens",
    "/api/instagram/oauth/callback",
  ]) {
    expect(
      (await updateSession(new NextRequest(`https://agjenti.app${path}`)))
        .status,
    ).toBe(200);
  }
  expect(m.create).not.toHaveBeenCalled();
});
it("still authenticates protected pages and redirects anonymous users", async () => {
  const response = await updateSession(
    new NextRequest("https://agjenti.app/admin/app"),
  );
  expect(m.user).toHaveBeenCalledOnce();
  expect(response.headers.get("location")).toBe(
    "https://agjenti.app/login?next=%2Fadmin%2Fapp",
  );
});
it("preserves signed-in login redirection", async () => {
  m.user.mockResolvedValue({ data: { user: { id: "user" } } });
  const response = await updateSession(
    new NextRequest("https://agjenti.app/login"),
  );
  expect(response.headers.get("location")).toBe(
    "https://agjenti.app/auth/continue",
  );
});
it("answers quickly with 503 when Auth does not respond, without signing anyone out", async () => {
  vi.useFakeTimers();
  try {
    m.user.mockReturnValue(new Promise(() => {}));
    const pending = updateSession(new NextRequest("https://agjenti.app/b/shop", { headers: { cookie: "sb-x-auth-token=abc" } }));
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_TIMEOUT_MS);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("returns JSON 503 for API routes when Auth is unreachable", async () => {
  m.user.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
  const response = await updateSession(new NextRequest("https://agjenti.app/api/agent-test/turns"));
  expect(response.status).toBe(503);
  expect(await response.json()).toHaveProperty("error");
});
it("keeps the login page reachable during an Auth outage", async () => {
  m.user.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
  const response = await updateSession(new NextRequest("https://agjenti.app/login"));
  expect(response.status).toBe(200);
});
it("still redirects to login when the session is really gone", async () => {
  m.user.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found") });
  const response = await updateSession(new NextRequest("https://agjenti.app/admin/pricing"));
  expect(response.headers.get("location")).toBe("https://agjenti.app/login?next=%2Fadmin%2Fpricing");
});
it("redirects to login, not 503, when Auth rejected the refresh and the check then runs out of time", async () => {
  vi.useFakeTimers();
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: "refresh_token_not_found" }), { status: 400 }));
  try {
    m.create.mockImplementation((_url, _key, options) => ({
      auth: { getUser: async () => { await options.global.fetch("https://auth.example/token?grant_type=refresh_token", { method: "POST" }); return new Promise(() => {}); } },
    }));
    const pending = updateSession(new NextRequest("https://agjenti.app/b/shop", { headers: { cookie: "sb-x-auth-token=abc" } }));
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_TIMEOUT_MS);
    const response = await pending;
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agjenti.app/login?next=%2Fb%2Fshop");
  } finally {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  }
});
it("does not count a 429 or a 5xx as a rejected session", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const status of [429, 503]) {
      globalThis.fetch = vi.fn(async () => new Response("", { status }));
      const replies = { rejected: false };
      await deadlineFetch(new AbortController().signal, replies)("https://auth.example/user");
      expect(replies.rejected).toBe(false);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
