import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedBusinessEcho } from "@/lib/instagram/types";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import { createServiceSupabase } from "@/lib/supabase/service";
import { channelAdapter } from "./channel";

/**
 * Messages the business sent from the native Instagram / WhatsApp Business app.
 * They are stored as outbound `staff` rows (sent_via marks the app) so the
 * inbox and the agent's history both see them. They are never queued as a
 * customer turn, so no agent reply can follow from an echo, and a stored echo
 * pauses the agent for that conversation (human hand-off).
 *
 * Instagram also echoes messages Agjenti sent through the Send API. Those are
 * already stored by the transport, so an echo is dropped when its mid, or a
 * recent part with the same text, belongs to an Agjenti send.
 */
export type EchoOutcome = "stored" | "duplicate" | "ours" | "unknown_connection" | "in_flight" | "failed";

type Options = { db?: SupabaseClient; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> };
const OWN_SEND_TEXT_WINDOW_MS = 10 * 60_000;
const ACCEPTED_PART = ["sending", "sent", "delivered", "read", "uncertain"];

export async function persistBusinessEchoes(echoes: NormalizedBusinessEcho[], options: Options = {}) {
  const outcomes: EchoOutcome[] = [];
  for (const echo of echoes) {
    try { outcomes.push(await persistBusinessEcho(echo, options)); }
    catch (error) {
      console.error("[echo] persist failed", { channel: echo.channel, error: error instanceof Error ? error.message : error });
      outcomes.push("failed");
    }
  }
  return outcomes;
}

export async function persistBusinessEcho(echo: NormalizedBusinessEcho, options: Options = {}): Promise<EchoOutcome> {
  const db = options.db ?? createServiceSupabase();
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const adapter = channelAdapter(echo.channel);
  const { data: connection, error: connectionError } = await db.from(adapter.table).select("id,business_id")
    .eq(adapter.account, echo.accountId).eq("status", "connected").maybeSingle();
  if (connectionError) throw new Error("Echo connection lookup failed");
  if (!connection) return "unknown_connection";

  // An Agjenti send may still be between the provider response and its DB
  // receipt; wait for it so its own echo is recognised instead of duplicated.
  const deadline = Date.now() + (options.waitMs ?? 20_000);
  for (;;) {
    const { count, error } = await db.from("workflow_inbound_queue").select("id", { count: "exact", head: true })
      .eq("connection_id", connection.id).eq("participant_id", echo.externalParticipantId).eq("status", "sending");
    if (error) throw new Error("Echo in-flight check failed");
    if (!count) break;
    if (Date.now() >= deadline) return "in_flight";
    await sleep(options.pollMs ?? 2_000);
  }

  const { data: ownPart, error: partError } = await db.from("message_transport_parts").select("id")
    .eq("connection_id", connection.id).eq("external_message_id", echo.externalMessageId).limit(1).maybeSingle();
  if (partError) throw new Error("Echo transport lookup failed");
  if (ownPart) return "ours";
  if (echo.text) {
    const since = new Date(echo.timestamp.getTime() - OWN_SEND_TEXT_WINDOW_MS).toISOString();
    const { data: sameText, error } = await db.from("message_transport_parts").select("id")
      .eq("connection_id", connection.id).eq("participant_id", echo.externalParticipantId).eq("body", echo.text)
      .in("status", ACCEPTED_PART).gte("updated_at", since).limit(1).maybeSingle();
    if (error) throw new Error("Echo transport text lookup failed");
    if (sameText) return "ours";
  }
  const { data: existing, error: existingError } = await db.from("messages").select("id")
    .eq(adapter.connection, connection.id).eq("external_message_id", echo.externalMessageId).limit(1).maybeSingle();
  if (existingError) throw new Error("Echo message lookup failed");
  if (existing) return "duplicate";

  const conversationId = await echoConversation(db, echo, connection);
  const at = echo.timestamp.toISOString();
  const { error: insertError } = await db.from("messages").insert({
    business_id: connection.business_id,
    conversation_id: conversationId,
    [adapter.connection]: connection.id,
    direction: "outbound",
    source: "staff",
    sent_via: echo.channel === "whatsapp" ? "whatsapp_app" : "instagram_app",
    body: echo.text,
    media: echo.attachments.length ? echo.attachments : null,
    external_message_id: echo.externalMessageId,
    delivery_status: "sent",
    created_at: at,
  });
  if (insertError?.code === "23505") return "duplicate"; // Meta webhook retry raced us.
  if (insertError) throw new Error(`Echo insert failed: ${insertError.message}`);
  // Never touches last_inbound_at: the customer-service window stays the customer's.
  const { error: updateError } = await db.from("conversations")
    .update({ last_message_at: at, last_message_preview: echo.text?.slice(0, 140) ?? "[media]" })
    .eq("id", conversationId).eq("business_id", connection.business_id).lte("last_message_at", at);
  if (updateError) console.warn("[echo] conversation preview update failed", updateError.message);
  // A person answered from the app: hand the thread to staff, exactly like a
  // takeover. begin_workflow_send then discards any agent output still queued
  // for this conversation; the owner resumes the agent from the inbox.
  const { error: pauseError } = await db.from("conversations")
    .update({ status: "paused", auto_reply: false, updated_at: new Date().toISOString() })
    .eq("id", conversationId).eq("business_id", connection.business_id).eq("status", "active");
  if (pauseError) throw new Error(`Echo hand-off failed: ${pauseError.message}`);
  return "stored";
}

async function echoConversation(db: SupabaseClient, echo: NormalizedBusinessEcho, connection: { id: string; business_id: string }) {
  const adapter = channelAdapter(echo.channel);
  const { data: open, error } = await db.from("conversations").select("id")
    .eq("business_id", connection.business_id).eq(adapter.participant, echo.externalParticipantId)
    .eq(adapter.connection, connection.id).in("status", ["active", "paused"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Echo conversation lookup failed");
  if (open?.id) return open.id as string;

  // The owner started the chat from the app: open the thread the customer's
  // reply will continue, already handed to staff (see the pause above).
  const { data: last } = await db.from("conversations").select("id")
    .eq("business_id", connection.business_id).eq(adapter.participant, echo.externalParticipantId)
    .eq(adapter.connection, connection.id).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const at = echo.timestamp.toISOString();
  const { data: created, error: createError } = await db.from("conversations").insert({
    business_id: connection.business_id,
    customer_id: null,
    [adapter.participant]: echo.externalParticipantId,
    channel: echo.channel,
    [adapter.connection]: connection.id,
    status: "paused",
    auto_reply: false,
    previous_conversation_id: last?.id ?? null,
    last_message_at: at,
    last_message_preview: echo.text?.slice(0, 140) ?? "[media]",
    unread_count: 0,
  }).select("id").single();
  if (createError || !created?.id) throw new Error("Echo conversation create failed");
  const { error: stateError } = await db.from("conversation_states").insert({
    conversation_id: created.id, business_id: connection.business_id, status: "in_progress",
    collected: initialSnapshot(connection.business_id, created.id, "live"),
  });
  if (stateError) console.warn("[echo] conversation_states insert failed", stateError.message);
  return created.id as string;
}
