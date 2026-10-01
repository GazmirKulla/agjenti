import type {
	NormalizedAttachment,
	NormalizedAttachmentKind,
	NormalizedIncomingMessage,
} from "@/lib/instagram/types";

export type InstagramWebhookAttachment = {
	type?: string;
	payload?: { url?: string };
};

export type InstagramWebhookMessage = {
	mid?: string;
	text?: string;
	is_echo?: boolean;
	is_self?: boolean;
	is_deleted?: boolean;
	is_unsupported?: boolean;
	attachments?: InstagramWebhookAttachment[];
	quick_reply?: { payload?: string };
	referral?: Record<string, unknown>;
	reply_to?: {
		mid?: string;
		story?: { url?: string; id?: string; link_sticker_url?: string };
	};
};

export type InstagramWebhookMessagingEvent = {
	sender?: { id?: string };
	recipient?: { id?: string };
	timestamp?: number;
	message?: InstagramWebhookMessage;
	postback?: { mid?: string; title?: string; payload?: string };
	referral?: Record<string, unknown>;
	reaction?: { mid?: string; action?: string; reaction?: string; emoji?: string };
	read?: { mid?: string };
	message_edit?: unknown;
};

export type InstagramWebhookPayload = {
	object?: string;
	entry?: Array<{
		id?: string;
		time?: number;
		messaging?: InstagramWebhookMessagingEvent[];
		changes?: Array<{ field?: string; value?: unknown }>;
		standby?: unknown;
		messaging_handover?: unknown;
		messaging_optins?: unknown;
	}>;
};

export type IgnoredInstagramEvent = {
	reason: string;
	externalMessageId?: string;
};

export type ParsedInstagramWebhook = {
	messages: NormalizedIncomingMessage[];
	ignored: IgnoredInstagramEvent[];
};

const SHARE_TYPES = new Set([
	"ig_post",
	"ig_reel",
	"reel",
	"share",
	"story_mention",
	"story",
	"ig_story",
]);

function mapAttachmentKind(type: string): NormalizedAttachmentKind | null {
	if (type === "image" || type === "media") return "image";
	if (type === "video") return "video";
	if (type === "audio") return "audio";
	if (type === "file") return "document";
	if (SHARE_TYPES.has(type)) return "share";
	if (type === "ephemeral") return null;
	return null;
}

function timestampFrom(ms: number | undefined): Date {
	if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
		return new Date(ms);
	}
	return new Date();
}

function asStringId(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "";
}

function buildAttachments(raw: InstagramWebhookAttachment[] | undefined): {
	attachments: NormalizedAttachment[];
	onlyEphemeral: boolean;
	unknownTypes: string[];
} {
	const attachments: NormalizedAttachment[] = [];
	const unknownTypes: string[] = [];
	let ephemeralCount = 0;
	for (const item of raw ?? []) {
		const type = item.type?.trim() ?? "";
		if (!type) continue;
		if (type === "ephemeral") {
			ephemeralCount += 1;
			continue;
		}
		const kind = mapAttachmentKind(type);
		const url = item.payload?.url?.trim() || null;
		if (!kind) {
			unknownTypes.push(type);
			continue;
		}
		attachments.push({
			kind,
			externalMediaId: null,
			sourceUrl: url,
			mimeType: null,
			caption: null,
			filename: null,
			metadata: { instagramAttachmentType: type },
		});
	}
	const onlyEphemeral =
		ephemeralCount > 0 &&
		attachments.length === 0 &&
		unknownTypes.length === 0 &&
		(raw?.length ?? 0) > 0;
	return { attachments, onlyEphemeral, unknownTypes };
}

function ignore(reason: string, externalMessageId?: string): IgnoredInstagramEvent {
	return externalMessageId ? { reason, externalMessageId } : { reason };
}

