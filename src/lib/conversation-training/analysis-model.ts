import { createHash } from "node:crypto";
import type { Speaker, Turn } from "./normalize";

/** Version of what the analysis writes; stored on each suggestion. */
export const ANALYSIS_SCHEMA_VERSION = 1;

export type Destination = "style" | "example" | "knowledge" | "product" | "service" | "profile" | "workflow" | "gap";
export type Operation = "create" | "update" | "duplicate" | "conflict";
export type Confidence = "high" | "medium" | "low";
export type Evidence = { thread: string; at: string; speaker: Speaker; quote: string };

/** A turn the AI can point at: "c3.5" is turn 5 of conversation 3 in the batch. */
export type RefTurn = Turn & { ref: string; thread: string };

export const PROFILE_FIELDS = ["description", "address", "hours", "contact", "payment", "delivery", "returns", "warranty", "appointments"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const PROFILE_LABELS: Record<ProfileField, string> = {
  description: "Përshkrimi i biznesit", address: "Adresa", hours: "Orari", contact: "Kontakti",
  payment: "Pagesa", delivery: "Dërgesa", returns: "Kthimet", warranty: "Garancia", appointments: "Takimet",
};

export type Price = {
  min: number; max: number | null; currency: "ALL" | "EUR" | "USD"; unit: string | null;
  approximate: boolean; condition: string | null; at: string;
};

/** One thing the extraction found, before it is merged and compared with the business's data. */
export type Candidate = {
  id: string;
  kind: "product" | "service" | "knowledge" | "profile" | "workflow" | "gap";
  name: string;
  /** What the product or service is, or the fact itself: never how the business writes. */
  body: string;
  field: ProfileField | null;
  category: string | null;
  prices: Price[];
  explicit: boolean;
  confidence: Confidence;
  /** Who said it: only the owner's words are a fact about the business. */
  saidBy: "owner" | "agent";
  evidence: Evidence[];
  count: number;
};

export type Suggestion = {
  destination: Destination; operation: Operation;
  target_table: string | null; target_id: string | null;
  title: string; current_value: unknown; proposed: Record<string, unknown>;
  evidence: Evidence[]; confidence: Confidence; explicit: boolean;
  requires_confirmation: boolean; risk: "safe" | "important"; content_key: string;
};

/** Albanian names compare without case or diacritics: "Bateri ore", "bateria e orës". */
export function nameKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sq")
    .replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean)
    .map(stem)
    .filter((word) => !STOP.has(word)).join(" ").trim();
}
/** Drops Albanian case and article endings ("bateria", "baterisë", "bateri" → "bater"). */
function stem(word: string) {
  let out = word;
  for (let changed = true; changed && out.length > 5;) {
    changed = false;
    for (const suffix of ["se", "es", "it", "in", "en", "et", "ve", "te", "ja", "a", "i", "e", "s"]) {
      if (out.endsWith(suffix) && out.length - suffix.length >= 5) { out = out.slice(0, -suffix.length); changed = true; break; }
    }
  }
  return out;
}
const STOP = new Set(["e", "i", "te", "të", "per", "për", "me", "dhe", "nje", "një", "the", "a", "of", "ne", "në", "nga"]);

/** Share of words in common (0–1), for matching names that differ a little. */
export function similarity(a: string, b: string): number {
  const x = new Set(nameKey(a).split(" ").filter(Boolean)), y = new Set(nameKey(b).split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const word of x) if (y.has(word) || [...y].some((other) => other.length > 3 && word.length > 3 && (other.startsWith(word) || word.startsWith(other)))) common++;
  // "Ndërrim baterie" is inside "Ndërrimi i baterisë së orës": a match, if both words are there.
  const smaller = Math.min(x.size, y.size);
  return Math.max(common / Math.max(x.size, y.size), smaller >= 2 && common === smaller ? 0.85 : 0);
}

/** A customer message that tries to instruct the AI is never kept as an example. */
export const INSTRUCTION_ATTEMPT = /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|prompt|rules?)\b|system prompt|\byou are now\b|\bact as\b|\binjoro\b.{0,30}\b(udhëzim|rregull)|\bharro\b.{0,30}\budhëzim/iu;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** The same proposal from the same source data gets the same key, so it is never stored twice. */
export const suggestionKey = (businessId: string, destination: Destination, target: string | null, proposed: unknown) =>
  sha256(`${businessId}|${destination}|${target ?? ""}|${JSON.stringify(proposed)}`);

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const CONFIDENCE = new Set<Confidence>(["high", "medium", "low"]);
const KINDS = new Set<Candidate["kind"]>(["product", "service", "knowledge", "profile", "workflow", "gap"]);
const CURRENCIES = new Set(["ALL", "EUR", "USD"]);

