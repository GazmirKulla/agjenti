import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), load: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("../profile/service", () => ({ loadDashboardProfile: m.load, saveDashboardProfile: m.save }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { saveModules } from "./actions";
import { rebuildProfileFromModules } from "../profile/generate";
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "current-user" });
  m.access.mockResolvedValue({ business: { id: "tenant-a", slug: "canonical" } });
  m.load.mockResolvedValue(rebuildProfileFromModules(["products", "orders", "workflows"]));
});
it("reauthorizes the current session and refuses revoked membership without writing", async () => {
  m.access.mockResolvedValue(null);
  expect(await saveModules("old-page", new FormData())).toHaveProperty("error");
  expect(m.access).toHaveBeenCalledWith("current-user", "old-page");
  expect(m.load).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
});
it("refuses an expired session before resolving a tenant", async () => {
  m.user.mockResolvedValue(null);
  expect(await saveModules("shop", new FormData())).toHaveProperty("error");
  expect(m.access).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
});
it("uses authoritative membership and fresh profile, ignoring forged form identities", async () => {
  const form = new FormData(); form.set("businessId", "foreign"); form.set("userId", "old-user"); form.set("module_products", "on");
  expect(await saveModules("alias", form)).toHaveProperty("success");
  expect(m.load).toHaveBeenCalledWith("tenant-a");
  expect(m.save).toHaveBeenCalledWith("tenant-a", expect.objectContaining({ enabledModules: expect.arrayContaining(["products"]) }));
  expect(m.save.mock.calls[0][1].enabledModules).not.toContain("orders");
  expect(m.revalidate).toHaveBeenCalledWith("/b/canonical", "layout");
});
it("does not accept a direct request enabling a dependent module alone", async () => {
  const form = new FormData(); form.set("module_bookings", "on");
  expect(await saveModules("shop", form)).toHaveProperty("error"); expect(m.save).not.toHaveBeenCalled();
});
