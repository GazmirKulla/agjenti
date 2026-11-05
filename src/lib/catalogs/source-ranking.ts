import { selectSemanticCandidates } from "@/lib/conversations/understanding/selection";

/** Semantic relevance is not authority: only server-scoped records are returned. */
export async function rankKnowledge<T extends { title: string; body: string; intent_key?: string | null }>(entries: T[], question: string) {
  const selected = await selectSemanticCandidates("relevance", entries.map(entry => ({ title: entry.title, body: entry.body })), question);
  return selected.map(({ index, score }) => ({ entry: entries[index], score, index }));
}
