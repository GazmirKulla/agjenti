import { loadSetupStatus } from "@/lib/setup/status";
import { isReady } from "@/lib/setup/model";
import { createServiceSupabase } from "@/lib/supabase/service";
type ControlResult = { ok: true; status: 200 } | { error: string; status: number };
function response(value: { ok: true } | { error: string }, options?: { status: number }): ControlResult {
  return "error" in value ? { error: value.error, status: options?.status ?? 500 } : { ok: true, status: 200 };
}
/** Caller supplies a verified actor; the RPC rechecks membership and revision. */
export async function resumeConversation(businessId: string, userId: string, conversationId: string, expectedRevision?: number): Promise<ControlResult> {
  const service = createServiceSupabase();

    const setup = await loadSetupStatus(businessId);
    if (!setup.connected || (!setup.launched && !isReady(setup)))
      return response(
        { error: "Lidh Instagram-in ose WhatsApp-in dhe përfundo konfigurimin nga Dashboard." },
        { status: 409 },
      );
    const { data: snapshot, error: readError } = await service
      .from("conversation_states").select("revision")
      .eq("conversation_id", conversationId).eq("business_id", businessId).maybeSingle();
    if (readError) return response({ error: "Gjendja nuk u verifikua. Provo përsëri." }, { status: 500 });
    if (!snapshot) return response({ error: "Gjendja e bisedës nuk u gjet në këtë biznes." }, { status: 404 });
    if (!Number.isInteger(snapshot.revision)) return response({ error: "Gjendja e bisedës nuk është e vlefshme." }, { status: 409 });
    if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) return response({ error: "Biseda ndryshoi. Rishqyrtoje." }, { status: 409 });
    try {
      const { data: revision, error } = await service.rpc("resume_conversation_agent", {
        p_business: businessId, p_user: userId, p_conversation: conversationId, p_revision: snapshot.revision,
      });
      if (error) {
        const conflict = error.code === "55P03" || error.code === "40P01" || ["stale_state", "state_missing", "state_invalid", "queue_transition_conflict", "delivery_unverified"].includes(error.message);
        const status = error.message === "unauthorized" ? 403 : error.message === "invalid_conversation" ? 404 : conflict ? 409 : 500;
        return response({ error: error.message === "delivery_unverified"
          ? "Një dërgim është ende në proces ose i paverifikuar. Verifiko rezultatin para rifillimit."
          : conflict ? "Biseda ndryshoi ose po përpunohet. Rifresko dhe provo përsëri."
          : "Agjenti nuk u rifillua. Kontrollo qasjen dhe provo përsëri." }, { status });
      }
      if (revision !== snapshot.revision + 1) return response({ error: "Rifillimi nuk u konfirmua. Rifresko gjendjen para një prove tjetër." }, { status: 500 });
      return response({ ok: true });
    } catch {
      return response({ error: "Rezultati i rifillimit nuk u konfirmua. Rifresko gjendjen; mos e përsërit automatikisht." }, { status: 500 });
    }
}
export async function stopConversation(businessId: string, conversationId: string, action: "pause" | "complete", expectedUpdatedAt?: string): Promise<ControlResult> {
  const state = { status: action === "pause" ? "paused" : "completed", auto_reply: false };
  let query = createServiceSupabase()
    .from("conversations")
    .update({ ...state, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("business_id", businessId);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select("id")
    .maybeSingle();
  if (error)
    return response(
      { error: "Statusi i bisedës nuk u ndryshua. Provo përsëri." },
      { status: 500 },
    );
  if (!data)
    return response(
      { error: "Biseda nuk u gjet në këtë biznes." },
      { status: 404 },
    );
  return response({ ok: true });
}
