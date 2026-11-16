import { sendInstagramImage, sendInstagramText } from "@/lib/instagram/send";
import { sendWhatsAppImage, sendWhatsAppText } from "@/lib/whatsapp/api";
export type MessagingChannel = "instagram" | "whatsapp";
export function channelAdapter(channel: MessagingChannel = "instagram") {
  return channel === "whatsapp" ? {
    table: "whatsapp_connections", account: "phone_number_id", participant: "whatsapp_participant_id",
    connection: "whatsapp_connection_id", metadata: "whatsappPhoneNumberId", send: sendWhatsAppText, sendImage: (p: Parameters<typeof sendWhatsAppImage>[0]) => sendWhatsAppImage(p),
  } as const : {
    table: "instagram_connections", account: "ig_user_id", participant: "instagram_participant_id",
    connection: "instagram_connection_id", metadata: "instagramAccountId", send: sendInstagramText, sendImage: (p: Parameters<typeof sendInstagramImage>[0]) => sendInstagramImage(p),
  } as const;
}
