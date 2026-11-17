"use server";
import { PRODUCT_DESCRIPTION_PROMPT, PRODUCT_FIELDS_PROMPT } from "./prompts";
import { loadItemSetup } from "@/lib/items/business";
import { attributeFields, variantFields } from "@/lib/items/fields";
import { ITEM_KINDS, fieldsOf } from "@/lib/items/kinds";
import { describeFields, parseFieldSuggestion, type FieldSuggestion } from "@/lib/items/field-suggest";
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
    instructions: PRODUCT_DESCRIPTION_PROMPT(),
    input: [
      `Biznesi: ${access.business.name}`,
      `Emri i produktit: ${name}`,
      typeName ? `Lloji: ${typeName}` : "Lloji: i papërcaktuar",
    ].join("\n"),
  });

  if (!result.ok) return { error: result.error };
  return { text: result.text, success: "Përshkrimi u gjenerua." };
}

/** Suggests values for the product's fields from its name and description.
 * Read-only: the form fills the empty fields and the owner saves them. */
export async function suggestProductFields(...args: Parameters<typeof suggestProductFieldsUnmetered>) {
  return withAiUsage(undefined, () => suggestProductFieldsUnmetered(...args));
}
async function suggestProductFieldsUnmetered(slug: string, form: FormData): Promise<{ error: string } | { suggestion: FieldSuggestion }> {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  try { await requireModuleAllowed(access.business.id, "products"); }
  catch { return { error: "Moduli Produkte nuk lejohet ose lejet nuk u verifikuan." }; }

  const name = String(form.get("name") ?? "").trim().slice(0, 200);
  const description = String(form.get("description") ?? "").trim().slice(0, 4000);
  const sku = String(form.get("sku") ?? "").trim().slice(0, 80);
  if (name.length < 2 && description.length < 10)
    return { error: "Shkruaj emrin dhe përshkrimin e produktit, që AI të ketë nga t’i lexojë të dhënat." };

  const setup = await loadItemSetup(access.business.id);
  const requested = String(form.get("item_kind") ?? "");
  const kindId = ITEM_KINDS[requested] ? requested : setup.kind.id;
  const attributes = fieldsOf(kindId, attributeFields(setup.fields));
  const choices = variantFields(setup.fields);
  if (!attributes.length && !choices.length) return { error: "Biznesi nuk ka ende fusha produkti. Shtoji te Fushat." };

  const result = await completeText({
    maxChars: 4000,
    instructions: PRODUCT_FIELDS_PROMPT(),
    input: [
      `Emri: ${name || "—"}`,
      sku ? `Kodi: ${sku}` : null,
      `Përshkrimi: ${description || "—"}`,
      `Fushat: ${JSON.stringify(describeFields(attributes, choices))}`,
    ].filter(Boolean).join("\n"),
  });
  if (!result.ok) return { error: result.error };
  return { suggestion: parseFieldSuggestion(result.text, attributes, choices) };
}
