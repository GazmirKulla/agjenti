import { createServiceSupabase } from "@/lib/supabase/service";

/** The business profile lives in Knowledge: what the owner told us during
 * onboarding (or later to the assistant) becomes entries the agent reads in
 * replies, one per topic, which the owner edits like any other knowledge.
 * Behaviour (when to ask for help) belongs to the agent's instructions, and
 * yes/no answers only shape the panel, so neither becomes knowledge. */
export const PROFILE_TOPICS = {
  businessDescription: "Përshkrimi i biznesit",
  categoryDescription: "Çfarë bën biznesi",
  offeringsSummary: "Çfarë ofron biznesi",
  catalogContext: "Si përdoren katalogët",
  customerQuestions: "Pyetjet e shpeshta",
  customerProcess: "Si bëhet porosia ose rezervimi",
} as const;
export type ProfileTopic = keyof typeof PROFILE_TOPICS;
const PREFIX = "profile:";

/** Title, text and key of each answered topic. */
export function profileEntries(details: unknown) {
  const source = details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, unknown> : {};
  return (Object.keys(PROFILE_TOPICS) as ProfileTopic[]).flatMap((topic) => {
    const raw = source[topic];
    const body = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => `• ${item.trim()}`).join("\n")
      : typeof raw === "string" ? raw.trim() : "";
    return body ? [{ topic, intentKey: `${PREFIX}${topic}`, title: PROFILE_TOPICS[topic], body: body.slice(0, 8000) }] : [];
  });
}

/** Writes the answered topics into Knowledge. An entry the owner already has
 * for the topic is updated; topics left empty never remove anything. */
export async function syncProfileKnowledge(businessId: string, details: unknown) {
  const entries = profileEntries(details);
  if (!entries.length) return 0;
  const db = createServiceSupabase();
  const { data: existing, error } = await db.from("knowledge_entries").select("id,intent_key,body")
    .eq("business_id", businessId).in("intent_key", entries.map((entry) => entry.intentKey));
  if (error) throw new Error("profile_knowledge_unavailable");
  let written = 0;
  for (const entry of entries) {
    const current = existing?.find((row) => row.intent_key === entry.intentKey);
    if (current && current.body.trim() === entry.body) continue;
    const result = current
      ? await db.from("knowledge_entries").update({ body: entry.body, updated_at: new Date().toISOString() }).eq("id", current.id).eq("business_id", businessId)
      : await db.from("knowledge_entries").insert({ business_id: businessId, title: entry.title, body: entry.body, intent_key: entry.intentKey, is_active: true });
    if (result.error) throw new Error("profile_knowledge_failed");
    written++;
  }
  return written;
}
