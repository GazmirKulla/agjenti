import { createServiceSupabase } from "@/lib/supabase/service";

export type EnsureCustomerInput = {
	businessId: string;
	conversationId: string;
	displayName?: string | null;
	phone?: string | null;
	username?: string | null;
	instagramUserId?: string | null;
};

export type EnsureCustomerResult =
	| { ok: true; customerId: string; created: boolean }
	| { ok: false; error: string; status: number };

/**
 * Promote a conversation participant into a CRM customer row (or reuse linked one).
 */
export async function ensureCustomerForConversation(
	input: EnsureCustomerInput,
): Promise<EnsureCustomerResult> {
	const supabase = createServiceSupabase();
	const { data: conversation, error: conversationError } = await supabase
		.from("conversations")
		.select(
			"id,customer_id,instagram_participant_id,participant_username,participant_display_name",
		)
		.eq("id", input.conversationId)
		.eq("business_id", input.businessId)
		.maybeSingle();

	if (conversationError || !conversation) {
		return { ok: false, error: "Biseda nuk u gjet.", status: 404 };
	}

	if (conversation.customer_id) {
		return {
			ok: true,
			customerId: conversation.customer_id as string,
			created: false,
		};
	}

	const instagramUserId =
		input.instagramUserId?.trim() ||
		(conversation.instagram_participant_id as string | null) ||
		null;
	const username =
		input.username?.trim() ||
		(conversation.participant_username as string | null) ||
		null;
	const displayName =
		input.displayName?.trim() ||
		(conversation.participant_display_name as string | null) ||
		username ||
		null;

	if (instagramUserId) {
		const { data: existing } = await supabase
			.from("customers")
			.select("id")
			.eq("business_id", input.businessId)
			.eq("instagram_user_id", instagramUserId)
			.maybeSingle();
		if (existing?.id) {
			await supabase
				.from("conversations")
				.update({
					customer_id: existing.id,
					updated_at: new Date().toISOString(),
				})
				.eq("id", input.conversationId);
			const patch: Record<string, unknown> = {
				updated_at: new Date().toISOString(),
			};
			if (input.phone?.trim()) patch.phone = input.phone.trim();
			if (displayName) patch.display_name = displayName;
			if (username) patch.username = username;
			if (Object.keys(patch).length > 1) {
				await supabase.from("customers").update(patch).eq("id", existing.id);
			}
			return { ok: true, customerId: existing.id as string, created: false };
		}
	}

	const { data: created, error: createError } = await supabase
		.from("customers")
		.insert({
			business_id: input.businessId,
			instagram_user_id: instagramUserId,
			username,
			display_name: displayName,
			phone: input.phone?.trim() || null,
		})
		.select("id")
		.single();

	if (createError || !created?.id) {
		return {
			ok: false,
			error: createError?.message || "Klienti nuk u krijua.",
			status: 500,
		};
	}

	const { error: linkError } = await supabase
		.from("conversations")
		.update({
			customer_id: created.id,
			updated_at: new Date().toISOString(),
		})
		.eq("id", input.conversationId);

	if (linkError) {
		return { ok: false, error: linkError.message, status: 500 };
	}

	return { ok: true, customerId: created.id as string, created: true };
}

export function conversationDisplayName(row: {
	participant_display_name?: string | null;
	participant_username?: string | null;
	customers?: {
		display_name?: string | null;
		username?: string | null;
	} | null;
}): string {
	const customer = row.customers;
	return (
		customer?.display_name ||
		customer?.username ||
		row.participant_display_name ||
		row.participant_username ||
		"Bisedë Instagram"
	);
}
