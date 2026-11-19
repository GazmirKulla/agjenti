/**
 * Where a knowledge entry came from, stored with it (knowledge_entries.source). The text itself is kept as
 * written, in light Markdown (knowledge_entries.format): lists, numbered steps, tables and short bold labels.
 */
export type KnowledgeSourceKind = "owner" | "website" | "instagram" | "conversation" | "profile" | "instructions" | "assistant";
export type KnowledgeSource = { kind: KnowledgeSourceKind; ref?: string; evidence?: string; capturedAt?: string };

export const knowledgeSource = (kind: KnowledgeSourceKind, extra: Omit<KnowledgeSource, "kind" | "capturedAt"> = {}): KnowledgeSource =>
  ({ kind, ...extra, capturedAt: new Date().toISOString() });

const kinds: Record<KnowledgeSourceKind, string> = {
  owner: "Shkruar nga ti", website: "Nga faqja e webit", instagram: "Nga Instagram-i", conversation: "Nga bisedat e vjetra",
  profile: "Nga profili i biznesit", instructions: "Nga udhëzimet e Agjentit", assistant: "Nga Asistenti",
};

/** "Nga faqja e webit · 18 nën · ndryshuar nga ti"; an entry saved before sources were kept says so. */
export function knowledgeSourceLabel(source: unknown, ownerEditedAt?: string | null) {
  const s = source && typeof source === "object" ? source as Partial<KnowledgeSource> : null;
  const date = (value?: string | null) => value ? new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Tirane" }).format(new Date(value)) : "";
  const head = s?.kind && kinds[s.kind] ? kinds[s.kind] : "Burim i panjohur";
  const parts = [head, date(s?.capturedAt)].filter(Boolean);
  if (ownerEditedAt && s?.kind !== "owner") parts.push(`ndryshuar nga ti ${date(ownerEditedAt)}`);
  const notFound = (source as { notFoundAt?: string } | null)?.notFoundAt;
  if (notFound) parts.push(`nuk u gjet në leximin e fundit të faqes (${date(notFound)})`);
  return parts.join(" · ");
}
