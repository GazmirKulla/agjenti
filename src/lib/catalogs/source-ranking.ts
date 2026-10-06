import { foldText } from "@/lib/workflows/engine";
const ignored = new Set([
  "per",
  "nje",
  "dhe",
  "the",
  "for",
  "with",
  "dua",
  "keni",
  "eshte",
  "you",
  "your",
  "me",
  "nga",
]);
export function rankKnowledge<
  T extends { title: string; body: string; intent_key?: string | null },
>(entries: T[], question: string) {
  const tokens = foldText(question)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !ignored.has(t));
  return entries
    .map((entry, index) => {
      const title = foldText(entry.title),
        body = foldText(entry.body);
      const exact = title.length > 3 && foldText(question).includes(title);
      const score = exact
        ? 1
        : (tokens.filter((t) => title.includes(t)).length /
            Math.max(tokens.length, 1)) *
            0.7 +
          (tokens.filter((t) => body.includes(t)).length /
            Math.max(tokens.length, 1)) *
            0.3;
      return { entry, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
