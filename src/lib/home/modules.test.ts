import { expect, it } from "vitest";
import { MODULE_IDS, type DashboardSignals } from "@/lib/dashboard/modules/types";
import { homeModuleSplit } from "./modules";

const all = [...MODULE_IDS];
const shop: DashboardSignals = { businessType: "retail", offeringTypes: ["standard"], selectedUseCases: ["orders"], agentCapabilities: [] };
const salon: DashboardSignals = { businessType: "beauty", offeringTypes: ["services"], selectedUseCases: ["booking"], agentCapabilities: [] };

it("highlights what the onboarding answers point to and lists the rest", () => {
  const { highlighted, others } = homeModuleSplit({ source: "generated", signals: shop, enabledModules: all, hiddenModules: [] }, new Set());
  expect(highlighted).toEqual(expect.arrayContaining(["products", "orders", "customers"]));
  expect(highlighted).not.toContain("bookings");
  expect(others).toEqual(expect.arrayContaining(["bookings", "services", "activity", "reports"]));
  expect([...highlighted, ...others].sort()).toEqual([...new Set([...highlighted, ...others])].sort());
});

it("differs by business: a salon gets services and bookings, not orders", () => {
  const { highlighted } = homeModuleSplit({ source: "generated", signals: salon, enabledModules: all }, new Set());
  expect(highlighted).toEqual(expect.arrayContaining(["services", "bookings", "calendar"]));
  expect(highlighted).not.toContain("orders");
});

it("always highlights a module that holds records, even when hidden in the menu", () => {
  const { highlighted } = homeModuleSplit({ source: "manual", enabledModules: all, hiddenModules: ["orders"] }, new Set(["orders"]));
  expect(highlighted).toContain("orders");
});

it("follows the owner's own menu when it was chosen by hand", () => {
  const hidden = all.filter((id) => id !== "leads" && id !== "customers");
  const { highlighted, others } = homeModuleSplit({ source: "manual", enabledModules: all, hiddenModules: hidden }, new Set());
  expect(highlighted).toEqual(["leads", "customers"]);
  expect(others).toContain("products");
});

it("never shows core pages or modules the business may not use", () => {
  const { highlighted, others } = homeModuleSplit({ source: "legacy", enabledModules: ["dashboard", "inbox", "products", "settings"] }, new Set(["orders"]));
  expect(highlighted).toEqual(["products"]);
  expect(others).toEqual([]);
});

it("keeps read-only pages out of the cards", () => {
  const { highlighted } = homeModuleSplit({ source: "manual", enabledModules: all, hiddenModules: [] }, new Set(["reports"]));
  expect(highlighted).not.toContain("reports");
  expect(highlighted).not.toContain("activity");
});
