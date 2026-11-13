import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/generate";
import { prompt } from "@/lib/ai/prompts/files";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { instagramGraph, instagramHistory } from "./instagram-history";
import type { LearningSettings } from "./settings";
import { cleanLines, mergeTranscripts, transcriptText, validSuggestions, type Line, type Suggestion, type Transcript } from "./transcripts";

/** Marks knowledge entries the owner approved from conversations. */
export const CONVERSATIONS_INTENT = "conversations";

const since = (settings: LearningSettings) => new Date(Date.now() - settings.lookback_days * 86_400_000);

async function instagramAccount(businessId: string) {
  const { data } = await createServiceSupabase().from("instagram_connections")
    .select("ig_user_id,access_token_ciphertext,status,expires_at")
    .eq("business_id", businessId).eq("status", "connected")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data?.access_token_ciphertext || (data.expires_at && Date.parse(data.expires_at) < Date.now())) return null;
  try { return { accountId: String(data.ig_user_id), graph: instagramGraph(decryptSecret(data.access_token_ciphertext)) }; }
  catch { return null; }
}

export type Eligibility = { enabled: boolean; eligible: boolean; count: number; required: number; instagram: boolean };

/** Whether the business has enough conversations to learn from: those stored
 * in Agjenti, or, with Instagram connected, its DMs from before the connection. */
export async function learningEligibility(businessId: string, settings: LearningSettings): Promise<Eligibility> {
  const required = settings.min_conversations;
  const { count } = await createServiceSupabase().from("conversations").select("id", { count: "exact", head: true })
    .eq("business_id", businessId).in("channel", ["instagram", "whatsapp"]).gte("last_message_at", since(settings).toISOString());
  let total = count ?? 0;
  let instagram = false;
  if (settings.enabled && total < required && settings.instagram_history) {
    const account = await instagramAccount(businessId);
    if (account) {
      instagram = true;
      const body = await account.graph("me/conversations", { platform: "instagram", fields: "id,updated_time", limit: String(Math.min(50, required)) }).catch(() => null);
      const recent = (Array.isArray(body?.data) ? body.data : []).filter((row: { updated_time?: string }) => row.updated_time && Date.parse(row.updated_time) >= since(settings).getTime());
      total = Math.max(total, recent.length);
    }
  }
  return { enabled: settings.enabled, eligible: settings.enabled && total >= required, count: total, required, instagram };
}

const SPEAKERS = { customer: "klienti", staff: "biznesi", agent: "agjenti" } as const;

async function storedTranscripts(businessId: string, settings: LearningSettings): Promise<{ transcripts: Transcript[]; agentIds: Set<string> }> {
  const db = createServiceSupabase();
  const { data: conversations, error } = await db.from("conversations")
    .select("id,channel,last_message_at,customers(instagram_user_id)")
    .eq("business_id", businessId).in("channel", ["instagram", "whatsapp"])
    .gte("last_message_at", since(settings).toISOString())
    .order("last_message_at", { ascending: false }).limit(settings.max_conversations);
  if (error) throw new PersistenceError("Bisedat nuk u ngarkuan.");
  const transcripts: Transcript[] = [];
  const agentIds = new Set<string>();
  const rows = conversations ?? [];
  for (let i = 0; i < rows.length; i += 10) {
    await Promise.all(rows.slice(i, i + 10).map(async (row) => {
      const { data: messages } = await db.from("messages").select("source,body,created_at,external_message_id")
        .eq("business_id", businessId).eq("conversation_id", row.id).not("body", "is", null)
        .in("source", ["customer", "staff", "agent"])
        .order("created_at", { ascending: false }).limit(settings.messages_per_conversation);
      const lines: Line[] = (messages ?? []).map((m) => {
        if (m.source === "agent" && m.external_message_id) agentIds.add(m.external_message_id);
        return { speaker: SPEAKERS[m.source as keyof typeof SPEAKERS], text: String(m.body), at: m.created_at };
      });
      const customer = (Array.isArray(row.customers) ? row.customers[0] : row.customers) as { instagram_user_id?: string | null } | null;
      transcripts.push({
        key: row.channel === "instagram" && customer?.instagram_user_id ? `instagram:${customer.instagram_user_id}` : `stored:${row.id}`,
        channel: row.channel as Transcript["channel"], lines, lastAt: row.last_message_at,
      });
    }));
  }
  return { transcripts, agentIds };
}

