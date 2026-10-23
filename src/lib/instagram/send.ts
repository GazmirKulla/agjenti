import { splitInstagramText } from "@/lib/instagram/split-text";
import type { MessagePart, PartObserver } from "@/lib/conversations/delivery-status";
import { graphVersion } from "@/lib/instagram/oauth";
import { isIsolatedExecution, refuseIsolatedEffect, assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";

export type SendInstagramResult =
	| { ok: true; messageId?: string; parts?: MessagePart[] }
	| { ok: false; skipped?: boolean; error: string; code?: string; parts?: MessagePart[] };

type MetaErrorBody = {
	error?: {
		message?: string;
		error_user_msg?: string;
		code?: number;
		error_subcode?: number;
	};
	message_id?: string;
};

async function postMessage(
	accountId: string,
	token: string,
	payload: Record<string, unknown>,
): Promise<SendInstagramResult> {
	assertBusinessEffectAllowed("instagram.send");
	if (isIsolatedExecution()) refuseIsolatedEffect("customer.message", "instagram");
	const url = `https://graph.instagram.com/${graphVersion()}/${accountId}/messages`;
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(20_000),
		});
	} catch (err) {
		return {
			ok: false,
			code: "send_uncertain",
			error: err instanceof Error ? err.message : "Instagram API: rrjeti dështoi.",
		};
	}
	const data = (await response.json().catch(() => null)) as MetaErrorBody | null;
	if (!response.ok) {
		const code = data?.error?.code;
		const subcode = data?.error?.error_subcode;
		if (code === 10 && subcode === 2534022) {
			return { ok: false, error: "Dritarja 24-orëshe ka mbaruar.", code: "instagram_window_closed" };
		}
		if (code === 190) {
			return { ok: false, error: "Token i Instagramit është i pavlefshëm.", code: "token_revoked" };
		}
		return {
			ok: false,
			...(response.status >= 500 ? { code: "send_uncertain" } : {}),
			error: data?.error?.error_user_msg || data?.error?.message || `Instagram API error (${response.status})`,
		};
	}
	if (typeof data?.message_id !== "string" || !data.message_id.trim()) {
		return { ok: false, error: "Instagram nuk konfirmoi dërgimin.", code: "receipt_missing" };
	}
	return { ok: true, messageId: data.message_id };
}

export async function sendInstagramText(params: {
	accountId: string;
	token: string;
	to: string;
	body: string;
	onPart?: PartObserver;
}): Promise<SendInstagramResult> {
	assertBusinessEffectAllowed("instagram.send");
	if (isIsolatedExecution()) refuseIsolatedEffect("customer.message", "instagram");
	const text = params.body.trim();
	if (!text) return { ok: false, error: "Mesazhi është bosh." };
	const chunks = splitInstagramText(text);
	let lastId: string | undefined;
	const parts: MessagePart[] = [];
	for (const [index, chunk] of chunks.entries()) {
		await params.onPart?.({ index, body: chunk, status: "sending" }, chunks.length);
		const send = await postMessage(params.accountId, params.token, {
			recipient: { id: params.to },
			message: { text: chunk },
		});
		const part: MessagePart = send.ok
			? { index, body: chunk, status: "sent", messageId: send.messageId }
			: { index, body: chunk, status: send.code === "send_uncertain" || send.code === "receipt_missing" ? "uncertain" : "failed", error: send.error };
		parts.push(part);
		// Persist each acknowledgement before the next external send. A failed
		// persistence call stops here; it must never replay the provider request.
		await params.onPart?.(part, chunks.length);
		if (!send.ok) return { ...send, parts };
		lastId = send.messageId ?? lastId;
	}
	return { ok: true, messageId: lastId, parts };
}
