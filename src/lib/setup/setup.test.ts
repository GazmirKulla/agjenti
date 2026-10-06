import { beforeEach, expect, it, vi } from "vitest";
import {
  isReady,
  setupGateMessage,
  setupSteps,
  type SetupStatus,
} from "./model";
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
  const result = await launchBusiness("shop", f);
  expect(result.error).toMatch(/Instagram/);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("names the first incomplete setup step in the gate message", () => {
  expect(setupGateMessage(ready)).toBeNull();
  expect(setupGateMessage({ ...ready, connected: false })).toMatch(/Instagram/);
  expect(setupGateMessage({ ...ready, usableProducts: 0 })).toMatch(/produkt/);
  expect(setupGateMessage({ ...ready, tested: false })).toMatch(/provën/i);
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
  expect(m.upsert).toHaveBeenCalledWith(
    {
      business_id: "business-a",
      tested_signature: "signature",
      tested_at: expect.any(String),
    },
    { onConflict: "business_id" },
  );
});
it("allows catalog/service-only workspaces without artificial products or order workflows", () => {
  for (const extra of [{ catalogCount: 1 }, { serviceCount: 1 }]) {
    const s = { ...ready, productCount: 0, usableProducts: 0, ...extra };
    expect(setupSteps(s).map((step) => step.key)).toEqual([
      "instagram",
      "products",
      "agents",
      "test",
    ]);
    expect(isReady(s)).toBe(true);
    expect(isReady({ ...s, tested: false })).toBe(false);
  }
  expect(isReady({ ...ready, catalogCount: 1, unconfiguredProducts: 1 })).toBe(
    false,
  );
});
