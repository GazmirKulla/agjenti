import { moduleRegistry } from "../modules/registry";
import type { DashboardProfile, ModuleId } from "../modules/types";

export type NavItem = {
  id: ModuleId | "chat-lab" | "pricing" | "actions" | "users" | "usage" | "prompts" | "flows";
  path: string;
  label: string;
  icon: string;
  /** The business's own name for this section (e.g. "Listimet"); wins over presentation labels. */
  custom?: true;
};

export function buildNavigationItems(
  profile: DashboardProfile,
  variant: "desktop" | "mobile" = "desktop",
  labels: Partial<Record<ModuleId, string>> = {},
): NavItem[] {
  const ids =
    variant === "mobile"
      ? profile.mobileNavigationItems
      : profile.navigationItems;
  return ids.map((id) => {
    const mod = moduleRegistry[id];
    return {
      id,
      path: mod.path,
      label: labels[id] ?? (variant === "mobile" && id === "dashboard" ? "Kreu" : mod.label),
      icon: mod.icon,
      ...(labels[id] ? { custom: true as const } : {}),
    };
  });
}

export function buildAdminNavigation(variant: "desktop" | "mobile" = "desktop"): NavItem[] {
  if (variant === "mobile") {
    return [
      { id: "dashboard", path: "", label: "Kreu", icon: "dashboard" },
      { id: "customers", path: "businesses", label: "Bizneset", icon: "businesses" },
    { id: "users", path: "users", label: "Përdoruesit", icon: "customers" },
    { id: "usage", path: "usage", label: "Statistikat", icon: "billing" },
      { id: "inbox", path: "conversations", label: "Integrime", icon: "inbox" },
      { id: "pricing", path: "pricing", label: "Çmimet", icon: "billing" },
    { id: "actions", path: "actions", label: "Modulet dhe aftësitë", icon: "spark" },
      { id: "settings", path: "settings", label: "Cilësimet", icon: "settings" },
    ];
  }
  return [
    { id: "dashboard", path: "", label: "Dashboard", icon: "dashboard" },
    { id: "customers", path: "businesses", label: "Bizneset", icon: "businesses" },
    { id: "users", path: "users", label: "Përdoruesit", icon: "customers" },
    { id: "usage", path: "usage", label: "Statistikat", icon: "billing" },
    { id: "products", path: "product-types", label: "Llojet", icon: "products" },
    { id: "inbox", path: "conversations", label: "Integrime", icon: "inbox" },
    { id: "pricing", path: "pricing", label: "Çmimet", icon: "billing" },
    { id: "actions", path: "actions", label: "Modulet dhe aftësitë", icon: "spark" },
    { id: "chat-lab", path: "chat-lab", label: "Chat Lab", icon: "spark" },
    { id: "prompts", path: "prompts", label: "Promptet", icon: "knowledge" },
    { id: "flows", path: "flows", label: "Rrjedhat", icon: "workflows" },
    { id: "agents", path: "onboarding", label: "Onboarding", icon: "spark" },
    { id: "settings", path: "settings", label: "Cilësimet", icon: "settings" },
  ];
}
