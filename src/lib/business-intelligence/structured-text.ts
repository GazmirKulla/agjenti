/**
 * A web page's visible text with its structure kept, in the light Markdown the agent and the knowledge page
 * read: headings as "## ", list items as "- ", table rows as "| a | b |", paragraphs and line breaks as new
 * lines. Reading markup (tags), never interpreting what the text means.
 */
const entities: Record<string, string> = { "&nbsp;": " ", "&#160;": " ", "&amp;": "&", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&euro;": "€" };
const decode = (text: string) => text.replace(/&(?:nbsp|#160|amp|quot|#39|apos|lt|gt|euro);/g, entity => entities[entity] ?? entity)
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

export function htmlToStructuredText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|svg|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Inline whitespace from the markup is not structure.
    .replace(/\s+/g, " ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level) => `\n\n${"#".repeat(Math.min(Number(level) + 1, 4))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<tr\b[^>]*>/gi, "\n|")
    .replace(/<\/t[dh]>/gi, " |")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|ul|ol|table|thead|tbody|tfoot|header|footer|main|aside|nav|blockquote|dl|dt|dd|figure|figcaption|form|fieldset)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(text)
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    // A table cell list with nothing in it, or a bare bullet, carries no content.
    .filter(line => line && line !== "-" && !/^\|[\s|]*$/.test(line))
    .reduce<string[]>((lines, line) => {
      const heading = line.startsWith("#");
      if (heading && lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(line);
      if (heading) lines.push("");
      return lines;
    }, [])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
