import { expect, it, vi } from "vitest";
vi.mock("@/components/dashboard/actions.css",()=>({}));
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync } from "node:fs";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => m }));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: async () => ({ id: "owner", email: "owner@test.invalid" }),
  requireBusinessAccess: async () => ({
    admin: true,
    business: { id: "source", slug: "agjenti", name: "Agjenti" },
  }),
  isPlatformAdmin: async () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dashboard/modules/entitlements", () => ({ loadAllowedModules: async () => ["products", "services", "workflows"] }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: async () => ({ enabledModules: ["products", "workflows"] }) }));
import PermissionsPage from "@/app/admin/businesses/[id]/permissions/page";
import AdminPage from "@/app/admin/actions/page";
import BusinessPage from "@/app/b/[slug]/actions/page";
import { policyCatalog } from "./policies";
function fixture() {
  const tables: Record<string, unknown[]> = {
    platform_actions: Object.keys(policyCatalog).map((key) => ({
      key,
      enabled: true,
    })),
    plan_actions: Object.keys(policyCatalog).flatMap((action_key) =>
      ["free", "starter", "professional", "enterprise"].map((plan) => ({
        plan,
        action_key,
        enabled: action_key !== "business.provision",
        monthly_limit: null,
      })),
    ),
    businesses: [{ id: "source", name: "Agjenti", slug: "agjenti" }],
    business_actions: [
      {
        business_id: "source",
        action_key: "business.provision",
        enabled: true,
      },
    ],
    business_action_settings: [],
    business_users: [{ role: "owner" }],
    business_invitations: [],
    action_executions: [],
  };
  m.from.mockImplementation((table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: result.data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return q;
  });
  m.rpc.mockResolvedValue({ data: true, error: null });
}
it("renders package controls and the complete manual invitation entry point", async () => {
  fixture();
  m.from.mockClear();
  const admin = renderToStaticMarkup(await AdminPage({})),
    business = renderToStaticMarkup(
      await BusinessPage({ params: Promise.resolve({ slug: "agjenti" }) }),
    );
  expect(admin).toContain("Modulet dhe aftësitë");
  expect(admin).toContain('name="plan_free"');
  expect(admin).toContain("enterprise");
  expect(admin).toContain('type="checkbox"');
  expect(admin).not.toContain('value="business"');
  expect(admin).not.toContain("Përjashtim për biznes");
  expect(business).toContain('name="email"');
  expect(business).toContain("Përgatit biznesin");
  expect(business).toContain("Ende nuk ka ftesa");
  expect(business).not.toContain("Lejo stafin");
  expect(business).toContain("I lejuar · joaktiv në hapësirë");
  const dir = process.env.ACTION_UI_PREVIEW_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const [name, html] of Object.entries({ admin, business }))
      writeFileSync(
        `${dir}/${name}.html`,
        `<!doctype html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./styles.css"></head><body><main class="dashboard-shell"><div style="max-width:1100px;padding:32px;margin:auto">${html}</div></main></body></html>`,
      );
  }
});

it("keeps denied capabilities visible without exposing the invitation form", async () => {
  fixture();
  m.rpc.mockResolvedValue({ data: false, error: null });
  const business = renderToStaticMarkup(await BusinessPage({ params: Promise.resolve({ slug: "agjenti" }) }));
  expect(business).toContain("Kjo aftësi nuk është e lejuar");
  expect(business).not.toContain('name="email"');
  expect(business).not.toContain('name="automation_allowed"');
  expect(business).toContain("/admin/businesses/source/permissions");
  expect(business).toContain("Modulet e hapësirës");
});

it("loads global policies independently and scopes exceptions to one business", async () => {
  fixture(); m.from.mockClear();
  await AdminPage({});
  expect(m.from.mock.calls.map(([table]) => table)).toEqual(["platform_actions", "plan_actions"]);
  const html = renderToStaticMarkup(await PermissionsPage({ params: Promise.resolve({ id: "source" }) }));
  expect(html).toContain("Agjenti");
  expect(html).toContain('name="target" value="source"');
  expect(html).toContain("Lejo për këtë biznes");
  expect(html).toContain("Sipas paketës");
});

it("selects one module while keeping every module reachable with an icon", async () => {
  fixture();
  const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ module: "business.provision" }) }));
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('name="action_key" value="business.provision"');
  expect(html).not.toContain('name="action_key" value="module.products"');
  expect(html).toContain('/admin/actions?module=module.products');
  expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(Object.keys(policyCatalog).length);
  const fallback = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ module: "unknown" }) }));
  expect(fallback).toContain('name="action_key" value="module.products"');
});
