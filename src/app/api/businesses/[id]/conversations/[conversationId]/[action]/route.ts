import { resumeConversation, stopConversation } from "@/lib/conversations/control";
import { NextResponse } from "next/server";
import { requestUserId } from "@/lib/conversations/transport-access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

async function canAccess(userId: string, businessId: string) {
  if (await isPlatformAdmin(userId)) return true;
  const service = createServiceSupabase();
  const { data } = await service
    .from("business_users")
    .select("user_id")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();
  return Boolean(data);
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string; conversationId: string; action: string }>;
  },
) {
  const { id: businessId, conversationId, action } = await context.params;
  // Browser cookies or the native app's bearer token; membership is checked the same way for both.
  const userId = await requestUserId(request);
  if (!userId || !(await canAccess(userId, businessId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const service = createServiceSupabase();
  if (action === "clear-messages") {
    const { data, error } = await service.rpc("clear_conversation_messages", {
      p_business_id: businessId,
      p_conversation_id: conversationId,
    });
    if (error)
      return NextResponse.json(
        { error: "Mesazhet nuk u pastruan. Provo përsëri." },
        { status: 500 },
      );
    if (!data)
      return NextResponse.json(
        { error: "Biseda nuk u gjet në këtë biznes." },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  }
  if (action === "resume") {
    const result = await resumeConversation(businessId, userId, conversationId);
    return NextResponse.json("error" in result ? { error: result.error } : { ok: true }, { status: result.status });
  }

  if (action === "delete") {
    const { data: existing } = await service
      .from("conversations")
      .select(
        "id,channel,whatsapp_participant_id,whatsapp_connection_id,instagram_participant_id,instagram_connection_id",
      )
      .eq("id", conversationId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!existing)
      return NextResponse.json(
        { error: "Biseda nuk u gjet në këtë biznes." },
        { status: 404 },
      );
    const participant =
      existing.channel === "whatsapp"
        ? existing.whatsapp_participant_id
        : existing.instagram_participant_id;
    const connection =
      existing.channel === "whatsapp"
        ? existing.whatsapp_connection_id
        : existing.instagram_connection_id;
    if (participant && connection) {
      await service
        .from("workflow_inbound_queue")
        .update({
          status: "ignored",
          leased_until: null,
          error: "Conversation deleted",
        })
        .eq("business_id", businessId)
        .eq("connection_id", connection)
        .eq("participant_id", participant)
        .in("status", ["queued", "processing", "prepared", "sending"]);
    }
    const { data, error } = await service
      .from("conversations")
      .delete()
      .eq("id", conversationId)
      .eq("business_id", businessId)
      .select("id")
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: "Biseda nuk u fshi. Provo përsëri." },
        { status: 500 },
      );
    if (!data)
      return NextResponse.json(
        { error: "Biseda nuk u gjet në këtë biznes." },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  }

  if (action !== "pause" && action !== "complete") return NextResponse.json({ error: "Veprim i panjohur." }, { status: 404 });
  const result = await stopConversation(businessId, conversationId, action);
  return NextResponse.json("error" in result ? { error: result.error } : { ok: true }, { status: result.status });
}
