import { inboxHistory, type InboxHistoryMessage } from "./inbox-history";
import { inboundBatch } from "./message-batch";
import { randomUUID } from "node:crypto";
import { InboundPersistenceError } from "./inbound-persistence-error";
import { hydrateProfile } from "./profile";
import { usesSharedCoordinator } from "./coordinator-policy";
import { prepareWorkflowReply, type WorkflowJob } from "./workflow-queue";
import { processConversationMessage } from "./process-conversation-message";
import { decryptSecret } from "@/lib/crypto/tokens";
import { channelAdapter } from "./channel";
import { isMetaDashboardTestMessage } from "@/lib/instagram/parse-webhook";
import { fetchInstagramUserProfile } from "@/lib/instagram/user-profile";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  emptyState,
  promptForStep,
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

export async function handleInboundMessage(
  message: NormalizedIncomingMessage,
  job?: WorkflowJob,
): Promise<void> {
  const batch = inboundBatch(message, job);
  message = batch.message;
  const adapter = channelAdapter(message.channel);
  const accountId = message.contextMetadata?.[adapter.metadata];

  if (isMetaDashboardTestMessage(message)) {
    if (await alreadyHandled(message.externalMessageId)) {
      return;
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
    return;
  }

  console.log("[inbound] start", {
    externalMessageId: message.externalMessageId,
    externalParticipantId: message.externalParticipantId,
    textPreview: message.text?.slice(0, 80) ?? null,
    attachmentCount: message.attachments.length,
  });

  if (!accountId) {
    console.warn("[inbound] early return: missing instagramAccountId");
    return;
  }
  if (!job && await alreadyHandled(message.externalMessageId)) {
    console.warn("[inbound] early return: alreadyHandled", {
      externalMessageId: message.externalMessageId,
    });
    return;
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
    return;
  }
  const conn = connection as ConnectionRow;
  const businessId = conn.business_id;
  if(job && (job.business_id!==businessId||job.connection_id!==conn.id||job.participant_id!==message.externalParticipantId)) throw new Error("Invalid queue identity");
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
    return;
  }

  let username = message.senderUsername;
  let displayName = message.senderDisplayName;
  if (message.channel === "instagram" && !username && !displayName) {
    const profile = await fetchInstagramUserProfile(
      message.externalParticipantId,
      accessToken,
    );
    username = profile.username;
    displayName = profile.name;
  }

  const { data: open } = await supabase
    .from("conversations")
    .select("id,status,auto_reply,openai_previous_response_id")
    .eq("business_id", businessId)
    .eq(adapter.participant, message.externalParticipantId)
    .eq(adapter.connection, conn.id)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = open?.id as string | undefined;
  let previousId: string | null = null;
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
        previous_conversation_id: previousId,
        last_inbound_at: message.timestamp.toISOString(),
        last_message_at: message.timestamp.toISOString(),
        last_message_preview: message.text?.slice(0, 140) ?? "[media]",
        unread_count: 1,
      })
      .select("id")
      .single();
    conversationId = created?.id;
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
          collected: emptyState(),
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
    return;
  }

  const correlationId = job ? `workflow-job:${job.id}` : randomUUID();
  let persistenceStage: InboundPersistenceError["stage"] = "message_insert";
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
          body: original.text,
          external_message_id: original.externalMessageId,
          media: original.attachments,
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
      } else {
        if (messageInsertError) throw messageInsertError;
        if (!insertedMessage?.id) throw new Error("Inbound insert not confirmed");
      }
    }
    if (!job) {
      // Claim the legacy receipt only AFTER persistence. Failure above must not
      // cause alreadyHandled() to suppress the next delivery. A stored inbound
      // with no receipt can safely resume here; the unique receipt elects one caller.
      persistenceStage = "event_receipt";
      const { data: receipt, error } = await supabase.from("webhook_events")
        .insert({ external_event_id: message.externalMessageId, status: "received" })
        .select("id").maybeSingle();
      if (error?.code === "23505") return;
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
  const { data: business } = await supabase
    .from("businesses")
    .select("auto_reply")
    .eq("id", businessId)
    .maybeSingle();
  const convAuto = open?.auto_reply;
  const autoOn = convAuto ?? business?.auto_reply ?? false;
  if (!autoOn || open?.status === "paused") {
    console.log("[inbound] skip auto-reply", {
      autoOn,
      conversationStatus: open?.status ?? null,
    });
    return;
  }

  const { data: rawState, error: stateReadError } = await supabase
    .from("conversation_states")
    .select(job ? "collected, workflow_id, revision" : "collected, workflow_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if(job&&stateReadError) throw new Error("Conversation state unavailable");
  if(job&&!rawState) await supabase.from("conversation_states").upsert({conversation_id:conversationId,business_id:businessId,status:"in_progress",collected:emptyState()},{onConflict:"conversation_id",ignoreDuplicates:true}).throwOnError();
  const stateRow=rawState as unknown as {collected:ConversationStatePayload|null;workflow_id:string|null;revision?:number}|null;
  // A paused handoff returns above. Reaching this point with its saved state means
  // staff explicitly resumed the conversation; start a new run without erasing data.
  let inboundState = structuredClone((stateRow?.collected as ConversationStatePayload | null) ?? emptyState());
  const shared = usesSharedCoordinator({ businessId, source: message.channel, state: inboundState });
  // Direct processor calls can test production routing, but live state commits
  // and sends for shared conversations must always pass through the durable queue.
  if (shared && !job) throw new Error("workflow_queue_required");
  if(job && (shared || inboundState.context)) inboundState=await hydrateProfile(businessId,message.externalParticipantId,inboundState,message.channel);
  // Persisted inbox history also includes customers and staff who spoke while AI
  // was paused. Never replay those messages as workflow commands or field values.
  const [{ data: historyRows, error: historyError }, { data: lastOutbound, error: outboundError }] = await Promise.all([
    supabase.from("messages").select("body,direction,source,delivery_status,external_message_id")
      .eq("business_id", businessId).eq("conversation_id", conversationId)
      .or("and(direction.eq.inbound,source.eq.customer),and(direction.eq.outbound,delivery_status.eq.sent,source.in.(agent,staff))")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10 + batch.originals.length),
    // Ownership evidence must not disappear when many messages arrive during pause.
    supabase.from("messages").select("body,source,delivery_status")
      .eq("business_id", businessId).eq("conversation_id", conversationId).eq("direction", "outbound")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (historyError || outboundError) throw new Error("Conversation history unavailable");
  const history = inboxHistory((historyRows ?? []) as InboxHistoryMessage[], new Set(batch.originals.map(original => original.externalMessageId)));
  inboundState.recentMessages = history.messages;
  const staffReplied = history.staffReplied || lastOutbound?.source === "staff" && lastOutbound.delivery_status === "sent";
  const resumedHandoff = inboundState.staffHandoff || inboundState.visual?.status === "handoff" && !inboundState.visual.advisory;
  if (resumedHandoff || staffReplied) {
    delete inboundState.staffHandoff;
    inboundState.conversationPaused = true;
    if (inboundState.processes) {
      const processes = inboundState.processes;
      if (processes.active && processes[processes.active]) processes[processes.active]!.status = "suspended";
      processes.active = null; processes.promptOwner = null;
      delete processes.pendingChoice; delete processes.auxiliary;
      if (processes.service) processes.service.promptCurrent = false;
    }
  }
  if (inboundState.visual?.status === "handoff" && !inboundState.visual.advisory) {
    inboundState.completedVisual = structuredClone(inboundState.visual);
    inboundState.visual.status = "completed";
  }
  if (message.channel === "whatsapp") {
    inboundState.fields.channel = message.channel;
    if (inboundState.visual) inboundState.visual.values.channel = message.channel;
  }
  const started = Date.now();
  const canAct = async () => {
    const [{ data: current, error }, { data: business, error: businessError }] = await Promise.all([
      supabase.from("conversations").select("status,auto_reply").eq("id", conversationId!).eq("business_id", businessId).maybeSingle(),
      supabase.from("businesses").select("auto_reply").eq("id", businessId).maybeSingle(),
    ]);
    return !error && !businessError && current?.status === "active" && Boolean(current.auto_reply ?? business?.auto_reply ?? false);
  };
  let deliveredReply: string | null = lastOutbound?.source === "agent" && lastOutbound.delivery_status === "sent" ? lastOutbound.body : null;
  let unconfirmedPrompt = false;
  if (job) {
    const { data: attempted, error: attemptError } = await supabase.from("workflow_inbound_queue")
      .select("status,reply").eq("business_id", businessId).eq("conversation_id", conversationId)
      .eq("connection_id", job.connection_id).eq("participant_id", job.participant_id)
      .lt("id", job.id).not("reply", "is", null).order("id", { ascending: false }).limit(1).maybeSingle();
    if (attemptError) throw new Error("Latest prompt attempt unavailable");
    // Check every turn, including free-text field answers after a staff resume.
    // An older identical sent reply is not evidence for this pending transition.
    unconfirmedPrompt = Boolean(attempted && attempted.status !== "sent");
    if (!attempted || unconfirmedPrompt || attempted.reply !== deliveredReply) deliveredReply = null;
    if (unconfirmedPrompt) {
      inboundState.conversationPaused = true;
      if (inboundState.processes) {
        inboundState.processes.promptOwner = null;
        delete inboundState.processes.pendingChoice;
        delete inboundState.processes.auxiliary;
        if (inboundState.processes.service) inboundState.processes.service.promptCurrent = false;
      }
    }
  }
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
    bookingGuard: job ? { jobId: job.id, leaseToken: job.lease_token, conversationId, revision: stateRow?.revision ?? 0 } : undefined,
    canAct,
    businessId,
    message: message.text ?? "",
    hasPhoto: message.attachments.some((a) => a.kind === "image"),
    state: inboundState,
    persistedWorkflowId: stateRow?.workflow_id ?? null,
    previousResponseId: resumedHandoff || staffReplied || unconfirmedPrompt ? null : open?.openai_previous_response_id ?? null,
  });
  const state = turn.nextState;
  const generated = { reply: turn.reply, responseId: turn.previousResponseId };
  if(job) {
    await prepareWorkflowReply(job,conversationId,stateRow?.revision??0,turn);
    return;
  }
  if (!await canAct()) return;
  await supabase
    .from("conversation_states")
    .upsert({
      conversation_id: conversationId,
      business_id: businessId,
      workflow_id: turn.workflowId,
      status: state.step_key === "order_ready" ? "ready" : "in_progress",
      collected: state,
      step_key: state.step_key,
      updated_at: new Date().toISOString(),
    })
    .throwOnError();

  if (turn.handoff && !turn.advisoryHandoff) {
    await supabase.from("conversations").update({ status: "paused", auto_reply: false })
      .eq("id", conversationId).eq("business_id", businessId).throwOnError();
  }
  if (!(turn.handoff && !turn.advisoryHandoff) && !await canAct()) return;
  const send = await adapter.send({
    accountId: String(accountId),
    token: accessToken,
    to: message.externalParticipantId,
    body: generated.reply || promptForStep(state.step_key),
  });

  await supabase.from("agent_turns").insert({
    conversation_id: conversationId,
    business_id: businessId,
    status: send.ok ? "ok" : "failed",
    reply: generated.reply,
    elapsed_ms: Date.now() - started,
  });

  if (send.ok) {
    await supabase.from("messages").insert({
      business_id: businessId,
      conversation_id: conversationId,
      [adapter.connection]: conn.id,
      direction: "outbound",
      source: "agent",
      body: generated.reply,
      external_message_id: send.messageId ?? null,
      delivery_status: "sent",
    });
    await supabase
      .from("conversations")
      .update({
        openai_previous_response_id: generated.responseId,
        last_message_at: new Date().toISOString(),
        last_message_preview: generated.reply.slice(0, 140),
      })
      .eq("id", conversationId);
  } else if (send.code === "token_revoked") {
    await supabase
      .from(adapter.table)
      .update({ status: "revoked", last_error: send.error })
      .eq("id", conn.id);
  }
}
