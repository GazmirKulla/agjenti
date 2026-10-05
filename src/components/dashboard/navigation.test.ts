import { expect, it } from "vitest";
import {
  isDashboardRoute,
  mobileBusinessNav,
  mobileAdminNav,
} from "./navigation";
it("selects only the actual tab and its descendants", () => {
  expect(isDashboardRoute("/b/demo", "/b/demo", "")).toBe(true);
  expect(isDashboardRoute("/b/demo/inbox/123", "/b/demo", "inbox")).toBe(true);
  expect(isDashboardRoute("/b/demo/inbox-other", "/b/demo", "inbox")).toBe(
    false,
  );
  expect(isDashboardRoute("/b/demo/products", "/b/demo", "")).toBe(false);
  expect(isDashboardRoute("/b/other/inbox", "/b/demo", "inbox")).toBe(false);
});
it("keeps four principal tabs per role with secondary configuration in the drawer", () => {
  expect(mobileBusinessNav.map(([path]) => path)).toEqual([
    "",
    "inbox",
    "products",
    "orders",
  ]);
  expect(mobileAdminNav.map(([path]) => path)).toEqual([
    "",
    "businesses",
    "conversations",
    "app",
  ]);
});
