/** Who wrote a line: the customer, a person of the business, or the agent. */
export type Speaker = "klienti" | "biznesi" | "agjenti";
export type Line = { speaker: Speaker; text: string; at: string };
export type Transcript = { key: string; channel: "instagram" | "whatsapp"; lines: Line[]; lastAt: string };

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// Phone-like runs: 9+ digits with spaces, dots, dashes or a leading + (prices such as "1500 - 2000" stay).
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const phone = (match: string) => (match.replace(/\D/g, "").length >= 9 ? "[telefon]" : match);
const URL_WITH_TOKEN = /https?:\/\/\S*[?&](token|key|code|sig)=\S*/gi;

/** Removes contact details before conversations are sent to the AI; names are never sent. */
export function redact(text: string): string {
  return text.replace(URL_WITH_TOKEN, "[lidhje]").replace(EMAIL, "[email]").replace(PHONE, phone);
}

/** Keeps the newest `perConversation` text lines, oldest first, trimmed and redacted. */
export function cleanLines(lines: Line[], perConversation: number, maxChars = 500): Line[] {
  return lines
    .filter((line) => line.text.trim())
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-perConversation)
    .map((line) => {
      const text = redact(line.text.replace(/\s+/g, " ").trim());
      return { ...line, text: text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text };
    });
}

/** Stored conversations plus Instagram history for customers not stored yet,
 * newest first, at most `max`. The stored copy wins: it knows the agent's lines. */
export function mergeTranscripts(stored: Transcript[], history: Transcript[], max: number): Transcript[] {
  const seen = new Set(stored.map((t) => t.key));
  return [...stored, ...history.filter((t) => !seen.has(t.key))]
    .filter((t) => t.lines.length > 0)
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, max);
}

/** The text the AI reads, bounded so one scan stays within a predictable cost. */
export function transcriptText(transcripts: Transcript[], maxChars = 120_000): string {
  const parts: string[] = [];
  let size = 0;
  for (const [index, t] of transcripts.entries()) {
    const block = `### Biseda ${index + 1} (${t.channel})\n${t.lines.map((l) => `${l.speaker}: ${l.text}`).join("\n")}`;
    if (size + block.length > maxChars) break;
    parts.push(block);
    size += block.length + 2;
  }
  return parts.join("\n\n");
}

export type SuggestionKind = "faq" | "fact" | "gap" | "conflict";
export type Suggestion = {
  kind: SuggestionKind;
  title: string;
  body: string;
  evidence: string[];
  count: number;
  /** For a conflict: the title of the knowledge entry the conversations contradict. */
  existingTitle: string | null;
};

const KINDS = new Set<SuggestionKind>(["faq", "fact", "gap", "conflict"]);
const norm = (value: string) => value.trim().toLocaleLowerCase();

/** Keeps only well-formed suggestions; drops what the knowledge already has
 * under the same title (except a conflict, which names it on purpose). */
export function validSuggestions(raw: unknown, knowledgeTitles: string[]): Suggestion[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { suggestions?: unknown }).suggestions) ? (raw as { suggestions: unknown[] }).suggestions : [];
  const known = new Map(knowledgeTitles.map((title) => [norm(title), title]));
  const out: Suggestion[] = [];
  const titles = new Set<string>();
  for (const item of list) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const kind = row.kind as SuggestionKind;
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 300) : "";
    const body = typeof row.body === "string" ? redact(row.body.trim()).slice(0, 4000) : "";
    if (!KINDS.has(kind) || title.length < 3 || titles.has(norm(title))) continue;
    if (kind !== "gap" && body.length < 3) continue;
    let existingTitle: string | null = null;
    if (kind === "conflict") {
      existingTitle = typeof row.existing_title === "string" ? known.get(norm(row.existing_title)) ?? null : null;
      if (!existingTitle) continue;
    } else if (known.has(norm(title))) continue;
    const evidence = (Array.isArray(row.evidence) ? row.evidence : [])
      .filter((quote): quote is string => typeof quote === "string" && quote.trim().length > 0)
      .slice(0, 3).map((quote) => redact(quote.trim()).slice(0, 240));
    const count = typeof row.count === "number" && Number.isFinite(row.count) ? Math.max(1, Math.round(row.count)) : 1;
    titles.add(norm(title));
    out.push({ kind, title, body, evidence, count, existingTitle });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 30);
}
