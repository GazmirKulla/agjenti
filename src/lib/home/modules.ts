import { moduleRegistry, navigationOrder } from "@/lib/dashboard/modules/registry";
import { generateDashboardProfile } from "@/lib/dashboard/profile/generate";
import { legacyDashboardProfile } from "@/lib/dashboard/profile/legacy";
import type { DashboardProfile, ModuleId } from "@/lib/dashboard/modules/types";

/** Pages that only read: listed under "all modules", never as a card. */
const READ_ONLY: readonly ModuleId[] = ["activity", "reports"];

/** Kreu: which modules suit this business, from what it said in onboarding
 * (structured answers, never conversation text) or, when the owner chose the
 * menu by hand, from that choice. The menu's hiding is a preference, so a
 * module that already holds the business's records is always highlighted. */
export function homeModuleSplit(
  profile: Pick<DashboardProfile, "source" | "signals" | "enabledModules" | "hiddenModules">,
  used: ReadonlySet<string>,
) {
  const allowed = new Set(profile.enabledModules);
  const suitable = new Set<ModuleId>(
    profile.source === "generated" && profile.signals
      ? generateDashboardProfile(profile.signals).enabledModules
      : profile.source === "legacy"
        ? legacyDashboardProfile.enabledModules
        : profile.enabledModules.filter((id) => !(profile.hiddenModules ?? []).includes(id)),
  );
  const listed = navigationOrder.filter((id) => allowed.has(id) && !moduleRegistry[id].core && !moduleRegistry[id].preview);
  const highlighted = listed.filter((id) => !READ_ONLY.includes(id) && (suitable.has(id) || used.has(id)));
  return { highlighted, others: listed.filter((id) => !highlighted.includes(id)) };
}
