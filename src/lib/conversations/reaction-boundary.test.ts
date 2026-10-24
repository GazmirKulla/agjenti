import { expect, it } from "vitest";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/parse-webhook";
import { parseInstagramWebhookPayload } from "@/lib/instagram/parse-webhook";

it("WhatsApp reactions cannot enter the AI text path, even in a mixed envelope", () => {
  expect(parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "123456" }, messages: [{ id: "reaction-id", from: "355690000001", timestamp: Math.floor(Date.now()/1000), type: "reaction", reaction: { message_id: "target", emoji: "👍" }, text: { body: "yes" } }],
  } }] }] })).toEqual([]);
});
it("Instagram reactions cannot enter the coordinator, even alongside message text", () => {
  expect(parseInstagramWebhookPayload({ object:"instagram",entry:[{id:"account",messaging:[{sender:{id:"person"},recipient:{id:"account"},timestamp:Date.now(),reaction:{mid:"target",action:"react",emoji:"👍"},message:{mid:"event",text:"yes"}}]}]}).messages).toEqual([]);
});
