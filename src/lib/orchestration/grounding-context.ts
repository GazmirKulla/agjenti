import type { BusinessGrounding, GroundedRead } from "@/lib/agents/business-grounding";
import { selectSemanticCandidates } from "@/lib/conversations/understanding/selection";

/** Rank the bounded tenant read before limiting prompt context; never take the first arbitrary rows. */
export async function processGroundingContext(read: BusinessGrounding, message: string, deadline: number) {
  async function project<T>(source: GroundedRead<T>, limit: number, candidate: (row: T) => { title: string; body: string }): Promise<GroundedRead<T>> {
    if (source.records.length <= limit) return source;
    try {
      const matches = await selectSemanticCandidates("relevance", source.records.map(candidate), message, deadline);
      return { ...source, records: matches.slice(0, limit).map(match => source.records[match.index]), status: "partial", reason: "semantic_context_subset" };
    } catch {
      return { ...source, records: [], status: "partial", reason: "semantic_context_unavailable" };
    }
  }
  const [products, services, knowledge] = await Promise.all([
    project(read.products, 20, row => ({ title: row.name, body: row.description ?? "" })),
    project(read.services, 20, row => ({ title: row.name, body: row.description ?? "" })),
    project({ ...read.knowledge, records: read.knowledge.records.filter(row => row.intent_key !== "service") }, 30, row => ({ title: row.title, body: row.body })),
  ]);
  return { products, services, knowledge: { ...knowledge, records: knowledge.records.map(row => ({ ...row, body: row.body.slice(0, 3000), bodyTruncated: row.body.length > 3000 })) } };
}
