import { blockReply, storableBlocks, type DataBlock, type MessageBlock } from "./blocks";
import { richTextPlain } from "./rich-text";
import { formattedCaption } from "./parse-reply";

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
