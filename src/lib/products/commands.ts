import { changeProductLifecycle } from "./lifecycle";
import { requireActionAccess } from "@/lib/actions/access";

import { visualSelection, saveProductsWithVisualFlow } from "./visual-selection";
import type { CommandActor } from "@/lib/actions/command-actor";
import { createServiceSupabase } from "@/lib/supabase/service";
import { batchSummary, optionalUuid, parseProductBatch } from "./batch";
import { parseProductForm } from "./parse";
import { loadItemSetup } from "@/lib/items/business";
import type { ProductVariant } from "./variants";

/** Replaces the product's variant table (rows with an id are updated in place). */
async function saveVariants(businessId: string, userId: string, productId: string, variants: ProductVariant[] | null) {
  if (variants === null) return {};
  const { error } = await createServiceSupabase().rpc("save_product_variants", { p_business: businessId, p_user: userId, p_product: productId, p_variants: variants });
  if (!error) return {};
  return { error: error.code === "23505" ? "Dy variante kanë të njëjtin kod/SKU ose të njëjtat vlera." : "Produkti u ruajt, por variantet jo. Provo përsëri." };
}
async function newestProductId(businessId: string, name: string) {
  const { data } = await createServiceSupabase().from("products").select("id").eq("business_id", businessId).eq("name", name)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id as string | undefined;
}
import { requireCatalogActivation } from "./activation";
import { capabilityModules, requireRuntimeModules } from "@/lib/capabilities/enforcement";

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
    try { await requireRuntimeModules(businessId, capabilityModules(["order.prepare"])); }
    catch { return { error: "Modulet e porosive duhet të jenë aktive para lidhjes së workflow-t." }; }
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
    ...(parsed.priceMode ? { price_mode: parsed.priceMode, price_max: parsed.priceMax, price_unit: parsed.priceUnit } : {}),
    currency: parsed.currency,
    product_type_id: parsed.productTypeId,
    workflow_id: parsed.workflowId,
    is_active: parsed.isActive,
    ...(parsed.itemKind ? { item_kind: parsed.itemKind, attributes: parsed.attributes, availability: parsed.availability } : {}),
    updated_at: new Date().toISOString(),
    ...(source ? { source } : {}),
  };
}

export async function createProduct(
  actor: CommandActor,
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const user = { id: actor.userId }, access = { business: actor.business };
  try { await requireActionAccess(access.business.id,user.id,"product.create"); } catch(e) { return {error:e instanceof Error?e.message:"Veprimi nuk lejohet."}; }

  const parsed = parseProductForm(form, { fields: (await loadItemSetup(access.business.id)).fields });
  if ("error" in parsed) return parsed;
  if (form.get("save_mode") === "draft") parsed.isActive = false;
  if (parsed.isActive) {
    try { await requireCatalogActivation(access.business.id, [rowFromParsed(access.business.id, parsed)]); }
    catch (error) { return { error: error instanceof Error ? error.message : "Nuk u verifikua katalogu." }; }
  }
  try {
    const visual = visualSelection(parsed.workflowId);
    if (visual) {
      parsed.workflowId = null;
      const check = await assertTypeAndWorkflow(access.business.id, parsed.productTypeId, null);
      if ("error" in check) return check;
      const result = await saveProductsWithVisualFlow(access.business.id, user.id, visual, "create", [rowFromParsed(access.business.id, parsed, "manual")]);
      if (result.error || !parsed.variants?.length) return result;
      const created = await newestProductId(access.business.id, parsed.name);
      const saved = created ? await saveVariants(access.business.id, user.id, created, parsed.variants) : { error: "Produkti u ruajt, por variantet jo. Hape produktin dhe shtoji përsëri." };
      return saved.error ? saved : result;
    }
  } catch { return { error: "Zgjedhja e rrjedhës nuk është e vlefshme." }; }

  const check = await assertTypeAndWorkflow(
    access.business.id,
    parsed.productTypeId,
    parsed.workflowId,
  );
  if ("error" in check) return check;

  const { data: created, error } = await createServiceSupabase()
    .from("products")
    .insert(rowFromParsed(access.business.id, parsed, "manual"))
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ky SKU përdoret tashmë nga një produkt tjetër."
          : "Produkti nuk u krijua. Provo përsëri.",
    };
  }
  if (parsed.variants?.length) {
    const saved = created?.id ? await saveVariants(access.business.id, user.id, created.id, parsed.variants) : { error: "Produkti u ruajt, por variantet jo. Hape produktin dhe shtoji përsëri." };
    if (saved.error) return saved;
  }
  return { success: "Produkti u krijua." };
}

