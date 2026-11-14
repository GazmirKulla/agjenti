import { createServiceSupabase } from "@/lib/supabase/service";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { processConversationMessage } from "@/lib/conversations/process-conversation-message";
import { readTestSession } from "@/lib/agents/test-chat/session";
import { sha256, suggestionKey, INSTRUCTION_ATTEMPT } from "./analysis-model";
import { buildPreview, type PreviewRow, type TrainingPreview } from "./preview";
import type { AgentConfigurationPreview } from "@/lib/agents/communication-configuration";

const ROWS = "id,destination,operation,status,target_table,target_id,title,proposed,edited,evidence";

/** Customer messages to test with: the ones behind the proposed examples and facts, without duplicates. */
export function testMessages(rows: { destination: string; proposed: Record<string, unknown>; evidence: { speaker: string; quote: string }[] }[], limit = 8): string[] {
  const out: string[] = [];
  const add = (text: unknown) => {
    const message = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    if (message.length < 3 || message.length > 500 || INSTRUCTION_ATTEMPT.test(message) || /\[(emri|telefon|email|lidhje)\]/.test(message)) return;
    if (!out.some((m) => m.toLocaleLowerCase("sq") === message.toLocaleLowerCase("sq"))) out.push(message);
  };
  for (const row of rows.filter((r) => r.destination === "example")) add(row.proposed.customer_message);
  for (const row of rows.filter((r) => r.destination !== "example")) for (const e of row.evidence) if (e.speaker === "customer") add(e.quote);
  return out.slice(0, limit);
}

async function sessionRows(businessId: string, sessionId: unknown) {
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new PersistenceError("Importi nuk u gjet.", 404);
  const db = createServiceSupabase();
  const { data: session } = await db.from("conversation_training_sessions").select("id,stats").eq("business_id", businessId).eq("id", sessionId).maybeSingle();
  if (!session) throw new PersistenceError("Importi nuk u gjet.", 404);
  const { data } = await db.from("conversation_training_suggestions").select(ROWS).eq("business_id", businessId).eq("session_id", session.id).limit(1000);
  return { session: session as { id: string; stats: Record<string, unknown> }, rows: (data ?? []) as (PreviewRow & { evidence: { speaker: string; quote: string }[] })[] };
}

async function reply(businessId: string, userId: string, message: string, previews: { configurationPreview?: AgentConfigurationPreview; trainingPreview?: TrainingPreview }) {
  const fresh = readTestSession(null, userId, businessId);
  const turn = await processConversationMessage({ mode: "test", businessId, message, hasPhoto: false, state: fresh.state, previousResponseId: null, ...previews });
  return { reply: turn.reply, knowledge: turn.debug.knowledgeTitles ?? [], examples: turn.debug.trainingMemoryIds?.length ?? 0, source: turn.debug.source };
}

/** One customer message answered twice by the real runtime, isolated: with the agent as it is now,
 * and with what this training would change. Nothing is saved and no customer is messaged. */
export async function compareReplies(businessId: string, userId: string, sessionId: unknown, rawMessage: unknown) {
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (!message || message.length > 2000) throw new PersistenceError("Shkruaj një mesazh klienti deri në 2,000 shkronja.", 400);
  const { rows } = await sessionRows(businessId, sessionId);
  const { data: agent } = await createServiceSupabase().from("ai_agents").select("id,name,instructions,communication,updated_at,configuration_revision")
    .eq("business_id", businessId).eq("is_active", true).maybeSingle();
  const preview = buildPreview(businessId, agent, rows);
  const [current, proposed] = await Promise.all([
    reply(businessId, userId, message, {}),
    reply(businessId, userId, message, { ...(preview.configuration ? { configurationPreview: preview.configuration } : {}), trainingPreview: preview.training }),
  ]);
  return { message, current, proposed };
}

export async function listTestMessages(businessId: string, sessionId: unknown) {
  const { rows } = await sessionRows(businessId, sessionId);
  return testMessages(rows.filter((r) => !["rejected", "superseded"].includes(r.status)));
}

/** The owner's verdict on one comparison. A reply they write becomes an approved example of this training. */
export async function recordTestFeedback(businessId: string, userId: string, input: { id?: unknown; message?: unknown; choice?: unknown; preferred?: unknown }) {
  const { session } = await sessionRows(businessId, input.id);
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 2000) : "";
  const preferred = typeof input.preferred === "string" ? input.preferred.trim() : "";
  if (!message || !["current", "proposed", "own"].includes(String(input.choice))) throw new PersistenceError("Zgjidh cila përgjigje është më e mirë.", 400);
  if (input.choice === "own" && (!preferred || preferred.length > 3000)) throw new PersistenceError("Shkruaj përgjigjen që do të jepje ti (deri në 3,000 shkronja).", 400);
  const db = createServiceSupabase();
  if (preferred) {
    const proposed = { customer_message: message, desired_response: preferred, situation: "Nga prova jote" };
    const content = suggestionKey(businessId, "example", null, proposed);
    const { error } = await db.from("conversation_training_suggestions").upsert({
      business_id: businessId, session_id: session.id, destination: "example", operation: "create", title: "Përgjigjja jote nga prova",
      proposed, evidence: [], confidence: "high", explicit: true, requires_confirmation: false, risk: "safe", status: "approved",
      decided_by: userId, decided_at: new Date().toISOString(), content_key: content, idempotency_key: sha256(`${session.id}|${content}`),
    }, { onConflict: "business_id,idempotency_key", ignoreDuplicates: true });
    if (error) throw new PersistenceError("Përgjigjja nuk u ruajt. Provo përsëri.");
  }
  const tests = { current: 0, proposed: 0, own: 0, ...((session.stats.tests as Record<string, number> | undefined) ?? {}) };
  tests[String(input.choice) as "current" | "proposed" | "own"]++;
  await db.from("conversation_training_sessions").update({ stats: { ...session.stats, tests } }).eq("business_id", businessId).eq("id", session.id);
  return { tests };
}
