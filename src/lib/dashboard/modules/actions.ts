"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { toggleableModules } from "./registry";
import { showModuleFor } from "./show";
import { storeModules } from "@/lib/settings/store";

export async function saveModules(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  try {
    const result = await storeModules(access.business.id, user.id, toggleableModules.filter(id => formData.get(`module_${id}`) === "on"));
    if ("error" in result) return result;
    revalidatePath(`/b/${access.business.slug}`, "layout");
    return result;
  } catch {
    return { error: "Pamja nuk u ruajt. Rifresko faqen dhe provo përsëri." };
  }
}

/** Shows one hidden module (and the modules it needs) again in the menu. */
export async function showModule(slug: string, moduleId: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const result = await showModuleFor(user.id, access.business.id, moduleId);
  if (result.success) revalidatePath(`/b/${access.business.slug}`, "layout");
  return result;
}
