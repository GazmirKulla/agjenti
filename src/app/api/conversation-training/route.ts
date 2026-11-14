import { after } from "next/server";
import { bearerToken, getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { continueTraining, workerOrigin } from "@/lib/conversation-training/continue";
import { applyApproved, approveSafe, confirmUpload, decideSuggestion, deleteAllTraining, deleteSession, listSessions, listSuggestions, prepareUpload, startInbox } from "@/lib/conversation-training/sessions";

export const runtime = "nodejs";
export const maxDuration = 120;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function accessFor(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new PersistenceError("Hyr përsëri në llogari.", 401);
  const membership = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  if (!membership) throw new PersistenceError("Nuk ke qasje në këtë biznes.", 403);
  return { user, businessId: membership.business.id };
}
const failure = (error: unknown) => {
  if (!(error instanceof PersistenceError)) console.error("[conversation-training]", error instanceof Error ? error.message.slice(0, 200) : "failed");
  return json({ error: error instanceof PersistenceError ? error.message : "Veprimi nuk u krye. Provo përsëri." }, error instanceof PersistenceError ? error.status : 503);
};
function wake(businessId: string, request: Request) {
  const origin = workerOrigin(new URL(request.url).origin);
  after(() => continueTraining(businessId, origin));
}

/** The business's imports (status, progress, counts) and how many messages are kept;
 * with `session`, what that analysis proposes. */
export async function GET(request: Request) {
  try {
    const { businessId } = await accessFor(request);
    const session = new URL(request.url).searchParams.get("session");
    if (session) return json(await listSuggestions(businessId, session));
    return json(await listSessions(businessId));
  } catch (error) { return failure(error); }
}

/** `inbox` starts reading the Inbox; `upload` prepares direct uploads of an Instagram
 * export and `uploaded` starts reading them; `delete` removes one import, `delete_all`
 * every imported conversation. `decide` approves or rejects one suggestion, `approve_safe`
 * the safe ones together, and `apply` writes the approved ones through the platform's
 * registered operations. Nothing here sends messages to customers. */
export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const { user, businessId } = await accessFor(request);
    const body = (await request.json().catch(() => ({}))) as { action?: string; id?: unknown; files?: unknown; ownerName?: unknown; decision?: unknown; edited?: unknown };
    switch (body.action) {
      case "inbox": { const result = await startInbox(businessId, user.id); wake(businessId, request); return json(result, 202); }
      case "upload": return json(await prepareUpload(businessId, user.id, body));
      case "uploaded": { const result = await confirmUpload(businessId, body.id); wake(businessId, request); return json(result, 202); }
      case "delete": return json(await deleteSession(businessId, body.id));
      case "delete_all": return json(await deleteAllTraining(businessId));
      case "decide": return json(await decideSuggestion(businessId, user.id, body));
      case "approve_safe": return json(await approveSafe(businessId, user.id, body.id));
      case "apply": return json(await applyApproved(businessId, user.id, body.id, request.headers.has("authorization") ? bearerToken(request) : undefined));
      default: return json({ error: "Veprim i panjohur." }, 400);
    }
  } catch (error) { return failure(error); }
}
