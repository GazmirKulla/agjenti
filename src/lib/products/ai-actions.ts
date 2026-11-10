"use server";
import { PRODUCT_DESCRIPTION_PROMPT } from "./prompts";
import { withAiUsage } from "@/lib/ai/usage";
import { requireModuleAllowed } from "@/lib/dashboard/modules/entitlements";

import { completeText } from "@/lib/ai/complete";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";


/** Counts the AI requests of this action against the business it authorizes. */
export async function generateProductDescription(...args: Parameters<typeof generateProductDescriptionUnmetered>) {
  return withAiUsage(undefined, () => generateProductDescriptionUnmetered(...args));
}
async function generateProductDescriptionUnmetered(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  try { await requireModuleAllowed(access.business.id, "products"); }
  catch { return { error: "Moduli Produkte nuk lejohet ose lejet nuk u verifikuan." }; }

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
    instructions: PRODUCT_DESCRIPTION_PROMPT,
    input: [
      `Biznesi: ${access.business.name}`,
      `Emri i produktit: ${name}`,
      typeName ? `Lloji: ${typeName}` : "Lloji: i papërcaktuar",
    ].join("\n"),
  });

  if (!result.ok) return { error: result.error };
  return { text: result.text, success: "Përshkrimi u gjenerua." };
}