export async function updateProduct(
  actor: CommandActor,
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const user = { id: actor.userId }, access = { business: actor.business };

  const id = String(form.get("product_id") ?? "");
  if (!id) return { error: "Produkti nuk është i vlefshëm." };
  const expected = String(form.get("updated_at") ?? "");
  if (!Number.isFinite(Date.parse(expected))) return { error: "Rifresko produktin përpara ruajtjes." };

  const parsed = parseProductForm(form, { fields: (await loadItemSetup(access.business.id)).fields });
  if ("error" in parsed) return parsed;
  if (form.get("save_mode") === "draft") parsed.isActive = false;
  if (parsed.isActive) {
    try { await requireCatalogActivation(access.business.id, [rowFromParsed(access.business.id, parsed)]); }
    catch (error) { return { error: error instanceof Error ? error.message : "Nuk u verifikua katalogu." }; }
  }
  try {
    const visual = visualSelection(parsed.workflowId);
    if (visual) {
      parsed.workflowId = null;
      const check = await assertTypeAndWorkflow(access.business.id, parsed.productTypeId, null);
      if ("error" in check) return check;
      const result = await saveProductsWithVisualFlow(access.business.id, user.id, visual, "update", [{ ...rowFromParsed(access.business.id, parsed), id, expected_updated_at: form.get("updated_at") }]);
      if (result.error) return result;
      const saved = await saveVariants(access.business.id, user.id, id, parsed.variants);
      return saved.error ? saved : result;
    }
  } catch { return { error: "Zgjedhja e rrjedhës nuk është e vlefshme." }; }


  const check = await assertTypeAndWorkflow(
    access.business.id,
    parsed.productTypeId,
    parsed.workflowId,
  );
  if ("error" in check) return check;

  const { data, error } = await createServiceSupabase()
    .from("products")
    .update({ ...rowFromParsed(access.business.id, parsed), updated_at: new Date(Math.max(Date.now(), Date.parse(expected) + 1)).toISOString() })
    .eq("updated_at", expected)
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
  if (!data) return { error: "Produkti ndryshoi ose u hoq. Rifresko faqen përpara ruajtjes." };
  const saved = await saveVariants(access.business.id, user.id, id, parsed.variants);
  if (saved.error) return saved;
  return { success: "Ndryshimet u ruajtën." };
}

export async function deleteProduct(actor: CommandActor, form: FormData) {
  const user = { id: actor.userId }, access = { business: actor.business };
  const id = String(form.get("product_id") ?? "");
  if (!id) return { error: "Produkti nuk është i vlefshëm." };

  try {
    const result = await changeProductLifecycle({ businessId: access.business.id, userId: user.id, id,
      expected: String(form.get("updated_at") ?? ""), operation: "delete" });
    return { success: result.message };
  } catch (error) { return { error: (error as Error).message }; }
}

export async function linkExternalProduct(actor: CommandActor, form: FormData) {
  const user = { id: actor.userId }, access = { business: actor.business };
  try { await requireActionAccess(access.business.id,user.id,"product.create"); } catch(e) { return {error:e instanceof Error?e.message:"Veprimi nuk lejohet."}; }

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
  if (parsed.isActive) {
    try { await requireCatalogActivation(access.business.id, [rowFromParsed(access.business.id, parsed)]); }
    catch (error) { return { error: error instanceof Error ? error.message : "Nuk u verifikua katalogu." }; }
  }

  const row = {
    ...rowFromParsed(access.business.id, { ...parsed, name }, "linked"),
    external_id: externalId,
  };
  if (existing) {
    const { error } = await db
      .from("products")
      .update(row)
      .eq("id", existing.id).eq("business_id", access.business.id);
    if (error) return { error: "Produkti i lidhur nuk u përditësua." };
  } else {
    const { error } = await db.from("products").insert(row);
    if (error) return { error: "Produkti nuk u lidh. Provo përsëri." };
  }
  return { success: "Produkti u lidh nga katalogu i jashtëm." };
}

