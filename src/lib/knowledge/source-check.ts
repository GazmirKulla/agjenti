import { createServiceSupabase } from "@/lib/supabase/service";

const normalized = (text: string) => text.toLocaleLowerCase().replace(/[*#|`>-]/g, " ").replace(/\s+/g, " ").trim();
/**
 * After the website is read again: the knowledge learned from it whose quote is no longer in the new text
 * is marked "not found in the last read" (only marked; it may sit on a page this read did not open). An
 * entry found again loses the mark. Pure text comparison of the source with itself.
 */
export function websiteQuoteFound(evidence: string, text: string) {
  const quote = normalized(evidence);
  return quote.length < 12 || normalized(text).includes(quote.slice(0, 160));
}
export async function markWebsiteKnowledge(businessId: string, text: string) {
  if (!text.trim()) return;
  const db = createServiceSupabase();
  const { data, error } = await db.from("knowledge_entries").select("id,source").eq("business_id", businessId).eq("source->>kind", "website");
  if (error) return;
  const now = new Date().toISOString();
  for (const row of data ?? []) {
    const source = row.source as { evidence?: string; notFoundAt?: string } | null;
    if (!source?.evidence) continue;
    const found = websiteQuoteFound(source.evidence, text);
    if (found === !source.notFoundAt) continue;
    const next: Record<string, unknown> = { ...source };
    if (found) delete next.notFoundAt; else next.notFoundAt = now;
    await db.from("knowledge_entries").update({ source: next }).eq("business_id", businessId).eq("id", row.id);
  }
}
