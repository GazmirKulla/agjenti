import { loadSetupStatus } from "@/lib/setup/status";
import { isReady } from "@/lib/setup/model";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
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
  _request: Request,
  context: {
    params: Promise<{ id: string; conversationId: string; action: string }>;
  },
) {
  const { id: businessId, conversationId, action } = await context.params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await canAccess(user.id, businessId))) {
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
    const setup = await loadSetupStatus(businessId);
    if (!setup.connected || (!setup.launched && !isReady(setup)))
      return NextResponse.json(
        { error: "Lidh Instagram-in ose WhatsApp-in dhe përfundo konfigurimin nga Dashboard." },
        { status: 409 },
      );
    const { data: snapshot, error: readError } = await service
      .from("conversation_states").select("revision")
      .eq("conversation_id", conversationId).eq("business_id", businessId).maybeSingle();
    if (readError) return NextResponse.json({ error: "Gjendja nuk u verifikua. Provo përsëri." }, { status: 500 });
    if (!snapshot) return NextResponse.json({ error: "Gjendja e bisedës nuk u gjet në këtë biznes." }, { status: 404 });
    if (!Number.isInteger(snapshot.revision)) return NextResponse.json({ error: "Gjendja e bisedës nuk është e vlefshme." }, { status: 409 });
    try {
      const { data: revision, error } = await service.rpc("resume_conversation_agent", {
        p_business: businessId, p_user: user.id, p_conversation: conversationId, p_revision: snapshot.revision,
      });
      if (error) {
        const conflict = error.code === "55P03" || error.code === "40P01" || ["stale_state", "state_missing", "state_invalid", "queue_transition_conflict", "delivery_unverified"].includes(error.message);
        const status = error.message === "unauthorized" ? 403 : error.message === "invalid_conversation" ? 404 : conflict ? 409 : 500;
        return NextResponse.json({ error: error.message === "delivery_unverified"
          ? "Një dërgim është ende në proces ose i paverifikuar. Verifiko rezultatin para rifillimit."
          : conflict ? "Biseda ndryshoi ose po përpunohet. Rifresko dhe provo përsëri."
          : "Agjenti nuk u rifillua. Kontrollo qasjen dhe provo përsëri." }, { status });
      }
      if (revision !== snapshot.revision + 1) return NextResponse.json({ error: "Rifillimi nuk u konfirmua. Rifresko gjendjen para një prove tjetër." }, { status: 500 });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Rezultati i rifillimit nuk u konfirmua. Rifresko gjendjen; mos e përsërit automatikisht." }, { status: 500 });
    }
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

  const states: Record<string, { status: string; auto_reply: boolean }> = {
    pause: { status: "paused", auto_reply: false },
    complete: { status: "completed", auto_reply: false },
  };
  const state = Object.hasOwn(states, action) ? states[action] : undefined;
  if (!state)
    return NextResponse.json({ error: "Veprim i panjohur." }, { status: 404 });
  const { data, error } = await service
    .from("conversations")
    .update({ ...state, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .select("id")
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: "Statusi i bisedës nuk u ndryshua. Provo përsëri." },
      { status: 500 },
    );
  if (!data)
    return NextResponse.json(
      { error: "Biseda nuk u gjet në këtë biznes." },
      { status: 404 },
    );
  return NextResponse.json({ ok: true });
}
