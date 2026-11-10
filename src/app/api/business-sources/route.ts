import { after } from "next/server";
import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { continueDiscovery, workerOrigin } from "@/lib/discovery/continue";
import { learnFromSources, previewSources, reviewSources, sourcesState, SourcesError } from "@/lib/discovery/sources-step";

/** Onboarding step 2 for the web and the mobile app: preview the public
 * Instagram and website, start learning from them, review what was found. */
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function authorize(request: Request) {
  const user = await getRequestUser(request);
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  return user && access ? { user, business: access.business } : null;
}

export async function GET(request: Request) {
  const access = await authorize(request);
  if (!access) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
  try { return json(await sourcesState(access.business.id)); }
  catch { return json({ error: "Burimet nuk u ngarkuan." }, 503); }
}

export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  const access = await authorize(request);
  if (!access) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
  const text = await request.text().catch(() => "");
  if (text.length > 20000) return json({ error: "Kërkesë e pavlefshme." }, 400);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text || "{}"); } catch { return json({ error: "Kërkesë e pavlefshme." }, 400); }
  try {
    if (body.action === "preview") return json(await previewSources(access.business.id, { username: body.username, website: body.website }));
    if (body.action === "learn") {
      const started = await learnFromSources(access.business.id, access.user.id);
      const origin = workerOrigin(new URL(request.url).origin);
      after(() => continueDiscovery(access.business.id, origin));
      return json({ started });
    }
    if (body.action === "confirm") return json(await reviewSources(access.business.id, access.user.id, Array.isArray(body.keep) ? body.keep : []));
    if (body.action === "dismiss") return json(await reviewSources(access.business.id, access.user.id, null));
    return json({ error: "Veprim i panjohur." }, 400);
  } catch (error) {
    if (error instanceof SourcesError) return json({ error: error.message }, error.status);
    console.error("[business-sources]", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return json({ error: "Veprimi nuk u krye. Provo përsëri." }, 503);
  }
}
