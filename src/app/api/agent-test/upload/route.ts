import { resolveMaterials } from "@/lib/business-assistant/materials";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { inspectAttachment, readAttachmentForm, sealAttachment } from "@/lib/agents/test-chat/attachments";
import { readAudioForm } from "@/lib/onboarding/audio-upload";
import { transcribeAudio } from "@/lib/business-intelligence/transcription";
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Kërkesë e palejuar." }, 403);
  const user = await getSessionUser();
  if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
  const url = new URL(request.url);
  const access = await requireBusinessAccess(user.id, url.searchParams.get("slug") ?? "");
  if (!access) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
  try {
    if (url.searchParams.get("mode") === "link") {
      const link = url.searchParams.get("url") ?? "";
      const [material] = await resolveMaterials([], [link], user.id, access.business.id);
      return json({ attachment: sealAttachment({ name: material.name, kind: "document", text: `Burimi: ${material.url}\n${material.text}`.slice(0,16000) }, user.id, access.business.id) });
    }
    if (url.searchParams.get("mode") === "audio") {
      const { file } = await readAudioForm(request);
      const transcript = await transcribeAudio(file);
      if (transcript.length > 2000) return json({ error: "Audioja kalon kufirin prej 2,000 karakteresh. Regjistro një mesazh më të shkurtër." }, 400);
      return json({ transcript });
    }
    if (!process.env.TOKEN_ENCRYPTION_KEY?.trim()) return json({ error: "Konfiguro çelësin e sesioneve të provës." }, 503);
    const content = await inspectAttachment(await readAttachmentForm(request));
    return json({ attachment: sealAttachment(content, user.id, access.business.id) });
  } catch (error) {
    // Provider errors may contain request details; never expose those to the browser.
    const known = error instanceof Error && /^(Skedari|Dokumenti|Përdor|Konfiguro|Ngarko|Mungon)/.test(error.message);
    return json({ error: known ? (error as Error).message : "Përpunimi nuk përfundoi. Provo përsëri." }, 400);
  }
}
