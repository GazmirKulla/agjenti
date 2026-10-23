/** A provider-accepted reply remains conversation evidence after a receipt. */
export function isAcceptedDelivery(status: string | null | undefined) {
  return status === "sent" || status === "delivered" || status === "read";
}
export type MessagePart = { index: number; body: string; status: "sending" | "sent" | "failed" | "uncertain"; messageId?: string; error?: string };
export type PartObserver = (part: MessagePart, total: number) => Promise<void>;
