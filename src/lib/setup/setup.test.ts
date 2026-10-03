import { beforeEach, expect, it, vi } from "vitest";
import { isReady, setupSteps, type SetupStatus } from "./model";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  status: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: m.user,
  requireBusinessAccess: m.access,
}));
vi.mock("@/lib/setup/status", () => ({ loadSetupStatus: m.status }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    rpc: m.rpc,
    from: () => ({ upsert: m.upsert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { launchBusiness } from "./actions";
import { recordSetupTest } from "./record-test";
const ready: SetupStatus = {
  available: true,
  connected: true,
  productCount: 2,
  usableProducts: 2,
  unconfiguredProducts: 0,
  agentReady: true,
  signature: "signature",
  tested: true,
  launched: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "owner" });
  m.access.mockResolvedValue({ business: { id: "business-a" } });
  m.status.mockResolvedValue(ready);
  m.rpc.mockResolvedValue({ error: null });
  m.upsert.mockResolvedValue({ error: null });
});
it("always guides in the same five-step order and never includes customers or orders", () => {
  expect(setupSteps(ready).map((s) => s.key)).toEqual([
    "instagram",
    "products",
    "agents",
    "workflows",
    "test",
  ]);
  expect(isReady(ready)).toBe(true);
  for (const partial of [
    { connected: false },
    { usableProducts: 0 },
    { productCount: 0 },
    { unconfiguredProducts: 1 },
    { agentReady: false },
    { tested: false },
    { available: false },
  ])
    expect(isReady({ ...ready, ...partial })).toBe(false);
});
it("authorizes launch before touching a business", async () => {
  m.user.mockResolvedValue(null);
  expect((await launchBusiness("shop", new FormData())).error).toBeTruthy();
  m.user.mockResolvedValue({ id: "other" });
  m.access.mockResolvedValue(null);
  expect((await launchBusiness("shop", new FormData())).error).toBeTruthy();
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.status).not.toHaveBeenCalled();
});
it.each(["manual", "automatic"])(
  "launches %s with verified business scope",
  async (mode) => {
    const form = new FormData();
    form.set("mode", mode);
    form.set("business_id", "forged");
    expect((await launchBusiness("shop", form)).success).toBeTruthy();
    expect(m.rpc).toHaveBeenCalledWith("launch_business", {
      p_business_id: "business-a",
      p_automatic: mode === "automatic",
    });
  },
);
it("requires Instagram even when every other step and the test are complete", async () => {
  m.status.mockResolvedValue({ ...ready, connected: false });
  const f = new FormData();
  f.set("mode", "automatic");
  expect((await launchBusiness("shop", f)).error).toBeTruthy();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("reports concurrent launch failure instead of success", async () => {
  m.rpc.mockResolvedValue({ error: { message: "Setup incomplete" } });
  const f = new FormData();
  f.set("mode", "manual");
  expect((await launchBusiness("shop", f)).error).toBeTruthy();
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("records only matching configuration signatures, without overwriting launch metadata", async () => {
  expect(await recordSetupTest("business-a", "old")).toBe(false);
  expect(m.upsert).not.toHaveBeenCalled();
  expect(await recordSetupTest("business-a", "signature")).toBe(true);
  expect(m.upsert).toHaveBeenCalledWith({
    business_id: "business-a",
    tested_signature: "signature",
    tested_at: expect.any(String),
  });
});
