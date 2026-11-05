import { selectSemanticCandidates } from "@/lib/conversations/understanding/selection";

/** Interpret references against this catalog; callers still validate tenant,
 * active status, presentation freshness and ambiguity before any action. */
export async function matchingCatalogNames<T extends { name: string }>(entries: T[], message: string): Promise<T[]> {
  const selected = await selectSemanticCandidates("identity", entries.map(entry => ({ title: entry.name })), message);
  // Identical labels cannot distinguish IDs. Preserve every duplicate even if
  // the model returned only one position, so the caller must clarify.
  const names = new Set(selected.map(match => entries[match.index].name));
  return entries.filter(entry => names.has(entry.name));
}
