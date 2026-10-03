import { NextResponse } from "next/server";
import { deauthorizeInstagramConnection } from "@/lib/instagram/meta-compliance";
import {
	parseMetaSignedRequest,
	readSignedRequestFromRequest,
} from "@/lib/instagram/signed-request";

export async function POST(request: Request) {
	try {
		const signedRequest = await readSignedRequestFromRequest(request);
		const payload = parseMetaSignedRequest(signedRequest);
		if (!payload?.user_id) {
			console.warn("[meta deauthorize] invalid signed_request");
			return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });
		}

		const result = await deauthorizeInstagramConnection(payload.user_id);
		console.log("[meta deauthorize] processed", {
			metaUserId: payload.user_id,
			found: result.found,
			connectionId: result.connectionId,
		});
		return new NextResponse(null, { status: 200 });
	} catch (error) {
		console.error("[meta deauthorize] failed", error);
		return NextResponse.json({ error: "Deauthorize failed" }, { status: 500 });
	}
}
