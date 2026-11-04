import type { CommandActor } from "@/lib/actions/command-actor";
import { createServiceSupabase } from "@/lib/supabase/service";

/** Existing KnowledgeWorkspace save action, also used by contextual activation. */
export async function saveKnowledgeEntry(actor: CommandActor, formData: FormData) {
  const acc = { business: actor.business };
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body || title.length > 8000 || body.length > 8000) return { error: "Plotëso titullin dhe përmbajtjen (deri në 8000 karaktere)." };
  const expected = String(formData.get("updated_at") ?? "");
  if (!Number.isFinite(Date.parse(expected))) return { error: "Njohuria ndryshoi ose u hoq. Rifresko faqen përpara ruajtjes." };
  // A confirmed revision must be consumed, even for two writes in one millisecond.
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(expected) + 1)).toISOString();
  const activationOnly = formData.get("activation_only") === "true";
  let write = createServiceSupabase().from("knowledge_entries")
    .update(activationOnly ? { is_active: true, updated_at: updatedAt } :
      { title, body, is_active: formData.get("is_active") === "on", updated_at: updatedAt })
    .eq("business_id", acc.business.id).eq("id", String(formData.get("id") ?? ""))
    .eq("updated_at", expected);
  // The revision fences the reviewed content; activation never rewrites text.
  // Keep content out of URL filters so valid long entries fit the gateway limit.
  if (activationOnly) write = write.eq("is_active", false);
  const result = await write.select("id").maybeSingle();
  if (result.error) return { error: "Njohuria nuk u ruajt. Provo përsëri." };
  if (!result.data) return { error: "Njohuria ndryshoi ose u hoq. Rifresko faqen përpara ruajtjes." };
  return { success: "Njohuria u ruajt." };
}

export async function createKnowledgeEntry(actor: CommandActor, form: FormData, id?: string) {
  const title = String(form.get("title") ?? "").trim(), body = String(form.get("body") ?? "").trim();
  const intent = String(form.get("intent_key") ?? "").trim();
  if (!title || !body || title.length > 8000 || body.length > 8000 || intent.length > 120) return { error: "Plotëso titullin dhe përmbajtjen (deri në 8000 karaktere)." };
  const result = await createServiceSupabase().from("knowledge_entries").insert({ ...(id ? { id } : {}), business_id: actor.business.id, title, body, intent_key: intent || null, is_active: form.get("is_active") !== "false" });
  if (result.error) return { error: "Njohuria nuk u krijua. Kontrollo gjendjen para riprovimit." };
  return { success: "Njohuria u krijua." };
}
