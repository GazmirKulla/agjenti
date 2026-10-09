"use server";
import { createHash } from "node:crypto";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { readTestSession, sealTestSession } from "@/lib/agents/test-chat/session";
import { processAgentTurn, type AgentTurnResult } from "@/lib/conversations/process-agent-turn";
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
    const id = `preview:${createHash("sha256").update(JSON.stringify(graph)).digest("hex")}`;
    if (session.state.visual && session.state.visual.versionId !== id) return { error: "Rrjedha ndryshoi. Rifillo provën." };
    const turn = await processAgentTurn({ businessId: access.business.id, mode: "test", message: message.trim(), hasPhoto,
      state: session.state, previousResponseId: session.previousResponseId,
      visualPreview: { id, businessId: access.business.id, graph, createdAt: new Date().toISOString() } });
    return { turn, session: sealTestSession(session, turn.nextState, turn.previousResponseId) };
  } catch {
    return { error: "Prova nuk u përfundua. Rifillo sesionin dhe provo përsëri." };
  }
}
