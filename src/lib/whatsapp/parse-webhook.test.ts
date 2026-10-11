import { describe, expect, it } from "vitest";
import { parseWhatsAppWebhook } from "./parse-webhook";
const envelope = (messages: unknown[], extra = {}) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456" }, contacts: [{ wa_id: "355691234567", profile: { name: "Ana" } }], messages, ...extra } }] }] });
const message = { id: "wamid.123", from: "355691234567", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Përshëndetje" } };
describe("WhatsApp webhook normalization", () => {
  it("routes text using the business phone ID and customer wa_id", () => {
    expect(parseWhatsAppWebhook(envelope([message]))).toEqual([expect.objectContaining({ channel: "whatsapp", externalMessageId: "wamid.123", externalParticipantId: "355691234567", senderDisplayName: "Ana", text: "Përshëndetje", contextMetadata: { whatsappPhoneNumberId: "123456" } })]);
  });
  it("does not turn receipts or malformed payloads into customer messages", () => {
    for (const input of [null, [], {}, envelope([], { statuses: [{ id: "sent", status: "read" }] }), envelope([{ ...message, timestamp: "invalid" }]), envelope([{ ...message, from: null }]), envelope([{ ...message, timestamp: String(Date.now()) }])]) expect(parseWhatsAppWebhook(input)).toEqual([]);
  });
  it("normalizes button replies and media without inventing public media URLs", () => {
    const items = parseWhatsAppWebhook(envelope([{ ...message, text: undefined, type: "interactive", interactive: { button_reply: { id: "yes", title: "Po" } } }, { ...message, text: undefined, type: "image", image: { id: "media123", mime_type: "image/jpeg", caption: "Produkti" } }]));
    expect(items[0].text).toBe("Po");
    expect(items[1]).toMatchObject({ text: "Produkti", attachments: [{ kind: "image", externalMediaId: "media123", sourceUrl: null }] });
  });
  it("handles multiple entries without crossing phone identities", () => {
    const a = envelope([message]); const b = envelope([{ ...message, id: "wamid.456" }]);
    b.entry[0].changes[0].value.metadata.phone_number_id = "987654";
    expect(parseWhatsAppWebhook({ ...a, entry: [...a.entry, ...b.entry] }).map(m => m.contextMetadata?.whatsappPhoneNumberId)).toEqual(["123456", "987654"]);
  });
});
