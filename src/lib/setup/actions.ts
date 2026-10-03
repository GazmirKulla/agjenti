"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadSetupStatus } from "./status";
import { isReady } from "./model";
export async function launchBusiness(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Hyr në llogari për të vazhduar." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  const mode = form.get("mode");
  if (mode !== "automatic" && mode !== "manual")
    return { error: "Zgjidh mënyrën e përdorimit." };
  const status = await loadSetupStatus(access.business.id);
  if (!isReady(status))
    return {
      error: "Përfundo pesë hapat dhe lidh Instagram-in përpara se të fillosh.",
    };
  const { error } = await createServiceSupabase().rpc("launch_business", {
    p_business_id: access.business.id,
    p_automatic: mode === "automatic",
  });
  if (error)
    return {
      error:
        "Konfigurimi ndryshoi ose nuk u ruajt. Rifresko dhe kontrollo hapat.",
    };
  revalidatePath(`/b/${slug}`, "layout");
  return {
    success:
      mode === "automatic"
        ? "Përgjigjet automatike u aktivizuan."
        : "Hapësira është gati. Përgjigjet mbeten manuale.",
  };
}

/** @deprecated Use updateProduct from @/lib/products/actions */
export { updateProduct as saveProductSetup } from "@/lib/products/actions";
