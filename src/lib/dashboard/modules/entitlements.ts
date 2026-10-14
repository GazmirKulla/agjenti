import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { MODULE_IDS, type ModuleId } from "./types";

export const loadAllowedModules = cache(async (businessId: string): Promise<ModuleId[]> => {
  const { data, error } = await createServiceSupabase().rpc("allowed_business_modules", { p_business: businessId });
  if (error || !Array.isArray(data)) throw new Error("Nuk u verifikuan lejet e moduleve. Provo përsëri.");
  return MODULE_IDS.filter(id => data.includes(id));
});

export async function requireModuleAllowed(businessId: string, moduleId: ModuleId) {
  if (!(await loadAllowedModules(businessId)).includes(moduleId))
    throw new Error("Ky modul nuk lejohet për këtë biznes.");
}
