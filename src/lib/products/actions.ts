"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { parseProductForm } from "./parse";

async function assertTypeAndWorkflow(
  businessId: string,
  productTypeId: string | null,
  workflowId: string | null,
) {
  const db = createServiceSupabase();
  if (productTypeId) {
    const { data: type } = await db
      .from("product_types")
      .select("id")
      .eq("id", productTypeId)
      .eq("is_active", true)
      .maybeSingle();
    if (!type) return { error: "Lloji global nuk u gjet." };
  }
  if (workflowId) {
    const { data: wf } = await db
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!wf) return { error: "Workflow-i nuk u gjet në këtë biznes." };
  }
  return {};
}

function rowFromParsed(
  businessId: string,
  parsed: Exclude<ReturnType<typeof parseProductForm>, { error: string }>,
  source?: "manual" | "linked",
) {
  return {
    business_id: businessId,
    name: parsed.name,
    description: parsed.description,
    sku: parsed.sku,
    image_url: parsed.imageUrl,
    price_amount: parsed.price,
    currency: parsed.currency,
    product_type_id: parsed.productTypeId,
    workflow_id: parsed.workflowId,
    is_active: parsed.isActive,
    updated_at: new Date().toISOString(),
    ...(source ? { source } : {}),
  };
}

export async function createProduct(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const parsed = parseProductForm(form);
  if ("error" in parsed) return parsed;
  const check = await assertTypeAndWorkflow(
    access.business.id,
    parsed.productTypeId,
    parsed.workflowId,
  );
  if ("error" in check) return check;

  const { error } = await createServiceSupabase()
    .from("products")
    .insert(rowFromParsed(access.business.id, parsed, "manual"));
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ky SKU përdoret tashmë nga një produkt tjetër."
          : "Produkti nuk u krijua. Provo përsëri.",
    };
  }
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Produkti u krijua." };
}

export async function updateProduct(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const id = String(form.get("product_id") ?? "");
  if (!id) return { error: "Produkti nuk është i vlefshëm." };

  const parsed = parseProductForm(form, { requirePrice: true });
  if ("error" in parsed) return parsed;
  if (!parsed.productTypeId)
    return { error: "Zgjidh llojin e produktit." };

  const check = await assertTypeAndWorkflow(
    access.business.id,
    parsed.productTypeId,
    parsed.workflowId,
  );
  if ("error" in check) return check;

  const { data, error } = await createServiceSupabase()
    .from("products")
    .update(rowFromParsed(access.business.id, parsed))
    .eq("id", id)
    .eq("business_id", access.business.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ky SKU përdoret tashmë nga një produkt tjetër."
          : "Produkti nuk u përditësua.",
    };
  }
  if (!data) return { error: "Produkti nuk u gjet në këtë biznes." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Ndryshimet u ruajtën." };
}

export async function deleteProduct(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  const id = String(form.get("product_id") ?? "");
  if (!id) return { error: "Produkti nuk është i vlefshëm." };

  const { data, error } = await createServiceSupabase()
    .from("products")
    .delete()
    .eq("id", id)
    .eq("business_id", access.business.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Produkti nuk u fshi." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Produkti u fshi." };
}

export async function linkExternalProduct(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const externalId = String(form.get("external_id") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  if (!externalId || !name)
    return { error: "Produkti i jashtëm nuk është i vlefshëm." };

  const parsed = parseProductForm(form);
  if ("error" in parsed) return parsed;

  const check = await assertTypeAndWorkflow(
    access.business.id,
    parsed.productTypeId,
    parsed.workflowId,
  );
  if ("error" in check) return check;

  const db = createServiceSupabase();
  const { data: existing, error: existingError } = await db
    .from("products")
    .select("id")
    .eq("business_id", access.business.id)
    .eq("external_id", externalId)
    .maybeSingle();
  if (existingError)
    return { error: "Nuk u verifikua lidhja e produktit. Provo përsëri." };

  const row = {
    ...rowFromParsed(access.business.id, { ...parsed, name }, "linked"),
    external_id: externalId,
  };
  if (existing) {
    const { error } = await db.from("products").update(row).eq("id", existing.id);
    if (error) return { error: "Produkti i lidhur nuk u përditësua." };
  } else {
    const { error } = await db.from("products").insert(row);
    if (error) return { error: "Produkti nuk u lidh. Provo përsëri." };
  }
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Produkti u lidh nga katalogu i jashtëm." };
}
