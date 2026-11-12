import { describe, expect, it } from "vitest";
import { parseWhatsAppEchoes, parseWhatsAppWebhook } from "./parse-webhook";
const now = Date.UTC(2026, 10, 12, 12);
const envelope = (echoes: unknown[]) => ({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "smb_message_echoes", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550783881", phone_number_id: "123456" }, contacts: [{ wa_id: "355691234567" }], message_echoes: echoes } }] }] });
const echo = { from: "15550783881", to: "355691234567", to_user_id: "AL.1", id: "wamid.echo", timestamp: String(now / 1000), type: "text", text: { body: "Mirëdita, po e dërgojmë sot" } };
describe("WhatsApp Business app echoes", () => {
  it("normalizes a text echo to the customer's thread", () => {
    expect(parseWhatsAppEchoes(envelope([echo]), now)).toEqual([{ channel: "whatsapp", accountId: "123456", externalParticipantId: "355691234567", externalMessageId: "wamid.echo", text: "Mirëdita, po e dërgojmë sot", attachments: [], timestamp: new Date(now) }]);
  });
  it("never reads echoes as customer messages", () => {
    expect(parseWhatsAppWebhook(envelope([echo]))).toEqual([]);
  });
  it("keeps media by provider id, skips edits, revokes and unknown recipients", () => {
    const image = { ...echo, id: "wamid.img", type: "image", text: undefined, image: { id: "media-1", mime_type: "image/jpeg", caption: "Ngjyra blu" } };
    const skipped = [{ ...echo, type: "edit", edit: { original_message_id: "wamid.echo" } }, { ...echo, type: "revoke", revoke: { original_message_id: "wamid.echo" } }, { ...echo, to: undefined }, { ...echo, timestamp: "invalid" }, { ...echo, text: { body: "  " } }];
    const result = parseWhatsAppEchoes(envelope([image, ...skipped]), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ externalMessageId: "wamid.img", text: "Ngjyra blu", attachments: [{ kind: "image", externalMediaId: "media-1" }] });
  });
});
