import { confirmMarketingWithdrawal } from "./confirmation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { channelAdapter, type MessagingChannel } from "@/lib/conversations/channel";
import { markInstagramTokenRejected } from "@/lib/instagram/token-health";
import { isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { workerOrigin } from "@/lib/discovery/continue";

type SendClaim = { id: string; token: string; body: string; participant_id: string; channel: MessagingChannel };
export async function runCampaignQueue(businessId?: string) {
  if (isIsolatedExecution()) refuseIsolatedEffect("background_job", "marketing_campaign");
  const db = createServiceSupabase();
  const recovery = await db.rpc("recover_marketing_campaigns");
  if (recovery.error) throw new Error("campaign_recovery_failed");
  let query = db.from("marketing_campaigns").select("id,business_id,channel").eq("status", "running").order("confirmed_at").limit(10);
  if (businessId) query = query.eq("business_id", businessId);
  const campaigns = await query;
  if (campaigns.error) throw new Error("campaign_queue_unavailable");
  const deadline = Date.now() + 35000;
  let acknowledgements = db.from("marketing_preference_events").select("business_id,message_id").eq("confirmation_status", "pending").gte("created_at", new Date(Date.now() - 23 * 3600000).toISOString()).order("created_at").limit(5);
  if (businessId) acknowledgements = acknowledgements.eq("business_id", businessId);
  const due = await acknowledgements;
  if (due.error) throw new Error("preference_queue_unavailable");
  for (const event of due.data ?? []) {
    if (Date.now() >= deadline) return;
    if (event.message_id) await confirmMarketingWithdrawal(event.business_id, event.message_id);
  }
  for (const campaign of campaigns.data ?? []) {
    const pending = await db.from("marketing_campaign_recipients").select("id,connection_id,participant_id").eq("campaign_id", campaign.id).eq("business_id", campaign.business_id).eq("status", "pending").order("id").limit(25);
    if (pending.error) throw new Error("campaign_queue_unavailable");
    const adapter = channelAdapter(campaign.channel);
    for (const recipient of pending.data ?? []) {
      if (Date.now() >= deadline) return;
      // Resolve/decrypt before committing the irreversible send boundary.
      const connection = await db.from(adapter.table).select(`id,access_token_ciphertext,${adapter.account}`).eq("id", recipient.connection_id).eq("business_id", campaign.business_id).eq("status", "connected").maybeSingle();
      if (connection.error) throw new Error("campaign_connection_unavailable");
      if (!connection.data) {
        const paused = await db.from("marketing_campaigns").update({ status: "paused", reason: "disconnected" }).eq("id", campaign.id).eq("status", "running");
        if (paused.error) throw new Error("campaign_pause_failed");
        break;
      }
      let token: string;
      try { token = decryptSecret(connection.data.access_token_ciphertext as string); }
      catch {
        await db.from("marketing_campaigns").update({ status: "paused", reason: "disconnected" }).eq("id", campaign.id).eq("status", "running");
        break;
      }
      const claim = await db.rpc("begin_marketing_send", { p_recipient: recipient.id });
      if (claim.error) throw new Error("campaign_claim_failed");
      if (!claim.data) continue;
      const send = claim.data as SendClaim;
      let status: "sent" | "failed" | "uncertain" = "uncertain", external: string | null = null, providerCode: string | null = null;
      try {
        // No humanAgent option, templates, tags, retry loop, or multipart content.
        const result = await adapter.send({ accountId: String((connection.data as unknown as Record<string, unknown>)[adapter.account]), token, to: send.participant_id, body: send.body });
        if (!result.ok) providerCode = result.code ?? null;
        if (result.ok && result.messageId) { status = "sent"; external = result.messageId; }
        else if (!result.ok && result.parts?.[0]?.status === "failed") status = "failed";
      } catch { /* A timeout or lost acknowledgement is never retried. */ }
      const finish = await db.rpc("finish_marketing_send", { p_recipient: send.id, p_token: send.token, p_status: status, p_external: external, p_reason: status === "sent" ? null : providerCode === "token_revoked" || providerCode === "rate_limited" ? providerCode : status === "failed" ? "provider_failed" : "uncertain" });
      if (finish.error) throw new Error("campaign_receipt_unavailable");
      if (providerCode === "token_revoked" && campaign.channel !== "whatsapp")
        await markInstagramTokenRejected(db, { id: String(connection.data.id), businessId: campaign.business_id }, "campaign").catch(() => console.error("[campaign] token state not saved"));
      if (status === "uncertain" || providerCode === "token_revoked" || providerCode === "rate_limited") break;
      await new Promise(resolve => setTimeout(resolve, 1050));
    }
  }
  const finished = await db.rpc("recover_marketing_campaigns");
  if (finished.error) throw new Error("campaign_recovery_failed");
}

/** Short server steps continue without keeping the owner's page open. */
export async function continueCampaigns(businessId: string, hop = 0) {
  if (isIsolatedExecution()) refuseIsolatedEffect("background_job", "marketing_continuation");
  try { await runCampaignQueue(businessId); }
  catch { console.error("[campaigns] worker interrupted; durable receipts retained"); }
  const db = createServiceSupabase();
  const pending = await db.from("marketing_campaigns").select("id").eq("business_id", businessId).eq("status", "running").limit(1);
  if (pending.error || !pending.data?.length) return;
  if (hop >= 199) {
    await db.from("marketing_campaigns").update({ status: "paused", reason: "worker_limit" }).eq("business_id", businessId).eq("status", "running");
    return;
  }
  const origin = workerOrigin(), secret = process.env.CRON_SECRET?.trim();
  if (!origin || !secret) return;
  await new Promise(resolve => setTimeout(resolve, 2000));
  // Only configured origin; never forward the secret to a request Host header.
  const url = new URL("/api/cron/campaigns", origin);
  try {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ businessId, hop: hop + 1 }), signal: AbortSignal.timeout(10000), cache: "no-store", redirect: "error" });
    if (!response.ok) console.error("[campaigns] continuation was not accepted");
  } catch { console.error("[campaigns] continuation unavailable; resume from dashboard or cron"); }
}
