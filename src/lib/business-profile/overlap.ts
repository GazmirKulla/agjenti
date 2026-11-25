import { createServiceSupabase } from "@/lib/supabase/service";
import { withAiUsage } from "@/lib/ai/usage";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { prompt } from "@/lib/ai/prompts/files";

/** Prompt text: prompts/burimet/mbivendosja-me-profilin.md */
export const PROFILE_OVERLAP_PROMPT = () => prompt("burimet/mbivendosja-me-profilin");
export type ProfileOverlap = { id: string; title: string; excerpt: string; updatedAt: string; evidence: string };
export class OverlapUnavailable extends Error {}
const schema = { type: "object", additionalProperties: false, required: ["matches"], properties: {
  matches: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "score", "evidence"], properties: {
    index: { type: "integer" }, score: { type: "number" }, evidence: { type: "string" } } } } } };

/**
 * Active knowledge that may repeat what the business profile now holds (contacts, address, opening hours), found by
 * meaning on the owner's request. The server keeps only matches whose evidence is quoted from that same entry.
 * Nothing changes here: each match is shown for the owner to keep or switch off, so one fact has one source.
 */
export async function findProfileOverlaps(businessId: string): Promise<ProfileOverlap[]> {
  const { data, error } = await createServiceSupabase().from("knowledge_entries").select("id,title,body,intent_key,updated_at")
    .eq("business_id", businessId).eq("is_active", true).limit(200);
  if (error) throw new Error("Njohuritë nuk u lexuan. Provo përsëri.");
  const entries = (data ?? []).filter(entry => entry.intent_key !== "service");
  if (!entries.length) return [];
  if (!process.env.OPENAI_API_KEY?.trim()) throw new OverlapUnavailable();
  let raw: unknown;
  try {
    const response = await withAiUsage(businessId, () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 4000, instructions: PROFILE_OVERLAP_PROMPT(),
      input: JSON.stringify({ candidates: entries.map((entry, index) => ({ index, title: entry.title.slice(0, 500), body: entry.body.slice(0, 3000) })) }),
      text: { format: { type: "json_schema", name: "profile_overlap", strict: true, schema } },
    }));
    if (response.status !== "completed") throw new OverlapUnavailable();
    raw = JSON.parse(response.output_text);
  } catch { throw new OverlapUnavailable(); }
  const matches = (raw as { matches?: unknown })?.matches;
  if (!Array.isArray(matches)) throw new OverlapUnavailable();
  const seen = new Set<number>();
  return matches.flatMap(match => {
    const { index, score, evidence } = (match ?? {}) as { index?: unknown; score?: unknown; evidence?: unknown };
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= entries.length || seen.has(index as number)) return [];
    const entry = entries[index as number];
    // The quote must come from this entry, so a suggestion always points at text the owner can see.
    if (typeof score !== "number" || score < 0.6 || score > 1 || typeof evidence !== "string" || !evidence.trim()
      || !(entry.body.includes(evidence) || entry.title.includes(evidence))) return [];
    seen.add(index as number);
    return [{ id: entry.id, title: entry.title, excerpt: entry.body.slice(0, 240), updatedAt: entry.updated_at, evidence }];
  });
}
