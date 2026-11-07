import { type ConversationStatePayload } from "./state";

export type ConversationMessage = { role: "user" | "assistant"; content: string };
export function recentConversation(state?: ConversationStatePayload | null): ConversationMessage[] {
  return (state?.recentMessages ?? []).filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10).map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
}
export function rememberTurn(before: ConversationStatePayload | null | undefined, next: ConversationStatePayload, message: string, reply: string) {
  next.recentMessages = [...recentConversation(before), {role:"user" as const,content:message.slice(0,1200)}, {role:"assistant" as const,content:reply.slice(0,1200)}].slice(-10);
}
