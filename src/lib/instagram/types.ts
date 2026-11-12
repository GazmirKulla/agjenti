export type NormalizedAttachmentKind =
	| "image"
	| "video"
	| "audio"
	| "document"
	| "sticker"
	| "share"
	| "story_reply";

export interface NormalizedAttachment {
	kind: NormalizedAttachmentKind;
	externalMediaId: string | null;
	sourceUrl: string | null;
	mimeType: string | null;
	metadata?: Record<string, unknown> | null;
	caption?: string | null;
	filename?: string | null;
}

export interface NormalizedIncomingMessage {
	channel: "instagram" | "whatsapp";
	externalMessageId: string;
	externalParticipantId: string;
	phone: string | null;
	senderUsername: string | null;
	senderDisplayName: string | null;
	text: string | null;
	attachments: NormalizedAttachment[];
	timestamp: Date;
	contextMetadata: Record<string, unknown> | null;
	rawPayload: unknown;
}

/**
 * A message the business itself sent to a customer from outside Agjenti
 * (Instagram app `is_echo`, WhatsApp Business app `smb_message_echoes`).
 * Never a customer turn: it is stored as an outbound staff message only.
 */
export interface NormalizedBusinessEcho {
	channel: "instagram" | "whatsapp";
	/** ig_user_id or phone_number_id of the business connection. */
	accountId: string;
	/** The customer the business wrote to. */
	externalParticipantId: string;
	externalMessageId: string;
	text: string | null;
	attachments: NormalizedAttachment[];
	timestamp: Date;
}
