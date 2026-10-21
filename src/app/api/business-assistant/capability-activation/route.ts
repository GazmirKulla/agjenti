import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { confirmCatalogActivation, inspectCatalogActivation } from "@/lib/business-assistant/catalog-activation";
import { AssistantError } from "@/lib/business-assistant/model";
import { confirmKnowledgeActivation, inspectKnowledgeActivation } from "@/lib/business-assistant/knowledge-activation";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const user = await getRequestUser(request);
    if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
    const membership = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
    if (!membership) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Mungon kërkesa." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 10000) { await reader.cancel(); return json({ error: "Kërkesa është shumë e gjatë." }, 400); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json({ error: "Kërkesë e pavlefshme." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Kërkesë e pavlefshme." }, 400);
    const actor = { userId: user.id, businessId: membership.business.id, slug: membership.business.slug, catalogSource: membership.business.catalog_source };
    if (body.capability === "knowledge.answer") {
      if (body.mode === "inspect") return json(await inspectKnowledgeActivation(actor));
      if (body.mode === "confirm" && body.approved === true) return json(await confirmKnowledgeActivation(actor, body.token));
    }
    if (body.mode === "inspect") return json(await inspectCatalogActivation(actor, body.capability));
    if (body.mode === "confirm" && body.approved === true) return json(await confirmCatalogActivation(actor, body.token));
    return json({ error: "Kërkohet miratim i qartë për konfigurimin e shqyrtuar." }, 400);
  } catch (error) {
    return json({ error: error instanceof AssistantError ? error.message : "Konfigurimi nuk u verifikua. Rihap kontrollin përpara se të vazhdosh." }, error instanceof AssistantError ? 409 : 500);
  }
}
