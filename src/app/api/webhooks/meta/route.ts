import { after, NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/conversations/handle-inbound";
import {
	getMetaVerifyToken,
	handleMetaVerification,
	verifyMetaSignatureAny,
} from "@/lib/instagram/meta-webhook";
import {
	type InstagramWebhookPayload,
	parseInstagramWebhookPayload,
} from "@/lib/instagram/parse-webhook";

export async function GET(request: Request) {
	const url = new URL(request.url);
	console.log("[meta webhook][GET] verify attempt", {
		mode: url.searchParams.get("hub.mode"),
		hasToken: Boolean(url.searchParams.get("hub.verify_token")),
		hasChallenge: Boolean(url.searchParams.get("hub.challenge")),
	});
	const result = handleMetaVerification(url, getMetaVerifyToken());
	if (result.ok) {
		console.log("[meta webhook][GET] verified ok");
		return new NextResponse(result.challenge, {
			status: 200,
			headers: { "Content-Type": "text/plain" },
		});
	}
	console.warn("[meta webhook][GET] verify failed");
	return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(request: Request) {
	try {
		const rawBody = await request.text();
		const signature = request.headers.get("x-hub-signature-256");
		console.log("[meta webhook][POST] received", {
			bodyLength: rawBody.length,
			hasSignature: Boolean(signature),
			signaturePrefix: signature?.slice(0, 20) ?? null,
		});

		const verified = verifyMetaSignatureAny(rawBody, signature);
		if (!verified.ok) {
			console.warn("[meta webhook][POST] early return: invalid signature");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}
		console.log("[meta webhook][POST] signature ok", { matched: verified.matched });

		let payload: InstagramWebhookPayload;
		try {
			payload = JSON.parse(rawBody) as InstagramWebhookPayload;
		} catch (err) {
			console.warn("[meta webhook][POST] early return: invalid JSON", err);
			return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
		}

		console.log("[meta webhook][POST] full payload", JSON.stringify(payload));
		console.log("[meta webhook][POST] object type", payload.object ?? null);

		const entries = payload.entry ?? [];
		console.log("[meta webhook][POST] entry count", entries.length);
		for (const [i, entry] of entries.entries()) {
			const messaging = entry.messaging ?? [];
			console.log("[meta webhook][POST] entry", {
				index: i,
				id: entry.id ?? null,
				time: entry.time ?? null,
				messagingCount: messaging.length,
				hasChanges: entry.changes != null,
				hasStandby: entry.standby != null,
				hasHandover: entry.messaging_handover != null,
				hasOptins: entry.messaging_optins != null,
				changeFields: (entry.changes ?? []).map((c) => c.field ?? "?"),
			});
			for (const [j, event] of messaging.entries()) {
				console.log("[meta webhook][POST] messaging event", {
					entryIndex: i,
					eventIndex: j,
					senderId: event.sender?.id ?? null,
					recipientId: event.recipient?.id ?? null,
					timestamp: event.timestamp ?? null,
					hasMessage: Boolean(event.message),
					hasPostback: Boolean(event.postback),
					hasReaction: Boolean(event.reaction),
					hasRead: Boolean(event.read),
					hasReferral: Boolean(event.referral),
					hasMessageEdit: event.message_edit != null,
					messageMid: event.message?.mid ?? event.postback?.mid ?? null,
					isEcho: event.message?.is_echo ?? null,
					isSelf: event.message?.is_self ?? null,
					isDeleted: event.message?.is_deleted ?? null,
					isUnsupported: event.message?.is_unsupported ?? null,
					textPreview: event.message?.text?.slice(0, 80) ?? null,
					attachmentTypes: (event.message?.attachments ?? []).map((a) => a.type ?? "?"),
				});
			}
		}

		if (payload.object !== "instagram") {
			console.warn("[meta webhook][POST] early return: object not instagram", {
				object: payload.object ?? null,
			});
			return NextResponse.json({ received: true, ignored: true });
		}

		const { messages, ignored } = parseInstagramWebhookPayload(payload);
		console.log("[meta webhook][POST] parse result", {
			acceptedCount: messages.length,
			ignoredCount: ignored.length,
			ignored,
			accepted: messages.map((m) => ({
				externalMessageId: m.externalMessageId,
				externalParticipantId: m.externalParticipantId,
				instagramAccountId: m.contextMetadata?.instagramAccountId ?? null,
				textPreview: m.text?.slice(0, 80) ?? null,
				attachmentCount: m.attachments.length,
			})),
		});

		if (messages.length === 0) {
			console.warn("[meta webhook][POST] no accepted messages after parse — nothing to process");
		}

		after(async () => {
			console.log("[meta webhook][POST] after() started", { messageCount: messages.length });
			try {
				await Promise.all(messages.map((message) => handleInboundMessage(message)));
				console.log("[meta webhook][POST] after() finished ok");
			} catch (err) {
				console.error("[meta webhook][POST] after() processing error:", err);
			}
		});
		return NextResponse.json({ received: true });
	} catch (err) {
		console.error("[meta webhook][POST] top-level error", err);
		return NextResponse.json({ received: true, error: true });
	}
}
