import { NextResponse } from "next/server";
import { transportAccess, isTransportId } from "@/lib/conversations/transport-access";
import { sendManualReaction, type ReactionResult } from "@/lib/conversations/provider-reactions";
import { channelAdapter } from "@/lib/conversations/channel";
import { decryptSecret } from "@/lib/crypto/tokens";
import { REACTION_EMOJI } from "@/lib/conversations/reactions";

export const maxDuration = 60;
type Context = { params: Promise<{ id: string; conversationId: string }> };
export async function GET(_request: Request, context: Context) {
  const { id, conversationId } = await context.params;
  const access = await transportAccess(id);
  if (!access || !isTransportId(conversationId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await access.db.rpc("read_message_reactions", { p_business: id, p_user: access.userId, p_conversation: conversationId });
  if (error) return NextResponse.json({ error: "Reactions nuk u ngarkuan." }, { status: 503 });
  return NextResponse.json({ reactions: data }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request, context: Context) {
  const { id, conversationId } = await context.params;
  const access = await transportAccess(id);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const raw = await request.text();
  let body;
  try { if (raw.length > 2000) throw new Error(); body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Kërkesë e pavlefshme." }, { status: 400 }); }
  if (!body || !isTransportId(conversationId) || !isTransportId(body.messageId) || !isTransportId(body.requestId)
    || !Number.isInteger(body.revision) || body.revision < 0 || !["", ...REACTION_EMOJI].includes(body.emoji)
    || body.retryAttempt !== undefined && (!Number.isInteger(body.retryAttempt) || body.retryAttempt < 1 || body.retryAttempt > 3))
    return NextResponse.json({ error: "Kërkesë e pavlefshme." }, { status: 400 });
  const { data: reservation, error } = await access.db.rpc("reserve_message_reaction", {
    p_business: id, p_user: access.userId, p_conversation: conversationId, p_message: body.messageId,
    p_request: body.requestId, p_revision: body.revision, p_emoji: body.emoji, p_retry: body.retryAttempt ?? null,
  });
  if (error) return NextResponse.json({ error: "Reaction nuk u pranua. Rifresko gjendjen dhe kontrollo lejet, mesazhin ose afatin." }, { status: 409 });
  if (!reservation.claimed) return NextResponse.json({ requestId: body.requestId, status: reservation.status });

  let result: ReactionResult;
  try {
    const adapter = channelAdapter(reservation.channel);
    const { data: connection, error: connectionError } = await access.db.from(adapter.table).select(`${adapter.account},access_token_ciphertext,status`)
      .eq("id", reservation.connectionId).eq("business_id", id).maybeSingle();
    if (connectionError || !connection || connection.status !== "connected") throw new Error("Connection unavailable");
    const token = decryptSecret(connection.access_token_ciphertext);
    result = await sendManualReaction({ channel: reservation.channel, accountId: String("phone_number_id" in connection ? connection.phone_number_id : connection.ig_user_id), token,
      to: reservation.participant, messageId: reservation.externalId, emoji: body.emoji });
  } catch {
    // The adapter classifies all attempted HTTP failures as uncertain itself.
    result = { status: "failed", externalId: null, error: "Lidhja e kanalit nuk është e disponueshme." };
  }
  // Retrying this DB acknowledgement never repeats the provider action.
  let persisted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const saved = await access.db.rpc("finish_message_reaction", { p_request: body.requestId, p_token: reservation.token, p_status: result.status, p_external: result.externalId, p_error: result.error });
      if (!saved.error) { persisted = true; break; }
    } catch { /* Same operation remains recoverable/uncertain on GET. */ }
  }
  if (!persisted) return NextResponse.json({ error: "Rezultati nuk u ruajt. Rifresko; mos krijo dërgim të ri.", requestId: body.requestId, status: "uncertain" }, { status: 503 });
  // The authoritative GET also includes any early failed provider receipt.
  return NextResponse.json({ requestId: body.requestId, refresh: true });
}