export type ScanResult = { suggestions: Suggestion[]; scanned: { conversations: number; messages: number; fromInstagram: number } };

/** Reads the business's recent conversations and suggests knowledge from
 * them. Nothing is saved: the owner approves each suggestion. */
export async function scanConversations(businessId: string, settings: LearningSettings): Promise<ScanResult> {
  if (!settings.enabled) throw new PersistenceError("Mësimi nga bisedat është i fikur nga platforma.", 403);
  if (!process.env.OPENAI_API_KEY) throw new PersistenceError("AI nuk është konfiguruar.", 503);
  const { transcripts: stored, agentIds } = await storedTranscripts(businessId, settings);
  let history: Transcript[] = [];
  if (settings.instagram_history) {
    const account = await instagramAccount(businessId);
    if (account) {
      history = await instagramHistory({
        graph: account.graph, accountId: account.accountId, since: since(settings),
        maxConversations: settings.max_conversations, perConversation: settings.messages_per_conversation, agentMessageIds: agentIds,
      }).catch((error) => {
        console.error("[conversation-learning] instagram", error instanceof Error ? error.message.slice(0, 200) : "failed");
        return [];
      });
    }
  }
  const storedKeys = new Set(stored.map((t) => t.key));
  const merged = mergeTranscripts(stored, history, settings.max_conversations)
    .map((t) => ({ ...t, lines: cleanLines(t.lines, settings.messages_per_conversation) }))
    .filter((t) => t.lines.some((line) => line.speaker === "klienti"));
  if (merged.length < settings.min_conversations)
    throw new PersistenceError(`Duhen të paktën ${settings.min_conversations} biseda me klientë; tani janë ${merged.length}.`, 409);

  const { data: knowledge } = await createServiceSupabase().from("knowledge_entries").select("title,body")
    .eq("business_id", businessId).order("updated_at", { ascending: false }).limit(80);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 110_000, maxRetries: 0 });
  const result = await client.responses.create({
    model: modelFor("assistant"), store: false,
    instructions: prompt("burimet/mesimi-nga-bisedat"),
    input: JSON.stringify({
      knowledge: (knowledge ?? []).map((entry) => ({ title: entry.title, body: String(entry.body).slice(0, 600) })),
      conversations: transcriptText(merged),
    }),
    text: { format: { type: "json_schema", name: "conversation_learning", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["suggestions"],
      properties: { suggestions: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["kind", "title", "body", "evidence", "count", "existing_title"],
        properties: {
          kind: { type: "string", enum: ["faq", "fact", "gap", "conflict"] },
          title: { type: "string" }, body: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          count: { type: "integer" }, existing_title: { type: "string" },
        },
      } } },
    } } },
  });
  return {
    suggestions: validSuggestions(JSON.parse(result.output_text), (knowledge ?? []).map((entry) => entry.title)),
    scanned: {
      conversations: merged.length,
      messages: merged.reduce((sum, t) => sum + t.lines.length, 0),
      fromInstagram: merged.filter((t) => !storedKeys.has(t.key)).length,
    },
  };
}

/** Saves one approved suggestion: a new active entry, or, for a conflict,
 * the corrected text of the existing entry with that title. */
export async function saveSuggestion(businessId: string, input: { kind?: unknown; title?: unknown; body?: unknown; existingTitle?: unknown }) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || !body || title.length > 500 || body.length > 8000) throw new PersistenceError("Plotëso titullin dhe përmbajtjen (deri në 8000 karaktere).", 400);
  const db = createServiceSupabase();
  if (input.kind === "conflict") {
    const existing = typeof input.existingTitle === "string" ? input.existingTitle.trim() : "";
    const { data: rows } = await db.from("knowledge_entries").select("id,title").eq("business_id", businessId);
    const match = (rows ?? []).find((row) => row.title.trim().toLocaleLowerCase() === existing.toLocaleLowerCase());
    if (!match) throw new PersistenceError("Njohuria që do përditësohej nuk u gjet më.", 404);
    const { error } = await db.from("knowledge_entries").update({ body, is_active: true, updated_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("id", match.id);
    if (error) throw new PersistenceError("Njohuria nuk u përditësua. Provo përsëri.");
    return { updated: match.title };
  }
  const { error } = await db.from("knowledge_entries").insert({ business_id: businessId, title, body, intent_key: CONVERSATIONS_INTENT, is_active: true });
  if (error) throw new PersistenceError("Njohuria nuk u ruajt. Provo përsëri.");
  return { created: title };
}
