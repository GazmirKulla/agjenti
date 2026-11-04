import { requireActionAccess } from "@/lib/actions/access";
import type { CommandActor } from "@/lib/actions/command-actor";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { parseService } from "./model";
export async function saveBusinessService(actor: CommandActor, form: FormData) {
  try {
    const user = { id: actor.userId }, access = { business: actor.business };
    const profile = await loadDashboardProfile(access.business.id);
    if (!profile.enabledModules.includes("services"))
      throw new Error("Nuk u verifikua qasja te shërbimet. Rifresko faqen dhe provo përsëri.");
    const id = String(form.get("id") ?? ""),
      updatedAt = String(form.get("updatedAt") ?? "");
    if (!id) await requireActionAccess(access.business.id,user!.id,"service.create");
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
    return { success: "Shërbimi u ruajt." };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Shërbimi nuk u ruajt.",
    };
  }
}
