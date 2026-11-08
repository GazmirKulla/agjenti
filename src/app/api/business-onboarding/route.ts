import { bearerToken, getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { meteredRoute } from "@/lib/ai/usage";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { loadContinuation } from "@/lib/onboarding/continuation-service";
import { openOnboardingConversation } from "@/lib/onboarding/assistant-chat";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function accessFor(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new PersistenceError("Hyr përsëri në llogari.", 401);
  const membership = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  if (!membership) throw new PersistenceError("Nuk ke qasje në këtë biznes.", 403);
  return { membership, user };
}
const failure = (error: unknown, fallback: string) =>
  json({ error: error instanceof PersistenceError ? error.message : fallback }, error instanceof PersistenceError ? error.status : 503);

/** Progress of the onboarding questions, if any are left. */
async function handleGET(request: Request) {
  try {
    const { membership } = await accessFor(request);
    return json({ continuation: await loadContinuation(membership.business.id) });
  } catch (error) {
    return failure(error, "Pyetjet e konfigurimit nuk u ngarkuan.");
  }
}

/** Opens the onboarding conversation, with the next question asked by the
 * assistant as its last message. `{ conversation: null }` when nothing is left. */
async function handlePOST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const { membership, user } = await accessFor(request);
    const profile = await loadDashboardProfile(membership.business.id);
    const view = await openOnboardingConversation({
      accessToken: bearerToken(request), userId: user.id, businessId: membership.business.id,
      modules: profile.enabledModules, catalogSource: membership.business.catalog_source,
    });
    return json(view ?? { conversation: null });
  } catch (error) {
    return failure(error, "Biseda e konfigurimit nuk u hap.");
  }
}
export const GET = meteredRoute(handleGET);
export const POST = meteredRoute(handlePOST);
