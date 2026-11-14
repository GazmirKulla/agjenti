import type { Turn } from "./normalize";
import { INSTRUCTION_ATTEMPT, similarity, type Evidence } from "./analysis-model";

/** Measured on the owner's own replies only, never the agent's or the customers'. */
export type StyleStats = {
  replies: number;
  meanChars: number; medianChars: number; medianWords: number;
  /** Shares of replies (0–1). */
  emoji: number; question: number; greeting: number; exclamation: number;
  formal: number; informal: number;
  albanian: number;
  phrases: { text: string; count: number }[];
  thanksReplies: string[];
};
export type StylePair = { id: string; thread: string; at: string; customer: string; business: string; tags: string[] };

const EMOJI = /\p{Extended_Pictographic}/u;
const GREETING = /^(p[eë]rsh[eë]ndetje|mir[eë]dita|mir[eë]m[eë]ngjes|mir[eë]mbr[eë]ma|tung|ckemi|çkemi|hello|hi|ciao|salut)\b/iu;
const FORMAL = /\b(ju|juve|jeni|keni|mund t[eë] na|ju lutem|z\.|znj\.)\b/iu;
const INFORMAL = /\b(ti|je|ke|mund t[eë] m[eë]|o vlla|o shok|bro|cun|goc)\b/iu;
const ALBANIAN = /\b(dhe|nuk|po|jo|është|eshte|ka|kemi|ma|t[eë]|p[eë]r|sa|shum[eë]|faleminderit|flm|mir[eë])\b/iu;
const THANKS = /^(faleminderit|flm|rrofsh|thanks|thank you|mersi|grazie)\b/iu;
const PRICE = /\b(sa kushton|sa [eë]sht[eë]|sa e ke|sa e keni|çmim|cmim|kushton|lek[eë]?|euro|€)\b/iu;
const MISSING = /\b(nuk e di|s'e di|se di|duhet ta shoh|ta shikoj|varet|sill(e|ni)? ta)\b/iu;

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const share = (items: string[], test: (t: string) => boolean) => (items.length ? Math.round((items.filter(test).length / items.length) * 100) / 100 : 0);

/** Phrases of 2–4 words the owner repeats (at least three times), most frequent first. */
export function frequentPhrases(replies: string[], limit = 15) {
  const counts = new Map<string, number>();
  for (const reply of replies) {
    const words = reply.toLocaleLowerCase("sq").replace(/\[[a-z]+\]/g, " ").replace(/[^\p{L}\s']/gu, " ").split(/\s+/).filter(Boolean);
    const seen = new Set<string>();
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= words.length; i++) seen.add(words.slice(i, i + n).join(" "));
    for (const phrase of seen) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const ranked = [...counts].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  // A shorter phrase inside a longer one with the same count says nothing new.
  const out: { text: string; count: number }[] = [];
  for (const [text, count] of ranked) {
    if (out.some((p) => p.text.includes(text) && p.count >= count)) continue;
    out.push({ text, count });
    if (out.length >= limit) break;
  }
  return out;
}

export function styleStats(threads: Turn[][]): StyleStats {
  const replies = threads.flatMap((turns) => turns.filter((t) => t.speaker === "owner").map((t) => t.text));
  const lengths = replies.map((r) => r.length);
  const thanksReplies: string[] = [];
  for (const turns of threads) for (let i = 1; i < turns.length; i++) {
    if (turns[i].speaker === "owner" && turns[i - 1].speaker === "customer" && THANKS.test(turns[i - 1].text.trim()) && turns[i].text.length <= 80) thanksReplies.push(turns[i].text);
  }
  return {
    replies: replies.length,
    meanChars: replies.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / replies.length) : 0,
    medianChars: median(lengths),
    medianWords: median(replies.map((r) => r.split(/\s+/).filter(Boolean).length)),
    emoji: share(replies, (r) => EMOJI.test(r)),
    question: share(replies, (r) => r.includes("?")),
    greeting: share(replies, (r) => GREETING.test(r.trim())),
    exclamation: share(replies, (r) => r.includes("!")),
    formal: share(replies, (r) => FORMAL.test(r)),
    informal: share(replies, (r) => INFORMAL.test(r)),
    albanian: share(replies, (r) => ALBANIAN.test(r)),
    phrases: frequentPhrases(replies),
    thanksReplies: [...new Set(thanksReplies)].slice(0, 8),
  };
}

/** What a customer turn is about, to show the AI (and the owner) varied examples. */
export function pairTags(customer: string, business: string): string[] {
  const tags: string[] = [];
  if (GREETING.test(customer.trim())) tags.push("greeting");
  if (THANKS.test(customer.trim())) tags.push("thanks");
  if (PRICE.test(customer)) tags.push("price");
  if (MISSING.test(business)) tags.push("needs_more");
  if (business.includes("?")) tags.push("follow_up");
  return tags;
}

/** Customer turn → the owner's reply right after it, from varied conversations:
 * every kind of situation first, then the most typical length. */
export function stylePairs(threads: { thread: string; turns: Turn[] }[], limit = 80): StylePair[] {
  const all: StylePair[] = [];
  for (const { thread, turns } of threads) for (let i = 1; i < turns.length; i++) {
    const [c, b] = [turns[i - 1], turns[i]];
    if (c.speaker !== "customer" || b.speaker !== "owner" || b.text.length > 600 || /^\[(foto|video|zë)\]$/.test(b.text)) continue;
    if (INSTRUCTION_ATTEMPT.test(c.text) || INSTRUCTION_ATTEMPT.test(b.text)) continue;
    all.push({ id: "", thread, at: b.at, customer: c.text.slice(0, 400), business: b.text, tags: pairTags(c.text, b.text) });
  }
  const typical = median(all.map((p) => p.business.length));
  const seenReply = new Set<string>();
  const perThread = new Map<string, number>();
  const ordered = [...all].sort((a, b) => Math.abs(a.business.length - typical) - Math.abs(b.business.length - typical) || b.at.localeCompare(a.at));
  const picked: StylePair[] = [];
  const take = (p: StylePair) => {
    const key = p.business.toLocaleLowerCase("sq").trim();
    if (seenReply.has(key) || (perThread.get(p.thread) ?? 0) >= 3 || picked.length >= limit) return;
    seenReply.add(key); perThread.set(p.thread, (perThread.get(p.thread) ?? 0) + 1); picked.push(p);
  };
  for (const tag of ["greeting", "thanks", "price", "needs_more", "follow_up"]) ordered.filter((p) => p.tags.includes(tag)).slice(0, 8).forEach(take);
  ordered.forEach(take);
  return picked.map((p, i) => ({ ...p, id: `p${i + 1}` }));
}

export type StyleResult = {
  summary: string;
  rules: { rule: string; pairs: string[] }[];
  policy: { tone: "warm" | "neutral" | "formal"; length: "concise" | "balanced"; emoji: "none" | "light"; questions: "when_needed" | "on_request" };
  examples: { pair: string; situation: string }[];
};

/** A rule about writing must not carry a fact: prices, hours and amounts belong to the catalog and knowledge. */
const FACT = /\d|lek[eë]?\b|euro|€|\$|or(ari|ar)\b|adres/iu;

export function validStyle(raw: unknown, pairs: StylePair[]): StyleResult | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = new Set(pairs.map((p) => p.id));
  const rules = (Array.isArray(r.rules) ? r.rules : []).flatMap((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const rule = typeof row.rule === "string" ? row.rule.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const cited = (Array.isArray(row.pairs) ? row.pairs : []).filter((id): id is string => typeof id === "string" && ids.has(id)).slice(0, 4);
    return rule.length >= 8 && cited.length && !FACT.test(rule) ? [{ rule, pairs: cited }] : [];
  }).slice(0, 12);
  const examples = (Array.isArray(r.examples) ? r.examples : []).flatMap((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const pair = typeof row.pair === "string" && ids.has(row.pair) ? row.pair : "";
    return pair ? [{ pair, situation: typeof row.situation === "string" ? row.situation.trim().slice(0, 120) : "" }] : [];
  }).filter((e, i, list) => list.findIndex((x) => x.pair === e.pair) === i).slice(0, 12);
  const p = r.policy && typeof r.policy === "object" ? (r.policy as Record<string, unknown>) : {};
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) => (allowed.includes(value as T) ? (value as T) : fallback);
  if (!rules.length && !examples.length) return null;
  return {
    summary: typeof r.summary === "string" ? r.summary.trim().slice(0, 600) : "",
    rules, examples,
    policy: {
      tone: pick(p.tone, ["warm", "neutral", "formal"] as const, "neutral"),
      length: pick(p.length, ["concise", "balanced"] as const, "concise"),
      emoji: pick(p.emoji, ["none", "light"] as const, "none"),
      questions: pick(p.questions, ["when_needed", "on_request"] as const, "when_needed"),
    },
  };
}

