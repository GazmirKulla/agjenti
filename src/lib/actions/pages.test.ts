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
import AdminPage from "@/app/admin/actions/page";
import BusinessPage from "@/app/b/[slug]/actions/page";
import { actionCatalog } from "./catalog";
function fixture() {
  const tables: Record<string, unknown[]> = {
    platform_actions: Object.keys(actionCatalog).map((key) => ({
      key,
      enabled: true,
    })),
    plan_actions: Object.keys(actionCatalog).flatMap((action_key) =>
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
  const admin = renderToStaticMarkup(await AdminPage({})),
    business = renderToStaticMarkup(
      await BusinessPage({ params: Promise.resolve({ slug: "agjenti" }) }),
    );
  expect(admin).toContain("Modulet dhe aftësitë");
  expect(admin).toContain('name="target"');
  expect(admin).toContain("enterprise");
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
  expect(business).toContain("/admin/actions?business=source");
  expect(business).toContain("Modulet e hapësirës");
});
