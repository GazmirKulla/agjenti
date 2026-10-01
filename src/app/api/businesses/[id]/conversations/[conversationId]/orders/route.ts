import { NextResponse } from "next/server";
import { submitExternalOrder } from "@/lib/integrations/zana";
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
	_request: Request,
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
		.select("customer_id")
		.eq("id", conversationId)
		.eq("business_id", businessId)
		.maybeSingle();
	const { data: stateRow } = await service
		.from("conversation_states")
		.select("collected")
		.eq("conversation_id", conversationId)
		.maybeSingle();
	const state = (stateRow?.collected ?? {}) as ConversationStatePayload;
	const customer = state.customer ?? { name: null, phone: null, city: null, address: null };
	if (!customer.name || !customer.phone || !customer.address) {
		return NextResponse.json({ error: "Mungojnë të dhënat e klientit." }, { status: 400 });
	}

	const { data: business } = await service
		.from("businesses")
		.select("catalog_source")
		.eq("id", businessId)
		.maybeSingle();
	const { data: product } = state.product_id
		? await service.from("products").select("id,name,external_id,product_type_id,price_amount").eq("id", state.product_id).maybeSingle()
		: { data: null };

	const { data: order } = await service
		.from("orders")
		.insert({
			business_id: businessId,
			conversation_id: conversationId,
			customer_id: conversation?.customer_id,
			status: "confirmed",
			currency: "ALL",
			total_amount: product?.price_amount ?? null,
			payload: state,
		})
		.select("id")
		.single();
	if (!order) return NextResponse.json({ error: "Porosia nuk u krijua." }, { status: 500 });

	await service.from("order_items").insert({
		order_id: order.id,
		product_id: product?.id ?? null,
		product_type_key: product?.product_type_id ?? null,
		external_format_id: typeof state.fields.collect_size === "string" ? state.fields.collect_size : null,
		quantity: 1,
		options: state.fields,
		unit_amount: product?.price_amount ?? null,
	});

	if (business?.catalog_source === "zana" || business?.catalog_source === "external") {
		const submitted = await submitExternalOrder({
			businessId,
			payload: {
				channel: "instagram",
				customer,
				items: [
					{
						productId: product?.external_id ?? product?.id,
						productType: product?.product_type_id,
						formatId: state.fields.collect_size ?? null,
						colorId: state.fields.collect_color ?? null,
						quantity: 1,
						character: state.fields.collect_theme ?? null,
					},
				],
			},
		});
		if (!submitted.ok) {
			await service.from("orders").update({ status: "failed" }).eq("id", order.id);
			return NextResponse.json({ error: submitted.error }, { status: 502 });
		}
		await service
			.from("orders")
			.update({
				status: "submitted",
				external_system: business.catalog_source,
				external_order_id: submitted.orderId ?? null,
			})
			.eq("id", order.id);
		await service
			.from("conversation_states")
			.update({ status: "submitted" })
			.eq("conversation_id", conversationId);
		return NextResponse.json({ ok: true, orderId: order.id, externalOrderId: submitted.orderId });
	}

	await service.from("conversation_states").update({ status: "submitted" }).eq("conversation_id", conversationId);
	return NextResponse.json({ ok: true, orderId: order.id });
}
