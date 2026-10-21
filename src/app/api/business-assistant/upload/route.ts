import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { inspectAttachment, readAttachmentForm, sealAttachment } from "@/lib/business-assistant/materials";
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!permittedWrite(request)) return json({ error: "Kërkesë e palejuar." }, 403);
  const user = await getRequestUser(request);
  if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
  const access = await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  if (!access) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
  try {
    const content = await inspectAttachment(await readAttachmentForm(request));
    return json({ attachment: sealAttachment(content, user.id, access.business.id) });
  } catch (error) {
    const known = error instanceof Error && /^(Skedari|Dokumenti|Përdor|Konfiguro|Ngarko|Mungon)/.test(error.message);
    return json({ error: known ? (error as Error).message : "Përpunimi nuk përfundoi. Provo përsëri." }, 400);
  }
}
