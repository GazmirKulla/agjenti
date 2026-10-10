"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { batchSummary, optionalUuid, parseProductBatch } from "./batch";
import { parseProductForm } from "./parse";
import { publishedProductBindings } from "./workflow-binding";

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

export async function createProduct(
  slug: string,
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const parsed = parseProductForm(form);
  if ("error" in parsed) return parsed;
  if (form.get("save_mode") === "draft") parsed.isActive = false;
  if (
    parsed.isActive &&
    (parsed.price == null || !parsed.productTypeId || !parsed.workflowId)
  )
    return {
      error:
        "Ruaje produktin si draft, lidhe me rrjedhën te Workflow dhe publiko lidhjen. Për aktivizim duhen edhe çmimi dhe lloji.",
    };
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

export async function updateProduct(
  slug: string,
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const id = String(form.get("product_id") ?? "");
  if (!id) return { error: "Produkti nuk është i vlefshëm." };

  const parsed = parseProductForm(form);
  if ("error" in parsed) return parsed;
  if (form.get("save_mode") === "draft") parsed.isActive = false;
  let hasVisualFlow = false;
  if (parsed.isActive && !parsed.workflowId) {
    try { hasVisualFlow = (await publishedProductBindings(access.business.id)).has(id); }
    catch { return { error: "Nuk u verifikua rrjedha e publikuar. Provo përsëri." }; }
  }
  if (
    parsed.isActive &&
    (parsed.price == null || !parsed.productTypeId || (!parsed.workflowId && !hasVisualFlow))
  )
    return {
      error:
        "Për aktivizim duhen çmimi, lloji dhe një rrjedhë e publikuar. Mund ta ruash si draft dhe ta lidhësh te Workflow.",
    };

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
  let hasVisualFlow = false;
  if (parsed.isActive && !parsed.workflowId && existing) {
    try { hasVisualFlow = (await publishedProductBindings(access.business.id)).has(existing.id); }
    catch { return { error: "Nuk u verifikua rrjedha e publikuar. Provo përsëri." }; }
  }
  if (parsed.isActive && (parsed.price == null || !parsed.productTypeId || (!parsed.workflowId && !hasVisualFlow)))
    return { error: "Për aktivizim duhen çmimi, lloji dhe një rrjedhë e publikuar. Ruaje si draft për ta lidhur te Workflow." };

  const row = {
    ...rowFromParsed(access.business.id, { ...parsed, name }, "linked"),
    external_id: externalId,
  };
  if (existing) {
    const { error } = await db
      .from("products")
      .update(row)
      .eq("id", existing.id);
    if (error) return { error: "Produkti i lidhur nuk u përditësua." };
  } else {
    const { error } = await db.from("products").insert(row);
    if (error) return { error: "Produkti nuk u lidh. Provo përsëri." };
  }
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Produkti u lidh nga katalogu i jashtëm." };
}

export async function importProductBatch(
  slug: string,
  payload: {
    items?: unknown;
    productTypeId?: string | null;
    workflowId?: string | null;
  },
) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const parsed = parseProductBatch(payload?.items);
  if ("error" in parsed) return parsed;
  const productTypeId = optionalUuid(payload?.productTypeId);
  if (typeof productTypeId !== "string" && productTypeId !== null)
    return productTypeId;
  const workflowId = optionalUuid(payload?.workflowId);
  if (typeof workflowId !== "string" && workflowId !== null) return workflowId;

  const check = await assertTypeAndWorkflow(
    access.business.id,
    productTypeId,
    workflowId,
  );
  if ("error" in check) return check;

  const db = createServiceSupabase();
  const externalIds = parsed.items.flatMap((item) =>
    item.externalId ? [item.externalId] : [],
  );
  const existing = new Map<string, string>();
  if (externalIds.length) {
    const { data, error } = await db
      .from("products")
      .select("id, external_id")
      .eq("business_id", access.business.id)
      .in("external_id", externalIds);
    if (error)
      return { error: "Produktet ekzistuese nuk u verifikuan. Provo përsëri." };
    for (const row of (data ?? []) as {
      id: string;
      external_id: string | null;
    }[]) {
      if (row.external_id && row.id) existing.set(row.external_id, row.id);
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = parsed.skipped;
  let reason = "";
  const now = new Date().toISOString();

  for (const item of parsed.items) {
    const fields = {
      name: item.name,
      description: item.description,
      image_url: item.imageUrl,
      price_amount: item.price,
      currency: item.currency,
      updated_at: now,
      ...(productTypeId ? { product_type_id: productTypeId } : {}),
      ...(workflowId ? { workflow_id: workflowId } : {}),
      ...(item.sku ? { sku: item.sku } : {}),
    };
    const currentId = item.externalId
      ? existing.get(item.externalId)
      : undefined;
    const result = currentId
      ? await db
          .from("products")
          .update(fields)
          .eq("id", currentId)
          .eq("business_id", access.business.id)
      : await db.from("products").insert({
          ...fields,
          business_id: access.business.id,
          is_active: false,
          source: "manual",
          ...(item.externalId ? { external_id: item.externalId } : {}),
        });
    if (result.error) {
      skipped += 1;
      if (!reason) {
        reason =
          result.error.code === "23505"
            ? "Një SKU është i zënë."
            : "Një produkt nuk u ruajt.";
      }
    } else if (currentId) updated += 1;
    else created += 1;
  }

  if (!created && !updated)
    return { error: reason || "Asnjë produkt nuk u ruajt." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: batchSummary(created, updated, skipped) };
}

export async function bulkConfigureProducts(
  slug: string,
  payload: {
    ids: string[];
    productTypeId: string | null;
    workflowId: string | null;
    mode: "map" | "activate" | "draft";
  },
): Promise<{ error?: string; success?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  const ids = Array.isArray(payload?.ids) ? [...new Set(payload.ids)] : [];
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) ||
    !["map", "activate", "draft"].includes(payload.mode)
  )
    return { error: "Zgjidh 1–100 produkte të vlefshme." };
  const check = await assertTypeAndWorkflow(
    access.business.id,
    payload.productTypeId,
    payload.workflowId,
  );
  if ("error" in check) return check;
  const db = createServiceSupabase();
  const { data: rows, error } = await db
    .from("products")
    .select("id,product_type_id,workflow_id,price_amount")
    .eq("business_id", access.business.id)
    .in("id", ids);
  if (error || rows?.length !== ids.length)
    return {
      error: "Disa produkte nuk u gjetën në këtë biznes. Rifresko listën.",
    };
  let visualIds: string[] = [];
  if (payload.mode === "activate" && !payload.workflowId && rows.some(p => !p.workflow_id)) {
    try { visualIds = [...(await publishedProductBindings(access.business.id)).keys()].filter(id => ids.includes(id)); }
    catch { return { error: "Nuk u verifikuan rrjedhat e publikuara. Provo përsëri." }; }
  }
  if (
    payload.mode === "activate" &&
    rows.some(
      (p) =>
        !(payload.productTypeId || p.product_type_id) ||
        !(payload.workflowId || p.workflow_id || visualIds.includes(p.id)) ||
        p.price_amount == null,
    )
  )
    return {
      error:
        "Çdo produkt duhet të ketë çmim, lloj dhe workflow përpara aktivizimit.",
    };
  if (payload.mode === "map" && !payload.productTypeId && !payload.workflowId)
    return { error: "Zgjidh llojin ose workflow-n." };
  const changes = {
    updated_at: new Date().toISOString(),
    ...(payload.mode !== "draft" && payload.productTypeId
      ? { product_type_id: payload.productTypeId }
      : {}),
    ...(payload.mode !== "draft" && payload.workflowId
      ? { workflow_id: payload.workflowId }
      : {}),
    ...(payload.mode === "activate"
      ? { is_active: true }
      : payload.mode === "draft"
        ? { is_active: false }
        : {}),
  };
  let mutation = db
    .from("products")
    .update(changes)
    .eq("business_id", access.business.id)
    .in("id", ids);
  if (payload.mode === "activate") {
    mutation = mutation.not("price_amount", "is", null);
    if (!payload.productTypeId)
      mutation = mutation.not("product_type_id", "is", null);
    if (!payload.workflowId) mutation = visualIds.length
      ? mutation.or(`workflow_id.not.is.null,id.in.(${visualIds.join(",")})`)
      : mutation.not("workflow_id", "is", null);
  }
  const saved = await mutation.select("id");
  if (saved.error) return { error: "Ndryshimet nuk u ruajtën." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: `U përditësuan ${saved.data?.length ?? 0} produkte.` };
}
