import { expect, it } from "vitest";
import { isDashboardRoute } from "./navigation";
import { buildNavigationItems, buildAdminNavigation } from "@/lib/dashboard/navigation/builder";
import { legacyDashboardProfile } from "@/lib/dashboard/profile/legacy";
import { generateDashboardProfile } from "@/lib/dashboard/profile/generate";

it("selects only the actual tab and its descendants", () => {
  expect(isDashboardRoute("/b/demo", "/b/demo", "")).toBe(true);
  expect(isDashboardRoute("/b/demo/inbox/123", "/b/demo", "inbox")).toBe(true);
  expect(isDashboardRoute("/b/demo/inbox-other", "/b/demo", "inbox")).toBe(
    false,
  );
  expect(isDashboardRoute("/b/demo/products", "/b/demo", "")).toBe(false);
  expect(isDashboardRoute("/b/other/inbox", "/b/demo", "inbox")).toBe(false);
});

it("keeps four principal tabs for legacy mobile nav", () => {
  const mobile = buildNavigationItems(legacyDashboardProfile, "mobile");
  expect(mobile.map((item) => item.path)).toEqual([
    "",
    "inbox",
    "products",
    "orders",
  ]);
});

it("keeps four principal tabs for admin mobile nav", () => {
  expect(buildAdminNavigation("mobile").map((item) => item.path)).toEqual([
    "",
    "businesses",
    "conversations",
    "app",
  ]);
});

it("adapts mobile tabs for a service booking business", () => {
  const profile = generateDashboardProfile({
    businessType: "services",
    offeringTypes: ["services"],
    selectedUseCases: ["messages", "booking", "customers"],
    agentCapabilities: ["handle_bookings", "reply_messages"],
    workflow: "appointment",
    teamSize: "2-5",
  });
  const mobile = buildNavigationItems(profile, "mobile");
  expect(mobile.map((item) => item.path)).toContain("");
  expect(mobile.map((item) => item.path)).toContain("inbox");
  expect(mobile.some((item) => item.path === "products")).toBe(false);
  expect(mobile.some((item) => ["services", "bookings"].includes(item.path))).toBe(
    true,
  );
});
