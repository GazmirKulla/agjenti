import { foldText } from "@/lib/workflows/engine";

const ignored = new Set("dua deshiroj porosis porosit blej produkt produkti produkte produktet sherbim sherbimi keni gjendje cmimi kushton cfare ckemi pershendetje hello please want order buy product products have stock available".split(" "));
const words = (text: string) => foldText(text).split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !ignored.has(word));

// Only a single edit on longer words. Short identifiers, numbers and SKUs must
// remain exact; multiple equally plausible catalog entries require clarification.
function oneEdit(a: string, b: string) {
  if (a.length < 6 || b.length < 6 || /\d/.test(a + b) || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

export function matchingCatalogNames<T extends { name: string }>(entries: T[], message: string): T[] {
  const text = foldText(message);
  const full = entries.filter(entry => {
    const name = foldText(entry.name).trim();
    return name.length >= 2 && new RegExp(`(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(text);
  });
  if (full.length) return full;
  const tokens = words(text);
  const scored = entries.map(entry => {
    const names = words(entry.name);
    return { entry, score: [...new Set(tokens)].reduce((score, token) => score + (names.includes(token) ? 2 : names.some(name => oneEdit(token, name)) ? 1 : 0), 0) };
  });
  const best = scored.reduce((max, item) => Math.max(max, item.score), 0);
  return best ? scored.filter(item => item.score === best).map(item => item.entry) : [];
}
