import { revalidatePath } from "next/cache";
import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { showModuleFor } from "@/lib/dashboard/modules/show";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

/** Shows a hidden menu section; used by the mobile app after an assistant change. */
export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  const user = await getRequestUser(request);
  if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
  const access = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  if (!access) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
  let body: { show?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Kërkesë e pavlefshme." }, 400);
  }
  if (typeof body?.show !== "string" || body.show.length > 40) return json({ error: "Kërkesë e pavlefshme." }, 400);
  const result = await showModuleFor(user.id, access.business.id, body.show);
  if (result.error) return json({ error: result.error }, 400);
  try { revalidatePath(`/b/${access.business.slug}`, "layout"); } catch { /* The menu refreshes on the next load. */ }
  return json(result);
}
