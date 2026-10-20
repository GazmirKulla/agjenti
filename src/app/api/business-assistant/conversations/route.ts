import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { isUuid, listConversations, readConversation, reassessPlan, writeConversation, PersistenceError } from "@/lib/business-assistant/persistence";
import { planningPreferences } from "@/lib/business-assistant/persistence-model";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
async function accessFor(request: Request) {
  const user = await getSessionUser();
  if (!user) throw new PersistenceError("Hyr përsëri në llogari.", 401);
  const access = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  if (!access) throw new PersistenceError("Nuk ke qasje në këtë biznes.", 403);
  const profile = await loadDashboardProfile(access.business.id);
  return { userId: user.id, businessId: access.business.id, modules: profile.enabledModules, catalogSource: access.business.catalog_source };
}
function failure(error: unknown) {
  return json({ error: error instanceof PersistenceError ? error.message : "Historiku nuk u ngarkua. Provo përsëri." }, error instanceof PersistenceError ? error.status : 503);
}
export async function GET(request: Request) {
  try {
    const access = await accessFor(request), params = new URL(request.url).searchParams, id = params.get("id");
    if (!id) return json(await listConversations(access, params.get("cursor") ?? undefined));
    const before = params.has("before") ? Number(params.get("before")) : undefined;
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new PersistenceError("Faqëzim i pavlefshëm.", 400);
    const view = await readConversation(access, id, before);
    return json(params.get("assess") === "1" ? { ...view, ...await reassessPlan(access, view.plan) } : view);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const access = await accessFor(request);
    const reader = request.body?.getReader();
    if (!reader) throw new PersistenceError("Kërkesë e pavlefshme.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 20000) { await reader.cancel(); throw new PersistenceError("Kërkesë tepër e madhe.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new PersistenceError("Kërkesë e pavlefshme.", 400); }
    if (!body || !isUuid(body.id) || !["create", "rename", "delete", "preferences", "close_plan"].includes(body.mode)) throw new PersistenceError("Kërkesë e pavlefshme.", 400);
    if (body.mode !== "create" && (!Number.isInteger(body.revision) || body.revision < 0)) throw new PersistenceError("Revision i pavlefshëm.", 400);
    let payload = {};
    if (body.mode === "rename") {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 100 || /[\r\n\x00-\x1f]/.test(body.title)) throw new PersistenceError("Titulli duhet të ketë 1–100 karaktere në një rresht.", 400);
      payload = { title: body.title.trim() };
    }
    if (body.mode === "preferences") {
      try { payload = planningPreferences(body.preferences); } catch { throw new PersistenceError("Zgjedhje të pavlefshme.", 400); }
      const view = await readConversation(access, body.id);
      const ids = new Set(view.plan?.snapshot.actionPlan?.steps.map(s => s.id) ?? []);
      if (Object.keys(payload).some(key => !ids.has(key))) throw new PersistenceError("Hapi nuk i përket këtij plani.", 400);
    }
    await writeConversation(access, body.id, body.mode, body.revision ?? null, null, payload);
    return json(body.mode === "delete" ? { deleted: true } : await readConversation(access, body.id));
  } catch (error) { return failure(error); }
}
