import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { requireActionAccess } from "@/lib/actions/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { createServiceSupabase } from "@/lib/supabase/service";
import { assertImportAccess, prepareImport, commitImport } from "@/lib/products/import-service";
import { evaluateImport } from "@/lib/products/import-evaluation";
import { revalidatePath } from "next/cache";
export const maxDuration = 90;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const user = await getRequestUser(request); if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
    const slug = new URL(request.url).searchParams.get("slug") || "";
    const member = await requireBusinessAccess(user.id, slug); if (!member) return json({ error: "Nuk ke qasje." }, 403);
    const profile = await loadDashboardProfile(member.business.id);
    const access = { userId: user.id, businessId: member.business.id, catalogSource: member.business.catalog_source, modules: profile.enabledModules };
    assertImportAccess(access); await requireActionAccess(access.businessId, user.id, "product.create");
    const reader = request.body?.getReader(); if (!reader) return json({ error: "Mungon kërkesa." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2200000) { await reader.cancel(); return json({ error: "Kërkesë tepër e madhe." }, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.mode === "configuration") {
      const db = createServiceSupabase(); const [types, workflows] = await Promise.all([db.from("product_types").select("id,name").eq("is_active", true).order("name"), db.from("workflows").select("id,name").eq("business_id", access.businessId).order("name")]);
      if (types.error || workflows.error) return json({ error: "Konfigurimet nuk u lexuan." }, 503);
      return json({ types: types.data, workflows: workflows.data });
    }
    if (body.mode === "confirm" && body.approved === true) {
      const result = await commitImport(access, body.token);
      try { revalidatePath(`/b/${slug}`, "layout"); } catch { /* The commit receipt remains authoritative. */ }
      return json(result);
    }
    if (!body.options || typeof body.options !== "object" || !body.options.mapping || !Array.isArray(body.options.fields)) return json({ error: "Zgjedhje të pavlefshme." }, 400);
    if (body.mode === "review") return json({ preview: await prepareImport(access, body.token, body.options) });
    if (body.mode === "evaluate") return json(await evaluateImport(access, body.token, body.options));
    return json({ error: "Veprim i pavlefshëm." }, 400);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Importi nuk u konfirmua." }, 400); }
}
