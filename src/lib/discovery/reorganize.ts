import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/generate";
import { prompt } from "@/lib/ai/prompts/files";
import { createServiceSupabase } from "@/lib/supabase/service";
import { value, type Entity } from "@/lib/business-intelligence/model";

/** At the end of the onboarding scan everything found on Instagram and the
 * website is merged into one clean list for the owner to accept, reject or
 * edit. The earlier source's separate proposal is replaced by it. */

type Item = { title: string; body: string; source: "instagram" | "website" | "both" };

export function itemsToEntities(items: Item[], now = new Date().toISOString()): Entity[] {
  return items.flatMap((item) => {
    const title = item.title.trim().slice(0, 200), body = item.body.trim().slice(0, 8000);
    if (title.length < 2 || body.length < 2) return [];
    // Knowledge from the scan is routed only when it carries a website/Instagram source and evidence.
    const source = item.source === "instagram" ? "instagram" as const : "website" as const;
    const fact = (field: "title" | "body", text: string) => ({ field, value: text, source, sourceRef: "onboarding:organized", confidence: 0.9,
      evidence: body, evidenceKind: "text" as const, confirmedByUser: false, createdAt: now, updatedAt: now });
    return [{ id: crypto.randomUUID(), target: "knowledge" as const, facts: [fact("title", title), fact("body", body)] }];
  });
}

/** One proposed entry per title: a second entry with the same title would be
 * held back inactive outside the proposal, so same-title bodies are merged. */
export function oneEntryPerTitle(entities: Entity[]): Entity[] {
  const byTitle = new Map<string, Entity>();
  const out: Entity[] = [];
  for (const entity of entities) {
    const key = value(entity, "title").trim().toLowerCase();
    const first = key ? byTitle.get(key) : undefined;
    if (!first) { const copy = { ...entity }; if (key) byTitle.set(key, copy); out.push(copy); continue; }
    const extra = value(entity, "body").trim();
    if (!extra || value(first, "body").includes(extra)) continue;
    const body = `${value(first, "body").trim()}\n\n${extra}`.slice(0, 8000);
    first.facts = first.facts.map((fact) => fact.field === "body" ? { ...fact, value: body, evidence: [fact.evidence, extra].filter(Boolean).join("\n\n").slice(0, 8000) } : fact);
  }
  return out;
}

export function parseItems(raw: unknown): Item[] {
  const entries = raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries) ? (raw as { entries: unknown[] }).entries : [];
  return entries.flatMap((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const source: Item["source"] = row.source === "instagram" || row.source === "website" ? row.source : "both";
    return typeof row.title === "string" && typeof row.body === "string" ? [{ title: row.title, body: row.body, source }] : [];
  }).slice(0, 12);
}

/** Earlier sources' pending proposals (their entries are replaced by the merged list). */
async function earlierProposals(businessId: string, jobId: string) {
  const db = createServiceSupabase();
  const { data: jobs } = await db.from("business_discovery_jobs").select("id,source,checkpoint")
    .eq("business_id", businessId).eq("status", "completed").neq("id", jobId).not("input->>review", "is", null);
  const pending = (jobs ?? []).filter((job) => job.checkpoint?.review?.status === "pending");
  const ids = pending.flatMap((job) => (job.checkpoint.review.knowledgeIds ?? []) as string[]);
  const { data: entries } = ids.length ? await db.from("knowledge_entries").select("id,title,body").eq("business_id", businessId).eq("is_active", false).in("id", ids) : { data: [] };
  return { pending, ids, entries: (entries ?? []).map((entry) => ({ ...entry, source: pending.find((job) => (job.checkpoint.review.knowledgeIds ?? []).includes(entry.id))?.source ?? "website" })) };
}

/** The merged list, or null when there is nothing to merge or the model failed
 * (the scan then keeps its own proposal). Earlier proposals are cleared only
 * after the merged list exists. */
export async function reorganizeKnowledge(businessId: string, jobId: string, jobSource: string, current: Entity[]): Promise<Entity[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const earlier = await earlierProposals(businessId, jobId);
  const { data: preview } = await createServiceSupabase().from("business_source_previews").select("instagram,website").eq("business_id", businessId).maybeSingle();
  const input = [
    ...earlier.entries.map((entry) => ({ title: entry.title, body: entry.body, source: entry.source })),
    ...current.map((entity) => ({ title: value(entity, "title"), body: value(entity, "body"), source: jobSource })),
  ].filter((item) => item.title || item.body);
  const bio = typeof preview?.instagram?.profile?.biography === "string" ? preview.instagram.profile.biography : "";
  const description = typeof preview?.website?.description === "string" ? preview.website.description : "";
  if (!input.length && !bio && !description) return null;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
    const result = await client.responses.create({
      model: modelFor("assistant"), store: false,
      instructions: prompt("burimet/riorganizimi-i-njohurive"),
      input: JSON.stringify({ instagramBio: bio, websiteDescription: description, entries: input }),
      text: { format: { type: "json_schema", name: "organized_knowledge", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["entries"],
        properties: { entries: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "body", "source"],
          properties: { title: { type: "string" }, body: { type: "string" }, source: { type: "string", enum: ["instagram", "website", "both"] } } } } },
      } } },
    });
    const entities = itemsToEntities(parseItems(JSON.parse(result.output_text)));
    if (!entities.length) return null;
    // The earlier proposal is replaced by the merged list.
    const db = createServiceSupabase();
    if (earlier.ids.length) await db.from("knowledge_entries").delete().eq("business_id", businessId).eq("is_active", false).in("id", earlier.ids);
    for (const job of earlier.pending)
      await db.from("business_discovery_jobs").update({ checkpoint: { ...job.checkpoint, review: { ...job.checkpoint.review, knowledgeIds: [] } } }).eq("id", job.id);
    return entities;
  } catch (error) {
    console.error("[discovery reorganize]", error instanceof Error ? error.message.slice(0, 200) : "failed");
    return null;
  }
}
