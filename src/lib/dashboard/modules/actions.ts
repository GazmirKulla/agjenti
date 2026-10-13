"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile, saveDashboardProfile } from "../profile/service";
import { rebuildProfileFromModules } from "../profile/generate";
import { canEnableModule } from "./dependencies";
import { moduleRegistry, toggleableModules } from "./registry";
import type { ModuleId } from "./types";

export async function saveModules(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const profile = await loadDashboardProfile(access.business.id);
  const selected = toggleableModules.filter(id => formData.get(`module_${id}`) === "on");
  const enabled = new Set<ModuleId>([...profile.enabledModules.filter(id => moduleRegistry[id].core), ...selected]);
  for (const id of selected) {
    const check = canEnableModule(id, enabled);
    if (!check.ok) return { error: check.reason };
  }
  await saveDashboardProfile(access.business.id, rebuildProfileFromModules([...enabled], profile.signals));
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "Modulet e hapësirës u përditësuan." };
}
