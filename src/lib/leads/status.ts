import { createServiceSupabase } from "@/lib/supabase/service";
import type { LeadStatus } from "./model";

export const leadStatuses: LeadStatus[] = ["new", "contacted", "won", "lost"];

/** Shared by the Leads page and the conversation panel; the RPC rechecks membership. */
export async function changeLeadStatus(businessId: string, userId: string, leadId: string, status: LeadStatus): Promise<{ error: string; success?: undefined } | { success: string; error?: undefined }> {
  if (!leadStatuses.includes(status) || !/^[0-9a-f-]{36}$/i.test(leadId)) return { error: "Kërkesë e pavlefshme." };
  const { error } = await createServiceSupabase().rpc("manage_lead", {
    p_business: businessId, p_user: userId, p_lead: leadId, p_status: status,
  });
  if (error) {
    if (error.message.includes("lead_open_exists")) return { error: "Ky klient ka tashmë një lead të hapur." };
    if (error.message.includes("not_found")) return { error: "Lead-i nuk u gjet. Rifresko faqen." };
    return { error: "Statusi nuk u ndryshua. Provo përsëri." };
  }
  return { success: "Statusi u ndryshua." };
}
