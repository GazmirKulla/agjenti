import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), profile: vi.fn(), from: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
// Advisory workflow metadata only; the real mutation/validation and capability assessor run.
vi.mock("@/lib/workflows/visual/business-workflow", () => ({ publishedBusinessWorkflow: async () => null }));
vi.mock("@/lib/products/workflow-binding", () => ({ publishedProductBindings: async () => new Map() }));
import { POST } from "./route";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import { updateCatalogField } from "@/lib/products/inline-actions";

type Row = Record<string, unknown>;
type Query = { table: string; filters: Row; patch?: Row; head?: boolean; limit?: number };
let tables: Record<string, Row[]>;
let queries: Query[];
let writes: number;
let readFailure: boolean, postReadFailure: boolean, race: boolean, writeFailure: boolean;
const id = "00000000-0000-4000-8000-000000000001";
const typeId = "00000000-0000-4000-8000-000000000002";
const stamp = "2026-10-17T00:00:00.000Z";
const product = () => tables.products[0];
const req = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/business-assistant/capability-activation?slug=shop-a", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
const inspect = (capability = "product.search") => POST(req({ mode: "inspect", capability }));
const confirm = (token: string, extra: Row = {}) => POST(req({ mode: "confirm", token, approved: true, ...extra }));
async function offer() {
  const response = await inspect(); expect(response.status).toBe(200);
  const result = await response.json(); expect(result.status).toBe("available");
  expect(result.options[0].token).toBeTypeOf("string");
  return result.options[0].token as string;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "synthetic-catalog-activation-only");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "tenant-a,tenant-b");
  m.user.mockResolvedValue({ id: "owner-a" });
  m.access.mockResolvedValue({ business: { id: "tenant-a", slug: "canonical-a", catalog_source: "internal" } });
  m.profile.mockResolvedValue({ enabledModules: ["products"] });
  writes = 0; queries = []; readFailure = postReadFailure = race = writeFailure = false;
  tables = {
    business_users: [{ business_id: "tenant-a", user_id: "owner-a", role: "owner" }], platform_admins: [],
    products: [{ id, business_id: "tenant-a", name: "Produkt sintetik", price_amount: 10, currency: "EUR", product_type_id: typeId,
      workflow_id: null, is_active: false, updated_at: stamp, source: "manual", external_id: null, description: null, sku: null, image_url: null }],
    product_types: [{ id: typeId, is_active: true }], workflows: [],
  };
  m.from.mockImplementation((table: string) => {
    const query: Query = { table, filters: {} }; queries.push(query);
    const execute = () => {
      if (table === "products" && (readFailure || postReadFailure && writes > 0) && !query.patch)
        return { data: null, error: { message: "private-db-secret" }, count: null };
      if (query.patch && writeFailure) return { data: null, error: { code: "write_failed" }, count: null };
      if (query.patch && race) product().updated_at = "2026-10-18T10:00:00.000Z";
      let rows = (tables[table] ?? []).filter(row => Object.entries(query.filters).every(([key, value]) => row[key] === value));
      if (query.limit) rows = rows.slice(0, query.limit);
      if (query.patch) { for (const row of rows) Object.assign(row, query.patch); writes += rows.length; }
      return { data: rows.map(row => ({ ...row })), count: rows.length, error: null };
    };
    const q = {
      select: (_columns: string, options?: { head?: boolean }) => { query.head = options?.head; return q; },
      eq: (key: string, value: unknown) => { query.filters[key] = value; return q; },
      order: () => q, limit: (n: number) => { query.limit = n; return q; },
      update: (patch: Row) => { query.patch = patch; return q; },
      maybeSingle: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return q;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("inspects missing configuration without writes, then uses the real catalog action and reassesses", async () => {
  const token = await offer(); expect(writes).toBe(0);
  const original = { ...product() };
  const response = await confirm(token, { businessId: "foreign", userId: "foreign", productId: "foreign", readiness: "ready", field: "workflow_id", value: "foreign" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "activated", changed: true, assessment: { capabilityKey: "product.search", status: "ready" } });
  expect(writes).toBe(1);
  expect(product()).toEqual({ ...original, is_active: true, updated_at: expect.any(String) });
  expect(queries.filter(q => q.patch)).toEqual([expect.objectContaining({ table: "products", filters: { business_id: "tenant-a", id, updated_at: stamp, is_active: false }, patch: { is_active: true, updated_at: expect.any(String) } })]);
  expect(m.access).toHaveBeenCalledWith("owner-a", "canonical-a"); // existing action reauthenticates canonical slug
  expect(queries.every(q => !q.patch || q.table === "products")).toBe(true);
});

it("explains supported-but-disabled without issuing a token or changing module selection", async () => {
  m.profile.mockResolvedValue({ enabledModules: [] });
  expect(await (await inspect()).json()).toMatchObject({ status: "disabled", changed: false, assessment: { availability: "module_disabled" } });
  expect(writes).toBe(0); expect(queries.some(q => q.patch)).toBe(false);
});
it("returns already ready without a mutation or approval ticket", async () => {
  product().is_active = true;
  const result = await (await inspect()).json();
  expect(result).toMatchObject({ status: "ready", changed: false }); expect(result.options).toBeUndefined(); expect(writes).toBe(0);
});
it.each(["inventory.check", "constructor", "__proto__", "customer.create"])("does not offer unsupported %s", async key => {
  expect(await (await inspect(key)).json()).toMatchObject({ status: "unsupported", changed: false });
  expect(m.from).not.toHaveBeenCalled();
});
it("does not activate another supported capability through this slice", async () => {
  expect(await (await inspect("booking.create")).json()).toMatchObject({ status: "blocked", changed: false }); expect(writes).toBe(0);
});
it("distinguishes a member without configuration permission from a disabled capability", async () => {
  tables.business_users[0].role = "staff";
  const result = await (await inspect()).json(); expect(result.status).toBe("unauthorized"); expect(result.options).toBeUndefined();
  expect(m.profile).not.toHaveBeenCalled(); expect(writes).toBe(0);
});
it("rechecks owner permission and module state after the dialog was prepared", async () => {
  const token = await offer(); tables.business_users[0].role = "staff";
  expect(await (await confirm(token)).json()).toMatchObject({ status: "unauthorized", changed: false });
  tables.business_users[0].role = "owner"; m.profile.mockResolvedValue({ enabledModules: [] });
  expect(await (await confirm(token)).json()).toMatchObject({ status: "disabled", changed: false }); expect(writes).toBe(0);
});
it("blocks missing/changed product configuration and a change racing the write", async () => {
  const token = await offer(); product().updated_at = "2026-10-17T01:00:00.000Z";
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(0);
  product().updated_at = stamp; race = true;
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(0);
});
it("rejects deleted products and a product type disabled after review", async () => {
  const token = await offer(); tables.product_types[0].is_active = false;
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(0);
  tables.products = []; expect((await confirm(token)).status).toBe(409); expect(writes).toBe(0);
});
it("rejects cross-tenant and cross-user replay even for an otherwise authorized owner", async () => {
  const token = await offer();
  m.access.mockResolvedValue({ business: { id: "tenant-b", slug: "b", catalog_source: "internal" } });
  expect((await confirm(token)).status).toBe(409);
  m.access.mockResolvedValue({ business: { id: "tenant-a", slug: "canonical-a", catalog_source: "internal" } });
  m.user.mockResolvedValue({ id: "another-owner" });
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(0);
});
it("rejects expired, tampered and non-activation tickets", async () => {
  const token = await offer(); const ticket = JSON.parse(decryptSecret(token));
  for (const invalid of ["forged", encryptSecret(JSON.stringify({ ...ticket, expires: 1 })), encryptSecret(JSON.stringify({ ...ticket, purpose: "business-assistant-v1" }))])
    expect((await confirm(invalid)).status).toBe(409);
  expect(writes).toBe(0);
});
it("requires explicit approval and ignores cancellation without writes", async () => {
  const token = await offer();
  expect((await confirm(token, { approved: false })).status).toBe(400);
  // Closing the dialog invokes no confirmation endpoint; inspection did not mutate.
  expect(writes).toBe(0);
});
it("makes duplicate approval read-only and cannot reactivate a later-disabled product", async () => {
  const token = await offer(); await confirm(token);
  expect(await (await confirm(token)).json()).toMatchObject({ status: "ready", changed: false }); expect(writes).toBe(1);
  product().is_active = false; product().updated_at = "2026-10-18T11:00:00.000Z";
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(1);
});
it("fences concurrent duplicate confirmations with the existing row revision", async () => {
  const token = await offer(); const results = await Promise.all([confirm(token), confirm(token)]);
  expect(results.some(r => r.status === 200)).toBe(true); expect(writes).toBe(1); expect(product().is_active).toBe(true);
});
it("does not repeat the status write when concurrent approvals share the same millisecond revision", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(stamp));
  const token = await offer(); await Promise.all([confirm(token), confirm(token)]);
  expect(writes).toBe(1); expect(product().is_active).toBe(true);
});
it("rejects an old approval after enable/disable in the same millisecond", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(stamp));
  const token = await offer(); await confirm(token);
  await updateCatalogField("canonical-a", { id, field: "is_active", value: false, updatedAt: String(product().updated_at) });
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(2); expect(product().is_active).toBe(false);
});
it.each(["price", "type", "external", "empty"])("offers no write for %s configuration", async kind => {
  if (kind === "price") product().price_amount = null;
  if (kind === "type") tables.product_types[0].is_active = false;
  if (kind === "external") m.access.mockResolvedValue({ business: { id: "tenant-a", slug: "canonical-a", catalog_source: "external" } });
  if (kind === "empty") tables.products = [];
  const result = await (await inspect()).json(); expect(result.status).toBe("blocked");
  expect(result.options?.some((o: { token?: string }) => o.token)).not.toBe(true); expect(writes).toBe(0);
});
it("does not interpret failed readiness reads as permission to activate", async () => {
  const token = await offer(); readFailure = true;
  const response = await confirm(token); expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).not.toContain("private-db-secret"); expect(writes).toBe(0);
});
it("reports an acknowledged write separately from failed reassessment", async () => {
  const token = await offer(); postReadFailure = true;
  const result = await (await confirm(token)).json();
  expect(result).toMatchObject({ status: "unverified", changed: true }); expect(result.assessment).toBeUndefined(); expect(writes).toBe(1);
});
it("reports write and post-write cache errors without inventing a successful outcome", async () => {
  const token = await offer(); writeFailure = true;
  expect((await confirm(token)).status).toBe(409); expect(writes).toBe(0);
  writeFailure = false; m.refresh.mockImplementation(() => { throw new Error("cache unavailable"); });
  expect(await (await confirm(token)).json()).toMatchObject({ status: "unverified", changed: null }); expect(writes).toBe(1);
});
it("rejects invalid origin, session, membership, approval format and oversized payloads", async () => {
  expect((await POST(req({ mode: "inspect" }, "https://foreign.test"))).status).toBe(403);
  expect(m.user).not.toHaveBeenCalled();
  m.user.mockResolvedValueOnce(null); expect((await inspect()).status).toBe(401);
  m.access.mockResolvedValueOnce(null); expect((await inspect()).status).toBe(403);
  expect((await POST(req({ mode: "confirm", approved: "true" }))).status).toBe(400);
  expect((await POST(req({ text: "x".repeat(11000) }))).status).toBe(400);
  expect(writes).toBe(0);
});
