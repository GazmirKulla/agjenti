import type { BusinessGrounding, GroundedRead } from "@/lib/agents/business-grounding";
import { selectSemanticCandidates } from "@/lib/conversations/understanding/selection";

/** Rank the bounded tenant read before limiting prompt context; never take the first arbitrary rows. */
export async function processGroundingContext(read: BusinessGrounding, message: string, deadline: number, pin?: { productIds?: string[]; serviceIds?: string[] }) {
  async function project<T extends { id: string }>(source: GroundedRead<T>, limit: number, candidate: (row: T) => { title: string; body: string }, pinIds: string[] = []): Promise<GroundedRead<T>> {
    const pinned = pinIds.flatMap(id => {
      const row = source.records.find(record => record.id === id);
      return row ? [row] : [];
    });
    if (source.records.length <= limit) {
      const records = [...new Map([...pinned, ...source.records].map(row => [row.id, row])).values()];
      return records.length === source.records.length ? source : { ...source, records, status: "partial", reason: "pinned_catalog_reference" };
    }
    try {
      const matches = await selectSemanticCandidates("relevance", source.records.map(candidate), message, deadline);
      const selected = matches.slice(0, Math.max(0, limit - pinned.length)).map(match => source.records[match.index]);
      return { ...source, records: [...new Map([...pinned, ...selected].map(row => [row.id, row])).values()].slice(0, limit), status: "partial", reason: "semantic_context_subset" };
    } catch {
      return { ...source, records: pinned, status: "partial", reason: "semantic_context_unavailable" };
    }
  }
  const [products, services, knowledge] = await Promise.all([
    project(read.products, 20, row => ({ title: row.name, body: [row.description, row.details, row.variants, row.choices].filter(Boolean).join("\n") }), pin?.productIds ?? []),
    project(read.services, 20, row => ({ title: row.name, body: row.description ?? "" }), pin?.serviceIds ?? []),
    project({ ...read.knowledge, records: read.knowledge.records.filter(row => row.intent_key !== "service") }, 30, row => ({ title: row.title, body: row.body })),
  ]);
  return { products, services, knowledge: { ...knowledge, records: knowledge.records.map(row => ({ ...row, body: row.body.slice(0, 3000), bodyTruncated: row.body.length > 3000 })) } };
}
