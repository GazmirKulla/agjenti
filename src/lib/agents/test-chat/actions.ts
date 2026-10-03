"use server";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import {
  processAgentTurn,
  type AgentTurnResult,
} from "@/lib/conversations/process-agent-turn";
import { readTestSession, sealTestSession } from "./session";
export type TestChatInput = {
  slug: string;
  message: string;
  hasMedia?: boolean;
  session?: string | null;
};
export type TestChatResult =
  | { error: string }
  | (AgentTurnResult & {
      session: string;
      turns: number;
      autoReplyEnabled: boolean;
    });
export async function simulateAgentTurn(
  input: TestChatInput,
): Promise<TestChatResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: "Hyr në llogari për të provuar agjentin." };
    if (
      !input ||
      typeof input.slug !== "string" ||
      input.slug.length > 150 ||
      typeof input.message !== "string" ||
      input.message.length > 2000 ||
      (input.hasMedia !== undefined && typeof input.hasMedia !== "boolean") ||
      (input.session != null && typeof input.session !== "string")
    )
      return {
        error:
          "Kërkesa nuk është e vlefshme. Mesazhi duhet të ketë deri në 2,000 karaktere.",
      };
    const access = await requireBusinessAccess(user.id, input.slug);
    if (!access) return { error: "Nuk ke qasje në këtë biznes." };
    const text = input.message.trim();
    if (!text && !input.hasMedia)
      return { error: "Shkruaj një mesazh ose simulo një foto." };
    let session;
    try {
      session = readTestSession(
        input.session ?? null,
        user.id,
        access.business.id,
      );
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Rifillo sesionin e provës.",
      };
    }
    // Fail before incurring an AI call if session encryption is not configured.
    if (!process.env.TOKEN_ENCRYPTION_KEY?.trim())
      return {
        error:
          "Administratori duhet të konfigurojë çelësin e sesioneve të provës.",
      };
    const turn = await processAgentTurn({
      businessId: access.business.id,
      message: text,
      hasPhoto: input.hasMedia === true,
      state: session.state,
      previousResponseId: session.previousResponseId,
    });
    return {
      ...turn,
      session: sealTestSession(
        session,
        turn.nextState,
        turn.previousResponseId,
      ),
      turns: session.turns + 1,
      autoReplyEnabled: access.business.auto_reply,
    };
  } catch {
    return {
      error:
        "Prova nuk u përfundua. Kontrollo konfigurimin e agjentit dhe provo përsëri.",
    };
  }
}