/** Words of style that never belong inside a product or service description. */
const STYLE_WORDS = /\b(përshëndet|faleminderit|ju lutem|emoji|ton(i|in)? |shkruaj|përgjigju|përgjigj(e|ja) (e )?shkurt|sjellsh[eë]m|miq[eë]sor|profesional)/iu;

/** Keeps only well-formed candidates whose evidence points at real turns of the batch. */
export function validCandidates(raw: unknown, turns: Map<string, RefTurn>, batch: number): Candidate[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: Candidate[] = [];
  for (const [index, item] of items.entries()) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const kind = row.kind as Candidate["kind"];
    if (!KINDS.has(kind)) continue;
    const evidence = (Array.isArray(row.evidence) ? row.evidence : []).flatMap((ref) => {
      const turn = typeof ref === "string" ? turns.get(ref) : undefined;
      return turn ? [{ thread: turn.thread, at: turn.at, speaker: turn.speaker, quote: turn.text.slice(0, 300) }] : [];
    }).slice(0, 4);
    if (!evidence.length) continue;
    // Only what the business wrote makes a fact; a customer's question is at most a gap.
    const business = evidence.filter((e) => e.speaker !== "customer");
    const effective: Candidate["kind"] = kind !== "gap" && !business.length ? "gap" : kind;
    const name = text(row.name, 160);
    let body = text(row.body, 2000);
    if (name.length < 2) continue;
    if ((effective === "product" || effective === "service") && STYLE_WORDS.test(body)) body = "";
    if (effective !== "gap" && effective !== "product" && effective !== "service" && body.length < 2) continue;
    const field = effective === "profile" && (PROFILE_FIELDS as readonly string[]).includes(String(row.field)) ? (row.field as ProfileField) : null;
    if (effective === "profile" && !field) continue;
    const at = business[0]?.at ?? evidence[0].at;
    const prices = effective === "product" || effective === "service" || effective === "knowledge"
      ? (Array.isArray(row.prices) ? row.prices : []).flatMap((p) => validPrice(p, at, business.map((e) => e.quote).join(" "))).slice(0, 6) : [];
    const saidBy = business.length && business.every((e) => e.speaker === "agent") ? "agent" : "owner";
    const confidence = CONFIDENCE.has(row.confidence as Confidence) ? (row.confidence as Confidence) : "low";
    out.push({
      id: `b${batch}.${index}`, kind: effective, name, body, field,
      category: text(row.category, 80) || null, prices,
      explicit: row.explicit === true && effective !== "gap",
      // The agent's words are a weaker source than the owner's.
      confidence: saidBy === "agent" && confidence === "high" ? "medium" : confidence,
      saidBy, evidence, count: 1,
    });
  }
  return out;
}

function validPrice(raw: unknown, at: string, said: string): Price[] {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const min = typeof p.min === "number" && Number.isFinite(p.min) && p.min >= 0 && p.min < 1e9 ? p.min : null;
  if (min === null) return [];
  const max = typeof p.max === "number" && Number.isFinite(p.max) && p.max > min && p.max < 1e9 ? p.max : null;
  const currency = typeof p.currency === "string" && CURRENCIES.has(p.currency.toUpperCase()) ? (p.currency.toUpperCase() as Price["currency"]) : "ALL";
  // A unit is kept only when the business wrote it: "/ orë" must not be invented.
  const unit = text(p.unit, 30);
  const written = unit && said.toLocaleLowerCase("sq").includes(unit.toLocaleLowerCase("sq").replace(/^\/\s*/, ""));
  return [{ min, max, currency, unit: written ? unit : null, approximate: p.approximate === true || max !== null, condition: text(p.condition, 160) || null, at }];
}

/** Turns of each conversation, numbered for the AI ("c1.0", "c1.1", …). */
export function numberTurns(threads: { thread: string; turns: Turn[] }[]): { text: string; refs: Map<string, RefTurn> } {
  const refs = new Map<string, RefTurn>();
  const blocks = threads.map(({ thread, turns }, i) => {
    const lines = turns.map((turn, j) => {
      const ref = `c${i + 1}.${j}`;
      refs.set(ref, { ...turn, ref, thread });
      const who = turn.speaker === "customer" ? "klienti" : turn.speaker === "owner" ? "biznesi" : "agjenti";
      return `[${ref}] ${turn.at.slice(0, 10)} ${who}: ${turn.text.replace(/\n/g, " / ")}`;
    });
    return `### Biseda c${i + 1}\n${lines.join("\n")}`;
  });
  return { text: blocks.join("\n\n"), refs };
}
