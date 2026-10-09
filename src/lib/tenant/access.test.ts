import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), aliasIds: vi.fn(), aliasSlug: vi.fn(), alias: vi.fn(), businesses: [] as { id: string; slug: string }[] }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
import { requireBusinessAccess } from "./access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.businesses = [{ id: "own-business", slug: "filiz-store" }];
  mocks.alias.mockResolvedValue({ data: { business_id: "own-business" } });
  mocks.aliasIds.mockReturnValue({ maybeSingle: mocks.alias });
  mocks.aliasSlug.mockReturnValue({ in: mocks.aliasIds });
  mocks.from.mockImplementation((table: string) => {
    if (table === "platform_admins") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    if (table === "business_users") return { select: () => ({ eq: async () => ({ data: mocks.businesses.map(b => ({ business_id: b.id })) }) }) };
    if (table === "businesses") return { select: () => ({ in: () => ({ order: async () => ({ data: mocks.businesses }) }) }) };
    if (table === "business_slug_aliases") return { select: () => ({ eq: mocks.aliasSlug }) };
    throw new Error(`Unexpected table: ${table}`);
  });
});

describe("business slug aliases", () => {
  it("uses a current address without querying aliases", async () => {
    expect(await requireBusinessAccess("owner", "filiz-store")).toMatchObject({ business: { id: "own-business", slug: "filiz-store" } });
    expect(mocks.alias).not.toHaveBeenCalled();
  });
  it("resolves old addresses only within the user's memberships", async () => {
    expect(await requireBusinessAccess("owner", "biznes-old")).toMatchObject({ business: { slug: "filiz-store" } });
    expect(mocks.aliasSlug).toHaveBeenCalledWith("slug", "biznes-old");
    expect(mocks.aliasIds).toHaveBeenCalledWith("business_id", ["own-business"]);
  });
  it("rejects an alias to a different business even if returned by storage", async () => {
    mocks.alias.mockResolvedValue({ data: { business_id: "other-business" } });
    expect(await requireBusinessAccess("owner", "biznes-other")).toBeNull();
  });
  it("does not look up aliases without membership", async () => {
    mocks.businesses = [];
    expect(await requireBusinessAccess("outsider", "biznes-old")).toBeNull();
    expect(mocks.alias).not.toHaveBeenCalled();
  });
  it("denies access when the alias table is unavailable or no alias exists", async () => {
    mocks.alias.mockResolvedValue({ data: null, error: { message: "Missing table" } });
    expect(await requireBusinessAccess("owner", "biznes-old")).toBeNull();
  });
});
