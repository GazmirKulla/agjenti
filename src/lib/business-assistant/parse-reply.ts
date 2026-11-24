import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import type { PhrasingContent, RootContent } from "mdast";
import { readRichText, richHref, type Inline, type TextPart } from "./rich-text";

/** Parse model-authored prose on the server. Unsupported markup stays literal. */
export function formattedCaption(source: string) {
  if (!source.trim() || source.length > 12000) return null;
  const literal = (node: RootContent) => source.slice(node.position?.start.offset, node.position?.end.offset);
  function inline(node: PhrasingContent, depth: number): Inline[] {
    if (depth > 12) return [literal(node)];
    if (node.type === "text") return [node.value];
    if (node.type === "break") return ["\n"];
    if (node.type === "strong") return [{ strong: node.children.flatMap(child => inline(child, depth + 1)) }];
    if (node.type === "link") {
      const label = node.children.flatMap(child => inline(child, depth + 1));
      return richHref(node.url) && label.length ? [{ href: node.url, label }] : label;
    }
    return [literal(node)];
  }
  function part(node: RootContent, depth: number): TextPart {
    if (depth <= 12 && node.type === "list") return {
      ...(node.ordered ? { start: node.start ?? 1 } : {}),
      items: node.children.map(item => item.children.map(child => part(child, depth + 1))),
    };
    if (node.type === "table") return {
      table: node.children.map(row => row.children.map(cell => cell.children.flatMap(child => inline(child, depth + 1)))),
      align: node.align ?? node.children[0].children.map(() => null),
    };
    if (node.type === "paragraph") return { paragraph: node.children.flatMap(child => inline(child, depth)) };
    return { paragraph: [literal(node)] };
  }
  const parts = fromMarkdown(source, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] }).children.map(node => part(node, 0));
  const first = parts[0];
  if (parts.length === 1 && "paragraph" in first && first.paragraph.every(node => typeof node === "string")
      && first.paragraph.join("") === source) return null;
  return readRichText({ type: "rich_text", version: 1, parts });
}

