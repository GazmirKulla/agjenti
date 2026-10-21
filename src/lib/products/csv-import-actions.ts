"use server";
import { requireActionAccess } from "@/lib/actions/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { evaluateImport } from "./import-evaluation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { revalidatePath } from "next/cache";
import { assertImportAccess, sealImportSource, prepareImport, commitImport } from "./import-service";
import { withCsvHeaders, type ImportOptions, type ImportPreview } from "./import-model";

async function accessFor(slug: string) {
  const user = await getSessionUser();
  if (!user) throw Error("Hyr përsëri në llogari.");
  const member = await requireBusinessAccess(user.id, slug);
  if (!member) throw Error("Nuk ke qasje në këtë biznes.");
  const profile = await loadDashboardProfile(member.business.id);
  const access = { userId: user.id, businessId: member.business.id, catalogSource: member.business.catalog_source, modules: profile.enabledModules };
  assertImportAccess(access);
  await requireActionAccess(access.businessId,user.id,"product.create");
  return access;
}
export async function uploadProductCsv(slug: string, raw: string, name: string, withoutHeaders = false) {
  try { return { source: sealImportSource(await accessFor(slug), withoutHeaders ? withCsvHeaders(raw) : raw, String(name).slice(0, 120)) }; }
  catch (e) { return { error: (e as Error).message }; }
}
export async function reviewProductCsv(slug: string, source: string, options: ImportOptions) {
  try { return { preview: await prepareImport(await accessFor(slug), source, options) }; }
  catch (e) { return { error: (e as Error).message }; }
}
export async function confirmProductCsv(slug: string, token: string) {
  try {
    const result = await commitImport(await accessFor(slug), token);
    revalidatePath(`/b/${slug}`, "layout");
    return result;
  } catch (e) { return { error: (e as Error).message }; }
}
export async function evaluateProductCsv(slug: string, source: string, options: ImportOptions): Promise<{ error?: string; preview?: ImportPreview; mapping?: ImportOptions["mapping"] }> {
  try {
    const access = await accessFor(slug);
    return await evaluateImport(access, source, options);
  } catch (e) { return { error: (e as Error).message }; }
}

export async function productCsvConfiguration(slug: string) {
  try {
    const access = await accessFor(slug), db = createServiceSupabase();
    const [types, workflows] = await Promise.all([
      db.from("product_types").select("id,name").eq("is_active", true).order("name"),
      db.from("workflows").select("id,name").eq("business_id", access.businessId).order("name"),
    ]);
    if (types.error || workflows.error) throw Error("Konfigurimet nuk u lexuan.");
    return { types: types.data ?? [], workflows: workflows.data ?? [] };
  } catch (e) { return { error: (e as Error).message }; }
}
