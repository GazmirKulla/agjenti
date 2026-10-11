import { sendInstagramText } from "@/lib/instagram/send";
import { sendWhatsAppText } from "@/lib/whatsapp/api";
export type MessagingChannel = "instagram" | "whatsapp";
export function channelAdapter(channel: MessagingChannel = "instagram") {
  return channel === "whatsapp" ? {
    table: "whatsapp_connections", account: "phone_number_id", participant: "whatsapp_participant_id",
    connection: "whatsapp_connection_id", metadata: "whatsappPhoneNumberId", send: sendWhatsAppText,
  } as const : {
    table: "instagram_connections", account: "ig_user_id", participant: "instagram_participant_id",
    connection: "instagram_connection_id", metadata: "instagramAccountId", send: sendInstagramText,
  } as const;
}
