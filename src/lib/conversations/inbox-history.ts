import type { ConversationMessage } from "@/lib/workflows/guidance";
import { isAcceptedDelivery } from "./delivery-status";

export type InboxHistoryMessage = {
  body: string | null;
  direction: string;
  source: string;
  delivery_status: string;
  external_message_id: string | null;
};

/** Rows are newest first. Current batch is recorded by the coordinator exactly once. */
export function inboxHistory(rows: InboxHistoryMessage[], currentIds: Set<string>) {
  const previous = rows.filter(row => !currentIds.has(row.external_message_id ?? "")
    && (row.direction === "inbound" && row.source === "customer"
      || row.direction === "outbound" && isAcceptedDelivery(row.delivery_status) && ["agent", "staff"].includes(row.source)));
  const staffReplied = previous.find(row => row.direction === "outbound")?.source === "staff";
  const messages: ConversationMessage[] = previous.filter(row => row.body?.trim()).slice(0, 10).reverse().map(row => ({
    role: row.direction === "inbound" ? "user" : "assistant",
    content: `${row.source === "staff" ? "[Stafi] " : ""}${row.body}`.slice(0, 1200),
  }));
  return { messages, staffReplied };
}
