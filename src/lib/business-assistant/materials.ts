import { inspectAttachment, readAttachmentForm, readAttachment, sealAttachment } from "@/lib/agents/test-chat/attachments";
import { readPublicMaterial } from "./public-page";
import { AssistantError } from "./model";
export { inspectAttachment, readAttachmentForm, sealAttachment };
export type AssistantMaterial = { name: string; text: string; kind: string; url?: string };
export async function resolveMaterials(tokens: unknown, links: unknown, userId: string, businessId: string): Promise<AssistantMaterial[]> {
  if (!Array.isArray(tokens) || !Array.isArray(links) || tokens.length + links.length > 3 || tokens.some(t => typeof t !== "string") || links.some(u => typeof u !== "string" || u.length > 2048)) throw new AssistantError("Shto deri në 3 materiale të vlefshme.");
  const materials: AssistantMaterial[] = [];
  for (const token of tokens) {
    try { materials.push(readAttachment(token, userId, businessId)); }
    catch { throw new AssistantError("Skedari ka skaduar ose nuk është i vlefshëm. Ngarkoje përsëri."); }
  }
  for (const url of links as string[]) {
    try {
      const page = await readPublicMaterial(url);
      if ("error" in page) throw new AssistantError(page.error);
      if (!/text\/(html|plain)|application\/(xhtml\+xml|json)/i.test(page.contentType)) throw new AssistantError("Ky link nuk përmban faqe tekst. Ngarko skedarin drejtpërdrejt.");
      const text = page.body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, 16000);
      if (!text) throw new AssistantError("Faqja nuk ka tekst të lexueshëm. Kopjo tekstin ose ngarko një foto.");
      materials.push({ name: page.url, url: page.url, text, kind: "link" });
    } catch (error) { if (error instanceof AssistantError) throw error; throw new AssistantError("Linku nuk u lexua. Provo përsëri ose ngarko përmbajtjen si skedar."); }
  }
  return materials;
}
export function linksInText(text: string): string[] { return [...new Set((text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map(url => url.replace(/[.,;!?)}\]]+$/, "")))]; }
