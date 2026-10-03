import { NextResponse } from "next/server";
import { ensureCustomerForConversation } from "@/lib/conversations/ensure-customer";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";
import type { ConversationStatePayload } from "@/lib/workflows/engine";

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
	request: Request,
	context: { params: Promise<{ id: string; conversationId: string }> },
) {
	const { id: businessId, conversationId } = await context.params;
	const supabase = await createServerSupabase();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user || !(await canAccess(user.id, businessId))) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const service = createServiceSupabase();
	const { data: conversation } = await service
		.from("conversations")
		.select("id,customer_id,instagram_participant_id,participant_username,participant_display_name")
		.eq("id", conversationId)
		.eq("business_id", businessId)
		.maybeSingle();
	if (!conversation) {
		return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
	}
	if (conversation.customer_id) {
		return NextResponse.json(
			{ error: "Kjo bisedë ka tashmë një klient të lidhur." },
			{ status: 409 },
		);
	}

	let body: { name?: string; phone?: string } = {};
	try {
		body = (await request.json()) as { name?: string; phone?: string };
	} catch {
		body = {};
	}

	const { data: stateRow } = await service
		.from("conversation_states")
		.select("collected")
		.eq("conversation_id", conversationId)
		.maybeSingle();
	const state = (stateRow?.collected ?? {}) as ConversationStatePayload;
	const workflowCustomer = state.customer ?? {
		name: null,
		phone: null,
		city: null,
		address: null,
	};

	const ensured = await ensureCustomerForConversation({
		businessId,
		conversationId,
		displayName:
			body.name?.trim() ||
			workflowCustomer.name ||
			conversation.participant_display_name,
		phone: body.phone?.trim() || workflowCustomer.phone,
		username: conversation.participant_username,
		instagramUserId: conversation.instagram_participant_id,
	});

	if (!ensured.ok) {
		return NextResponse.json({ error: ensured.error }, { status: ensured.status });
	}

	return NextResponse.json({
		ok: true,
		customerId: ensured.customerId,
		created: ensured.created,
	});
}
