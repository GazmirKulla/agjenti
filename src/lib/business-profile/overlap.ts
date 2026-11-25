import { createServiceSupabase } from "@/lib/supabase/service";
import { withAiUsage } from "@/lib/ai/usage";
import { selectSemanticCandidates, SelectionUnavailable } from "@/lib/conversations/understanding/selection";

/** What the profile now holds, as the question the knowledge is matched against (meaning, not words). */
export const PROFILE_TOPICS_QUERY = "Kontaktet publike të biznesit (telefoni, email-i, website-i, rrjetet sociale), adresa ose vendndodhja, dhe orari i hapjes.";
export type ProfileOverlap = { id: string; title: string; excerpt: string; updatedAt: string; evidence: string };

/**
 * Active knowledge that may repeat what the business profile now holds, found by meaning on the owner's request.
 * Nothing changes here: each match is shown for the owner to keep or switch off, so one fact has one source.
 */
export async function findProfileOverlaps(businessId: string): Promise<ProfileOverlap[]> {
  const { data, error } = await createServiceSupabase().from("knowledge_entries").select("id,title,body,intent_key,updated_at")
    .eq("business_id", businessId).eq("is_active", true).limit(400);
  if (error) throw new Error("Njohuritë nuk u lexuan. Provo përsëri.");
  const entries = (data ?? []).filter(entry => entry.intent_key !== "service");
  if (!entries.length) return [];
  const matches = await withAiUsage(businessId, () => selectSemanticCandidates("relevance", entries.map(entry => ({ title: entry.title, body: entry.body })), PROFILE_TOPICS_QUERY));
  return matches.filter(match => match.score >= 0.6).map(match => {
    const entry = entries[match.index];
    return { id: entry.id, title: entry.title, excerpt: entry.body.slice(0, 240), updatedAt: entry.updated_at, evidence: match.evidence };
  });
}
export { SelectionUnavailable };
