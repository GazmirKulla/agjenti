/** Reads the conversations of an Instagram data export ("Download your
 * information"), in its JSON or HTML form. Everything in the files is
 * untrusted data: it is parsed as text and never interpreted. */

export type ExportMessage = { sender: string; text: string; at: Date };
export type ExportThread = { path: string; participants: string[]; messages: ExportMessage[] };

/** Conversation files of the export: inbox and message requests, JSON or HTML,
 * in the old (`messages/…`) or current (`your_instagram_activity/messages/…`) layout. */
const CONVERSATION_FILE = /(?:^|\/)messages\/(?:inbox|message_requests)\/[^/]+\/message_\d+\.(json|html)$/i;

export function conversationFileKind(path: string): "json" | "html" | null {
  const match = CONVERSATION_FILE.exec(path.replace(/\\/g, "/"));
  return match ? (match[1].toLowerCase() as "json" | "html") : null;
}

/** The folder of a conversation (several message_N files belong to one). */
export function conversationFolder(path: string) {
  return path.replace(/\\/g, "/").replace(/\/message_\d+\.(json|html)$/i, "");
}

/** Instagram writes UTF-8 bytes as if each were a Latin-1 character ("Ã«" for "ë").
 * The text is repaired only when it is clearly in that form. */
export function repairText(value: string): string {
  if (!value || !/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
  const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return value; }
}

/** Instagram's own notices in a conversation: likes, reactions, attachments, calls. */
const SYSTEM = [
  /^(?:.{0,80} )?(?:liked a message|reacted .{1,16} to (?:your|a) message|sent an attachment|shared a story|mentioned you in (?:their|his|her) story|replied to your story|started a (?:video|audio) chat|missed a (?:video|audio )?call|the (?:video|audio) chat ended|changed the theme|set the nickname|unsent a message)\.?$/i,
  /^(?:.{0,80} )?(?:pëlqeu një mesazh|reagoi .{1,16} ndaj mesazhit|dërgoi një (?:bashkëngjitje|skedar)|ndau një story)\.?$/i,
];
export const isSystemText = (text: string) => SYSTEM.some((pattern) => pattern.test(text.trim()));

/** The export lists the newest message first; equal times keep the reverse of file order. */
function oldestFirst(messages: ExportMessage[]) {
  return messages.map((m, i) => ({ m, i })).sort((a, b) => a.m.at.getTime() - b.m.at.getTime() || b.i - a.i).map(({ m }) => m);
}
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** One message_N.json file. */
export function parseExportJson(text: string, path: string): ExportThread | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== "object" || !Array.isArray((data as { messages?: unknown }).messages)) return null;
  const raw = data as { participants?: unknown; messages: unknown[] };
  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => repairText(str((p as { name?: unknown })?.name)).trim()).filter(Boolean);
  const messages: ExportMessage[] = [];
  for (const item of raw.messages) {
    const m = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const sender = repairText(str(m.sender_name)).trim();
    const content = repairText(str(m.content)).trim();
    const ms = typeof m.timestamp_ms === "number" ? m.timestamp_ms : Number.NaN;
    if (!sender || !Number.isFinite(ms)) continue;
    // Media without text is kept as a marker: "[foto]" still shows the customer sent a picture.
    const text = content || (Array.isArray(m.photos) && m.photos.length ? "[foto]" : Array.isArray(m.videos) && m.videos.length ? "[video]" : Array.isArray(m.audio_files) && m.audio_files.length ? "[zë]" : "");
    if (!text || isSystemText(text)) continue;
    messages.push({ sender, text, at: new Date(ms) });
  }
  return { path, participants, messages: oldestFirst(messages) };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", euml: "ë", Euml: "Ë", ccedil: "ç", Ccedil: "Ç", hellip: "…", ndash: "–", mdash: "—" };
