import { resolveMaterials, linksInText } from "@/lib/business-assistant/materials";
import { simulateVisualWorkflow } from "@/lib/workflows/visual/test-actions";
import { parseUIContext } from "@/lib/business-assistant/context";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { transcribeAudio } from "@/lib/business-intelligence/transcription";
import { readAudioForm } from "@/lib/onboarding/audio-upload";
import { executeTicket, openTicket, planRequest } from "@/lib/business-assistant/service";
import { persistedTurn, PersistenceError, reassessPlan } from "@/lib/business-assistant/persistence";
import { AssistantError } from "@/lib/business-assistant/model";
import { readPersonalAssistantName } from "@/lib/business-assistant/identity";
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
      if (size > 2200000) {
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
    if (body.mode === "workflow_test") {
      if (!access.modules.includes("workflows")) throw new AssistantError("Workflow-t nuk janë aktivë për këtë biznes.");
      const result = await simulateVisualWorkflow(slug, body.graph, body.message, body.session);
      if (result.error || !result.turn) throw new AssistantError(result.error ?? "Prova nuk përfundoi.");
      return json({ reply: result.turn.reply, session: result.session, handoff: result.turn.handoff, advisoryHandoff: result.turn.advisoryHandoff });
    }
    if (body.mode === "confirm") {
      if (typeof body.token !== "string" || body.token.length > 300000)
        throw new AssistantError("Konfirmim i pavlefshëm.");
      const execute = async () => {
        const ticket = openTicket(body.token, access);
        const result = await executeTicket(access, body.token);
        const tables: Record<string, string> = { product: "products", service: "booking_services", knowledge: "knowledge_entries", agent: "ai_agents", profile: "businesses", booking: "bookings", workflow: "assistant_visual_requests", orderflow: "assistant_workflow_changes", linear: "products" };
        return { ...result, saved: true, outcome: { status: "backend_acknowledged", action: ticket.action,
          reference: { table: tables[ticket.action.split("_")[0]],
            ...(ticket.action === "booking_create" ? { request_key: `assistant:${ticket.id}` } : { id: ticket.id }) } } };
      };
      // Keep legacy callers compatible; the owner assistant UI uses durable requests.
      const result = body.conversationId
        ? await persistedTurn(access, body, { content: "Konfirmova ndryshimin e shqyrtuar.", mode: "confirm", fingerprintData: body.token }, execute)
        : await executeTicket(access, body.token);
      let warning: string | undefined;
      try { revalidatePath(`/b/${slug}`, "layout"); }
      catch { warning = "Ndryshimi u ruajt. Rifresko faqen për të përditësuar pamjen."; }
      return json({ ...result, ...(!body.conversationId ? { saved: true } : {}), ...(warning ? { warning } : {}) });
    }
    if (
      body.mode !== "plan" ||
      typeof body.text !== "string" ||
      (!body.text.trim() && !body.attachments?.length && !body.links?.length) ||
      body.text.length > 12000
    )
      throw new AssistantError("Shkruaj deri në 12,000 karaktere ose shto një material.");
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
    const assistantName = body.assistantName === undefined ? undefined : readPersonalAssistantName(body.assistantName);
    if (assistantName === null) throw new AssistantError("Emri i asistentit duhet të ketë 1–32 karaktere në një rresht.");
    if (body.pendingToken !== undefined && (typeof body.pendingToken !== "string" || body.pendingToken.length > 300000)) throw new AssistantError("Propozim i pavlefshëm.");
    if (body.links !== undefined && !Array.isArray(body.links)) throw new AssistantError("Linke të pavlefshme.");
    const links = [...new Set([...(body.links ?? []), ...linksInText(body.text)])];
    const materials = await resolveMaterials(body.attachments ?? [], links, user.id, membership.business.id);
    if (body.conversationId) return json(await persistedTurn(access, body, {
      content: body.text.trim(), context, mode: "plan",
      fingerprintData: [body.attachments ?? [], links],
    }, async (history, prior, preferences) => {
      // Stored context is historical data. Selection/revision conflicts are never silently retargeted.
      let effectiveContext = context;
      if (prior) {
        const checked = await reassessPlan(access, { revision: 0, snapshot: prior, preferences: {} });
        if (!checked.recovery.verified) throw new PersistenceError(`${checked.recovery.message} Fillo një bisedë të re për një objektiv tjetër.`, 409);
        prior = checked.plan!.snapshot;
        const pages: Record<string, string> = { product: "products", service: "services", knowledge: "knowledge", booking: "bookings", agent: "agents" };
        const targetContext = prior.target && pages[prior.target.kind]
          ? parseUIContext({ page: pages[prior.target.kind], entityType: prior.target.kind, entityId: prior.target.id, entryPoint: "contextual" }) : undefined;
        const retainedContext = targetContext ?? prior.context;
        const priorIds = retainedContext?.selectedEntityIds?.length ? retainedContext.selectedEntityIds : retainedContext?.entityId ? [retainedContext.entityId] : [];
        const nextIds = context?.selectedEntityIds?.length ? context.selectedEntityIds : context?.entityId ? [context.entityId] : [];
        if (priorIds.length && nextIds.length && JSON.stringify([...priorIds].sort()) !== JSON.stringify([...nextIds].sort()))
          throw new PersistenceError("Ky plan i përket një elementi tjetër. Fillo një bisedë të re për zgjedhjen e re.", 409);
        if (priorIds.length && !nextIds.length) effectiveContext = retainedContext;
      }
      return { ...await planRequest(access, body.text.trim(), history, effectiveContext, body.pendingToken, materials, assistantName, prior, preferences),
        recoveryContext: effectiveContext };
    }));
    if (assistantName !== undefined) return json(await planRequest(access, body.text.trim(), history, context, body.pendingToken, materials, assistantName));
    if (materials.length) return json(await planRequest(access, body.text.trim(), history, context, body.pendingToken, materials));
    if (body.pendingToken !== undefined) return json(await planRequest(access, body.text.trim(), history, context, body.pendingToken));
    return json(context ? await planRequest(access, body.text.trim(), history, context) : await planRequest(access, body.text.trim(), history));
  } catch (error) {
    return json(
      {
        ...(error instanceof AssistantError && error.publication ? { publication: error.publication } : {}),
        error:
          error instanceof AssistantError || error instanceof PersistenceError
            ? error.message
            : "Veprimi nuk përfundoi. Provo përsëri pas pak.",
      },
      error instanceof PersistenceError ? error.status : error instanceof AssistantError ? 400 : 500,
    );
  }
}
