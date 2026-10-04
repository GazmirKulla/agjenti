"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeExternalKey } from "./keys";

type StepInput = {
  key: string;
  position: number;
  kind: "choice" | "text" | "photo" | "customer" | "confirm";
  label: string;
};

function parseStepsJson(raw: string): StepInput[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return { error: "Hapat e template-it nuk janë JSON i vlefshëm." };
  }
  if (!Array.isArray(parsed) || !parsed.length)
    return { error: "Shto të paktën një hap në template." };
  const kinds = new Set(["choice", "text", "photo", "customer", "confirm"]);
  const steps: StepInput[] = [];
  for (const [i, item] of parsed.entries()) {
    if (!item || typeof item !== "object")
      return { error: "Çdo hap duhet të jetë objekt." };
    const row = item as Record<string, unknown>;
    const key = String(row.key ?? "").trim();
    const kind = String(row.kind ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!key || !kinds.has(kind) || !label)
      return {
        error: `Hapi ${i + 1} ka key/kind/label të pavlefshëm.`,
      };
    steps.push({
      key,
      kind: kind as StepInput["kind"],
      label,
      position: i,
    });
  }
  if (!steps.some((s) => s.kind === "customer"))
    return { error: "Template-i duhet të përfundojë me hapin e klientit." };
  if (steps[steps.length - 1]?.kind !== "customer")
    return { error: "Hapi i fundit i template-it duhet të jetë i tipit customer." };
  return steps;
}

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id)))
    return { error: "Kërkohet qasja e administratorit." as const };
  return { user };
}

export async function createGlobalProductType(form: FormData) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin;
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Vendos emrin e llojit (të paktën 2 karaktere)." };
  const description = String(form.get("description") ?? "").trim() || null;
  const externalKey =
    normalizeExternalKey(String(form.get("external_key") ?? "") || name) || null;
  const sortOrder = Number(String(form.get("sort_order") ?? "0")) || 0;
  const steps = parseStepsJson(String(form.get("steps_json") ?? "[]"));
  if ("error" in steps) return steps;

  const db = createServiceSupabase();
  const { data: type, error } = await db
    .from("product_types")
    .insert({
      name,
      description,
      external_key: externalKey,
      sort_order: sortOrder,
      is_active: form.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error || !type) {
    return {
      error:
        error?.code === "23505"
          ? "Ky çelës i jashtëm përdoret tashmë."
          : "Lloji nuk u krijua.",
    };
  }
  await db
    .from("product_type_steps")
    .insert(
      steps.map((s) => ({
        product_type_id: type.id,
        key: s.key,
        position: s.position,
        kind: s.kind,
        required: true,
        config: { label: s.label },
      })),
    )
    .throwOnError();
  revalidatePath("/admin/product-types");
  return { success: "Lloji global u krijua." };
}

export async function updateGlobalProductType(form: FormData) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin;
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!id || name.length < 2)
    return { error: "Vendos emrin e llojit (të paktën 2 karaktere)." };
  const description = String(form.get("description") ?? "").trim() || null;
  const externalKey =
    normalizeExternalKey(String(form.get("external_key") ?? "")) || null;
  const sortOrder = Number(String(form.get("sort_order") ?? "0")) || 0;
  const steps = parseStepsJson(String(form.get("steps_json") ?? "[]"));
  if ("error" in steps) return steps;

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("product_types")
    .update({
      name,
      description,
      external_key: externalKey,
      sort_order: sortOrder,
      is_active: form.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ky çelës i jashtëm përdoret tashmë."
          : "Lloji nuk u përditësua.",
    };
  }
  if (!data) return { error: "Lloji nuk u gjet." };
  await db.from("product_type_steps").delete().eq("product_type_id", id).throwOnError();
  await db
    .from("product_type_steps")
    .insert(
      steps.map((s) => ({
        product_type_id: id,
        key: s.key,
        position: s.position,
        kind: s.kind,
        required: true,
        config: { label: s.label },
      })),
    )
    .throwOnError();
  revalidatePath("/admin/product-types");
  return { success: "Ndryshimet u ruajtën." };
}

export async function deleteGlobalProductType(form: FormData) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin;
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Lloji nuk është i vlefshëm." };
  const db = createServiceSupabase();
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("product_type_id", id);
  if ((count ?? 0) > 0)
    return {
      error: `Ky lloj përdoret nga ${count} produkte. Hiq lidhjen te produktet përpara fshirjes.`,
    };
  const { data, error } = await db
    .from("product_types")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Lloji nuk u fshi." };
  revalidatePath("/admin/product-types");
  return { success: "Lloji u fshi." };
}

/** Copy global type template steps into a new business workflow and link the product. */
export async function applyTypeSuggestion(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const productId = String(form.get("product_id") ?? "");
  const typeId = String(form.get("product_type_id") ?? "");
  if (!productId || !typeId)
    return { error: "Zgjidh produktin dhe llojin." };

  const db = createServiceSupabase();
  const [{ data: product }, { data: type }, { data: templateSteps }] =
    await Promise.all([
      db
        .from("products")
        .select("id,name")
        .eq("id", productId)
        .eq("business_id", access.business.id)
        .maybeSingle(),
      db
        .from("product_types")
        .select("id,name")
        .eq("id", typeId)
        .eq("is_active", true)
        .maybeSingle(),
      db
        .from("product_type_steps")
        .select("key,position,kind,config")
        .eq("product_type_id", typeId)
        .order("position"),
    ]);
  if (!product) return { error: "Produkti nuk u gjet në këtë biznes." };
  if (!type) return { error: "Lloji global nuk u gjet." };
  if (!templateSteps?.length)
    return { error: "Ky lloj nuk ka template workflow për t’u kopjuar." };

  const workflowName = `Workflow – ${type.name}`;
  const { data: existing } = await db
    .from("workflows")
    .select("id")
    .eq("business_id", access.business.id)
    .eq("name", workflowName)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let workflowId = existing?.id ?? null;
  if (!workflowId) {
    const { data: wf } = await db
      .from("workflows")
      .insert({
        business_id: access.business.id,
        name: workflowName,
      })
      .select("id")
      .single()
      .throwOnError();
    if (!wf) return { error: "Workflow-i nuk u krijua." };
    workflowId = wf.id;
    await db
      .from("workflow_steps")
      .insert(
        templateSteps.map((s) => ({
          workflow_id: workflowId!,
          key: s.key,
          position: s.position,
          kind: s.kind,
          required: true,
          config: s.config ?? {},
        })),
      )
      .throwOnError();
  }

  await db
    .from("products")
    .update({
      product_type_id: typeId,
      workflow_id: workflowId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("business_id", access.business.id)
    .throwOnError();

  revalidatePath(`/b/${slug}`, "layout");
  return {
    success: existing
      ? `Sugjerimi u aplikua: u ripërdor workflow “${type.name}”.`
      : `Sugjerimi u aplikua: workflow “${type.name}” u lidh me produktin.`,
  };
}
