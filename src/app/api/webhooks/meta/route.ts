import { parseWhatsAppWebhook } from "@/lib/whatsapp/parse-webhook";
import { parseProviderReceipts, persistProviderReceipts } from "@/lib/conversations/provider-receipts";
import { parseProviderReactions, persistProviderReactions } from "@/lib/conversations/provider-reactions";
import { verifyMetaSignature } from "@/lib/instagram/meta-webhook";
import { enqueueWorkflowMessage, runWorkflowQueue } from "@/lib/conversations/workflow-queue";
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
	isMetaDashboardTestMessage,
} from "@/lib/instagram/parse-webhook";

export const maxDuration = 180;

export async function GET(request: Request) {
	const url = new URL(request.url);
	const result = handleMetaVerification(url, getMetaVerifyToken());
	if (result.ok) {
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
		const verified = verifyMetaSignatureAny(rawBody, signature);
		if (!verified.ok) {
			console.warn("[meta webhook][POST] invalid signature");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		let payload: InstagramWebhookPayload;
		try {
			payload = JSON.parse(rawBody) as InstagramWebhookPayload;
		} catch {
			console.warn("[meta webhook][POST] invalid JSON");
			return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
		}

		if ((payload.object as string) === "whatsapp_business_account") {
            if (!verifyMetaSignature(rawBody, signature)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
            await persistProviderReceipts(parseProviderReceipts(payload));
            await persistProviderReactions(parseProviderReactions(payload));
            const messages = parseWhatsAppWebhook(payload);
            for (const message of messages) await enqueueWorkflowMessage(message);
            if (messages.length) after(async () => { await runWorkflowQueue(); });
            return NextResponse.json({ received: true });
        }

        if (payload.object !== "instagram") {
			return NextResponse.json({ received: true, ignored: true });
		}

		const { messages, ignored } = parseInstagramWebhookPayload(payload);
        await persistProviderReceipts(parseProviderReceipts(payload));
        await persistProviderReactions(parseProviderReactions(payload));
		console.log("[meta webhook][POST]", {
			accepted: messages.length,
			ignored: ignored.length,
			matchedSecret: verified.matched,
		});

		for (const message of messages) {
			// Only Meta's synthetic dashboard event bypasses the durable queue.
			if (isMetaDashboardTestMessage(message)) await handleInboundMessage(message);
			else await enqueueWorkflowMessage(message);
		}
		if (messages.length) after(async () => {
			try {
				await runWorkflowQueue();
			} catch (err) {
				console.error("[meta webhook][POST] processing error:", err);
			}
		});
		return NextResponse.json({ received: true });
	} catch (err) {
		console.error("[meta webhook][POST] top-level error", err);
		return NextResponse.json({ received: false, error: true }, {status:503});
	}
}
