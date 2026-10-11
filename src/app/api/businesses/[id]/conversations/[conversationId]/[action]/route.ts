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
  if (action === "resume") {
    const setup = await loadSetupStatus(businessId);
    if (!setup.connected || (!setup.launched && !isReady(setup)))
      return NextResponse.json(
        { error: "Lidh Instagram-in ose WhatsApp-in dhe përfundo konfigurimin nga Dashboard." },
        { status: 409 },
      );
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
    resume: { status: "active", auto_reply: true },
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
  if (action === "resume") {
    const { data: collected } = await service
      .from("conversation_states")
      .select("collected")
      .eq("conversation_id", conversationId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (collected?.collected && typeof collected.collected === "object") {
      const next = { ...(collected.collected as Record<string, unknown>) };
      delete next.staffHandoff;
      // Explicit false: inbound must not re-arm the "previous request?" clarify prompt.
      next.conversationPaused = false;
      const visual = next.visual as { status?: string; advisory?: boolean } | undefined;
      if (visual?.status === "handoff" && !visual.advisory) {
        next.completedVisual = visual;
        next.visual = { ...visual, status: "completed" };
      }
      if (next.processes && typeof next.processes === "object") {
        const processes = next.processes as Record<string, unknown>;
        processes.active = null;
        processes.promptOwner = null;
        delete processes.pendingChoice;
        delete processes.auxiliary;
      }
      await service
        .from("conversation_states")
        .update({ collected: next, updated_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("business_id", businessId);
    }
    await service
      .from("workflow_inbound_queue")
      .update({
        status: "ignored",
        leased_until: null,
        error: "Staff resumed the agent",
        reply: null,
      })
      .eq("business_id", businessId)
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "processing", "prepared", "sending", "uncertain"]);
  }
  return NextResponse.json({ ok: true });
}
