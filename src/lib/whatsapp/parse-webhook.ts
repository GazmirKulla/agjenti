import type { NormalizedIncomingMessage, NormalizedAttachment } from "@/lib/instagram/types";
type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : [];
const text = (v: unknown) => typeof v === "string" ? v : null;
export function parseWhatsAppWebhook(payload: unknown): NormalizedIncomingMessage[] {
  const root = object(payload);
  if (root.object !== "whatsapp_business_account") return [];
  const result: NormalizedIncomingMessage[] = [];
  for (const entry of rows(root.entry)) for (const change of rows(entry.changes)) {
    if (change.field !== "messages") continue;
    const value = object(change.value), phoneId = text(object(value.metadata).phone_number_id);
    if (!phoneId || !/^\d+$/.test(phoneId)) continue;
    for (const message of rows(value.messages)) {
      const id = text(message.id), from = text(message.from), type = text(message.type);
      const timestamp = new Date(Number(message.timestamp) * 1000);
      if (!id || !from || !/^\d+$/.test(from) || !Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now() + 60_000) continue;
      const content = object(message[type ?? ""]);
      const interactive = object(message.interactive);
      const reply = object(interactive.button_reply ?? interactive.list_reply);
      const body = text(object(message.text).body) ?? text(reply.title) ?? text(object(message.button).text) ?? text(content.caption);
      const attachments: NormalizedAttachment[] = [];
      if (["image", "video", "audio", "document", "sticker"].includes(type ?? "") && text(content.id)) attachments.push({
        kind: type as NormalizedAttachment["kind"], externalMediaId: text(content.id), sourceUrl: null,
        mimeType: text(content.mime_type), caption: text(content.caption), filename: text(content.filename),
      });
      if (!body && !attachments.length) continue;
      const contact = rows(value.contacts).find(c => c.wa_id === from);
      result.push({ channel: "whatsapp", externalMessageId: id, externalParticipantId: from, phone: from,
        senderUsername: null, senderDisplayName: text(object(contact?.profile).name), text: body, attachments, timestamp,
        contextMetadata: { whatsappPhoneNumberId: phoneId }, rawPayload: message });
    }
  }
  return result;
}
