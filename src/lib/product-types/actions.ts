"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { SIMPLE_STEPS } from "@/lib/workflows/engine";
import { normalizeExternalKey } from "./keys";

async function assertWorkflowInBusiness(
  businessId: string,
  workflowId: string | null,
) {
  if (!workflowId) return null;
  const { data } = await createServiceSupabase()
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("business_id", businessId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function createProductType(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Vendos emrin e llojit (të paktën 2 karaktere)." };
  const description = String(form.get("description") ?? "").trim() || null;
  const externalKey = normalizeExternalKey(
    String(form.get("external_key") ?? "") || name,
  );
  const workflowIdRaw = String(form.get("workflow_id") ?? "").trim();
  const createWorkflow = form.get("create_workflow") === "on";

  const db = createServiceSupabase();
  let workflowId: string | null = null;

  if (workflowIdRaw) {
    workflowId = await assertWorkflowInBusiness(
      access.business.id,
      workflowIdRaw,
    );
    if (!workflowId) return { error: "Workflow-i i zgjedhur nuk u gjet." };
  } else if (createWorkflow) {
    const { data: wf } = await db
      .from("workflows")
      .insert({
        business_id: access.business.id,
        name: `Workflow – ${name}`,
      })
      .select("id")
      .single()
      .throwOnError();
    if (!wf) return { error: "Workflow-i nuk u krijua." };
    await db
      .from("workflow_steps")
      .insert(
        SIMPLE_STEPS.map((s, i) => ({
          workflow_id: wf.id,
          key: s.key,
          position: i,
          kind: s.kind,
          required: true,
          config: { label: s.label },
        })),
      )
      .throwOnError();
    workflowId = wf.id;
  }

  const { error } = await db.from("product_types").insert({
    business_id: access.business.id,
    name,
    description,
    external_key: externalKey,
    workflow_id: workflowId,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ky çelës i jashtëm përdoret tashmë nga një lloj tjetër."
          : "Lloji nuk u krijua. Provo përsëri.",
    };
  }
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Lloji i produktit u krijua." };
}

export async function updateProductType(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!id || name.length < 2)
    return { error: "Vendos emrin e llojit (të paktën 2 karaktere)." };
  const description = String(form.get("description") ?? "").trim() || null;
  const externalKey = normalizeExternalKey(String(form.get("external_key") ?? ""));
  const workflowIdRaw = String(form.get("workflow_id") ?? "").trim() || null;
  const workflowId = await assertWorkflowInBusiness(
    access.business.id,
    workflowIdRaw,
  );
  if (workflowIdRaw && !workflowId)
    return { error: "Workflow-i i zgjedhur nuk u gjet." };

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("product_types")
    .update({
      name,
      description,
      external_key: externalKey,
      workflow_id: workflowId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("business_id", access.business.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ky çelës i jashtëm përdoret tashmë nga një lloj tjetër."
          : "Lloji nuk u përditësua.",
    };
  }
  if (!data) return { error: "Lloji nuk u gjet në këtë biznes." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Ndryshimet u ruajtën." };
}

export async function deleteProductType(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Lloji nuk është i vlefshëm." };

  const db = createServiceSupabase();
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("business_id", access.business.id)
    .eq("product_type_id", id);
  if ((count ?? 0) > 0)
    return {
      error: `Ky lloj është i lidhur me ${count} produkte. Hiq lidhjen te Produktet përpara fshirjes.`,
    };

  const { data, error } = await db
    .from("product_types")
    .delete()
    .eq("id", id)
    .eq("business_id", access.business.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Lloji nuk u fshi." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Lloji u fshi." };
}

export async function seedDefaultProductTypes(slug: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const { data, error } = await createServiceSupabase().rpc(
    "seed_default_product_types",
    { p_business_id: access.business.id },
  );
  if (error) return { error: "Llojet tipike nuk u shtuan. Provo përsëri." };
  revalidatePath(`/b/${slug}`, "layout");
  const created = typeof data === "number" ? data : 0;
  return {
    success:
      created > 0
        ? `U shtuan ${created} lloje tipike me workflow.`
        : "Llojet tipike ekzistojnë tashmë për këtë biznes.",
  };
}
