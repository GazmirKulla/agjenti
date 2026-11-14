import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { prompt } from "@/lib/ai/prompts/files";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ANALYSIS_SCHEMA_VERSION, numberTurns, PROFILE_FIELDS, sha256, suggestionKey, validCandidates, type Candidate, type Suggestion } from "./analysis-model";
import { mergeCandidates, suggestionsFor, type ExistingData } from "./match";
import { toTurns, type Speaker, type Turn } from "./normalize";
import { pairEvidence, styleChanges, styleInstructions, stylePairs, styleStats, validStyle, type StyleStats } from "./style";

/** Prompt texts: prompts/trajnimi/*.md */
export const STYLE_PROMPT = () => prompt("trajnimi/stili-i-pronarit");
export const EXTRACTION_PROMPT = () => prompt("trajnimi/nxjerrja-nga-bisedat");
export const MERGE_PROMPT = () => prompt("trajnimi/bashkimi-i-gjetjeve");

/** The newest conversations with new messages are analysed, at most this many per session. */
export const MAX_THREADS = 600;
const BATCH_CHARS = 32_000;
const BATCH_THREADS = 25;
const TURNS_PER_THREAD = 60;
const MAX_CANDIDATES = 700;

export type AnalysisCheckpoint = {
  threads?: string[]; nextThread?: number;
  candidates?: Candidate[]; merged?: Candidate[];
  suggestions?: Suggestion[];
  topics?: Record<string, number>; outcomes?: Record<string, number>;
};

type Row = { thread_key: string; speaker: Speaker; body: string; sent_at: string };

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("ai_unconfigured");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 80_000, maxRetries: 0 });
}
async function structured(instructions: string, input: unknown, name: string, schema: Record<string, unknown>, maxTokens: number) {
  const response = await client().responses.create({
    model: modelFor("assistant"), store: false, max_output_tokens: maxTokens, instructions,
    input: JSON.stringify(input),
    text: { format: { type: "json_schema", name, strict: true, schema } },
  });
  if (response.status !== "completed" || !response.output_text) throw new Error(`${name}_incomplete`);
  return JSON.parse(response.output_text) as unknown;
}

const arr = (items: Record<string, unknown>) => ({ type: "array", items });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: "string" };

