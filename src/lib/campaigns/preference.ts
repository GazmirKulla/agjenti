import { confirmMarketingWithdrawal } from "./confirmation";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { prompt } from "@/lib/ai/prompts/files";
import { createServiceSupabase } from "@/lib/supabase/service";
import { attributeAiUsage } from "@/lib/ai/usage";

type Message = { id: string; body: string | null; direction: string; source: string };
export type PreferenceDecision = { messageId: string; conversationId: string; decision: "subscribe" | "unsubscribe" | "unchanged" | "ambiguous"; evidence: string | null; referenceMessageId: string | null; hasOtherRequest: boolean };
export function validatePreference(raw: unknown, message: Message, conversationId: string, history: Message[]): PreferenceDecision {
  const v = raw as PreferenceDecision;
  if (!v || typeof v.hasOtherRequest !== "boolean" || v.messageId !== message.id || v.conversationId !== conversationId || !["subscribe", "unsubscribe", "unchanged", "ambiguous"].some(x => x === v.decision)) throw new Error("invalid_preference");
  if (v.referenceMessageId !== null && !history.some(m => m.id === v.referenceMessageId && m.direction === "outbound")) throw new Error("invalid_reference");
  if (v.decision === "subscribe" || v.decision === "unsubscribe") {
    // Exact quotation verification, not semantic matching or a phrase dictionary.
    if (typeof v.evidence !== "string" || !v.evidence.trim() || (message.body ?? "").indexOf(v.evidence) < 0) throw new Error("invalid_evidence");
  } else if (v.evidence !== null) throw new Error("invalid_evidence");
  return v;
}
export async function reviewMarketingPreference(businessId: string, messageId: string) {
  const db = createServiceSupabase();
  const settings = await db.from("marketing_settings").select("enabled").eq("business_id", businessId).maybeSingle();
  // Rolling deployment: absence of the new schema must not break existing replies.
  if (settings.error?.code === "42P01" || settings.error?.code === "PGRST205") return;
  if (settings.error) throw new Error("marketing_settings_unavailable");
  if (!settings.data) return;
  const read = await db.from("messages").select("id,body,direction,source,conversation_id,created_at").eq("business_id", businessId).eq("id", messageId).eq("direction", "inbound").eq("source", "customer").not("marketing_inbound_at", "is", null).single();
  if (read.error || !read.data) throw new Error("marketing_message_unavailable");
  const message = read.data;
  const history = await db.from("messages").select("id,body,direction,source").eq("business_id", businessId).eq("conversation_id", message.conversation_id).or("direction.eq.inbound,and(direction.eq.outbound,delivery_status.in.(sent,delivered,read))").lt("created_at", message.created_at).order("created_at", { ascending: false }).limit(12);
  let decision: PreferenceDecision | null = null;
  try {
    if (history.error || !process.env.OPENAI_API_KEY || !message.body || message.body.length > 12000) throw new Error("classification_unavailable");
    attributeAiUsage(businessId);
    const response = await new OpenAI({ timeout: 8000, maxRetries: 0 }).responses.create({ model: modelFor("utility"), store: false, max_output_tokens: 600,
      instructions: prompt("campaigns/preference"), input: JSON.stringify({ message, history: history.data.slice().reverse() }),
      text: { format: { type: "json_schema", name: "marketing_preference", strict: true, schema: { type: "object", additionalProperties: false,
        required: ["messageId", "conversationId", "decision", "evidence", "referenceMessageId", "hasOtherRequest"], properties: {
          hasOtherRequest: { type: "boolean" }, messageId: { type: "string" }, conversationId: { type: "string" }, decision: { type: "string", enum: ["subscribe", "unsubscribe", "unchanged", "ambiguous"] }, evidence: { type: ["string", "null"] }, referenceMessageId: { type: ["string", "null"] },
        } } } },
    });
    if (response.status !== "completed") throw new Error("classification_unavailable");
    decision = validatePreference(JSON.parse(response.output_text), message, message.conversation_id, history.data);
  } catch { /* Keep promotional sends held. No language fallback and no implicit consent. */ }
  const saved = await db.rpc("review_marketing_preference", { p_business: businessId, p_message: messageId, p_decision: decision?.decision ?? "unavailable", p_evidence: decision?.evidence ?? null, p_reference: decision?.referenceMessageId ?? null });
  if (saved.error) throw new Error("marketing_preference_unavailable");
  // A prior queue attempt may have stored the decision but not started the acknowledgement.
  await confirmMarketingWithdrawal(businessId, messageId).catch(() => console.error("[campaigns] withdrawal saved; acknowledgement not confirmed"));
  return { decision: saved.data ? decision?.decision ?? "unavailable" : "unchanged", onlyWithdrawal: decision?.decision === "unsubscribe" && decision.hasOtherRequest === false };
}
