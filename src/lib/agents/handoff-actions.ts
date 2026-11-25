"use server";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { prepareCommunicationConfiguration, saveCommunicationConfiguration } from "./communication-configuration";

/**
 * Çfarë bën Agjenti: what the agent tells the customer when it hands the conversation to staff. It goes
 * through the same versioned path as Komunikimi (a draft, then its publication), so it is recorded as a new
 * version. Refused while Komunikimi holds other unpublished changes, which publishing would carry with it.
 */
export async function saveHandoffMessage(slug: string, message: string, seenUpdatedAt: string) {
  try {
    const user = await getSessionUser();
    const access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
    if (typeof message !== "string") return { error: "Mesazhi nuk është i vlefshëm." };
    const businessId = access.business.id;
    const { data: agent, error } = await createServiceSupabase().from("ai_agents").select("id,updated_at")
      .eq("business_id", businessId).eq("is_active", true).maybeSingle();
    if (error || !agent) return { error: "Agjenti aktiv nuk u gjet. Krijoje ose aktivizoje te Udhëzimet." };
    if (agent.updated_at !== seenUpdatedAt) return { error: "Konfigurimi i Agjentit ndryshoi. Rifresko faqen përpara ruajtjes." };
    const result = await saveCommunicationConfiguration(businessId, user.id,
      await prepareCommunicationConfiguration(businessId, { id: agent.id, mode: "apply", communication: { handoffMessage: message } }));
    revalidatePath(`/b/${slug}/agents`);
    revalidatePath(`/b/${slug}`, "layout");
    return { success: message.trim() ? `Mesazhi u ruajt. ${result.message}` : `U kthye mesazhi i zakonshëm. ${result.message}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Mesazhi nuk u ruajt." };
  }
}
