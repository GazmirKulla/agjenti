import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), from: vi.fn(), rpc:vi.fn() }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: mocks.profile }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from, rpc:mocks.rpc }) }));

function chain(data: unknown, count?: number) {
  const value = { data, error: null, count };
  const q = {
    select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(async () => value),
    then: (resolve: (result: typeof value) => unknown) => Promise.resolve(value).then(resolve),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({data:false,error:null});
  mocks.profile.mockResolvedValue({ enabledModules: ["knowledge", "products", "orders", "workflows", "bookings", "staff"] });
});

it("rejects a user before reading another tenant's readiness", async () => {
  mocks.from.mockImplementation(() => chain(null));
  const { assessBusinessCapabilities } = await import("./assessment");
  await expect(assessBusinessCapabilities("tenant-b", { userId: "user-a" })).rejects.toThrow("Nuk ke qasje");
  expect(mocks.profile).not.toHaveBeenCalled();
});

it("reports missing configuration without exposing secrets", async () => {
  mocks.from.mockImplementation((table: string) => {
    if (table === "business_users") return chain({ business_id: "tenant-a" });
    if (table === "platform_admins") return chain(null);
    if (table === "knowledge_entries" || table === "products" || table === "booking_services") return chain(null, 0);
    if (table === "visual_workflows") return chain({ enabled: false, published_version_id: null });
    if (table === "business_calendar_settings") return chain({ agent_booking_enabled: false });
    return chain(null);
  });
  const { assessBusinessCapabilities, summarizeCapabilityAssessments } = await import("./assessment");
  const result = summarizeCapabilityAssessments(await assessBusinessCapabilities("tenant-a", { userId: "user-a" }));
  expect(result.find((item) => item.capabilityKey === "product.search")).toMatchObject({ status: "needs_setup" });
  expect(result.find((item) => item.capabilityKey === "booking.create")).toMatchObject({ status: "needs_setup" });
  expect(JSON.stringify(result)).not.toContain("ciphertext");
});

it("marks an unknown capability unsupported", async () => {
  mocks.from.mockImplementation((table: string) => table === "business_users" ? chain({ business_id: "tenant-a" }) : chain(null));
  const { assessCapability } = await import("./assessment");
  await expect(assessCapability("tenant-a", { userId: "user-a" }, "inventory.back_in_stock.notify")).resolves.toMatchObject({
    status: "unsupported",
    reasonCode: "unknown_capability",
  });
  expect(mocks.profile).not.toHaveBeenCalled();
});

it("scopes readiness reads to the authorized tenant and membership to the actor", async () => {
  const queries: { table: string; q: ReturnType<typeof chain> }[] = [];
  mocks.from.mockImplementation((table: string) => {
    const q = chain(table === "business_users" ? { business_id: "tenant-a" } : null, 1);
    queries.push({ table, q }); return q;
  });
  const { assessBusinessCapabilities } = await import("./assessment");
  await assessBusinessCapabilities("tenant-a", { userId: "user-a" });
  for (const { table, q } of queries) {
    if (table !== "platform_admins") expect(q.eq).toHaveBeenCalledWith("business_id", "tenant-a");
    if (["business_users", "platform_admins"].includes(table)) expect(q.eq).toHaveBeenCalledWith("user_id", "user-a");
  }
});
