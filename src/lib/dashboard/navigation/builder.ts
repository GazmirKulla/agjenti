import { moduleRegistry } from "../modules/registry";
import type { DashboardProfile, ModuleId } from "../modules/types";

export type NavItem = {
  id: ModuleId | "chat-lab" | "pricing" | "actions";
  path: string;
  label: string;
  icon: string;
};

export function buildNavigationItems(
  profile: DashboardProfile,
  variant: "desktop" | "mobile" = "desktop",
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
      label: variant === "mobile" && id === "dashboard" ? "Kreu" : mod.label,
      icon: mod.icon,
    };
  });
}

export function buildAdminNavigation(variant: "desktop" | "mobile" = "desktop"): NavItem[] {
  if (variant === "mobile") {
    return [
      { id: "dashboard", path: "", label: "Kreu", icon: "dashboard" },
      { id: "customers", path: "businesses", label: "Bizneset", icon: "businesses" },
      { id: "inbox", path: "conversations", label: "Integrime", icon: "inbox" },
      { id: "pricing", path: "pricing", label: "Çmimet", icon: "billing" },
    { id: "actions", path: "actions", label: "Modulet dhe aftësitë", icon: "spark" },
      { id: "settings", path: "app", label: "App", icon: "settings" },
    ];
  }
  return [
    { id: "dashboard", path: "", label: "Dashboard", icon: "dashboard" },
    { id: "customers", path: "businesses", label: "Bizneset", icon: "businesses" },
    { id: "products", path: "product-types", label: "Llojet", icon: "products" },
    { id: "inbox", path: "conversations", label: "Integrime", icon: "inbox" },
    { id: "pricing", path: "pricing", label: "Çmimet", icon: "billing" },
    { id: "actions", path: "actions", label: "Modulet dhe aftësitë", icon: "spark" },
    { id: "chat-lab", path: "chat-lab", label: "Chat Lab", icon: "spark" },
    { id: "agents", path: "onboarding", label: "Onboarding", icon: "spark" },
    { id: "settings", path: "app", label: "App", icon: "settings" },
  ];
}
