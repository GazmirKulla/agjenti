import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AssistantHistoryDrawer } from "./history-drawer";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { organizeWorkspace } from "@/lib/dashboard/navigation/workspace";
import { defaultAppearance, parseAppearance } from "./appearance";
vi.mock("./history-drawer.css", () => ({}));
vi.mock("@/components/dashboard/workspace-navigation.module.css", () => ({ default: {} }));

const props = { open: true, mobile: false, assistantName: "Aria", businessName: "Dyqani",
  busy: false, loading: false, warning: "", onClose: vi.fn(), onNew: vi.fn(), onSelect: vi.fn(),
  onRename: vi.fn(), onDelete: vi.fn(), threads: [] };
it("uses a generic default and preserves independently selected display names", () => {
  expect(defaultAppearance.name).toBe("Asistenti AI");
  for (const name of ["Migo", "Aria"]) expect(parseAppearance(JSON.stringify({ name, avatar: "mint" })).name).toBe(name);
});
it("renders private history within the workspace, with no second modal on desktop", () => {
  const html = renderToStaticMarkup(h(AssistantHistoryDrawer, props));
  expect(html).toContain('role="complementary"');
  expect(html).toContain("Bisedat me Aria");
  expect(html).toContain("Private · Dyqani");
  expect(html).not.toContain("<dialog");
  expect(html).not.toContain("Migo");
  expect(html).toContain("Historiku i klientëve mbetet te Bisedat");
});
it("distinguishes loading from empty state and exposes mobile modal semantics", () => {
  const html = renderToStaticMarkup(h(AssistantHistoryDrawer, { ...props, mobile: true, loading: true }));
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain("Historiku i klientëve mbetet te Bisedat");
});
it("highlights the selected conversation without exposing internal metadata", () => {
  const html = renderToStaticMarkup(h(AssistantHistoryDrawer, { ...props, selectedId: "internal-private-id", onMore: vi.fn(),
    threads: [{ id: "internal-private-id", title: "<script>Oferta</script>", revision: 87654321, plan_revision: 12345678,
      updated_at: "2026-10-20T10:00:00Z", pending_request: "private-request-id", pending_since: null }] }));
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("&lt;script&gt;");
  for (const secret of ["internal-private-id", "private-request-id", "87654321", "12345678", "<script>"]) expect(html).not.toContain(secret);
  expect(html).toContain("Më shumë biseda");
});
it.each(["Migo", "Aria", "Asistenti AI"])("uses the same neutral Home route with the personalized name %s", assistantName => {
  const html = renderToStaticMarkup(h(WorkspaceNavigation, { navigation: organizeWorkspace([]), base: "/b/shop",
    pathname: "/b/shop", section: "home", assistantName, onNavigate: vi.fn() }));
  expect(html).toContain(assistantName);
  expect(html).toContain('href="/b/shop"');
  expect(html).toContain('aria-current="page"');
});