const STYLE_SCHEMA = obj({
  summary: str,
  rules: arr(obj({ rule: str, pairs: arr(str) })),
  policy: obj({ tone: { type: "string", enum: ["warm", "neutral", "formal"] }, length: { type: "string", enum: ["concise", "balanced"] }, emoji: { type: "string", enum: ["none", "light"] }, questions: { type: "string", enum: ["when_needed", "on_request"] } }),
  examples: arr(obj({ pair: str, situation: str })),
});
const INTENTS = ["product_request", "service_request", "price", "appointment", "delivery", "complaint", "technical", "availability", "greeting", "other"];
const OUTCOMES = ["sale", "appointment", "handover", "answered", "unanswered"];
const EXTRACTION_SCHEMA = obj({
  conversations: arr(obj({ ref: str, intents: arr({ type: "string", enum: INTENTS }), outcome: { type: "string", enum: OUTCOMES } })),
  items: arr(obj({
    kind: { type: "string", enum: ["product", "service", "knowledge", "profile", "workflow", "gap"] },
    name: str, body: str, field: { type: "string", enum: ["", ...PROFILE_FIELDS] }, category: str,
    prices: arr(obj({ min: { type: "number" }, max: { type: ["number", "null"] }, currency: { type: "string", enum: ["ALL", "EUR", "USD"] }, unit: { type: ["string", "null"] }, approximate: { type: "boolean" }, condition: { type: ["string", "null"] } })),
    explicit: { type: "boolean" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, evidence: arr(str),
  })),
});
const MERGE_SCHEMA = obj({ groups: arr(obj({ ids: arr(str), kind: { type: "string", enum: ["product", "service", "knowledge", "profile", "workflow", "gap"] }, name: str })) });

/** Messages of the given conversations (or the newest of the business), grouped into turns. */
async function loadThreads(businessId: string, keys?: string[], limit = 6000) {
  let query = createServiceSupabase().from("conversation_training_messages").select("thread_key,speaker,body,sent_at").eq("business_id", businessId);
  if (keys) query = query.in("thread_key", keys);
  const { data, error } = await query.order("sent_at", { ascending: false }).limit(limit);
  if (error) throw new Error("messages_unavailable");
  const byThread = new Map<string, Row[]>();
  for (const row of (data ?? []) as Row[]) byThread.set(row.thread_key, [...(byThread.get(row.thread_key) ?? []), row]);
  return [...byThread].map(([thread, rows]) => ({ thread, turns: toTurns(rows) }));
}

/** Conversations with messages not analysed yet, newest first. */
export async function threadsToAnalyse(businessId: string) {
  const { data, error } = await createServiceSupabase().from("conversation_training_messages").select("thread_key")
    .eq("business_id", businessId).is("analyzed_at", null).order("sent_at", { ascending: false }).limit(50_000);
  if (error) throw new Error("messages_unavailable");
  return [...new Set((data ?? []).map((r) => r.thread_key as string))].slice(0, MAX_THREADS);
}

async function activeAgent(businessId: string) {
  const { data } = await createServiceSupabase().from("ai_agents").select("id,communication,instructions").eq("business_id", businessId)
    .order("is_active", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; communication: unknown; instructions: string } | null;
}

/** Style: measured on all the owner's replies the business has, then described by the AI with real examples. */
export async function analyseStyle(businessId: string, previous?: StyleStats) {
  const threads = await loadThreads(businessId);
  const stats = styleStats(threads.map((t) => t.turns));
  const changes = styleChanges(previous, stats);
  if (stats.replies < 5) return { stats, changes, suggestions: [] as Suggestion[], warning: "Ka shumë pak përgjigje të shkruara nga ti për të mësuar stilin." };
  const pairs = stylePairs(threads);
  const raw = await structured(STYLE_PROMPT(), { stats, pairs: pairs.map(({ id, customer, business, tags }) => ({ id, customer, business, tags })) }, "owner_style", STYLE_SCHEMA, 4000);
  const result = validStyle(raw, pairs);
  if (!result) return { stats, changes, suggestions: [], warning: "Stili nuk u përshkrua dot këtë herë." };
  const agent = await activeAgent(businessId);
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const { data: memories } = await createServiceSupabase().from("agent_training_memories").select("customer_message,desired_response").eq("business_id", businessId).eq("kind", "example").eq("is_active", true).limit(200);
  const known = new Set((memories ?? []).map((m) => `${m.customer_message.trim().toLowerCase()}|${m.desired_response.trim().toLowerCase()}`));
  const suggestions: Suggestion[] = [];
  const styleProposed = { summary: result.summary, instructions: styleInstructions(stats, result), rules: result.rules.map((r) => r.rule), policy: result.policy, stats, changes };
  suggestions.push({
    destination: "style", operation: agent ? "update" : "create", target_table: agent ? "ai_agents" : null, target_id: agent?.id ?? null,
    title: "Si shkruan biznesi", current_value: agent ? { communication: agent.communication } : null, proposed: styleProposed,
    evidence: result.rules.flatMap((r) => r.pairs).slice(0, 4).flatMap((id) => byId.get(id) ? pairEvidence(byId.get(id)!) : []).slice(0, 8),
    confidence: stats.replies >= 30 ? "high" : stats.replies >= 12 ? "medium" : "low", explicit: true, requires_confirmation: false, risk: "safe",
    content_key: suggestionKey(businessId, "style", agent?.id ?? null, styleProposed),
  });
  for (const example of result.examples) {
    const pair = byId.get(example.pair)!;
    const proposed = { customer_message: pair.customer, desired_response: pair.business, situation: example.situation };
    const duplicate = known.has(`${pair.customer.trim().toLowerCase()}|${pair.business.trim().toLowerCase()}`);
    suggestions.push({
      destination: "example", operation: duplicate ? "duplicate" : "create", target_table: null, target_id: null,
      title: example.situation || pair.customer.slice(0, 80), current_value: null, proposed, evidence: pairEvidence(pair),
      confidence: "high", explicit: true, requires_confirmation: false, risk: "safe", content_key: suggestionKey(businessId, "example", null, proposed),
    });
  }
  return { stats, changes, suggestions, warning: null };
}

/** The next batch of conversations, bounded in size, with the AI's findings. */
export async function extractBatch(businessId: string, threads: string[], from: number, batchIndex: number) {
  const keys = threads.slice(from, from + BATCH_THREADS);
  const loaded = (await loadThreads(businessId, keys, 8000))
    .map((t) => ({ ...t, turns: t.turns.slice(-TURNS_PER_THREAD) }))
    .filter((t) => t.turns.some((turn) => turn.speaker === "customer"));
  const order = new Map(keys.map((k, i) => [k, i]));
  loaded.sort((a, b) => (order.get(a.thread) ?? 0) - (order.get(b.thread) ?? 0));
  const picked: typeof loaded = [];
  let size = 0;
  for (const t of loaded) {
    const length = t.turns.reduce((sum, turn) => sum + turn.text.length + 30, 0);
    if (picked.length && size + length > BATCH_CHARS) break;
    picked.push(t); size += length;
  }
  // Conversations not read in this batch stay for the next one.
  const consumed = picked.length ? keys.indexOf(picked.at(-1)!.thread) + 1 : keys.length;
  if (!picked.length) return { next: from + consumed, candidates: [] as Candidate[], intents: [] as string[], outcomes: [] as string[] };
  const { text, refs } = numberTurns(picked);
  const raw = await structured(EXTRACTION_PROMPT(), { conversations: text }, "conversation_findings", EXTRACTION_SCHEMA, 9000);
  const conversations = raw && typeof raw === "object" && Array.isArray((raw as { conversations?: unknown }).conversations) ? (raw as { conversations: { intents?: unknown; outcome?: unknown }[] }).conversations : [];
  return {
    next: from + consumed,
    candidates: validCandidates(raw, refs, batchIndex),
    intents: conversations.flatMap((c) => (Array.isArray(c.intents) ? c.intents.filter((i): i is string => typeof i === "string" && INTENTS.includes(i)) : [])),
    outcomes: conversations.flatMap((c) => (typeof c.outcome === "string" && OUTCOMES.includes(c.outcome) ? [c.outcome] : [])),
  };
}

/** Joins the same findings from different batches; the AI only groups ids, it writes no data. */
export async function consolidate(candidates: Candidate[]) {
  if (candidates.length < 2) return mergeCandidates(candidates);
  const list = candidates.slice(0, 300).map((c) => ({ id: c.id, kind: c.kind, field: c.field, name: c.name, body: c.body.slice(0, 160) }));
  try {
    const raw = await structured(MERGE_PROMPT(), { findings: list }, "finding_groups", MERGE_SCHEMA, 6000) as { groups?: { ids?: unknown; kind?: unknown; name?: unknown }[] };
    const groups = (raw.groups ?? []).flatMap((g) => Array.isArray(g.ids) && typeof g.kind === "string" && typeof g.name === "string"
      ? [{ ids: g.ids.filter((id): id is string => typeof id === "string"), kind: g.kind as Candidate["kind"], name: g.name }] : []);
    return mergeCandidates(candidates, groups);
  } catch {
    // Grouping by name still avoids exact duplicates.
    return mergeCandidates(candidates);
  }
}

export async function existingData(businessId: string): Promise<ExistingData> {
  const db = createServiceSupabase();
  const [products, services, knowledge, calendar] = await Promise.all([
    db.from("products").select("id,name,description,price_amount,price_max,price_mode,currency,price_unit").eq("business_id", businessId).is("archived_at", null).limit(3000),
    db.from("booking_services").select("id,name,description,price_amount,currency,price_mode").eq("business_id", businessId).limit(1000),
    db.from("knowledge_entries").select("id,title,body").eq("business_id", businessId).eq("is_active", true).limit(2000),
    db.from("business_calendar_settings").select("hours").eq("business_id", businessId).maybeSingle(),
  ]);
  if (products.error || services.error || knowledge.error) throw new Error("business_data_unavailable");
  const hours = calendar.data?.hours;
  return { products: products.data ?? [], services: services.data ?? [], knowledge: knowledge.data ?? [], calendarHours: Array.isArray(hours) && hours.length ? hours : null };
}

/** Stores the session's suggestions. Older pending suggestions are superseded; what the owner
 * rejected before, or what repeats a suggestion still open, is not proposed again. */
export async function storeSuggestions(businessId: string, sessionId: string, suggestions: Suggestion[]) {
  const db = createServiceSupabase();
  const keys = [...new Set(suggestions.map((s) => s.content_key))];
  const rejected = new Set<string>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data } = await db.from("conversation_training_suggestions").select("content_key").eq("business_id", businessId).in("status", ["rejected", "applied"]).in("content_key", keys.slice(i, i + 100));
    for (const row of data ?? []) rejected.add(row.content_key);
  }
  const rows = suggestions.filter((s) => !rejected.has(s.content_key))
    .filter((s, i, list) => list.findIndex((x) => x.content_key === s.content_key) === i)
    .map((s) => ({ ...s, business_id: businessId, session_id: sessionId, schema_version: ANALYSIS_SCHEMA_VERSION, idempotency_key: sha256(`${sessionId}|${s.content_key}`) }));
  const { error: superseded } = await db.from("conversation_training_suggestions").update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("business_id", businessId).eq("status", "pending").neq("session_id", sessionId);
  if (superseded) throw new Error("suggestions_unavailable");
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("conversation_training_suggestions").upsert(rows.slice(i, i + 200), { onConflict: "business_id,idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error("suggestions_unavailable");
  }
  return rows;
}

export async function markAnalysed(businessId: string, threads: string[]) {
  const db = createServiceSupabase();
  const now = new Date().toISOString();
  for (let i = 0; i < threads.length; i += 100) {
    const { error } = await db.from("conversation_training_messages").update({ analyzed_at: now }).eq("business_id", businessId).in("thread_key", threads.slice(i, i + 100)).is("analyzed_at", null);
    if (error) throw new Error("messages_unavailable");
  }
}

export function finalSuggestions(businessId: string, candidates: Candidate[], existing: ExistingData, style: Suggestion[]) {
  return [...style, ...suggestionsFor(businessId, candidates, existing)];
}

export const countBy = (values: string[], into: Record<string, number> = {}) => {
  for (const value of values) into[value] = (into[value] ?? 0) + 1;
  return into;
};
export const MAX_ANALYSIS_CANDIDATES = MAX_CANDIDATES;
export type { Turn };
