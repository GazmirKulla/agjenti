import { createServiceSupabase } from "@/lib/supabase/service";

const reasons: Record<string, string> = {
  dissatisfied: "Klienti duket i pakënaqur", complaint: "Klienti ka një ankesë", not_helped: "Agjenti nuk po e ndihmon klientin",
};

/**
 * Tells the business's owners in the panel (Kreu, attention events) that a customer needs a person, with a
 * link to the conversation. One notice per conversation and day; never a message to the customer.
 */
export async function notifyStaffOfUnhappyCustomer(businessId: string, conversationId: string, escalation: { reason: string; action: "handoff" | "notify" }) {
  const db = createServiceSupabase();
  const [{ data: business }, { data: owners }, { data: conversation }] = await Promise.all([
    db.from("businesses").select("slug").eq("id", businessId).maybeSingle(),
    db.from("business_users").select("user_id").eq("business_id", businessId).eq("role", "owner"),
    db.from("conversations").select("participant_display_name").eq("id", conversationId).eq("business_id", businessId).maybeSingle(),
  ]);
  if (!business?.slug || !owners?.length) return;
  const sourceId = `escalation:${conversationId}:${new Date().toISOString().slice(0, 10)}`;
  const { data: existing } = await db.from("business_attention_events").select("user_id").eq("business_id", businessId).eq("source_id", sourceId);
  const notified = new Set((existing ?? []).map(row => row.user_id));
  const who = conversation?.participant_display_name ? ` (${conversation.participant_display_name})` : "";
  const rows = owners.filter(owner => !notified.has(owner.user_id)).map(owner => ({
    business_id: businessId, user_id: owner.user_id, source_id: sourceId,
    title: `${reasons[escalation.reason] ?? "Klientit i duhet një person"}${who}`,
    detail: escalation.action === "handoff" ? "Agjenti ia kaloi bisedën stafit dhe nuk përgjigjet më derisa ta rifillosh." : "Agjenti vazhdon të përgjigjet; shiko bisedën.",
    href: `/b/${business.slug}/inbox/${conversationId}`,
  }));
  if (rows.length) await db.from("business_attention_events").insert(rows);
}
