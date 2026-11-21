import { createServiceSupabase } from "@/lib/supabase/service";
import { LEAD_STATUSES, type LeadStatus } from "./model";

/** Moves the conversation's lead to another status; the RPC rechecks membership and the business. */
export async function changeConversationLead(businessId: string, userId: string, conversationId: string, status: LeadStatus): Promise<{ error: string; success?: undefined } | { success: string; error?: undefined }> {
  if (!LEAD_STATUSES.includes(status) || !/^[0-9a-f-]{36}$/i.test(conversationId)) return { error: "Kërkesë e pavlefshme." };
  const { error } = await createServiceSupabase().rpc("set_conversation_lead", {
    p_business: businessId, p_user: userId, p_conversation: conversationId, p_status: status,
  });
  if (error) return { error: error.message.includes("not_found") ? "Biseda nuk u gjet. Rifresko faqen." : "Statusi nuk u ndryshua. Provo përsëri." };
  return { success: "Statusi u ndryshua." };
}
