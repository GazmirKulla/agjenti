import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.create }));
import { updateSession } from "./middleware";
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
