import { createServiceSupabase } from "@/lib/supabase/service";
import { channelAdapter, type MessagingChannel } from "./channel";
export type ProviderReceipt = { channel: MessagingChannel; accountId: string; participantId: string; messageId: string; status: "sent" | "delivered" | "read" | "failed"; occurredAt: string };
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown) => Array.isArray(v) ? v.map(row) : [];
const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 1024 ? v : null;
/** Receipts are not customer messages and never enter the coordinator. */
export function parseProviderReceipts(payload: unknown, now = Date.now()): ProviderReceipt[] {
  const root = row(payload), result: ProviderReceipt[] = [];
  const append = (channel: MessagingChannel, account: unknown, participant: unknown, message: unknown, status: unknown, timestamp: number) => {
    if (!id(account) || !id(participant) || !id(message) || !["sent", "delivered", "read", "failed"].includes(String(status)) || !Number.isFinite(timestamp) || timestamp > now + 300000 || timestamp < now - 7 * 86400000) return;
    result.push({ channel, accountId: account as string, participantId: participant as string, messageId: message as string, status: status as ProviderReceipt["status"], occurredAt: new Date(timestamp).toISOString() });
  };
  for (const entry of rows(root.entry)) {
    if (root.object === "whatsapp_business_account") for (const change of rows(entry.changes)) {
      if (change.field !== "messages") continue;
      const value = row(change.value);
      for (const status of rows(value.statuses)) append("whatsapp", row(value.metadata).phone_number_id, status.recipient_id, status.id, status.status, Number(status.timestamp) * 1000);
    }
    if (root.object === "instagram") {
      const events = [...rows(entry.messaging), ...rows(entry.changes).filter(c => c.field === "messaging_seen").map(c => row(c.value))];
      for (const event of events) {
        const recipient = row(event.recipient).id;
        // Do not infer a watermark or 'delivered' from an Instagram read event.
        if (recipient !== entry.id) continue;
        append("instagram", entry.id, row(event.sender).id, row(event.read).mid, "read", Number(event.timestamp));
      }
    }
  }
  return result;
}
/** Call only after raw-body signature verification. Account identity resolves tenant. */
export async function persistProviderReceipts(receipts: ProviderReceipt[]) {
  if (!receipts.length) return;
  const db = createServiceSupabase();
  for (const receipt of receipts) {
    const adapter = channelAdapter(receipt.channel);
    const { data: connection, error } = await db.from(adapter.table).select("id").eq(adapter.account, receipt.accountId).eq("status", "connected").maybeSingle();
    if (error) throw new Error("Receipt connection unavailable");
    if (!connection) continue;
    const { error: writeError } = await db.rpc("record_transport_receipt", { p_connection: connection.id, p_participant: receipt.participantId, p_external: receipt.messageId, p_status: receipt.status, p_occurred: receipt.occurredAt });
    if (writeError) throw new Error("Receipt persistence failed");
  }
}
