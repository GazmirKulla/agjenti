"use server";
import { processBookingTurn } from "@/lib/calendar/agent";
import { loadSetupStatus } from "@/lib/setup/status";
import { recordSetupTest } from "@/lib/setup/record-test";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import {
  processAgentTurn,
  type AgentTurnResult,
} from "@/lib/conversations/process-agent-turn";
import { readTestSession, sealTestSession } from "./session";
import { issueTrainingReceipt } from "@/lib/agents/training/receipt";
import { readAttachment } from "./attachments";
export type TestChatInput = {
  slug: string;
  message: string;
  hasMedia?: boolean;
  session?: string | null;
  attachments?: string[];
};
export type TestChatResult =
  | { error: string }
  | (AgentTurnResult & {
      setupTestPassed?: boolean;
      setupNotice?: string;
      session: string;
      turns: number;
      autoReplyEnabled: boolean;
      trainingReceipt?: string;
    });

function customerComplete(customer: {
  name: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
}) {
  return Boolean(
    customer.name?.trim() &&
    customer.phone?.trim() &&
    customer.city?.trim() &&
    customer.address?.trim(),
  );
}

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
      || (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.length > 3 || input.attachments.some(token => typeof token !== "string" || token.length > 100000)))
    )
      return {
        error:
          "Kërkesa nuk është e vlefshme. Mesazhi duhet të ketë deri në 2,000 karaktere.",
      };
    const access = await requireBusinessAccess(user.id, input.slug);
    if (!access) return { error: "Nuk ke qasje në këtë biznes." };
    const text = input.message.trim();
    if (!text && !input.hasMedia && !input.attachments?.length)
      return { error: "Shkruaj një mesazh, bashkëngjit skedar ose simulo një foto." };
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
    let attachments;
    try { attachments = (input.attachments ?? []).map(token => readAttachment(token, user.id, access.business.id)); }
    catch (error) { return { error: error instanceof Error ? error.message : "Ngarko skedarin përsëri." }; }
    // Keep small excerpts, never file bytes, in the encrypted test-only checkpoint.
    session.attachments = [...(session.attachments ?? []), ...attachments].slice(-3).map(a => ({ ...a, text: Buffer.from(a.text).subarray(0, 6000).toString("utf8") }));
    const attachmentContext = session.attachments.map(a => `${a.name} (${a.kind}):\n${a.text}`).join("\n\n").slice(0, 18000);
    // Read before the turn so a concurrent config edit cannot certify a stale test.
    const setup = await loadSetupStatus(access.business.id).catch(() => null);

    // Sticky fingerprint: keep across turns unless the live config hash changes.
    let setupSignature = session.setupSignature ?? null;
    if (!setup?.available) {
      setupSignature = null;
    } else if (!setupSignature && session.turns === 0) {
      setupSignature = setup.signature;
    } else if (setupSignature && setup.signature !== setupSignature) {
      setupSignature = null;
    }

    const bookingTurn = await processBookingTurn({businessId: access.business.id, message: text, state: session.state, mode: "test"});
    const turn = bookingTurn ?? await processAgentTurn({
      mode: "test",
      businessId: access.business.id,
      message: text || (attachments.length ? "Çfarë mund të më thuash për skedarin që dërgova?" : text),
      hasPhoto: input.hasMedia === true || attachments.some(a => a.kind === "image"),
      attachmentContext,
      hasAttachments: attachments.length > 0,
      state: session.state,
      previousResponseId: session.previousResponseId,
    });

    const configAligned = Boolean(
      setup?.available &&
      setupSignature &&
      setup.signature === setupSignature &&
      turn.debug.agentConfigured,
    );
    // One AI reply in the session is enough; the last turn may be fallback.
    const sawAi =
      configAligned && (session.sawAi === true || turn.debug.source === "ai");

    session.setupSignature = configAligned ? setupSignature : null;
    session.sawAi = sawAi;

    let setupTestPassed = false;
    if (
      configAligned &&
      sawAi &&
      ((turn.workflowId &&
        turn.nextState.product_id &&
        turn.nextState.step_key === "order_ready" &&
        customerComplete(turn.nextState.customer)) ||
        (setup?.productCount === 0 &&
          turn.debug.source === "ai" &&
          ((turn.debug.retrievedCatalogIds?.length ?? 0) > 0 ||
            turn.debug.retrievedService === true ||
            ((setup.knowledgeCount ?? 0) > 0 && turn.debug.knowledgeCount > 0))))
    ) {
      setupTestPassed = await recordSetupTest(
        access.business.id,
        setupSignature!,
      ).catch(() => false);
      if (setupTestPassed) revalidatePath(`/b/${input.slug}`, "layout");
    }
    return {
      ...turn,
      productName: turn.productName,
      workflowProgress: turn.workflowProgress,
      setupTestPassed,
      setupNotice: !configAligned
        ? "Kjo bisedë nuk numërohet si test konfigurimi. Kontrollo agjentin dhe rifillo pasi të ruash ndryshimet."
        : !sawAi
          ? "Prova ka nevojë për të paktën një përgjigje AI. Rifillo dhe provo përsëri."
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
      trainingReceipt: issueTrainingReceipt(user.id, access.business.id, text || "[Foto e simuluar]", turn.reply, turn.workflowId, turn.nextState.step_key),
    };
  } catch {
    return {
      error:
        "Prova nuk u përfundua. Kontrollo konfigurimin e agjentit dhe provo përsëri.",
    };
  }
}
