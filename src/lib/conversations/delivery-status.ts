/** A provider-accepted reply remains conversation evidence after a receipt. */
export function isAcceptedDelivery(status: string | null | undefined) {
  return status === "sent" || status === "delivered" || status === "read";
}
export type MessagePart = { index: number; body: string; status: "sending" | "sent" | "failed" | "uncertain"; messageId?: string; error?: string };
export type PartObserver = (part: MessagePart, total: number) => Promise<void>;

/**
 * Instagram-style receipt for the thread: one label under the newest message, only when that
 * message is ours and the channel accepted it. A customer reply after it makes the label moot.
 * Routine statuses (sent / delivered / read) are not repeated on every bubble; problems are.
 */
export function threadReceipt(messages: { direction: string; delivery_status: string | null | undefined }[]): "read" | "delivered" | "sent" | null {
  const last = messages.at(-1);
  if (!last || last.direction !== "outbound" || !isAcceptedDelivery(last.delivery_status)) return null;
  return last.delivery_status as "read" | "delivered" | "sent";
}
/** Whether a bubble shows its own delivery status: only for outbound problems or in-progress states. */
export function showsInlineDelivery(direction: string, status: string | null | undefined) {
  return direction === "outbound" && Boolean(status) && !isAcceptedDelivery(status);
}
