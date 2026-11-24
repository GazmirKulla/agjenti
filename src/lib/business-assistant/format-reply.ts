import { fromMarkdown } from "mdast-util-from-markdown";
import type { PhrasingContent, RootContent } from "mdast";
import { blockReply, storableBlocks, type DataBlock, type MessageBlock } from "./blocks";
import { readRichText, richHref, richTextPlain, type Inline, type TextPart } from "./rich-text";

/** Parse model-authored prose on the server. Unsupported markup stays literal. */
function formattedCaption(source: string) {
  if (!source.trim() || source.length > 4000) return null;
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
    if (node.type === "paragraph") return { paragraph: node.children.flatMap(child => inline(child, depth)) };
    return { paragraph: [literal(node)] };
  }
  const parts = fromMarkdown(source).children.map(node => part(node, 0));
  const first = parts[0];
  if (parts.length === 1 && "paragraph" in first && first.paragraph.every(node => typeof node === "string")
      && first.paragraph.join("") === source) return null;
  return readRichText({ type: "rich_text", version: 1, parts });
}

/** The plain caption is authoritative for history and copy. Data blocks take priority in storage. */
export function formatOwnerReply(message: string, dataBlocks: DataBlock[] = []): { message: string; blocks?: MessageBlock[] } {
  const rich = formattedCaption(message);
  if (rich) {
    const caption = richTextPlain(rich.parts);
    const reply = blockReply(caption, dataBlocks);
    const blocks = storableBlocks([rich, ...reply.blocks]);
    if (blocks.length === reply.blocks.length + 1) return { ...reply, blocks };
    return reply;
  }
  return dataBlocks.length ? blockReply(message, dataBlocks) : { message };
}
