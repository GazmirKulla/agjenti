"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";

/** Existing KnowledgeWorkspace save action, also used by contextual activation. */
export async function saveKnowledgeEntry(slug: string, formData: FormData) {
  const session = await getSessionUser();
  if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const acc = await requireBusinessAccess(session.id, slug);
  if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
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
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Njohuria u ruajt." };
}
