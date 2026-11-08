import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { ContinuationError } from "@/lib/onboarding/continuation";
import { answerContinuation, loadContinuation } from "@/lib/onboarding/continuation-service";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function access(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return { response: json({ error: "Hyr përsëri në llogari." }, 401) };
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const membership = await requireBusinessAccess(user.id, slug);
  if (!membership) return { response: json({ error: "Nuk ke qasje në këtë biznes." }, 403) };
  return { businessId: membership.business.id };
}

/** The next onboarding question the dashboard agent should ask, if any. */
export async function GET(request: Request) {
  try {
    const result = await access(request);
    if ("response" in result) return result.response;
    return json({ continuation: await loadContinuation(result.businessId) });
  } catch {
    return json({ error: "Pyetjet e konfigurimit nuk u ngarkuan." }, 503);
  }
}

export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const result = await access(request);
    if ("response" in result) return result.response;
    if (Number(request.headers.get("content-length") ?? 0) > 16000)
      return json({ error: "Përgjigjja është shumë e gjatë." }, 400);
    const raw = await request.text();
    if (raw.length > 16000) return json({ error: "Përgjigjja është shumë e gjatë." }, 400);
    let body: { field?: unknown; answer?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Kërkesa nuk është e vlefshme." }, 400);
    }
    return json({ continuation: await answerContinuation(result.businessId, body?.field, body?.answer) });
  } catch (error) {
    if (error instanceof ContinuationError) return json({ error: error.message }, error.status);
    return json({ error: "Përgjigjja nuk u ruajt. Provo përsëri." }, 503);
  }
}
