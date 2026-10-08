export const TEXT_BATCH_SIZE = 20000;
// Keep extraction bounded without silently ignoring topics later in the source.
export function discoveryTextBatch(text: string, offset = 0) {
  let end = Math.min(text.length, offset + TEXT_BATCH_SIZE);
  if (end < text.length) {
    const newline = text.lastIndexOf("\n", end);
    if (newline > offset + TEXT_BATCH_SIZE / 2) end = newline + 1;
  }
  return { text: text.slice(offset, end), next: end, done: end >= text.length };
}
