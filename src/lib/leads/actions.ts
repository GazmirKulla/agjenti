"use server";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { cleanKeywords, FOLLOW_UP_CHOICES, type LeadStatus } from "./model";
import { changeLeadStatus } from "./status";

/** Any member of the business moves a lead to another status. */
export async function updateLeadStatus(slug: string, leadId: string, status: LeadStatus) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const result = await changeLeadStatus(access.business.id, user.id, leadId, status);
  if (result.success) revalidatePath(`/b/${access.business.slug}/leads`);
  return result;
}

/** Owner or platform administrator: which messages create a lead, and when it counts as waiting. */
export async function saveLeadSettings(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const hours = Number(formData.get("followUpHours"));
  const settings = {
    enabled: formData.get("enabled") === "on",
    price: formData.get("price") === "on",
    availability: formData.get("availability") === "on",
    contact: formData.get("contact") === "on",
    autoContacted: formData.get("autoContacted") === "on",
    keywords: cleanKeywords(String(formData.get("keywords") ?? "")),
    followUpHours: (FOLLOW_UP_CHOICES as readonly number[]).includes(hours) ? hours : 4,
  };
  const { error } = await createServiceSupabase().rpc("save_lead_settings", {
    p_business: access.business.id, p_user: user.id, p_settings: settings,
  });
  if (error) return { error: error.message.includes("unauthorized") ? "Vetëm pronari mund t'i ndryshojë rregullat." : "Rregullat nuk u ruajtën. Provo përsëri." };
  revalidatePath(`/b/${access.business.slug}/leads`);
  return { success: "Rregullat u ruajtën. Vlejnë për mesazhet e reja." };
}
