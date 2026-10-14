import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), memberships: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, listMemberships: m.memberships }));
import { GET } from "./route";
const request = () => GET(new Request("https://agjenti.app/auth/mobile/continue"));
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "user" }); });
it("keeps the mobile destination through password login", async () => {
  m.user.mockResolvedValue(null);
  expect((await request()).headers.get("location")).toBe("https://agjenti.app/login?next=/auth/mobile/continue");
  expect(m.memberships).not.toHaveBeenCalled();
});
it("opens the assistant for an accessible business even for platform admins", async () => {
  m.memberships.mockResolvedValue({ admin: true, businesses: [{ slug: "shop" }] });
  expect((await request()).headers.get("location")).toBe("https://agjenti.app/b/shop");
});
it("does not invent business access for unassigned users", async () => {
  m.memberships.mockResolvedValue({ admin: false, businesses: [] });
  expect((await request()).headers.get("location")).toBe("https://agjenti.app/onboarding");
});
