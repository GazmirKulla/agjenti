import { reviewMarketingPreference } from "@/lib/campaigns/preference";
import { notifyStaffOfUnhappyCustomer } from "./escalation";
import { messageWithVoice, transcribeMessageMedia } from "./voice-media";
import { loadAgentBehavior } from "@/lib/agents/behavior";
import { recordCapabilityEvents } from "@/lib/tracking/events";
import { sharedMediaTurnContext } from "./shared-media-context";
import { findOwnInstagramPosts } from "@/lib/instagram/media";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import { inboxHistory, type InboxHistoryMessage } from "./inbox-history";
import { readStoredConversationState } from "@/lib/orchestration/stored-state";
import { isAcceptedDelivery } from "./delivery-status";
import { inboundBatch } from "./message-batch";
import { randomUUID } from "node:crypto";
import { InboundPersistenceError } from "./inbound-persistence-error";
import { prepareWorkflowReply, type WorkflowJob } from "./workflow-queue";
import { processConversationMessage } from "./process-conversation-message";
import { decryptSecret } from "@/lib/crypto/tokens";
import { channelAdapter } from "./channel";
import { isMetaDashboardTestMessage } from "@/lib/instagram/parse-webhook";
import { fetchInstagramUserProfile, type InstagramUserProfile } from "@/lib/instagram/user-profile";
import { avatarIsStale, refreshInstagramParticipantAvatar } from "./participant-avatar";
import { replyTargetFrom } from "./reply-target";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { runAiReaction } from "./ai-reaction-runtime";
import { hasUnfinishedWork } from "./ai-reaction-decision";
import {
  type ConversationStatePayload,
} from "@/lib/workflows/engine";

type ConnectionRow = {
  id: string;
  business_id: string;
  ig_user_id?: string;
  phone_number_id?: string;
  access_token_ciphertext: string;
  status: string;
};

async function alreadyHandled(externalId: string): Promise<boolean> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("external_event_id", externalId)
    .maybeSingle();
  return Boolean(data?.id);
}

/** Why an incoming message got no reply from the agent, as a code for Shëndeti i Agjentit. */
export type NoReplyReason = "meta_test" | "account_missing" | "already_handled" | "unknown_account" | "token_unreadable" | "no_conversation"
  | "duplicate" | "marketing_preference" | "auto_reply_off" | "conversation_paused" | "conversation_closed";