export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? whole;
  });
}
const plain = (html: string) => decodeEntities(html.replace(/<br\s*\/?>|<\/?(?:div|p|li|tr|td|table|section|h\d)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ")).replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  shk: 1, pri: 3, maj: 4, qer: 5, kor: 6, korr: 6, gus: 7, gush: 7, sht: 8, tet: 9, nën: 10, nen: 10, dhj: 11,
};
/** The date line of an HTML message: "Jan 05, 2024 3:12 pm", "Jan 05, 2024, 3:12 PM",
 * "05 jan 2024, 15:12", or an ISO date. Read as UTC: the export does not name a zone. */
export function parseExportDate(value: string): Date | null {
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0)));
  const named = /^([a-zë]{3,9})\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?(am|pm|pd|md)?$/.exec(text)
    ?? null;
  const dayFirst = named ? null : /^(\d{1,2}) ([a-zë]{3,9})\.? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?(am|pm|pd|md)?$/.exec(text);
  const parts = named ? { month: named[1], day: named[2], rest: named.slice(3) } : dayFirst ? { month: dayFirst[2], day: dayFirst[1], rest: dayFirst.slice(3) } : null;
  if (!parts) return null;
  const month = MONTHS[parts.month.slice(0, 4)] ?? MONTHS[parts.month.slice(0, 3)];
  if (month === undefined) return null;
  const [year, h, min, sec, half] = parts.rest;
  let hour = +h;
  if (half === "pm" || half === "md") hour = hour % 12 + 12;
  else if (half === "am" || half === "pd") hour = hour % 12;
  if (hour > 23 || +min > 59 || +parts.day < 1 || +parts.day > 31) return null;
  return new Date(Date.UTC(+year, month, +parts.day, hour, +min, +(sec ?? 0)));
}

/** One message_N.html file. Each message is an <h2> with the sender, then its
 * content, then a date line; class names change between exports, so only that
 * order is relied on. */
export function parseExportHtml(html: string, path: string): ExportThread | null {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  const blocks = body.split(/<h2\b[^>]*>/i).slice(1);
  if (!blocks.length) return null;
  const participantsMatch = /Participants?:\s*([^<]+)</i.exec(body) ?? /Pjesëmarrësit?:\s*([^<]+)</i.exec(body);
  const participants = participantsMatch
    ? decodeEntities(participantsMatch[1]).split(/,| and | dhe /).map((name) => repairText(name).trim()).filter(Boolean)
    : [];
  const messages: ExportMessage[] = [];
  for (const block of blocks) {
    const end = block.search(/<\/h2>/i);
    if (end < 0) continue;
    const sender = repairText(plain(block.slice(0, end)));
    const lines = plain(block.slice(end + 5)).split("\n").map((line) => line.trim()).filter(Boolean);
    let at: Date | null = null;
    let dateIndex = -1;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
      at = parseExportDate(lines[i]);
      if (at) { dateIndex = i; break; }
    }
    if (!sender || !at) continue;
    const text = repairText(lines.slice(0, dateIndex).join("\n")).trim();
    if (!text || isSystemText(text)) continue;
    messages.push({ sender, text, at });
  }
  if (!messages.length && !participants.length) return null;
  return { path, participants: participants.length ? participants : [...new Set(messages.map((m) => m.sender))], messages: oldestFirst(messages) };
}

export function parseConversationFile(path: string, text: string): ExportThread | null {
  const kind = conversationFileKind(path) ?? (/\.json$/i.test(path) ? "json" : /\.html?$/i.test(path) ? "html" : null);
  if (kind === "json") return parseExportJson(text, path);
  if (kind === "html") return parseExportHtml(text, path);
  return null;
}

/** The files of one conversation (message_1, message_2…) as one thread, oldest message first. */
export function mergeThreadParts(parts: ExportThread[]): ExportThread | null {
  if (!parts.length) return null;
  const participants = [...new Set(parts.flatMap((p) => p.participants))];
  const messages = parts.flatMap((p) => p.messages).sort((a, b) => a.at.getTime() - b.at.getTime());
  return { path: conversationFolder(parts[0].path), participants, messages };
}
