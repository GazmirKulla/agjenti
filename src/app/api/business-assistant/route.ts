import { parseUIContext } from "@/lib/business-assistant/context";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { transcribeAudio } from "@/lib/business-intelligence/transcription";
import { readAudioForm } from "@/lib/onboarding/audio-upload";
import { executeTicket, planRequest } from "@/lib/business-assistant/service";
import { AssistantError } from "@/lib/business-assistant/model";
import { revalidatePath } from "next/cache";
export const runtime = "nodejs";
export const maxDuration = 90;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function readJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AssistantError("Mungon kërkesa.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 96000) {
        await reader.cancel();
        throw new AssistantError("Kërkesa është shumë e gjatë.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AssistantError("Kërkesa nuk është e vlefshme.");
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Kërkesë e palejuar." }, 403);
  try {
    const slug = new URL(request.url).searchParams.get("slug") ?? "";
    const user = await getSessionUser();
    if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
    const membership = await requireBusinessAccess(user.id, slug);
    if (!membership)
      return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
    const profile = await loadDashboardProfile(membership.business.id);
    const access = {
      userId: user.id,
      businessId: membership.business.id,
      modules: profile.enabledModules,
      catalogSource: membership.business.catalog_source,
    };
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data;")
    ) {
      const { file } = await readAudioForm(request);
      const transcript = await transcribeAudio(file);
      return json({ transcript });
    }
    const body = await readJson(request);
    if (!body || typeof body !== "object")
      throw new AssistantError("Kërkesë e pavlefshme.");
    if (body.mode === "confirm") {
      if (typeof body.token !== "string" || body.token.length > 80000)
        throw new AssistantError("Konfirmim i pavlefshëm.");
      const result = await executeTicket(access, body.token);
      revalidatePath(`/b/${slug}`, "layout");
      return json({ ...result, saved: true });
    }
    if (
      body.mode !== "plan" ||
      typeof body.text !== "string" ||
      body.text.trim().length < 3 ||
      body.text.length > 12000
    )
      throw new AssistantError("Shkruaj kërkesën me 3–12000 karaktere.");
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    if (
      history.some(
        (m: { role?: unknown; content?: unknown } | null) =>
          !m ||
          !["user", "assistant"].includes(String(m.role)) ||
          typeof m.content !== "string" ||
          m.content.length > 12000,
      )
    )
      throw new AssistantError(
        "Biseda është shumë e gjatë. Fillo një kërkesë të re.",
      );
    const context = parseUIContext(body.context);
    return json(context ? await planRequest(access, body.text.trim(), history, context) : await planRequest(access, body.text.trim(), history));
  } catch (error) {
    return json(
      {
        error:
          error instanceof AssistantError
            ? error.message
            : "Veprimi nuk përfundoi. Provo përsëri pas pak.",
      },
      error instanceof AssistantError ? 400 : 500,
    );
  }
}
