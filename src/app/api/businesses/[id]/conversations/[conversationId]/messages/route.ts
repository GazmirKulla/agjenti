import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto/tokens";
import { sendInstagramText } from "@/lib/instagram/send";
import { instagramWindowClosedError, isInstagramMessagingWindowOpen } from "@/lib/instagram/window";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

async function canAccess(userId: string, businessId: string) {
	if (await isPlatformAdmin(userId)) return true;
	const service = createServiceSupabase();
	const { data } = await service
		.from("business_users")
		.select("user_id")
		.eq("business_id", businessId)
		.eq("user_id", userId)
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
	const body = (await request.json()) as { body?: string };
	const text = body.body?.trim();
	if (!text) return NextResponse.json({ error: "Mesazhi është bosh." }, { status: 400 });

	const service = createServiceSupabase();
	const { data: conversation } = await service
		.from("conversations")
		.select(
			"id,business_id,customer_id,instagram_participant_id,instagram_connection_id,last_inbound_at,status",
		)
		.eq("id", conversationId)
		.eq("business_id", businessId)
		.maybeSingle();
	if (!conversation) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
	if (!isInstagramMessagingWindowOpen(conversation.last_inbound_at)) {
		return NextResponse.json(instagramWindowClosedError(), { status: 409 });
	}

	let recipientId = conversation.instagram_participant_id as string | null;
	if (!recipientId && conversation.customer_id) {
		const { data: customer } = await service
			.from("customers")
			.select("instagram_user_id")
			.eq("id", conversation.customer_id)
			.maybeSingle();
		recipientId = customer?.instagram_user_id ?? null;
	}
	const { data: conn } = await service
		.from("instagram_connections")
		.select("ig_user_id,access_token_ciphertext,status")
		.eq("id", conversation.instagram_connection_id)
		.maybeSingle();
	if (!recipientId || !conn || conn.status !== "connected") {
		return NextResponse.json({ error: "Instagram nuk është i lidhur." }, { status: 400 });
	}

	let token: string;
	try {
		token = decryptSecret(conn.access_token_ciphertext);
	} catch {
		return NextResponse.json({ error: "Token i pavlefshëm." }, { status: 500 });
	}

	const send = await sendInstagramText({
		accountId: conn.ig_user_id,
		token,
		to: recipientId,
		body: text,
	});
	if (!send.ok) {
		return NextResponse.json({ error: send.error, code: send.code }, { status: 400 });
	}

	await service.from("messages").insert({
		business_id: businessId,
		conversation_id: conversationId,
		instagram_connection_id: conversation.instagram_connection_id,
		direction: "outbound",
		source: "staff",
		body: text,
		external_message_id: send.messageId ?? null,
		delivery_status: "sent",
	});
	await service
		.from("conversations")
		.update({
			last_message_at: new Date().toISOString(),
			last_message_preview: text.slice(0, 140),
			status: conversation.status === "completed" ? "active" : conversation.status,
		})
		.eq("id", conversationId);

	return NextResponse.json({ ok: true, messageId: send.messageId });
}
