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

		if (payload.object !== "instagram") {
			return NextResponse.json({ received: true, ignored: true });
		}

		const { messages, ignored } = parseInstagramWebhookPayload(payload);
		console.log("[meta webhook][POST]", {
			accepted: messages.length,
			ignored: ignored.length,
			matchedSecret: verified.matched,
		});

		const legacy: typeof messages=[];
		for(const message of messages) { if(!await enqueueWorkflowMessage(message)) legacy.push(message); }
		after(async () => {
			try {
				await Promise.all([runWorkflowQueue(), ...legacy.map((message) => handleInboundMessage(message))]);
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
