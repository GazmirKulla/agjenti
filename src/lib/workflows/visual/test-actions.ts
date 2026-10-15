"use server";
import { processConversationMessage } from "@/lib/conversations/process-conversation-message";
import { visualGraphHash } from "./graph-hash";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { readTestSession, sealTestSession } from "@/lib/agents/test-chat/session";
import { type AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { validateVisualGraph } from "./model";

export async function simulateVisualWorkflow(slug: string, raw: unknown, message: string, token?: string | null, hasPhoto = false): Promise<{ turn?: AgentTurnResult; session?: string; error?: string }> {
  try {
    const user = await getSessionUser();
    const access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
    if (typeof message !== "string" || message.length > 2000 || (!message.trim() && !hasPhoto) || typeof hasPhoto !== "boolean" || (token != null && typeof token !== "string")) return { error: "Shkruaj një mesazh deri në 2,000 karaktere." };
    const { graph, errors } = validateVisualGraph(raw);
    if (!graph) return { error: errors[0]?.message || "Plotëso rrjedhën për ta provuar." };
    if (!process.env.TOKEN_ENCRYPTION_KEY?.trim()) return { error: "Konfiguro çelësin e sesioneve të provës." };
    const session = readTestSession(token ?? null, user.id, access.business.id);
    const id = `preview:${visualGraphHash(graph)}`;
    // Read older sealed sessions too; a suspended process can own the only cursor.
    const { state } = session;
    const pins = [session.visualPreviewId, state.visual?.versionId, state.completedVisual?.versionId,
      state.processes?.order?.snapshot.visual?.versionId, state.processes?.booking?.versionId,
      state.processes?.booking?.visual?.versionId, state.processes?.service?.versionId,
      state.processes?.service?.visual?.versionId, state.processes?.actionFlow?.versionId,
      state.processes?.actionFlow?.visual?.versionId, state.processes?.auxiliary?.visual.versionId];
    if (pins.some(pin => pin && pin !== id) || session.turns > 0 && !pins.some(Boolean)) return { error: "Rrjedha ndryshoi. Rifillo provën." };
    session.visualPreviewId = id;
    const turn = await processConversationMessage({ businessId: access.business.id, mode: "test", message: message.trim(), hasPhoto,
      state: session.state, previousResponseId: session.previousResponseId,
      visualPreview: { id, businessId: access.business.id, graph, createdAt: new Date().toISOString() } });
    return { turn, session: sealTestSession(session, turn.nextState, turn.previousResponseId) };
  } catch {
    return { error: "Prova nuk u përfundua. Rifillo sesionin dhe provo përsëri." };
  }
}
