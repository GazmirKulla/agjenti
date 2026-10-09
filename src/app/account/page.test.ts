import { beforeEach, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  user: vi.fn(), memberships: vi.fn(), admin: vi.fn(), business: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: access.user,
  listMemberships: access.memberships,
  isPlatformAdmin: access.admin,
  requireBusinessAccess: access.business,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock("@/components/account/details", () => ({ AccountDetails: () => null }));
import AccountPage from "./page";
import AdminAccountPage from "../admin/account/page";
import BusinessAccountPage from "../b/[slug]/account/page";

beforeEach(() => {
  vi.resetAllMocks();
  access.user.mockResolvedValue({ id: "user-1" });
  access.memberships.mockResolvedValue({ admin: false, businesses: [{ slug: "demo" }] });
});

it("routes the old account address into the user's business panel", async () => {
  await expect(AccountPage()).rejects.toThrow("redirect:/b/demo/account");
});

it("routes platform administrators into the admin panel", async () => {
  access.memberships.mockResolvedValue({ admin: true, businesses: [{ slug: "demo" }] });
  await expect(AccountPage()).rejects.toThrow("redirect:/admin/account");
});

it("requires sign-in at the old account address", async () => {
  access.user.mockResolvedValue(null);
  await expect(AccountPage()).rejects.toThrow("redirect:/login");
});

it("keeps account details accessible before the first business is created", async () => {
  access.memberships.mockResolvedValue({ admin: false, businesses: [] });
  expect(await AccountPage()).toBeTruthy();
});

it("rejects business panel access without membership", async () => {
  access.business.mockResolvedValue(null);
  await expect(BusinessAccountPage({ params: Promise.resolve({ slug: "another-business" }) }))
    .rejects.toThrow("redirect:/auth/continue");
  expect(access.business).toHaveBeenCalledWith("user-1", "another-business");
});

it("rejects the admin account panel for non-admin users", async () => {
  access.admin.mockResolvedValue(false);
  await expect(AdminAccountPage()).rejects.toThrow("redirect:/auth/continue");
});
