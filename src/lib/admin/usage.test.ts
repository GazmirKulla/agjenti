import { describe, expect, it } from "vitest";
import { aggregateUsage, monthStart } from "./usage";

describe("platform usage statistics", () => {
  const data = aggregateUsage({
    monthStart: "2026-11-01",
    businesses: [
      { id: "b1", name: "Shop", slug: "shop", billing_user_id: "u1" },
      { id: "b2", name: "Cafe", slug: "cafe", billing_user_id: "u1" },
      { id: "b3", name: "Admin made", slug: "admin", billing_user_id: null },
    ],
    accounts: [{ user_id: "u1", plan: "starter" }],
    profiles: [{ id: "u1", email: "a@b.test", display_name: "Ana" }],
    messages: [{ business_id: "b1", used: 3 }, { business_id: "b2", used: "2" }, { business_id: "b3", used: 10 }],
    tokens: [
      { business_id: "b1", day: "2026-11-02", model: "m1", calls: 2, input_tokens: 100, output_tokens: 20 },
      { business_id: "b3", day: "2026-11-01", model: "m2", calls: 1, input_tokens: 50, output_tokens: 5 },
    ],
  });
  it("adds every business's messages and tokens to the user who pays", () => {
    expect(data.users).toEqual([expect.objectContaining({ userId: "u1", email: "a@b.test", plan: "starter", limit: 10_000, businesses: 2, messages: 5, tokens: 120, calls: 2 })]);
  });
  it("keeps ownerless businesses in the totals, not under a user", () => {
    expect(data.totals).toEqual({ messages: 15, tokens: 175, calls: 3, activeUsers: 1 });
    expect(data.businesses[0]).toMatchObject({ businessId: "b3", messages: 10 });
  });
  it("orders days by date and models by tokens", () => {
    expect(data.days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(data.models[0]).toMatchObject({ model: "m1", tokens: 120 });
  });
  it("uses the platform time zone for the month", () => {
    expect(monthStart(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01");
  });
});
