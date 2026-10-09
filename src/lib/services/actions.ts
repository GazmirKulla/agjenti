"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { parseService } from "./model";
export async function saveBusinessService(slug: string, form: FormData) {
  try {
    const user = await getSessionUser(),
      access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!access) throw new Error("Nuk ke qasje në këtë biznes.");
    const profile = await loadDashboardProfile(access.business.id);
    if (!profile.enabledModules.includes("services"))
      throw new Error("Aktivizo Shërbimet te Cilësimet → Modulet.");
    const id = String(form.get("id") ?? ""),
      updatedAt = String(form.get("updatedAt") ?? "");
    if (id && (!uuid(id) || !updatedAt))
      throw new Error("Rifresko shërbimin para ruajtjes.");
    const values = parseService(form),
      db = createServiceSupabase();
    if (id) {
      const result = await db
        .from("booking_services")
        .update(values)
        .eq("business_id", access.business.id)
        .eq("id", id)
        .eq("updated_at", updatedAt)
        .select("id")
        .maybeSingle();
      if (result.error) throw new Error("Shërbimi nuk u ruajt. Provo përsëri.");
      if (!result.data)
        throw new Error("Shërbimi ndryshoi. Rifresko faqen para ruajtjes.");
    } else
      await db
        .from("booking_services")
        .insert({ business_id: access.business.id, ...values })
        .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Shërbimi u ruajt." };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Shërbimi nuk u ruajt.",
    };
  }
}
