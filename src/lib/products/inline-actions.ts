"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { productCatalogColumns, type ProductRow } from "./catalog";

export type CatalogField = "workflow_id" | "product_type_id" | "is_active";
type Change = { id: string; field: CatalogField; value: string | boolean | null; updatedAt: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateCatalogField(slug: string, change: Change): Promise<{ error?: string; success?: string; product?: ProductRow }> {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  if (!change || !uuid.test(change.id ?? "") || !["is_active", "workflow_id", "product_type_id"].includes(change.field) ||
    typeof change.updatedAt !== "string" || change.updatedAt.length > 50 || !Number.isFinite(Date.parse(change.updatedAt)) ||
    (change.field === "is_active" ? typeof change.value !== "boolean" : change.value !== null && (typeof change.value !== "string" || !uuid.test(change.value)))) return { error: "Zgjedhja nuk është e vlefshme. Rifresko listën." };
  const db = createServiceSupabase();
  const businessId = access.business.id;
  const current = await db.from("products").select(productCatalogColumns).eq("business_id", businessId).eq("id", change.id).maybeSingle();
  if (current.error || !current.data) return { error: "Produkti nuk u gjet në këtë biznes. Rifresko listën." };
  const row = current.data as ProductRow;
  if (row.updated_at !== change.updatedAt) return { error: "Produkti ndryshoi ndërkohë. Rifresko listën dhe provo përsëri." };
  const changes: Record<string, unknown> = { [change.field]: change.value, updated_at: new Date().toISOString() };
  const next = { ...row, ...changes } as ProductRow;
  // Clearing a mapping explicitly returns a published product to draft.
  const demoted = next.is_active && (!next.product_type_id || !next.workflow_id) && change.field !== "is_active";
  if (demoted) changes.is_active = next.is_active = false;
  if (next.is_active) {
    const missing = [next.price_amount == null || !Number.isFinite(Number(next.price_amount)) || Number(next.price_amount) < 0 ? "çmimin" : "", !next.product_type_id ? "llojin" : "", !next.workflow_id ? "workflow-n" : ""].filter(Boolean);
    if (missing.length) return { error: `Për aktivizim, plotëso ${missing.join(" dhe ")}.` };
  }
  // Validate only references being changed, or all references for activation.
  if (next.product_type_id && (change.field === "product_type_id" || next.is_active)) {
    const type = await db.from("product_types").select("id").eq("id", next.product_type_id).eq("is_active", true).maybeSingle();
    if (type.error || !type.data) return { error: "Lloji nuk është aktiv. Zgjidh një lloj tjetër." };
  }
  if (next.workflow_id && (change.field === "workflow_id" || next.is_active)) {
    const workflow = await db.from("workflows").select("id").eq("business_id", businessId).eq("id", next.workflow_id).maybeSingle();
    if (workflow.error || !workflow.data) return { error: "Workflow-i nuk u gjet në këtë biznes. Zgjidh një tjetër." };
  }
  const saved = await db.from("products").update(changes).eq("business_id", businessId).eq("id", change.id).eq("updated_at", change.updatedAt).select(productCatalogColumns).maybeSingle();
  if (saved.error) return { error: "Ndryshimi nuk u ruajt. Provo përsëri." };
  if (!saved.data) return { error: "Produkti ndryshoi ndërkohë. Rifresko listën dhe provo përsëri." };
  revalidatePath(`/b/${slug}`, "layout");
  return { product: saved.data as ProductRow, success: demoted ? "U ruajt. Produkti kaloi në draft sepse lidhja u hoq." : "U ruajt." };
}
