// Shared, credential-free UI contract. Provider-specific requests stay server-side.
export const REACTION_EMOJI = ["❤️", "👍", "😊", "🎉", "🙏", "😂"] as const;
export type MessageReaction = {
  id: string; messageId: string; partId: string | null; actor: "customer" | "business";
  emoji: string; ambiguous: boolean; revision: number; requestId: string | null;
  requestedEmoji: string | null; status: "sending" | "sent" | "failed" | "uncertain" | null;
  error: string | null; attempt: number | null; canRetry: boolean;
};
export function reactionCapabilities(channel: string) {
  // Removal is deliberately gated on the official contract, not app parity.
  return channel === "instagram" ? { emoji: REACTION_EMOJI, remove: true }
    : channel === "whatsapp" ? { emoji: REACTION_EMOJI, remove: false }
    : { emoji: [] as readonly string[], remove: false };
}
