import { createServiceSupabase } from "@/lib/supabase/service";
import { loadDashboardProfile } from "../profile/service";
import { rebuildProfileFromModules } from "../profile/generate";
import { moduleRegistry, toggleableModules } from "./registry";
import { withRequiredModules } from "./visibility";
import type { ModuleId } from "./types";

/** Shows one hidden module (and the modules it needs) in a business's menu.
 * The database function allows only owners and platform administrators. */
export async function showModuleFor(userId: string, businessId: string, moduleId: string): Promise<{ error?: string; success?: string }> {
  if (!toggleableModules.includes(moduleId as ModuleId)) return { error: "Ky seksion nuk mund të ndryshohet." };
  try {
    const profile = await loadDashboardProfile(businessId);
    const show = new Set(withRequiredModules(moduleId as ModuleId));
    const hidden = (profile.hiddenModules ?? []).filter((id) => !show.has(id));
    const visible = profile.enabledModules.filter((id) => !hidden.includes(id));
    const preferences = { ...rebuildProfileFromModules(visible, profile.signals), enabledModules: visible, hiddenModules: hidden };
    const { error } = await createServiceSupabase().rpc("save_business_modules", {
      p_business: businessId, p_user: userId, p_profile: preferences,
    });
    if (error) return { error: "Seksioni nuk u shfaq. Vetëm pronari ose administratori mund ta ndryshojë." };
    return { success: `Seksioni “${moduleRegistry[moduleId as ModuleId].label}” shfaqet tani në menu.` };
  } catch {
    return { error: "Seksioni nuk u shfaq. Rifresko dhe provo përsëri." };
  }
}
