import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), session: vi.fn(), admin: vi.fn(), deletions: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.session, isPlatformAdmin: m.admin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
vi.mock("./actions", () => ({ manageUser: vi.fn() }));
import Page from "./page";
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ id: "admin" }); m.admin.mockResolvedValue(true);
  m.rpc.mockResolvedValue({ data: { total: 30, users: [{ id: "u1", name: "Përdorues prove", email: "preview@example.test", created_at: "2026-11-04", last_sign_in_at: null, email_confirmed_at: null, banned: false, admin: false, businesses: [] }] }, error: null });
  m.from.mockImplementation((table: string) => {
    if (table === "businesses") return { select: () => ({ order: async () => ({ data: [], error: null }) }) };
    if (table === "platform_user_events") return { select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
    if (table === "account_deletions") return { select: () => ({ in: () => ({ in: async () => ({ data: m.deletions(), error: null }) }) }) };
    throw new Error("Unexpected table");
  });
  m.deletions.mockReturnValue([]);
});
it("offers restoration only while a deletion is pending", async () => {
  expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).not.toContain("Rikthe llogarinë");
  m.deletions.mockReturnValue([{ user_id: "u1", status: "scheduled", purge_after: "2026-12-06T00:00:00Z" }]);
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Fshirje e kërkuar"); expect(html).toContain("Rikthe llogarinë");
  m.deletions.mockReturnValue([{ user_id: "u1", status: "purging", purge_after: "2026-12-06T00:00:00Z" }]);
  expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).not.toContain("Rikthe llogarinë");
});
it("renders orphan accounts, manual verification and password management; preserves filters in pagination", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: "prove", filter: "no-business" }) }));
  expect(html).toContain("Pa biznes"); expect(html).toContain("Verifiko email-in"); expect(html).toContain("Ndrysho fjalëkalimin");
  expect(html).toContain("filter=no-business"); expect(html).toContain("page=2");
  expect(m.rpc).toHaveBeenCalledWith("admin_list_users", { p_search: "prove", p_filter: "no-business", p_business: null, p_page: 1 });
  if (process.env.USER_PAGE_PREVIEW) writeFileSync(process.env.USER_PAGE_PREVIEW, `<!doctype html><html lang="sq"><head><meta charset="UTF-8"><link rel="stylesheet" href="users-preview.css"></head><body><div class="dashboard-shell" style="display:block"><main style="padding:24px">${html}</main></div></body></html>`);
});
it("fails visibly when the user directory cannot load", async () => {
  m.rpc.mockResolvedValue({ data: null, error: {} });
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("Nuk u ngarkuan");
});
it("denies non-admin access before querying the directory", async () => {
  m.admin.mockResolvedValue(false);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled();
});
