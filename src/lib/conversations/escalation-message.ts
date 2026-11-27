/** Spacing and case only, so a quote matches the message it was copied from. */
const fold = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/**
 * The stored customer message an escalation came from: the latest one of the turn that holds the customer's
 * own words the interpretation quoted (already verified against the turn). Locating a verified quote, never
 * reading meaning. Without a quote that fits one message (a voice message, a quote across messages), the
 * turn's latest message.
 */
export function escalationMessage(stored: readonly { id: string; text: string }[], evidence?: string): string | null {
  if (!stored.length) return null;
  const quote = fold(evidence ?? "");
  const source = quote ? [...stored].reverse().find(message => fold(message.text).includes(quote)) : undefined;
  return (source ?? stored[stored.length - 1]).id;
}
