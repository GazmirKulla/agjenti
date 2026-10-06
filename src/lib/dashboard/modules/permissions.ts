import type { DashboardProfile, ModuleId } from "./types";
import { loadDashboardProfile } from "../profile/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { redirect } from "next/navigation";

export function isModuleEnabled(
  profile: DashboardProfile,
  moduleId: ModuleId,
): boolean {
  return profile.enabledModules.includes(moduleId);
}

export async function requireEnabledModule(slug: string, moduleId: ModuleId) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const profile = await loadDashboardProfile(access.business.id);
  if (!isModuleEnabled(profile, moduleId)) redirect(`/b/${slug}`);
  return { user, access, profile };
}
