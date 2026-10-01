import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

async function canAccess(userId: string, businessId: string) {
	if (await isPlatformAdmin(userId)) return true;
	const service = createServiceSupabase();
	const { data } = await service
		.from("business_users")
		.select("user_id")
		.eq("user_id", userId)
		.eq("business_id", businessId)
		.maybeSingle();
	return Boolean(data);
}

export async function POST(
	_request: Request,
	context: { params: Promise<{ id: string; conversationId: string; action: string }> },
) {
	const { id: businessId, conversationId, action } = await context.params;
	const supabase = await createServerSupabase();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user || !(await canAccess(user.id, businessId))) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const service = createServiceSupabase();
	if (action === "pause") {
		await service
			.from("conversations")
			.update({ status: "paused", auto_reply: false, updated_at: new Date().toISOString() })
			.eq("id", conversationId)
			.eq("business_id", businessId);
	} else if (action === "resume") {
		await service
			.from("conversations")
			.update({ status: "active", auto_reply: true, updated_at: new Date().toISOString() })
			.eq("id", conversationId)
			.eq("business_id", businessId);
	} else if (action === "complete") {
		await service
			.from("conversations")
			.update({ status: "completed", auto_reply: false, updated_at: new Date().toISOString() })
			.eq("id", conversationId)
			.eq("business_id", businessId);
	} else {
		return NextResponse.json({ error: "Unknown action" }, { status: 404 });
	}
	return NextResponse.json({ ok: true });
}
