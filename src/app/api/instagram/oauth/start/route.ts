import { NextResponse } from "next/server";
import { instagramAuthorizeUrl, signOAuthState } from "@/lib/instagram/oauth";
import { createServerSupabase } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";

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
	return NextResponse.redirect(instagramAuthorizeUrl(state));
}