export async function importProductBatch(
  actor: CommandActor,
  payload: {
    items?: unknown;
    productTypeId?: string | null;
    workflowId?: string | null;
  },
) {
  const user = { id: actor.userId }, access = { business: actor.business };
  try { await requireActionAccess(access.business.id,user.id,"product.create"); } catch(e) { return {error:e instanceof Error?e.message:"Veprimi nuk lejohet."}; }

  const parsed = parseProductBatch(payload?.items);
  if ("error" in parsed) return parsed;
  const productTypeId = optionalUuid(payload?.productTypeId);
  if (typeof productTypeId !== "string" && productTypeId !== null)
    return productTypeId;

  try {
    const visual = visualSelection(payload?.workflowId);
    if (visual) {
      const check = await assertTypeAndWorkflow(access.business.id, productTypeId, null);
      if ("error" in check) return check;
      const rows = parsed.items.map(item => ({ name: item.name, description: item.description, image_url: item.imageUrl, price_amount: item.price, currency: item.currency, sku: item.sku, external_id: item.externalId, ...(productTypeId ? { product_type_id: productTypeId } : {}) }));
      const result = await saveProductsWithVisualFlow(access.business.id, user.id, visual, "import", rows);
      return result;
    }
  } catch { return { error: "Zgjedhja e rrjedhës nuk është e vlefshme." }; }
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
  return { success: batchSummary(created, updated, skipped) };
}

export async function bulkConfigureProducts(
  actor: CommandActor,
  payload: {
    ids: string[];
    productTypeId: string | null;
    workflowId: string | null;
    mode: "map" | "activate" | "draft";
    expected?: Record<string, string>;
  },
): Promise<{ error?: string; success?: string }> {
  const user = { id: actor.userId }, access = { business: actor.business };
  const ids = Array.isArray(payload?.ids) ? [...new Set(payload.ids)] : [];
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) ||
    !["map", "activate", "draft"].includes(payload.mode)
  )
    return { error: "Zgjidh 1–100 produkte të vlefshme." };
  try {
    const visual = visualSelection(payload.workflowId);
    if (visual && payload.mode !== "draft") {
      if (payload.mode === "activate") return { error: "Ruaj fillimisht lidhjen draft, pastaj aktivizo katalogun pa ndryshuar lidhjen. Publikimi mbetet veprim i veçantë." };
      const check = await assertTypeAndWorkflow(access.business.id, payload.productTypeId, null);
      if ("error" in check) return check;
      const result = await saveProductsWithVisualFlow(access.business.id, user.id, visual, "bind", ids.map(id => ({ id, ...(payload.expected ? { expected_updated_at: payload.expected[id] } : {}), ...(payload.productTypeId ? { product_type_id: payload.productTypeId } : {}) })));
      return result;
    }
  } catch { return { error: "Zgjedhja e rrjedhës nuk është e vlefshme." }; }
  const check = await assertTypeAndWorkflow(
    access.business.id,
    payload.productTypeId,
    payload.mode === "draft" ? null : payload.workflowId,
  );
  if ("error" in check) return check;
  const db = createServiceSupabase();
  const { data: rows, error } = await db
    .from("products")
    .select("id,product_type_id,workflow_id,price_amount,price_mode,price_max,currency,updated_at")
    .eq("business_id", access.business.id)
    .in("id", ids);
  if (error || rows?.length !== ids.length)
    return {
      error: "Disa produkte nuk u gjetën në këtë biznes. Rifresko listën.",
    };
  if (payload.mode === "activate") {
    try { await requireCatalogActivation(access.business.id, rows.map(p => ({ ...p, product_type_id: payload.productTypeId || p.product_type_id }))); }
    catch (error) { return { error: error instanceof Error ? error.message : "Nuk u verifikua katalogu." }; }
  }
  if (payload.mode === "map" && !payload.productTypeId && !payload.workflowId)
    return { error: "Zgjidh llojin ose workflow-n." };
  const changes = {
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
  const saved = await db.rpc("configure_product_batch", {
    p_business: access.business.id, p_user: user.id, p_ids: ids,
    p_expected: payload.expected ?? Object.fromEntries(rows.map(row => [row.id, row.updated_at])),
    p_changes: changes,
  });
  if (saved.error || saved.data !== ids.length) return { error: "Produktet ndryshuan ose grupi nuk u ruajt. Rifresko përpara riprovimit." };
  return { success: `U përditësuan ${saved.data ?? 0} produkte.` };
}
