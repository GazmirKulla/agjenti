"use server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadAllowedModules } from "./entitlements";
import { loadDashboardProfile } from "../profile/service";
import { rebuildProfileFromModules } from "../profile/generate";
import { canEnableModule } from "./dependencies";
import { moduleRegistry, toggleableModules } from "./registry";
import type { ModuleId } from "./types";

export async function saveModules(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  try {
    const [profile, permitted] = await Promise.all([
      loadDashboardProfile(access.business.id),
      loadAllowedModules(access.business.id),
    ]);
    const selected = toggleableModules.filter(id => formData.get(`module_${id}`) === "on");
    const allowed = new Set(permitted);
    if (selected.some(id => !allowed.has(id)))
      return { error: "Një modul nuk lejohet nga administratori. Rifresko faqen." };
    const enabled = new Set<ModuleId>([
      ...profile.enabledModules.filter(id => moduleRegistry[id].core), ...selected,
    ]);
    for (const id of selected) {
      const check = canEnableModule(id, enabled);
      if (!check.ok) return { error: check.reason };
    }
    const { error } = await createServiceSupabase().rpc("save_business_modules", {
      p_business: access.business.id,
      p_user: user.id,
      p_profile: rebuildProfileFromModules([...enabled], profile.signals),
    });
    if (error) return { error: "Modulet nuk u ruajtën. Vetëm pronari ose administratori mund t’i ndryshojë; kontrollo edhe lejet aktuale." };
    revalidatePath(`/b/${access.business.slug}`, "layout");
    return { success: "Modulet e hapësirës u përditësuan." };
  } catch {
    return { error: "Modulet nuk u ruajtën. Rifresko faqen dhe provo përsëri." };
  }
}
