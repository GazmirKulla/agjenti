import { reactionCapabilities } from "./reactions";

export type AiReactionDecision =
  | { kind: "none"; reason: string }
  | { kind: "reaction"; emoji: string; reason: string };

const orderWords = /\b(porosi\w*|rezerv\w*|booking|appointment|pages\w*|pagu\w*|konfirm\w*|anul\w*)\b/i;

/** Optional social acknowledgement, never an intent, confirmation or substitute
 * for the coordinator's normal reply. Match the WHOLE message, not a positive
 * word inside a complaint, question, fact declaration or business instruction. */
export function decideAiReaction(input: {
  channel: string;
  text: string | null | undefined;
  autoReplyEnabled: boolean;
  humanTakeover: boolean;
  manualEmoji?: string | null;
}): AiReactionDecision {
  if (!input.autoReplyEnabled) return { kind: "none", reason: "auto_reply_disabled" };
  if (input.humanTakeover) return { kind: "none", reason: "human_takeover" };
  if (input.manualEmoji !== undefined && input.manualEmoji !== null) return { kind: "none", reason: "manual_ownership" };
  const text = input.text?.trim() ?? "";
  if (!text || orderWords.test(text)) return { kind: "none", reason: text ? "transactional_intent" : "no_text" };
  const supported = reactionCapabilities(input.channel).emoji;
  if (!supported.length || text.length > 120 || /[?\n\r:]/.test(text)) return { kind: "none", reason: "not_appropriate" };
  const words = text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/[❤👍😊🎉🙏😂]/gu,'').replace(/[!.]/g,'').trim().replace(/\s+/g,' ');
  const standalone = /^(faleminderit( shume)?( per ndihmen)?|shume bukur|perfekt|super|hahaha|thanks( a lot| so much)?|thank you( so much)?)$/.test(words);
  if (!standalone && (words || !supported.some(emoji => text.includes(emoji)))) return { kind: "none", reason: "not_appropriate" };
  const emoji = supported.find(emoji=>text.includes(emoji)) ?? '😊';
  return { kind: "reaction", emoji, reason: "contextual_acknowledgement" };
}
