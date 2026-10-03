"use server";
import { loadSetupStatus } from "@/lib/setup/status";
import { recordSetupTest } from "@/lib/setup/record-test";
import { revalidatePath } from "next/cache";
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
      setupTestPassed?: boolean;
      setupNotice?: string;
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
    // Read before the turn so a concurrent config edit cannot certify a stale test.
    const setup = await loadSetupStatus(access.business.id).catch(() => null);
    const expectedSignature =
      session.turns === 0 ? setup?.signature : session.setupSignature;
    const turn = await processAgentTurn({
      businessId: access.business.id,
      message: text,
      hasPhoto: input.hasMedia === true,
      state: session.state,
      previousResponseId: session.previousResponseId,
    });
    const validTest = Boolean(
      setup?.available &&
      expectedSignature &&
      setup.signature === expectedSignature &&
      turn.debug.source === "ai" &&
      turn.debug.agentConfigured,
    );
    session.setupSignature = validTest ? expectedSignature : null;
    let setupTestPassed = false;
    if (
      validTest &&
      turn.workflowId &&
      turn.nextState.product_id &&
      turn.nextState.step_key === "order_ready" &&
      Object.values(turn.nextState.customer).every(Boolean)
    ) {
      setupTestPassed = await recordSetupTest(
        access.business.id,
        expectedSignature!,
      ).catch(() => false);
      if (setupTestPassed) revalidatePath(`/b/${input.slug}`, "layout");
    }
    return {
      ...turn,
      setupTestPassed,
      setupNotice: !validTest
        ? "Kjo bisedë nuk numërohet si test konfigurimi. Kontrollo agjentin dhe rifillo pasi të ruash ndryshimet."
        : turn.nextState.step_key === "order_ready" && !setupTestPassed
          ? "Prova përfundoi, por progresi nuk u ruajt. Kontrollo konfigurimin dhe rifillo."
          : undefined,
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
