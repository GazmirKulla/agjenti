/** Descriptive evidence only. Suggestions never carry an execution ticket. */
export type AttentionItem = {
  id: string;
  kind: "conversation" | "workflow" | "handoff" | "booking_sync" | "operation_plan";
  title: string;
  detail: string;
  href: string;
  action: string;
  conversationId?: string;
};
export type AttentionSnapshot = {
  items: AttentionItem[];
  unavailable: string[];
  checkedAt: string;
};

export function workflowNeedsAttention(draft: unknown, published: unknown): boolean {
  if (!published) return Boolean(draft);
  // A deliberately disabled, unchanged version is not unfinished work.
  return JSON.stringify(draft) !== JSON.stringify(published);
}
