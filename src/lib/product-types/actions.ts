"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
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
