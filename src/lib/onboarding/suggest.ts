import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/generate";
import { prompt } from "@/lib/ai/prompts/files";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { ContinuationItem } from "./continuation";
import { loadContinuation } from "./continuation-service";

/** What the owner is offered for one profile question, in the shape the
 * answer endpoint takes. */
export type SuggestedAnswer = { values: string[] } | { text: string };

/** Keeps only answers that fit their question: known field, allowed options,
 * one option unless the question takes several, text within limits. */
export function validSuggestions(items: ContinuationItem[], raw: unknown): Record<string, SuggestedAnswer> {
  const answers = raw && typeof raw === "object" && Array.isArray((raw as { answers?: unknown }).answers) ? (raw as { answers: unknown[] }).answers : [];
  const out: Record<string, SuggestedAnswer> = {};
  for (const entry of answers) {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const item = items.find((candidate) => candidate.field === row.field);
    if (!item || out[item.field]) continue;
    if (item.kind === "text" || item.kind === "list") {
      const text = typeof row.text === "string" ? row.text.trim().slice(0, 2000) : "";
      if (text.length >= 2) out[item.field] = { text };
      continue;
    }
    const allowed = new Set(item.options.map((option) => option.value));
    const values = [...new Set((Array.isArray(row.values) ? row.values : []).filter((value): value is string => typeof value === "string" && allowed.has(value)))];
    if (values.length) out[item.field] = { values: item.kind === "multiple" ? values : values.slice(0, 1) };
  }
  return out;
}

/** The profile questions answered from what the business already confirmed:
 * its active knowledge, the Instagram bio and the website description. */
export async function suggestProfileAnswers(businessId: string): Promise<Record<string, SuggestedAnswer>> {
  if (!process.env.OPENAI_API_KEY) return {};
  const view = await loadContinuation(businessId);
  if (!view?.items.length) return {};
  const db = createServiceSupabase();
  const [{ data: knowledge }, { data: preview }] = await Promise.all([
    db.from("knowledge_entries").select("title,body").eq("business_id", businessId).eq("is_active", true).order("updated_at", { ascending: false }).limit(40),
    db.from("business_source_previews").select("instagram,website").eq("business_id", businessId).maybeSingle(),
  ]);
  const bio = typeof preview?.instagram?.profile?.biography === "string" ? preview.instagram.profile.biography : "";
  const description = typeof preview?.website?.description === "string" ? preview.website.description : "";
  if (!knowledge?.length && !bio && !description) return {};
  const questions = view.items.map((item) => ({ field: item.field, title: item.title, kind: item.kind, options: item.options }));
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 });
  const result = await client.responses.create({
    model: modelFor("assistant"), store: false,
    instructions: prompt("burimet/plotesimi-i-profilit"),
    input: JSON.stringify({
      questions,
      knowledge: (knowledge ?? []).map((entry) => ({ title: entry.title, body: String(entry.body).slice(0, 1200) })),
      instagramBio: bio, websiteDescription: description,
    }),
    text: { format: { type: "json_schema", name: "profile_answers", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["answers"],
      properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "values", "text"],
        properties: { field: { type: "string" }, values: { type: "array", items: { type: "string" } }, text: { type: "string" } } } } },
    } } },
  });
  return validSuggestions(view.items, JSON.parse(result.output_text));
}
