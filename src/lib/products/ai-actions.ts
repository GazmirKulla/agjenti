"use server";

import { completeText } from "@/lib/ai/complete";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export async function generateProductDescription(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2)
    return { error: "Vendos emrin e produktit përpara se të gjenerosh." };

  const typeId = String(form.get("product_type_id") ?? "").trim();
  let typeName: string | null = null;
  if (typeId) {
    const { data: type } = await createServiceSupabase()
      .from("product_types")
      .select("name")
      .eq("id", typeId)
      .eq("is_active", true)
      .maybeSingle();
    typeName = type?.name ?? null;
  }

  const result = await completeText({
    maxChars: 220,
    instructions: [
      "Je copywriter për katalog produktesh në shqip (Shqipëri/Kosovë).",
      "Shkruaj një përshkrim të shkurtër, 1–2 fjali, maksimumi ~200 karaktere.",
      "Ton profesional dhe i qartë. Pa emoji. Pa çmime. Pa premtime të ekzagjeruara.",
      "Mos shpik specifikime teknike të pasigurta; qëndro i përgjithshëm por i dobishëm.",
      "Kthe vetëm përshkrimin, pa titull dhe pa thonjëza.",
    ].join(" "),
    input: [
      `Biznesi: ${access.business.name}`,
      `Emri i produktit: ${name}`,
      typeName ? `Lloji: ${typeName}` : "Lloji: i papërcaktuar",
    ].join("\n"),
  });

  if (!result.ok) return { error: result.error };
  return { text: result.text, success: "Përshkrimi u gjenerua." };
}
