import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { meteredRoute } from "@/lib/ai/usage";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { loadLearningSettings } from "@/lib/conversation-learning/settings";
import { learningEligibility, saveSuggestion, scanConversations } from "@/lib/conversation-learning/scan";

export const runtime = "nodejs";
export const maxDuration = 120;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function accessFor(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new PersistenceError("Hyr përsëri në llogari.", 401);
  const membership = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  if (!membership) throw new PersistenceError("Nuk ke qasje në këtë biznes.", 403);
  return membership;
}
const failure = (error: unknown, fallback: string) => {
  if (!(error instanceof PersistenceError)) console.error("[conversation-learning]", error instanceof Error ? error.message.slice(0, 200) : "failed");
  return json({ error: error instanceof PersistenceError ? error.message : fallback }, error instanceof PersistenceError ? error.status : 503);
};

/** Whether "Mëso nga bisedat" is open for this business, and the limits it uses. */
async function handleGET(request: Request) {
  try {
    const membership = await accessFor(request);
    const { settings } = await loadLearningSettings();
    const eligibility = await learningEligibility(membership.business.id, settings);
    return json({
      ...eligibility,
      limits: { messagesPerConversation: settings.messages_per_conversation, maxConversations: settings.max_conversations, lookbackDays: settings.lookback_days },
    });
  } catch (error) {
    return failure(error, "Mësimi nga bisedat nuk u ngarkua.");
  }
}

/** `{ action: "scan" }` reads the conversations and returns suggestions;
 * `{ action: "save", suggestion }` saves one the owner approved. */
async function handlePOST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const membership = await accessFor(request);
    const body = (await request.json().catch(() => ({}))) as { action?: string; suggestion?: Record<string, unknown> };
    if (body.action === "save") return json(await saveSuggestion(membership.business.id, body.suggestion ?? {}));
    if (body.action !== "scan") return json({ error: "Veprim i panjohur." }, 400);
    const { settings } = await loadLearningSettings();
    return json(await scanConversations(membership.business.id, settings));
  } catch (error) {
    return failure(error, "Skanimi i bisedave nuk përfundoi. Provo përsëri pas pak.");
  }
}

export const GET = meteredRoute(handleGET);
export const POST = meteredRoute(handlePOST);
