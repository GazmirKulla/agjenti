import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dashboardLanguage, translator } from "./core";
import { DashboardLanguageProvider, DashboardLanguageSwitch } from "@/components/dashboard/language";
import { ThreadClient } from "@/app/b/[slug]/inbox/[conversationId]/thread-client";
import { IntegrationCard } from "@/components/dashboard/integration-card";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { organizeWorkspace } from "@/lib/dashboard/navigation/workspace";

vi.mock("@/components/dashboard/integration-card.module.css", () => ({ default: {} }));
vi.mock("@/components/dashboard/workspace-navigation.module.css", () => ({ default: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
function render(language: "sq" | "en", child: React.ReactNode) {
  return renderToStaticMarkup(h(DashboardLanguageProvider, { language, children: child }));
}

describe("Scoped dashboard language", () => {
  it("defaults unsupported or missing preferences to Albanian", () => {
    expect(dashboardLanguage(undefined)).toBe("sq");
    expect(dashboardLanguage("de")).toBe("sq");
    expect(dashboardLanguage("en")).toBe("en");
    expect(translator("en")("External API detail")).toBe("External API detail");
  });
  it("translates manual chat controls and preserves customer content and channel", () => {
    const thread = h(ThreadClient, { userId: "synthetic-user", businessId: "test", conversationId: "thread", slug: "test", status: "paused", channel: "whatsapp", customerName: "Klienti", logs: [], messages: [{ id: "1", direction: "inbound", source: "customer", body: "Shkruaj një mesazh", media: null, created_at: "2026-10-12T10:00:00Z", delivery_status: null, delivery_error: null }] });
    const english = render("en", thread);
    expect(english).toContain("Resume AI agent");
    expect(english).toContain("Manual reply");
    expect(english).toContain("Message will be sent on");
    expect(english).toContain("WhatsApp");
    expect(english).toContain("<p>Shkruaj një mesazh</p>");
    expect(english).toContain("Klienti");
    expect(render("sq", thread)).toContain("Rifillo Agjentin AI");
  });
  it("translates connection actions without altering account identities or URLs", () => {
    const connected = render("en", h(IntegrationCard, { channel: "instagram", businessId: "b1", slug: "shop", status: "connected", identity: "@dyqani" }));
    expect(connected).toContain("@dyqani");
    expect(connected).toContain("Disconnect");
    const disconnected = render("en", h(IntegrationCard, { channel: "instagram", businessId: "b1", slug: "shop", status: "disconnected" }));
    expect(disconnected).toContain("Connect your business account");
    expect(disconnected).toContain("/api/instagram/oauth/start?businessId=b1");
  });
  it("translates the compact navigation and keeps manual business destinations intact", () => {
    const navigation = organizeWorkspace([
      { id: "services", path: "services", label: "Shërbimet", icon: "products" },
      { id: "catalogs", path: "catalogs", label: "Katalogët", icon: "catalogs" },
    ] as Parameters<typeof organizeWorkspace>[0]);
    const html = render("en", h(WorkspaceNavigation, { navigation, base: "/b/shop", pathname: "/b/shop/inbox", section: "conversations", onNavigate: () => {} }));
    expect(html).toContain("Conversations");
    expect(html).toContain("Business");
    expect(html).toContain("AI Assistant");
    expect(html).toContain("/b/shop/business");
    expect(html).not.toContain("/b/shop/services"); // Secondary destination, not a primary item.
    expect(navigation.search).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "services", label: "Shërbimet" }),
      expect.objectContaining({ path: "catalogs", label: "Katalogët" }),
    ]));
    expect(html).toContain("/b/shop/inbox");
  });
  it("exposes both language choices and identifies the selected language", () => {
    const html = render("en", h(DashboardLanguageSwitch));
    expect(html).toContain('lang="en" aria-pressed="true"');
    expect(html).toContain('lang="sq" aria-pressed="false"');
  });
});
