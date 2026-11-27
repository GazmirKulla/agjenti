import { createServiceSupabase } from "@/lib/supabase/service";
import { zonedParts } from "@/lib/calendar/model";

/**
 * The Assistant's read of the business's messaging channels: whether each is connected, whether its token is
 * about to stop working, and whether recent sends fail. Never a credential. Connecting at Meta and
 * disconnecting stay with the owner in Integrimet; the read gives the page to open.
 */
export type ChannelProblem = "not_connected" | "disconnected" | "token_expired" | "token_expiring" | "sends_failing" | "ok";
export type ChannelHealth = {
  channel: "instagram" | "whatsapp";
  connected: boolean;
  status: string | null;
  account: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  lastFailedSend: { at: string; error: string | null } | null;
  lastSuccessfulSend: string | null;
  problem: ChannelProblem;
  /** The panel page where the owner connects, reconnects or disconnects this channel. */
  manageUrl: string | null;
  /** The times above are local to this zone (the business's), as "YYYY-MM-DD HH:mm". */
  timezone: string;
};

const DAY = 86_400_000;
const sentStatuses = ["sent", "delivered", "read"];

/** What is wrong, from stored facts only: the connection, the token's expiry and the latest sends. */
export function channelProblem(input: { status: string | null; tokenExpiresAt: string | null; lastFailedSend: string | null; lastSuccessfulSend: string | null }, now: number): ChannelProblem {
  if (input.status === null) return "not_connected";
  if (input.status !== "connected") return "disconnected";
  const expires = input.tokenExpiresAt ? Date.parse(input.tokenExpiresAt) : NaN;
  if (Number.isFinite(expires) && expires <= now) return "token_expired";
  // The send after the last success failed: the channel stopped delivering.
  if (input.lastFailedSend && (!input.lastSuccessfulSend || Date.parse(input.lastFailedSend) > Date.parse(input.lastSuccessfulSend))) return "sends_failing";
  // Tokens are refreshed every day; one this close to expiry means the refresh is not working.
  if (Number.isFinite(expires) && expires - now < 7 * DAY) return "token_expiring";
  return "ok";
}

export async function readChannelHealth(businessId: string, now = Date.now()): Promise<ChannelHealth[]> {
  const db = createServiceSupabase();
  const [business, instagram, whatsapp] = await Promise.all([
    db.from("businesses").select("slug,timezone").eq("id", businessId).maybeSingle(),
    db.from("instagram_connections").select("id,status,username,expires_at,last_error").eq("business_id", businessId).maybeSingle(),
    db.from("whatsapp_connections").select("id,status,display_phone_number,verified_name,last_error").eq("business_id", businessId).maybeSingle(),
  ]);
  if (business.error || instagram.error || whatsapp.error || !business.data) throw Error("Gjendja e kanaleve nuk u lexua.");
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const manageUrl = origin && /^https?:\/\//.test(origin) ? `${origin}/b/${encodeURIComponent(business.data.slug)}/integrations` : null;
  const since = new Date(now - 7 * DAY).toISOString();
  // The owner reads times on the business's clock, never in UTC.
  const timezone = business.data.timezone || "Europe/Tirane";
  const local = (at: string | null) => { if (!at) return null; const p = zonedParts(at, timezone); return `${p.date} ${p.time}`; };
  // The latest failed and the latest delivered send of the last week through this connection, this business only.
  const sends = async (column: "instagram_connection_id" | "whatsapp_connection_id", connectionId: string) => {
    const base = () => db.from("messages").select("created_at,delivery_error").eq("business_id", businessId).eq(column, connectionId)
      .eq("direction", "outbound").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    const [failed, sent] = await Promise.all([base().eq("delivery_status", "failed").maybeSingle(), base().in("delivery_status", sentStatuses).maybeSingle()]);
    if (failed.error || sent.error) throw Error("Dërgimet e kanalit nuk u lexuan.");
    return { failed: failed.data ? { at: failed.data.created_at as string, error: (failed.data.delivery_error as string | null)?.slice(0, 200) ?? null } : null, sent: (sent.data?.created_at as string | undefined) ?? null };
  };
  const health = (channel: ChannelHealth["channel"], row: { status: string; last_error: string | null } | null, account: string | null, tokenExpiresAt: string | null,
    recent: { failed: ChannelHealth["lastFailedSend"]; sent: string | null }): ChannelHealth => ({
    channel, connected: row?.status === "connected", status: row?.status ?? null, account, tokenExpiresAt: local(tokenExpiresAt),
    lastError: row?.last_error?.slice(0, 200) ?? null, lastFailedSend: recent.failed ? { at: local(recent.failed.at)!, error: recent.failed.error } : null,
    lastSuccessfulSend: local(recent.sent),
    problem: channelProblem({ status: row?.status ?? null, tokenExpiresAt, lastFailedSend: recent.failed?.at ?? null, lastSuccessfulSend: recent.sent }, now),
    manageUrl, timezone,
  });
  const none = { failed: null, sent: null };
  const ig = instagram.data, wa = whatsapp.data;
  return [
    health("instagram", ig, ig?.username ? `@${ig.username}` : null, ig?.expires_at ?? null, ig ? await sends("instagram_connection_id", ig.id) : none),
    // WhatsApp Cloud API system tokens do not expire on a date.
    health("whatsapp", wa, wa ? [wa.verified_name, wa.display_phone_number].filter(Boolean).join(" · ") || null : null, null, wa ? await sends("whatsapp_connection_id", wa.id) : none),
  ];
}