export function parseInstagramWebhookPayload(
	payload: InstagramWebhookPayload,
): ParsedInstagramWebhook {
	const messages: NormalizedIncomingMessage[] = [];
	const ignored: IgnoredInstagramEvent[] = [];

	if (payload.object !== "instagram") {
		return { messages, ignored: [ignore("object_not_instagram")] };
	}

	for (const entry of payload.entry ?? []) {
		const accountId = asStringId(entry.id);
		if (entry.standby != null) ignored.push(ignore("standby"));
		if (entry.messaging_handover != null) ignored.push(ignore("messaging_handover"));
		if (entry.messaging_optins != null) ignored.push(ignore("messaging_optins"));
		if (entry.changes != null && (entry.messaging == null || entry.messaging.length === 0)) {
			ignored.push(
				ignore(
					`changes_only:${(entry.changes ?? []).map((c) => c.field ?? "?").join(",") || "empty"}`,
				),
			);
		}

		for (const event of entry.messaging ?? []) {
			const hasInbound = Boolean(event.message || event.postback);
			if (event.reaction && !hasInbound) {
				ignored.push(ignore("reaction", event.reaction.mid));
				continue;
			}
			if (event.read && !hasInbound) {
				ignored.push(ignore("read", event.read.mid));
				continue;
			}
			if (event.message_edit != null && !hasInbound) {
				ignored.push(ignore("message_edit"));
				continue;
			}

			const senderId = asStringId(event.sender?.id);
			const msg = event.message;
			const postback = event.postback;
			const mid = (msg?.mid ?? postback?.mid)?.trim() ?? "";

			const fromBusiness = Boolean(accountId && senderId && senderId === accountId);
			const testerInbound = msg?.is_self === true;
			if (!testerInbound && (fromBusiness || msg?.is_echo === true)) {
				ignored.push(ignore("echo", mid || undefined));
				continue;
			}
			if (msg?.is_deleted === true) {
				ignored.push(ignore("deleted", mid || undefined));
				continue;
			}
			if (msg?.is_unsupported === true) {
				ignored.push(ignore("unsupported", mid || undefined));
				continue;
			}

			const { attachments, onlyEphemeral, unknownTypes } = buildAttachments(msg?.attachments);
			if (onlyEphemeral) {
				ignored.push(ignore("ephemeral", mid || undefined));
				continue;
			}

			const isPostback = Boolean(postback);
			if (!msg && !isPostback && event.referral) {
				ignored.push(ignore("referral_only"));
				continue;
			}
			if (!msg && !isPostback) {
				ignored.push(ignore("empty_event"));
				continue;
			}

			const participantId = senderId;
			if (!mid || !participantId) {
				ignored.push(ignore("missing_id_or_sender", mid || undefined));
				continue;
			}

			const quickReplyPayload = msg?.quick_reply?.payload?.trim() || null;
			const postbackPayload = postback?.payload?.trim() || null;
			const postbackTitle = postback?.title?.trim() || null;
			const interactiveId = quickReplyPayload || postbackPayload;
			const interactiveTitle = postbackTitle || msg?.text?.trim() || interactiveId;

			let text: string | null = msg?.text?.trim() || null;
			if (isPostback) {
				text = postbackTitle || postbackPayload;
			} else if (quickReplyPayload && !text) {
				text = quickReplyPayload;
			}

			const contextMetadata: Record<string, unknown> = {
				instagramAccountId: accountId || null,
			};
			if (interactiveId) {
				contextMetadata.interactiveReply = {
					id: interactiveId,
					title: interactiveTitle || interactiveId,
				};
			}
			if (quickReplyPayload) contextMetadata.quickReply = { payload: quickReplyPayload };
			if (postback) contextMetadata.postback = postback;
			const referral = event.referral ?? msg?.referral ?? null;
			if (referral) contextMetadata.referral = referral;
			if (msg?.reply_to) contextMetadata.replyTo = msg.reply_to;
			if (unknownTypes.length > 0) {
				contextMetadata.unsupportedType = unknownTypes[0];
			}

			messages.push({
				channel: "instagram",
				externalMessageId: mid,
				externalParticipantId: participantId,
				phone: null,
				senderUsername: null,
				senderDisplayName: null,
				text,
				attachments,
				timestamp: timestampFrom(event.timestamp),
				contextMetadata,
				rawPayload: event,
			});
		}
	}

	return { messages, ignored };
}
