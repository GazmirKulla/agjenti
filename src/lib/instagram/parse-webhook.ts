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

/** Meta dashboard "Test" payloads use placeholder IDs like entry id "0". */
const META_TEST_DUMMY_IDS = new Set(["0", "12334", "23245", "<IGID>", "<IGSID>", "MESSAGE_ID"]);

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

function parseTimestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Meta dashboard field test uses entry.changes[{ field: "messages", value: {...} }]
 * instead of entry.messaging[].
 */
export function changeValueToMessagingEvent(
	value: unknown,
): InstagramWebhookMessagingEvent | null {
	if (!isRecord(value)) return null;
	const sender = isRecord(value.sender) ? value.sender : undefined;
	const recipient = isRecord(value.recipient) ? value.recipient : undefined;
	const message = isRecord(value.message)
		? (value.message as InstagramWebhookMessage)
		: undefined;
	const postback = isRecord(value.postback)
		? (value.postback as InstagramWebhookMessagingEvent["postback"])
		: undefined;
	if (!message && !postback) return null;
	return {
		sender: sender ? { id: asStringId(sender.id) || undefined } : undefined,
		recipient: recipient ? { id: asStringId(recipient.id) || undefined } : undefined,
		timestamp: parseTimestamp(value.timestamp),
		message,
		postback,
		referral: isRecord(value.referral) ? value.referral : undefined,
	};
}

export function isMetaDashboardTestEvent(
	accountId: string,
	event: InstagramWebhookMessagingEvent,
): boolean {
	const senderId = asStringId(event.sender?.id);
	const recipientId = asStringId(event.recipient?.id);
	const mid = (event.message?.mid ?? event.postback?.mid ?? "").trim();
	if (accountId === "0") return true;
	if (META_TEST_DUMMY_IDS.has(senderId) || META_TEST_DUMMY_IDS.has(recipientId)) return true;
	if (META_TEST_DUMMY_IDS.has(mid)) return true;
	if (mid.toUpperCase() === "TEST" || mid.startsWith("TEST_")) return true;
	return false;
}

export function isMetaDashboardTestMessage(message: NormalizedIncomingMessage): boolean {
	return message.contextMetadata?.metaDashboardTest === true;
}

function collectMessagingEvents(
	entry: NonNullable<InstagramWebhookPayload["entry"]>[number],
	ignored: IgnoredInstagramEvent[],
): InstagramWebhookMessagingEvent[] {
	const events: InstagramWebhookMessagingEvent[] = [...(entry.messaging ?? [])];
	const otherChangeFields: string[] = [];

	for (const change of entry.changes ?? []) {
		const field = change.field?.trim() || "";
		if (field === "messages") {
			const converted = changeValueToMessagingEvent(change.value);
			if (converted) {
				events.push(converted);
			} else {
				ignored.push(ignore("changes_messages_invalid"));
			}
			continue;
		}
		if (field) otherChangeFields.push(field);
	}

	if (
		otherChangeFields.length > 0 &&
		(entry.messaging == null || entry.messaging.length === 0) &&
		events.length === 0
	) {
		ignored.push(ignore(`changes_only:${otherChangeFields.join(",")}`));
	}

	return events;
}

function normalizeMessagingEvent(
	accountId: string,
	event: InstagramWebhookMessagingEvent,
): { message?: NormalizedIncomingMessage; ignored?: IgnoredInstagramEvent } {
	const hasInbound = Boolean(event.message || event.postback);
	if (event.reaction && !hasInbound) {
		return { ignored: ignore("reaction", event.reaction.mid) };
	}
	if (event.read && !hasInbound) {
		return { ignored: ignore("read", event.read.mid) };
	}
	if (event.message_edit != null && !hasInbound) {
		return { ignored: ignore("message_edit") };
	}

	const senderId = asStringId(event.sender?.id);
	const recipientId = asStringId(event.recipient?.id);
	const msg = event.message;
	const postback = event.postback;
	const mid = (msg?.mid ?? postback?.mid)?.trim() ?? "";
	const metaDashboardTest = isMetaDashboardTestEvent(accountId, event);

	// For Meta test payloads entry.id is often "0"; prefer recipient as business account.
	const resolvedAccountId =
		accountId && accountId !== "0" ? accountId : recipientId || accountId;

	const fromBusiness = Boolean(
		resolvedAccountId && senderId && senderId === resolvedAccountId,
	);
	const testerInbound = msg?.is_self === true;
	if (!metaDashboardTest && !testerInbound && (fromBusiness || msg?.is_echo === true)) {
		return { ignored: ignore("echo", mid || undefined) };
	}
	if (msg?.is_deleted === true) {
		return { ignored: ignore("deleted", mid || undefined) };
	}
	if (msg?.is_unsupported === true) {
		return { ignored: ignore("unsupported", mid || undefined) };
	}

	const { attachments, onlyEphemeral, unknownTypes } = buildAttachments(msg?.attachments);
	if (onlyEphemeral) {
		return { ignored: ignore("ephemeral", mid || undefined) };
	}

	const isPostback = Boolean(postback);
	if (!msg && !isPostback && event.referral) {
		return { ignored: ignore("referral_only") };
	}
	if (!msg && !isPostback) {
		return { ignored: ignore("empty_event") };
	}

	const participantId = senderId;
	if (!mid || !participantId) {
		return { ignored: ignore("missing_id_or_sender", mid || undefined) };
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
		instagramAccountId: resolvedAccountId || null,
		metaDashboardTest,
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

	return {
		message: {
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
		},
	};
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

		const events = collectMessagingEvents(entry, ignored);
		for (const event of events) {
			const result = normalizeMessagingEvent(accountId, event);
			if (result.ignored) ignored.push(result.ignored);
			if (result.message) messages.push(result.message);
		}
	}

	return { messages, ignored };
}
