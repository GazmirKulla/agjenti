import { bearerToken, getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { meteredRoute } from "@/lib/ai/usage";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { answerContinuation, loadContinuation } from "@/lib/onboarding/continuation-service";
import { ContinuationError } from "@/lib/onboarding/continuation";
import { instructionsFromAnswers } from "@/lib/onboarding/finish";
import { suggestProfileAnswers } from "@/lib/onboarding/suggest";
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

/** Progress of the onboarding questions, if any are left; or, with
 * `?suggest=1`, answers prefilled from the knowledge. */
async function handleGET(request: Request) {
  try {
    const { membership } = await accessFor(request);
    // `?suggest=1`: the questions answered from the confirmed knowledge, for the owner to confirm.
    if (new URL(request.url).searchParams.get("suggest") === "1")
      return json({ suggestions: await suggestProfileAnswers(membership.business.id).catch((error) => {
        console.error("[onboarding suggest]", error instanceof Error ? error.message.slice(0, 200) : "failed");
        return {};
      }) });
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
/** Answers one profile question: `{ field, answer }`, where answer is
 * `{ values }`, `{ text }` or `{ skip: true }`. The server checks it.
 * `{ finish: true }` ends the onboarding questions. */
async function handlePATCH(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const { membership } = await accessFor(request);
    const body = await request.json().catch(() => null) as { field?: unknown; answer?: unknown; finish?: unknown } | null;
    // `{ finish: true }`: the onboarding questions are done (instructions from the answers).
    if (body?.finish === true) {
      await instructionsFromAnswers(membership.business);
      return json({ ok: true });
    }
    if (!body || typeof body.field !== "string") return json({ error: "Pyetja mungon." }, 400);
    return json({ continuation: await answerContinuation(membership.business.id, body.field, body.answer) });
  } catch (error) {
    if (error instanceof ContinuationError) return json({ error: error.message }, error.status);
    return failure(error, "Përgjigjja nuk u ruajt. Provo përsëri.");
  }
}
export const GET = meteredRoute(handleGET);
export const PATCH = meteredRoute(handlePATCH);
export const POST = meteredRoute(handlePOST);
