import { it, expect, vi, beforeEach } from "vitest";
const auth = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: auth.user,
  requireBusinessAccess: auth.access,
}));
import { catalogAccess } from "./access";
beforeEach(() => vi.clearAllMocks());
it("rejects unauthenticated users", async () => {
  auth.user.mockResolvedValue(null);
  await expect(catalogAccess("a")).rejects.toThrow("unauthorized");
  expect(auth.access).not.toHaveBeenCalled();
});
it("rejects another tenant before reading documents", async () => {
  auth.user.mockResolvedValue({ id: "user" });
  auth.access.mockResolvedValue(null);
  await expect(catalogAccess("other")).rejects.toThrow("unauthorized");
});
it("accepts authorized members/admin through existing access policy", async () => {
  auth.user.mockResolvedValue({ id: "user" });
  auth.access.mockResolvedValue({ business: { id: "a", slug: "a" } });
  expect(await catalogAccess("a")).toMatchObject({ business: { id: "a" } });
});