export const pairEvidence = (pair: StylePair): Evidence[] => [
  { thread: pair.thread, at: pair.at, speaker: "customer", quote: pair.customer.slice(0, 300) },
  { thread: pair.thread, at: pair.at, speaker: "owner", quote: pair.business.slice(0, 300) },
];

/** The instruction block the agent gets: the owner's measured habits and the rules
 * drawn from them, worded as behaviour, with no business facts. */
export function styleInstructions(stats: StyleStats, result: StyleResult): string {
  const measured = [
    `Shkruaj si pronari: përgjigjet e tij kanë zakonisht rreth ${stats.medianWords} fjalë (${stats.medianChars} shkronja).`,
    stats.greeting < 0.2 ? "Mos e nis përgjigjen me përshëndetje, përveç kur klienti përshëndet i pari." : "",
    stats.emoji < 0.1 ? "Mos përdor emoji." : "",
    stats.question < 0.3 ? "Mos shto pyetje që nuk duhen; pyet vetëm kur të mungon diçka e domosdoshme." : "",
  ].filter(Boolean);
  const thanks = stats.thanksReplies[0];
  const lines = [...measured];
  // The AI's rules, without those that repeat a measured one or each other.
  for (const { rule } of result.rules) {
    if (/emoji/i.test(rule) && stats.emoji < 0.1) continue;
    if (lines.some((line) => similarity(line, rule) >= 0.6)) continue;
    lines.push(rule);
  }
  if (thanks && !lines.some((line) => line.includes(thanks))) lines.push(`Kur klienti falënderon, përgjigju shkurt, p.sh. «${thanks}».`);
  return lines.map((line) => `- ${line}`).join("\n");
}

/** How the owner's writing changed since the previous analysis (empty when similar). */
export function styleChanges(previous: StyleStats | undefined, current: StyleStats): string[] {
  if (!previous?.replies) return [];
  const changes: string[] = [];
  if (current.medianWords >= previous.medianWords * 1.5 && current.medianWords - previous.medianWords >= 4) changes.push("Përgjigjet tani janë më të gjata.");
  if (current.medianWords <= previous.medianWords / 1.5 && previous.medianWords - current.medianWords >= 4) changes.push("Përgjigjet tani janë më të shkurtra.");
  if (current.emoji - previous.emoji >= 0.2) changes.push("Tani përdor më shumë emoji.");
  if (previous.emoji - current.emoji >= 0.2) changes.push("Tani përdor më pak emoji.");
  if (current.formal - previous.formal >= 0.25) changes.push("Tani shkruan më zyrtarisht (me «ju»).");
  return changes;
}
