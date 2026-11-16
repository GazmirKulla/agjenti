import { createServiceSupabase } from "@/lib/supabase/service";
export async function loadCampaigns(businessId: string) {
  const db = createServiceSupabase();
  const [campaigns, settings, control, contacts] = await Promise.all([
    db.from("marketing_campaigns").select("id,name,channel,status,reason,created_at,offer_expires_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(30),
    db.from("marketing_settings").select("enabled,timezone,frequency_days").eq("business_id", businessId).maybeSingle(),
    db.from("marketing_control").select("enabled").eq("singleton", true).single(),
    db.from("conversations").select("id,channel,participant_display_name,participant_username,last_inbound_at,instagram_connection_id,whatsapp_connection_id,instagram_participant_id,whatsapp_participant_id").eq("business_id", businessId).gte("last_inbound_at", new Date(Date.now() - 23 * 3600000).toISOString()).order("last_inbound_at", { ascending: false }).limit(100),
  ]);
  if ([campaigns, settings, control, contacts].some(r => r.error)) throw new Error("campaigns_unavailable");
  const preferences = await db.from("marketing_preferences").select("connection_id,participant_id,status,review_pending,pending_message_id,evidence").eq("business_id", businessId);
  if (preferences.error) throw new Error("campaigns_unavailable");
  return { campaigns: campaigns.data ?? [], settings: settings.data ?? { enabled: false, timezone: "Europe/Tirane", frequency_days: 7 }, globalEnabled: control.data?.enabled === true,
    contacts: (contacts.data ?? []).map(c => {
      const p = preferences.data?.find(p => p.connection_id === (c.whatsapp_connection_id ?? c.instagram_connection_id) && p.participant_id === (c.whatsapp_participant_id ?? c.instagram_participant_id));
      return { id: c.id, name: c.participant_display_name || c.participant_username || "Kontakt", channel: c.channel, status: p?.status ?? "unknown", held: p?.review_pending ?? false, evidence: p?.evidence ?? null };
    }),
  };
}
export type CampaignDashboard = Awaited<ReturnType<typeof loadCampaigns>>;
export async function loadCampaign(businessId: string, id: string) {
  const db = createServiceSupabase();
  const [campaign, recipients] = await Promise.all([
    db.from("marketing_campaigns").select("id,name,channel,body,terms,hours,is_test,status,reason,excluded,created_at,offer_expires_at,confirmed_at").eq("business_id", businessId).eq("id", id).single(),
    db.from("marketing_campaign_recipients").select("id,name,body,status,reason,message_id,conversation_id").eq("business_id", businessId).eq("campaign_id", id).order("id").limit(500),
  ]);
  if (campaign.error || recipients.error) throw new Error("campaign_unavailable");
  const ids = (recipients.data ?? []).flatMap(r => r.message_id ? [r.message_id] : []);
  const messages = ids.length ? await db.from("messages").select("id,delivery_status").eq("business_id", businessId).in("id", ids) : { data: [], error: null };
  if (messages.error) throw new Error("campaign_unavailable");
  return { ...campaign.data, recipients: (recipients.data ?? []).map(r => ({ ...r, delivery: messages.data?.find(m => m.id === r.message_id)?.delivery_status ?? null })) };
}
export type CampaignDetail = Awaited<ReturnType<typeof loadCampaign>>;
/** Server-owned information only; discounts are never applied by this context. */
export async function campaignContext(businessId: string, conversationId: string) {
  const db = createServiceSupabase();
  const result = await db.from("marketing_campaign_recipients").select("body,started_at,marketing_campaigns!inner(id,name,terms,offer_expires_at)").eq("business_id", businessId).eq("conversation_id", conversationId).eq("status", "sent").gte("started_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("started_at", { ascending: false }).limit(3);
  if (result.error?.code === "42P01" || result.error?.code === "PGRST205") return undefined;
  if (result.error) throw new Error("campaign_context_unavailable");
  const preference = await db.from("conversations").select("instagram_connection_id,whatsapp_connection_id,instagram_participant_id,whatsapp_participant_id").eq("business_id", businessId).eq("id", conversationId).single();
  if (preference.error) throw new Error("campaign_context_unavailable");
  const c = preference.data;
  const status = await db.from("marketing_preferences").select("status,review_pending,reviewed_message_id").eq("business_id", businessId).eq("connection_id", c.whatsapp_connection_id ?? c.instagram_connection_id).eq("participant_id", c.whatsapp_participant_id ?? c.instagram_participant_id).maybeSingle();
  if (status.error) throw new Error("campaign_context_unavailable");
  return { now: new Date().toISOString(), offers: result.data, preference: status.data, policy: "These are previously sent offers, not authorization to change prices or apply discounts. Use only stated terms, respect offer_expires_at; never invent a benefit. Explain expired offers as expired. Marketing opt-out does not cancel orders or support. A separate service acknowledgement handles withdrawal; do not send a second confirmation. Continue answering any other question without changing workflow state merely because marketing stopped. Never claim consent was recorded when review_pending is true." };
}
