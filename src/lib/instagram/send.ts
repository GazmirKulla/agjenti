import { splitInstagramText } from "@/lib/instagram/split-text";
import { graphVersion } from "@/lib/instagram/oauth";

export type SendInstagramResult =
	| { ok: true; messageId?: string }
	| { ok: false; skipped?: boolean; error: string; code?: string };

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
			error: data?.error?.error_user_msg || data?.error?.message || `Instagram API error (${response.status})`,
		};
	}
	return { ok: true, messageId: data?.message_id };
}

export async function sendInstagramText(params: {
	accountId: string;
	token: string;
	to: string;
	body: string;
}): Promise<SendInstagramResult> {
	const text = params.body.trim();
	if (!text) return { ok: false, error: "Mesazhi është bosh." };
	const chunks = splitInstagramText(text);
	let lastId: string | undefined;
	for (const chunk of chunks) {
		const send = await postMessage(params.accountId, params.token, {
			recipient: { id: params.to },
			message: { text: chunk },
		});
		if (!send.ok) return send;
		lastId = send.messageId ?? lastId;
	}
	return { ok: true, messageId: lastId };
}
