import { NextResponse } from "next/server";
import { instagramAuthorizeUrl, signOAuthState } from "@/lib/instagram/oauth";
import { createServerSupabase } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export async function GET(request: Request) {
	const supabase = await createServerSupabase();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const businessId = new URL(request.url).searchParams.get("businessId");
	if (!businessId) return NextResponse.json({ error: "Mungon businessId" }, { status: 400 });

	const service = createServiceSupabase();
	const admin = await isPlatformAdmin(user.id);
	if (!admin) {
		const { data: member } = await service
			.from("business_users")
			.select("user_id")
			.eq("business_id", businessId)
			.eq("user_id", user.id)
			.maybeSingle();
		if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const state = signOAuthState({ businessId, userId: user.id });
	const authorizeUrl = instagramAuthorizeUrl(state);
	// Client-side navigation keeps the #weblink fragment (HTTP Location often drops it).
	const html = `<!DOCTYPE html>
<html lang="sq">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Lidh Instagram</title>
<meta http-equiv="refresh" content="0;url=${escapeHtml(authorizeUrl)}"/>
<script>location.replace(${JSON.stringify(authorizeUrl)});</script>
</head>
<body>
<p><a href="${escapeHtml(authorizeUrl)}">Vazhdo te Instagram (web)</a></p>
</body>
</html>`;

	return new NextResponse(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}