export async function handleInboundMessage(
  message: NormalizedIncomingMessage,
  job?: WorkflowJob,
): Promise<{ skipped: NoReplyReason } | void> {
  if (isIsolatedExecution()) refuseIsolatedEffect("webhook", "inbound_delivery");
  const batch = inboundBatch(message, job);
  message = batch.message;
  const adapter = channelAdapter(message.channel);
  const accountId = message.contextMetadata?.[adapter.metadata];

  if (isMetaDashboardTestMessage(message)) {
    if (await alreadyHandled(message.externalMessageId)) {
      return { skipped: "meta_test" };
    }
    const supabase = createServiceSupabase();
    const { error: webhookEventError } = await supabase
      .from("webhook_events")
      .insert({
        external_event_id: message.externalMessageId,
        status: "meta_test",
      });
    // Meta always reuses mid "random_mid" — treat unique races as success.
    if (
      webhookEventError &&
      !webhookEventError.message.includes("duplicate key")
    ) {
      console.warn("[inbound] meta_test insert failed", {
        error: webhookEventError.message,
      });
    }
    return { skipped: "meta_test" };
  }

  console.log("[inbound] start", {
    externalMessageId: message.externalMessageId,
    externalParticipantId: message.externalParticipantId,
    textPreview: message.text?.slice(0, 80) ?? null,
    attachmentCount: message.attachments.length,
  });

  if (!accountId) {
    console.warn("[inbound] early return: missing instagramAccountId");
    return { skipped: "account_missing" };
  }
  if (!job && await alreadyHandled(message.externalMessageId)) {
    console.warn("[inbound] early return: alreadyHandled", {
      externalMessageId: message.externalMessageId,
    });
    return { skipped: "already_handled" };
  }

  const supabase = createServiceSupabase();
  const { data: connection, error: connectionError } = await supabase
    .from(adapter.table)
    .select(message.channel === "whatsapp" ? "id,business_id,phone_number_id,access_token_ciphertext,status" : "id,business_id,ig_user_id,access_token_ciphertext,status")
    .eq(adapter.account, accountId)
    .eq("status", "connected")
    .maybeSingle();
  console.log("[inbound] connection lookup", {
    lookupIgUserId: accountId,
    found: Boolean(connection),
    connectionId: connection?.id ?? null,
    businessId: connection?.business_id ?? null,
    status: connection?.status ?? null,
    error: connectionError?.message ?? null,
  });
  if (!connection) {
    if(job) throw new Error("Queued connection unavailable");
    console.warn(
      "[inbound] early return: unknown Instagram account",
      accountId,
    );
    const { error: logError } = await supabase.from("integration_logs").insert({
      business_id: null,
      direction: "inbound",
      target: "meta",
      status: "unknown_account",
      error: accountId,
    });
    if (logError) {
      console.warn(
        "[inbound] integration_logs insert failed",
        logError.message,
      );
    }
    return { skipped: "unknown_account" };
  }
  const conn = connection as ConnectionRow;
  const businessId = conn.business_id;
  if(job && (job.business_id!==businessId||job.connection_id!==conn.id||job.participant_id!==message.externalParticipantId)) throw new Error("Invalid queue identity");
  const { data: business, error: businessPolicyError } = await supabase
    .from("businesses")
    .select("auto_reply")
    .eq("id", businessId)
    .maybeSingle();
  // Verify policy before provider calls or persisting a false default on a new thread.
  // Throwing preserves the queue's existing retry path instead of settling as ignored.
  if (businessPolicyError) throw new Error("Auto-reply policy unavailable");
  let accessToken: string;
  try {
    accessToken = decryptSecret(conn.access_token_ciphertext);
  } catch (error) {
    if(job) throw new Error("Queued token unavailable");
    console.error("[inbound] token decrypt failed", error);
    await supabase
      .from(adapter.table)
      .update({ status: "revoked", last_error: "decrypt_failed" })
      .eq("id", conn.id);
    return { skipped: "token_unreadable" };
  }

  let username = message.senderUsername;
  let displayName = message.senderDisplayName;
  let profile: InstagramUserProfile | null = null;
  if (message.channel === "instagram" && !username && !displayName) {
    profile = await fetchInstagramUserProfile(
      message.externalParticipantId,
      accessToken,
    );
    username = profile.username;
    displayName = profile.name;
  }

  // A retry belongs to its original conversation, not whichever thread happens
  // to be active now. Old unbound jobs may recover ONLY from an exact receipt.
  let originalConversationId = job?.conversation_id;
  if (job && !originalConversationId) {
    const { data: receipt, error } = await supabase.from("messages").select("conversation_id")
      .eq("business_id", businessId).eq(adapter.connection, conn.id)
      .eq("external_message_id", job.payload.externalMessageId)
      .eq("direction", "inbound").eq("source", "customer").maybeSingle();
    if (error) throw new Error("Queued conversation identity unavailable");
    originalConversationId = receipt?.conversation_id;
  }
  let conversationQuery = supabase
    .from("conversations")
    .select("id,status,auto_reply,openai_previous_response_id,participant_avatar_checked_at")
    .eq("business_id", businessId)
    .eq(adapter.participant, message.externalParticipantId)
    .eq(adapter.connection, conn.id);
  conversationQuery = originalConversationId
    ? conversationQuery.eq("id", originalConversationId)
    : conversationQuery.in("status", ["active", "paused"]);
  const { data: open, error: conversationReadError } = await conversationQuery.order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (job && (conversationReadError || originalConversationId && !open)) throw new Error("Queued original conversation unavailable");

  let conversationId = open?.id as string | undefined;
  let previousId: string | null = null;
  let createdFresh = false;
  if (!conversationId) {
    const { data: last } = await supabase
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq(adapter.participant, message.externalParticipantId)
      .eq(adapter.connection, conn.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    previousId = last?.id ?? null;
    const { data: created, error: createConversationError } = await supabase
      .from("conversations")
      .insert({
        business_id: businessId,
        customer_id: null,
        [adapter.participant]: message.externalParticipantId,
        channel: message.channel,
        participant_username: username,
        participant_display_name: displayName,
        [adapter.connection]: conn.id,
        status: "active",
        auto_reply: Boolean(business?.auto_reply),
        previous_conversation_id: previousId,
        last_inbound_at: message.timestamp.toISOString(),
        last_message_at: message.timestamp.toISOString(),
        last_message_preview: message.text?.slice(0, 140) ?? "[media]",
        unread_count: 1,
      })
      .select("id")
      .single();
    conversationId = created?.id;
    createdFresh = Boolean(conversationId);
    console.log("[inbound] conversation insert", {
      ok: !createConversationError,
      conversationId: conversationId ?? null,
      error: createConversationError?.message ?? null,
    });
    if (conversationId) {
      const { error: stateError } = await supabase
        .from("conversation_states")
        .insert({
          conversation_id: conversationId,
          business_id: businessId,
          status: "in_progress",
          collected: initialSnapshot(businessId, conversationId, "live"),
        });
      console.log("[inbound] conversation_states insert", {
        ok: !stateError,
        error: stateError?.message ?? null,
      });
    }
  } else {
    const conversationPatch: Record<string, unknown> = {
      last_inbound_at: message.timestamp.toISOString(),
      last_message_at: message.timestamp.toISOString(),
      last_message_preview: message.text?.slice(0, 140) ?? "[media]",
      unread_count: 1,
    };
    if (username) conversationPatch.participant_username = username;
    if (displayName) conversationPatch.participant_display_name = displayName;
    const { error: updateConversationError } = await supabase
      .from("conversations")
      .update(conversationPatch)
      .eq("id", conversationId);
    console.log("[inbound] conversation update", {
      conversationId,
      ok: !updateConversationError,
      error: updateConversationError?.message ?? null,
    });
  }
  if (!conversationId) {
    if(job) throw new Error("Queued conversation unavailable");
    console.warn("[inbound] early return: no conversationId");
    return { skipped: "no_conversation" };
  }
  if (message.channel === "instagram" && avatarIsStale(open?.participant_avatar_checked_at as string | null | undefined)) {
    await refreshInstagramParticipantAvatar({
      db: supabase, businessId, connectionId: conn.id, participantId: message.externalParticipantId, accessToken, profile,
    }).catch((error) => console.warn("[inbound] avatar refresh failed", error instanceof Error ? error.message : error));
  }

  if (job) {
    const { data: bound, error } = await supabase.rpc("bind_workflow_inbound", {
      p_id: job.id, p_token: job.lease_token, p_conversation: conversationId,
    });
    if (error || bound !== true) throw new Error("Queued conversation binding not confirmed");
    job.conversation_id = conversationId;
  }

  const correlationId = job ? `workflow-job:${job.id}` : randomUUID();
  let reactionMessageId: string | null = null;
  let onlyMarketingWithdrawal = batch.originals.length > 0;
  let persistenceStage: InboundPersistenceError["stage"] = "message_insert";
  // Stored customer messages with a voice message or video, transcribed before the agent reads the turn.
  const voiceMessageIds: string[] = [];
  try {
    for (const original of batch.originals) {
      persistenceStage = "message_insert";
      const { data: insertedMessage, error: messageInsertError } = await supabase
        .from("messages")
        .insert({
          business_id: businessId,
          conversation_id: conversationId,
          [adapter.connection]: conn.id,
          direction: "inbound",
          source: "customer",
          marketing_inbound_at: original.timestamp.toISOString(),
          body: original.text,
          external_message_id: original.externalMessageId,
          media: original.attachments,
          reply_to: replyTargetFrom(original.contextMetadata),
          delivery_status: "delivered",
        })
        .select("id")
        .maybeSingle();
      if (messageInsertError?.code === "23505") {
        // A queue retry may have persisted inbound before losing its worker. Verify
        // the exact inbound record; an unrelated unique violation is not success.
        persistenceStage = "duplicate_lookup";
        const { data: existing, error } = await supabase.from("messages").select("id")
          .eq("business_id", businessId).eq("conversation_id", conversationId)
          .eq(adapter.connection, conn.id).eq("external_message_id", original.externalMessageId)
          .eq("direction", "inbound").eq("source", "customer").maybeSingle();
        if (error) throw error;
        if (!existing?.id) throw new Error("Inbound duplicate not verified");
        reactionMessageId = existing.id;
      } else {
        if (messageInsertError) throw messageInsertError;
        if (!insertedMessage?.id) throw new Error("Inbound insert not confirmed");
        reactionMessageId = insertedMessage.id;
      }
      if (reactionMessageId && original.attachments.some(a => a.kind === "audio" || a.kind === "video")) voiceMessageIds.push(reactionMessageId);
      const preference = reactionMessageId ? await reviewMarketingPreference(businessId, reactionMessageId) : undefined;
      onlyMarketingWithdrawal = onlyMarketingWithdrawal && preference?.onlyWithdrawal === true;
    }
    if (!job) {
      // Claim the legacy receipt only AFTER persistence. Failure above must not
      // cause alreadyHandled() to suppress the next delivery. A stored inbound
      // with no receipt can safely resume here; the unique receipt elects one caller.
      persistenceStage = "event_receipt";
      const { data: receipt, error } = await supabase.from("webhook_events")
        .insert({ external_event_id: message.externalMessageId, status: "received" })
        .select("id").maybeSingle();
      if (error?.code === "23505") return { skipped: "duplicate" };
      if (error) throw error;
      if (!receipt?.id) throw new Error("Inbound receipt not confirmed");
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const failure = new InboundPersistenceError(correlationId, persistenceStage, /^[A-Z0-9]{5}$/.test(code) ? code : null);
    console.error("[inbound] persistence failed", {
      correlationId, stage: failure.stage, databaseCode: failure.databaseCode,
      channel: message.channel, jobId: job?.id ?? null, businessId, conversationId,
    });
    throw failure;
  }
  if (onlyMarketingWithdrawal) return { skipped: "marketing_preference" }; // Preference acknowledgement is separate; preserve the workflow exactly.
  const conversationStatus = createdFresh ? "active" : open?.status;
  const convAuto = createdFresh ? business?.auto_reply : open?.auto_reply;
  const autoOn = convAuto ?? business?.auto_reply ?? false;
  // AI reactions are an acknowledgement side-effect only. Test/isolated
  // execution never reaches this production inbound path.
  if (!autoOn || conversationStatus !== "active") {
    console.log("[inbound] skip auto-reply", {
      autoOn,
      conversationStatus: conversationStatus ?? null,
    });
    return { skipped: !autoOn ? "auto_reply_off" : conversationStatus === "paused" ? "conversation_paused" : "conversation_closed" };
  }

  const { data: rawState, error: stateReadError } = await supabase
    .from("conversation_states")
    .select(job ? "collected, workflow_id, revision" : "collected, workflow_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if(job&&stateReadError) throw new Error("Conversation state unavailable");
  if(job&&!rawState) await supabase.from("conversation_states").upsert({conversation_id:conversationId,business_id:businessId,status:"in_progress",collected:initialSnapshot(businessId,conversationId,"live")},{onConflict:"conversation_id",ignoreDuplicates:true}).throwOnError();
  const stateRow=rawState as unknown as {collected:ConversationStatePayload|null;workflow_id:string|null;revision?:number}|null;
  // A paused handoff returns above. Reaching this point with its saved state means
  // staff explicitly resumed the conversation; keep native facts and continue.
  let inboundState = readStoredConversationState(stateRow?.collected ?? {}, { businessId, conversationId, revision: stateRow?.revision });
  // Direct processor calls can test production routing, but live state commits
  // and sends for shared conversations must always pass through the durable queue.
  if (!job) throw new Error("workflow_queue_required");
  const runtime = inboundState.runtime ?? initialSnapshot(businessId, conversationId, "live");
  inboundState = { ...inboundState, runtime };
  // Persisted inbox history also includes customers and staff who spoke while AI
  // was paused. Never replay those messages as workflow commands or field values.
  const [{ data: historyRows, error: historyError }, { data: lastOutbound, error: outboundError }] = await Promise.all([
    supabase.from("messages").select("body,direction,source,sent_via,delivery_status,external_message_id,media")
      .eq("business_id", businessId).eq("conversation_id", conversationId)
      .or("and(direction.eq.inbound,source.eq.customer),and(direction.eq.outbound,delivery_status.in.(sent,delivered,read),source.in.(agent,staff))")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10 + batch.originals.length),
    // Ownership evidence must not disappear when many messages arrive during pause.
    supabase.from("messages").select("body,source,sent_via,delivery_status")
      .eq("business_id", businessId).eq("conversation_id", conversationId).eq("direction", "outbound")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (historyError || outboundError) throw new Error("Conversation history unavailable");
  const history = inboxHistory((historyRows ?? []) as InboxHistoryMessage[], new Set(batch.originals.map(original => original.externalMessageId)));
  inboundState.recentMessages = history.messages;
  const currentIds = new Set(batch.originals.map(original => original.externalMessageId));
  // Shared posts/reels from this turn and the last few customer messages; the business's own post resolves to its product.
  const sharedMedia = await sharedMediaTurnContext(supabase, businessId, {
    current: message.attachments,
    earlier: ((historyRows ?? []) as (InboxHistoryMessage & { media?: unknown })[])
      .filter(row => row.direction === "inbound" && !currentIds.has(row.external_message_id ?? "")).slice(0, 3).map(row => row.media),
    ownPosts: message.channel === "instagram" ? links => findOwnInstagramPosts(accessToken, links) : undefined,
  });
  const staffReplied = history.staffReplied || lastOutbound?.source === "staff" && lastOutbound.sent_via !== "campaign" && lastOutbound.sent_via !== "marketing_preference" && isAcceptedDelivery(lastOutbound.delivery_status);
  const resumedHandoff = runtime.handoffRequested === true;
  if (resumedHandoff) inboundState.runtime = { ...runtime, handoffRequested: false };
  const canAct = async () => {
    const [{ data: current, error }, { data: business, error: businessError }] = await Promise.all([
      supabase.from("conversations").select("status,auto_reply").eq("id", conversationId!).eq("business_id", businessId).maybeSingle(),
      supabase.from("businesses").select("auto_reply").eq("id", businessId).maybeSingle(),
    ]);
    return !error && !businessError && current?.status === "active" && Boolean(current.auto_reply ?? business?.auto_reply ?? false);
  };
  let deliveredReply: string | null = lastOutbound?.source === "agent" && isAcceptedDelivery(lastOutbound.delivery_status) ? lastOutbound.body : null;
  let unconfirmedPrompt = false;
  if (job) {
    const { data: attempted, error: attemptError } = await supabase.from("workflow_inbound_queue")
      .select("status,reply").eq("business_id", businessId).eq("conversation_id", conversationId)
      .eq("connection_id", job.connection_id).eq("participant_id", job.participant_id)
      .lt("id", job.id).not("reply", "is", null).order("id", { ascending: false }).limit(1).maybeSingle();
    if (attemptError) throw new Error("Latest prompt attempt unavailable");
    // Only in-flight deliveries block field answers. Ignored/failed jobs are settled
    // (staff resume, delete, or abandoned) and must not force the clarify prompt.
    unconfirmedPrompt = Boolean(attempted && ["prepared", "sending", "uncertain"].includes(attempted.status));
    if (unconfirmedPrompt || (attempted && attempted.reply !== deliveredReply)) deliveredReply = null;
    if (unconfirmedPrompt) throw new Error("delivery_unverified");
  }
  // What the customer said in voice messages and videos, when the business lets the agent read them.
  const voice = voiceMessageIds.length && !isIsolatedExecution() && (await loadAgentBehavior(businessId)).voice
    ? (await Promise.all(voiceMessageIds.map(id => transcribeMessageMedia(businessId, conversationId, id).catch(() => [])))).flat() : [];
  if (voice.length) await recordCapabilityEvents(voice.map(v => ({ businessId, capability: "customer.voice", mode: "live" as const, conversationId,
    point: v.transcript ? "transcribed" : "not_heard", reason: v.failure ? `${v.kind}_${v.failure}` : v.kind })));
  // Capture pre-turn evidence before the coordinator may update/suspend state.
  const reactionHistory = history.messages.map(message => ({ ...message }));
  const reactionPendingWork = hasUnfinishedWork(inboundState);
  const turn = await processConversationMessage({
    onTrace: event => {
      if (event.label === "Conversation coordinator completed") console.info("[inbound] coordinator", {
        ...event.data, correlationId, businessId, conversationId, jobId: job?.id ?? null,
      });
    },
    deliveredReply,
    conversationKey: conversationId,
    customerIdentity: { conversationId, instagramParticipantId: message.externalParticipantId, instagramConnectionId: conn.id, channel: message.channel },
    source: message.channel,
    // The Instagram account writing in is read like an account the prospect named
    // (only for a business allowed to scan prospects, e.g. Agjenti.app).
    prospectSender: message.channel === "instagram" ? username ?? null : null,
    bookingGuard: job ? { jobId: job.id, leaseToken: job.lease_token, conversationId, revision: stateRow?.revision ?? 0 } : undefined,
    processTransport: job ? { jobId: job.id, leaseToken: job.lease_token, conversationId, revision: stateRow?.revision ?? 0 } : undefined,
    canAct,
    businessId,
    message: voice.length ? messageWithVoice(message.text, voice) : message.text ?? "",
    hasPhoto: message.attachments.some((a) => a.kind === "image"),
    ...(sharedMedia ? { attachmentContext: sharedMedia.attachmentContext, referencedProductIds: sharedMedia.productIds, groundingHint: sharedMedia.groundingHint } : {}),
    state: inboundState,
    persistedWorkflowId: stateRow?.workflow_id ?? null,
    previousResponseId: resumedHandoff || staffReplied || unconfirmedPrompt ? null : open?.openai_previous_response_id ?? null,
  });
  const state = turn.nextState;
  if(job) {
    await prepareWorkflowReply(job,conversationId,stateRow?.revision??0,turn);
    // Committed: the customer needs a person. Staff are told in both cases; with a handoff the conversation pauses after this reply.
    if (turn.escalation) {
      await recordCapabilityEvents([{ businessId, capability: "customer.escalation", mode: "live", conversationId,
        point: turn.escalation.action === "handoff" ? "handed_off" : "notified", reason: turn.escalation.reason }]);
      await notifyStaffOfUnhappyCustomer(businessId, conversationId, turn.escalation).catch(() => undefined);
    }
    // Persist the normal reply first. Optional acknowledgements never replace it
    // or turn a reaction persistence/provider failure into a message retry.
    if (reactionMessageId && autoOn && conversationStatus==='active' && !(turn.handoff && !turn.advisoryHandoff) && !isIsolatedExecution()) {
      try {
        await runAiReaction({businessId,conversationId,messageId:reactionMessageId,text:message.text,
          channel:message.channel,accountId:String(accountId),participantId:message.externalParticipantId,
          context:{history:reactionHistory,preparedReply:turn.reply,pendingWork:reactionPendingWork || hasUnfinishedWork(state)},
          autoReplyEnabled:Boolean(autoOn),humanTakeover:false,jobId:job.id,leaseToken:job.lease_token});
      } catch { /* Normal prepared reply remains authoritative and sendable. */ }
    }
    return;
  }
}
