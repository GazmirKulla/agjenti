/** An optional presentation of the stored plain-text caption. It carries no action or business data. */
export type Inline = string | { strong: Inline[] } | { href: string; label: Inline[] };
export type TextPart = { paragraph: Inline[] } | { items: TextPart[][]; start?: number };
export type RichTextBlock = { type: "rich_text"; version: 1; parts: TextPart[] };

export function richHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/u.test(value)) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password && !Array.from(value).some(c => c.charCodeAt(0) < 32);
  } catch {
    return false;
  }
}

type Raw = Record<string, unknown>;
const record = (x: unknown): x is Raw => x !== null && typeof x === "object" && !Array.isArray(x);

/** Validate stored JSON before handing any of its values to React. */
export function readRichText(raw: Raw): RichTextBlock | null {
  if (raw.type !== "rich_text" || raw.version !== 1) return null;
  let budget = 12000;
  function list<T>(x: unknown, depth: number, test: (value: unknown, depth: number) => value is T): x is T[] {
    if (!Array.isArray(x) || !x.length || depth > 16 || (budget -= x.length) < 0) return false;
    return x.every(item => test(item, depth + 1));
  }
  function inline(x: unknown, depth: number): x is Inline {
    if (typeof x === "string") return (budget -= x.length) >= 0;
    if (!record(x)) return false;
    if ("strong" in x) return list(x.strong, depth, inline);
    return richHref(x.href) && (budget -= x.href.length) >= 0 && list(x.label, depth, inline);
  }
  function parts(x: unknown, depth: number): x is TextPart[] {
    return list(x, depth, part);
  }
  function part(x: unknown, depth: number): x is TextPart {
    if (!record(x)) return false;
    if ("paragraph" in x) return list(x.paragraph, depth, inline);
    return (x.start === undefined || typeof x.start === "number" && Number.isSafeInteger(x.start) && x.start >= 0 && x.start <= 999999999)
      && list(x.items, depth, parts);
  }
  return parts(raw.parts, 0) ? { type: "rich_text", version: 1, parts: raw.parts } : null;
}

function inlineText(nodes: Inline[]): string {
  return nodes.map(node => {
    if (typeof node === "string") return node;
    if ("strong" in node) return inlineText(node.strong);
    const label = inlineText(node.label);
    return label === node.href ? label : `${label} (${node.href})`;
  }).join("");
}

export function richTextPlain(parts: TextPart[]): string {
  return parts.map(part => {
    if ("paragraph" in part) return inlineText(part.paragraph);
    return part.items.map((item, i) => {
      const marker = part.start === undefined ? "• " : `${part.start + i}. `;
      return marker + richTextPlain(item).split("\n").map((line, n) => n && line ? " ".repeat(marker.length) + line : line).join("\n");
    }).join("\n");
  }).join("\n\n");
}
