import { processBookingTurn } from "@/lib/calendar/agent";
import { processAgentTurn } from "./process-agent-turn";
import { decryptSecret } from "@/lib/crypto/tokens";
import { sendInstagramText } from "@/lib/instagram/send";
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
  ig_user_id: string;
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
): Promise<void> {
  const accountId =
    typeof message.contextMetadata?.instagramAccountId === "string"
      ? message.contextMetadata.instagramAccountId
      : null;

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
  if (await alreadyHandled(message.externalMessageId)) {
    console.warn("[inbound] early return: alreadyHandled", {
      externalMessageId: message.externalMessageId,
    });
    return;
  }

  const supabase = createServiceSupabase();
  const { data: webhookEvent, error: webhookEventError } = await supabase
    .from("webhook_events")
    .insert({
      external_event_id: message.externalMessageId,
      status: "received",
    })
    .select("id")
    .maybeSingle();
  if (webhookEventError?.code === "23505") return;
  if (webhookEventError) throw new Error("Nuk u ruajt mesazhi hyrës.");
  console.log("[inbound] webhook_events insert", {
    ok: !webhookEventError,
    id: webhookEvent?.id ?? null,
    error: null,
    externalMessageId: message.externalMessageId,
  });

  const { data: connection, error: connectionError } = await supabase
    .from("instagram_connections")
    .select("id,business_id,ig_user_id,access_token_ciphertext,status")
    .eq("ig_user_id", accountId)
    .neq("status", "disconnected")
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
  let accessToken: string;
  try {
    accessToken = decryptSecret(conn.access_token_ciphertext);
  } catch (error) {
    console.error("[inbound] token decrypt failed", error);
    await supabase
      .from("instagram_connections")
      .update({ status: "revoked", last_error: "decrypt_failed" })
      .eq("id", conn.id);
    return;
  }

  let username = message.senderUsername;
  let displayName = message.senderDisplayName;
  if (!username && !displayName) {
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
    .eq("instagram_participant_id", message.externalParticipantId)
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
      .eq("instagram_participant_id", message.externalParticipantId)
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
        instagram_participant_id: message.externalParticipantId,
        participant_username: username,
        participant_display_name: displayName,
        instagram_connection_id: conn.id,
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
    console.warn("[inbound] early return: no conversationId");
    return;
  }

  const { data: insertedMessage, error: messageInsertError } = await supabase
    .from("messages")
    .insert({
      business_id: businessId,
      conversation_id: conversationId,
      instagram_connection_id: conn.id,
      direction: "inbound",
      source: "customer",
      body: message.text,
      external_message_id: message.externalMessageId,
      media: message.attachments,
      delivery_status: "delivered",
    })
    .select("id")
    .maybeSingle();
  console.log("[inbound] messages insert", {
    ok: !messageInsertError,
    messageId: insertedMessage?.id ?? null,
    conversationId,
    error: messageInsertError?.message ?? null,
  });

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

  const { data: stateRow } = await supabase
    .from("conversation_states")
    .select("collected, workflow_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  // A paused handoff returns above. Reaching this point with its saved state means
  // staff explicitly resumed the conversation; start a new run without erasing data.
  const inboundState = structuredClone((stateRow?.collected as ConversationStatePayload | null) ?? emptyState());
  if (inboundState.visual?.status === "handoff") {
    inboundState.completedVisual = structuredClone(inboundState.visual);
    inboundState.visual.status = "completed";
  }
  const started = Date.now();
  const bookingTurn = await processBookingTurn({
    businessId, message: message.text ?? "", conversationKey: conversationId,
    state: inboundState,
  });
  const turn = bookingTurn ?? await processAgentTurn({
    businessId,
    message: message.text ?? "",
    hasPhoto: message.attachments.some((a) => a.kind === "image"),
    state: inboundState,
    previousResponseId: open?.openai_previous_response_id ?? null,
  });
  const state = turn.nextState;
  const generated = { reply: turn.reply, responseId: turn.previousResponseId };
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

  if (turn.handoff) {
    await supabase.from("conversations").update({ status: "paused", auto_reply: false })
      .eq("id", conversationId).eq("business_id", businessId).throwOnError();
  }
  const send = await sendInstagramText({
    accountId: conn.ig_user_id,
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
      instagram_connection_id: conn.id,
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
      .from("instagram_connections")
      .update({ status: "revoked", last_error: send.error })
      .eq("id", conn.id);
  }
}
