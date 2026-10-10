"use server";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { createHash } from "node:crypto";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadLinearContext } from "@/lib/business-assistant/linear-service";
import { parseLinearDefinition } from "./linear";
import { migrateContext } from "./context";
import { readTestSession, sealTestSession } from "@/lib/agents/test-chat/session";
import { processAgentTurn } from "@/lib/conversations/process-agent-turn";
export async function simulateProductWorkflow(slug: string, productId: string, message: string, token?: string, photo = false) {
    try {
        const user = await getSessionUser(), access = user ? await requireBusinessAccess(user.id, slug) : null;
        if (!user || !access)
            throw new Error("Nuk ke qasje në këtë biznes.");
        if (typeof message !== "string" || message.length > 2000 || (Boolean(token) && !message.trim() && !photo) || typeof photo !== "boolean")
            throw new Error("Shkruaj një mesazh deri në 2,000 karaktere.");
        const profile = await loadDashboardProfile(access.business.id);
        const card = await loadLinearContext({ businessId: access.business.id, userId: user.id, modules: profile.enabledModules, catalogSource: access.business.catalog_source }, productId);
        if (!card.draft)
            throw new Error("Ruaj draftin për ta provuar.");
        const definition = parseLinearDefinition(card.draft.definition);
        const versionId = `linear-preview:${createHash("sha256").update(JSON.stringify(definition)).digest("hex")}`;
        const session = readTestSession(token ?? null, user.id, access.business.id);
        if (session.state.context?.execution.linear && (session.state.context.execution.linear.versionId !== versionId || session.state.product_id !== productId))
            throw new Error("Drafti ndryshoi. Rifillo provën.");
        const state = migrateContext(session.state);
        state.product_id = productId;
        if (!token)
            state.step_key = definition.steps[0].key;
        state.context!.execution.linear = { id: card.draft.source_workflow_id ?? productId, versionId, name: definition.name, steps: definition.steps };
        const turn = await processAgentTurn({ businessId: access.business.id, mode: "test", linearPreview: true, message: token ? message.trim() : "", hasPhoto: token && photo ? true : false, state });
        return { reply: turn.reply, session: sealTestSession(session, turn.nextState, turn.previousResponseId) };
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : "Prova nuk përfundoi." };
    }
}
