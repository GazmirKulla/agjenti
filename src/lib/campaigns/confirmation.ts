import { createServiceSupabase } from "@/lib/supabase/service";
import { channelAdapter } from "@/lib/conversations/channel";
import { decryptSecret } from "@/lib/crypto/tokens";
import { isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
/** A durable, single acknowledgement of a verified withdrawal, even with auto-replies off. */
export async function confirmMarketingWithdrawal(businessId: string, messageId: string) {
  if (isIsolatedExecution()) refuseIsolatedEffect("customer.message", "marketing_preference");
  const db = createServiceSupabase();
  const event = await db.from("marketing_preference_events").select("id,connection_id,participant_id").eq("business_id", businessId).eq("message_id", messageId).eq("confirmation_status", "pending").maybeSingle();
  if (event.error) throw new Error("preference_confirmation_unavailable");
  if (!event.data) return;
  const registry = await db.from("messaging_connections").select("channel").eq("business_id", businessId).eq("id", event.data.connection_id).single();
  if (registry.error) throw new Error("preference_connection_unavailable");
  const adapter = channelAdapter(registry.data.channel);
  const connection = await db.from(adapter.table).select(`access_token_ciphertext,${adapter.account}`).eq("business_id", businessId).eq("id", event.data.connection_id).eq("status", "connected").maybeSingle();
  if (connection.error || !connection.data) return;
  const token = decryptSecret(connection.data.access_token_ciphertext as string);
  const claim = await db.rpc("begin_marketing_confirmation", { p_event: event.data.id });
  if (claim.error) throw new Error("preference_claim_failed");
  if (!claim.data) return;
  let status = "uncertain", external: string | null = null;
  try {
    const result = await adapter.send({ accountId: String((connection.data as unknown as Record<string, unknown>)[adapter.account]), token, to: event.data.participant_id, body: claim.data.body });
    if (result.ok && result.messageId) { status = "sent"; external = result.messageId; }
    else if (!result.ok && result.parts?.[0]?.status === "failed") status = "failed";
  } catch { /* Never retry an ambiguous send. */ }
  const saved = await db.rpc("finish_marketing_confirmation", { p_event: event.data.id, p_token: claim.data.confirmation_token, p_status: status, p_external: external });
  if (saved.error) throw new Error("preference_receipt_unavailable");
}
