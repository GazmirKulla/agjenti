import { NextResponse } from "next/server";
import {
	createDeletionConfirmationCode,
	deleteInstagramUserData,
	getDataDeletionStatus,
} from "@/lib/instagram/meta-compliance";
import {
	parseMetaSignedRequest,
	readSignedRequestFromRequest,
} from "@/lib/instagram/signed-request";

function appBaseUrl(request: Request): string {
	const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
	if (configured) return configured;
	return new URL(request.url).origin;
}

export async function POST(request: Request) {
	try {
		const signedRequest = await readSignedRequestFromRequest(request);
		const payload = parseMetaSignedRequest(signedRequest);
		if (!payload?.user_id) {
			console.warn("[meta data-deletion] invalid signed_request");
			return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });
		}

		const confirmationCode = createDeletionConfirmationCode();
		const result = await deleteInstagramUserData({
			metaUserId: payload.user_id,
			confirmationCode,
			appBaseUrl: appBaseUrl(request),
		});

		console.log("[meta data-deletion] processed", {
			metaUserId: payload.user_id,
			confirmationCode: result.confirmationCode,
			connectionFound: result.connectionFound,
		});

		return NextResponse.json({
			url: result.statusUrl,
			confirmation_code: result.confirmationCode,
		});
	} catch (error) {
		console.error("[meta data-deletion] failed", error);
		return NextResponse.json({ error: "Data deletion failed" }, { status: 500 });
	}
}

export async function GET(request: Request) {
	const code = new URL(request.url).searchParams.get("code")?.trim();
	if (!code) {
		return NextResponse.json(
			{ error: "Mungon confirmation code." },
			{ status: 400 },
		);
	}

	try {
		const row = await getDataDeletionStatus(code);
		if (!row) {
			return NextResponse.json(
				{ error: "Kërkesa e fshirjes nuk u gjet." },
				{ status: 404 },
			);
		}

		return NextResponse.json({
			confirmation_code: row.confirmation_code,
			status: row.status,
			meta_user_id: row.meta_user_id,
			created_at: row.created_at,
			completed_at: row.completed_at,
			message:
				row.status === "completed"
					? "Kërkesa për fshirjen e të dhënave të Instagram u përfundua. Token-i u revokua dhe të dhënat e lidhura me Instagram u anonimizuan."
					: `Statusi i kërkesës: ${row.status}`,
		});
	} catch (error) {
		console.error("[meta data-deletion][GET] failed", error);
		return NextResponse.json({ error: "Status lookup failed" }, { status: 500 });
	}
}
