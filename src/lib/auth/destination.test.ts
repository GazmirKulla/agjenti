import { describe, expect, it } from "vitest";
import { homeForAccess } from "./destination";
describe("role destination", () => {
  it("sends admins directly to platform even with businesses", () =>
    expect(homeForAccess({ admin: true, businesses: [{ slug: "zana" }] })).toBe(
      "/admin",
    ));
  it("sends members to their assigned business", () =>
    expect(homeForAccess({ admin: false, businesses: [{ slug: "own" }] })).toBe(
      "/b/own",
    ));
  it("does not expose a business to unassigned users", () =>
    expect(homeForAccess({ admin: false, businesses: [] })).toBe(
      "/onboarding",
    ));
});
