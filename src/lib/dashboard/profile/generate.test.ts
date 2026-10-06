import { expect, it, describe } from "vitest";
import { generateDashboardProfile } from "./generate";
import { canEnableModule, normalizeEnabledModules } from "../modules/dependencies";
import { parseDashboardProfile } from "./service";
import { legacyDashboardProfile } from "./legacy";

describe("generateDashboardProfile", () => {
  it("enables service booking modules without products/orders", () => {
    const profile = generateDashboardProfile({
      businessType: "services",
      offeringTypes: ["services"],
      selectedUseCases: ["messages", "booking", "customers"],
      agentCapabilities: ["handle_bookings", "reply_messages", "answer_questions"],
      workflow: "appointment",
      teamSize: "2-5",
    });
    expect(profile.enabledModules).toContain("services");
    expect(profile.enabledModules).toContain("bookings");
    expect(profile.enabledModules).toContain("calendar");
    expect(profile.enabledModules).toContain("staff");
    expect(profile.enabledModules).not.toContain("products");
    expect(profile.enabledModules).not.toContain("orders");
    expect(profile.primaryActions[0]?.id).toBe("new_booking");
    expect(profile.widgets.some((w) => w.id === "bookings_today")).toBe(true);
  });

  it("enables ecommerce modules without calendar", () => {
    const profile = generateDashboardProfile({
      businessType: "ecommerce",
      offeringTypes: ["variants"],
      selectedUseCases: ["messages", "sales", "orders", "products"],
      agentCapabilities: [
        "recommend_products",
        "collect_order_details",
        "create_order",
      ],
      workflow: "product-orders",
      teamSize: "solo",
    });
    expect(profile.enabledModules).toContain("products");
    expect(profile.enabledModules).toContain("orders");
    expect(profile.enabledModules).toContain("workflows");
    expect(profile.enabledModules).not.toContain("bookings");
    expect(profile.enabledModules).not.toContain("calendar");
    expect(profile.primaryActions[0]?.id).toBe("add_product");
  });

  it("enables catalog/lead modules for B2B-style signals", () => {
    const profile = generateDashboardProfile({
      businessType: "other",
      offeringTypes: [],
      selectedUseCases: ["messages", "leads"],
      agentCapabilities: ["qualify_leads", "reply_messages"],
      workflow: "quote_request",
      teamSize: "solo",
    });
    expect(profile.enabledModules).toContain("catalogs");
    expect(profile.enabledModules).toContain("leads");
    expect(profile.enabledModules).not.toContain("products");
    expect(profile.enabledModules).not.toContain("orders");
    expect(profile.primaryActions.some((a) => a.id === "add_catalog")).toBe(
      true,
    );
  });

  it("keeps hybrid mixed offerings", () => {
    const profile = generateDashboardProfile({
      businessType: "beauty",
      offeringTypes: ["mixed"],
      selectedUseCases: ["messages", "booking", "sales", "orders"],
      agentCapabilities: [
        "handle_bookings",
        "recommend_products",
        "collect_order_details",
      ],
      workflow: "service-or-product-request",
      teamSize: "2-5",
    });
    expect(profile.enabledModules).toContain("products");
    expect(profile.enabledModules).toContain("services");
    expect(profile.enabledModules).toContain("bookings");
    expect(profile.enabledModules).toContain("orders");
  });
});

describe("module dependencies", () => {
  it("requires services before bookings", () => {
    expect(
      canEnableModule("bookings", new Set(["dashboard", "inbox"])).ok,
    ).toBe(false);
    expect(
      canEnableModule("bookings", new Set(["dashboard", "services"])).ok,
    ).toBe(true);
  });

  it("requires products before orders", () => {
    expect(canEnableModule("orders", new Set(["services"])).ok).toBe(false);
    expect(canEnableModule("orders", new Set(["products"])).ok).toBe(true);
  });

  it("drops invalid dependents when normalizing", () => {
    expect(
      normalizeEnabledModules(["products", "orders", "bookings", "calendar"]),
    ).toEqual(
      expect.arrayContaining(["products", "orders"]),
    );
    expect(
      normalizeEnabledModules(["products", "orders", "bookings", "calendar"]),
    ).not.toContain("bookings");
  });
});

describe("parseDashboardProfile", () => {
  it("falls back to null for empty payloads", () => {
    expect(parseDashboardProfile(null)).toBeNull();
    expect(parseDashboardProfile({})).toBeNull();
  });

  it("accepts legacy source", () => {
    expect(parseDashboardProfile(legacyDashboardProfile)?.source).toBe("legacy");
  });

  it("rebuilds manual profiles from enabled modules", () => {
    const parsed = parseDashboardProfile({
      version: 1,
      source: "manual",
      enabledModules: ["dashboard", "inbox", "services", "bookings", "agents", "instagram", "settings"],
    });
    expect(parsed?.enabledModules).toContain("bookings");
    expect(parsed?.navigationItems).toContain("services");
  });
});
