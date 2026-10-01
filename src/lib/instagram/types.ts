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
	channel: "instagram";
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
