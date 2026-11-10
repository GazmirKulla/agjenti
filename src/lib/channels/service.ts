import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { needsAttention, type ChannelActivity, type ChannelConnection, type ChannelId } from "./health";

/** Connection rows of both channels; null when not connected or unreadable. */
export const loadChannelConnections = cache(async (businessId: string) => {
  const db = createServiceSupabase();
  const [ig, wa] = await Promise.all([
    db.from("instagram_connections").select("status,expires_at,last_error").eq("business_id", businessId).neq("status", "disconnected").maybeSingle(),
    db.from("whatsapp_connections").select("status,last_error").eq("business_id", businessId).maybeSingle(),
  ]);
  const instagram: ChannelConnection | null = ig.data ? { status: ig.data.status, expiresAt: ig.data.expires_at, lastError: ig.data.last_error } : null;
  const whatsapp: ChannelConnection | null = wa.data ? { status: wa.data.status, lastError: wa.data.last_error } : null;
  return { instagram, whatsapp };
});

/** For the menu: does any connected channel need the owner? Never throws. */
export async function channelsNeedAttention(businessId: string) {
  try {
    const { instagram, whatsapp } = await loadChannelConnections(businessId);
    return needsAttention("instagram", instagram) || needsAttention("whatsapp", whatsapp);
  } catch {
    return false;
  }
}

/** Last customer message and the number of customer messages in the last 7 days, per channel. */
export async function loadChannelActivity(businessId: string, channel: ChannelId): Promise<ChannelActivity | null> {
  const db = createServiceSupabase();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [last, week] = await Promise.all([
    db.from("conversations").select("last_inbound_at").eq("business_id", businessId).eq("channel", channel)
      .not("last_inbound_at", "is", null).order("last_inbound_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("messages").select("id, conversations!inner(channel)", { count: "exact", head: true })
      .eq("business_id", businessId).eq("direction", "inbound").eq("source", "customer")
      .eq("conversations.channel", channel).gte("created_at", since),
  ]);
  if (last.error || week.error) return null;
  return { lastInboundAt: last.data?.last_inbound_at ?? null, weekInbound: week.count ?? 0 };
}
