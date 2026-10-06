import type { DashboardStats } from "@/lib/dashboard/stats";
import type { DashboardProfile, DashboardWidget } from "../modules/types";

export type ResolvedWidget = DashboardWidget & { value: number };

export function resolveWidgets(
  profile: DashboardProfile,
  stats: DashboardStats,
  options?: { business?: boolean },
): ResolvedWidget[] {
  const business = options?.business !== false;
  return profile.widgets.map((widget) => {
    let value = 0;
    switch (widget.stat) {
      case "conversations":
        value = stats.conversations;
        break;
      case "orders":
        value = stats.orders;
        break;
      case "customers":
        value = stats.customers;
        break;
      case "connections":
        value = stats.connections;
        break;
      case "agents":
        value = stats.agents;
        break;
      case "paused":
        value = stats.paused;
        break;
      default:
        value = 0;
    }
    if (!business && widget.id === "conversations") {
      return {
        ...widget,
        label: "Biznese",
        icon: "businesses",
        value: stats.totalBusinesses,
      };
    }
    if (!business && widget.stat === "customers") {
      return {
        ...widget,
        label: "Biseda",
        icon: "inbox",
        value: stats.conversations,
      };
    }
    return { ...widget, value };
  });
}
