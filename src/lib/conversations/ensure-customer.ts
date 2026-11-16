import { createServiceSupabase } from "@/lib/supabase/service";
import { assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";

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
  assertBusinessEffectAllowed("customer.register");
	const supabase = createServiceSupabase();
	const { data: conversation, error: conversationError } = await supabase
		.from("conversations")
		.select(
			"id,customer_id,instagram_participant_id,whatsapp_participant_id,participant_username,participant_display_name",
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
	const whatsappUserId = conversation.whatsapp_participant_id as string | null;
	const username =
		input.username?.trim() ||
		(conversation.participant_username as string | null) ||
		null;
	const displayName =
		input.displayName?.trim() ||
		(conversation.participant_display_name as string | null) ||
		username ||
		null;

	if (instagramUserId || whatsappUserId) {
		const { data: existing, error: lookupError } = await supabase
			.from("customers")
			.select("id")
			.eq("business_id", input.businessId)
			.eq(whatsappUserId ? "whatsapp_user_id" : "instagram_user_id", whatsappUserId || instagramUserId)
			.maybeSingle();
		if (lookupError) {
			return { ok: false, error: "Klienti nuk u gjet.", status: 500 };
		}
		if (existing?.id) {
			const { data: linked, error: linkError } = await supabase
				.from("conversations")
				.update({
					customer_id: existing.id,
					updated_at: new Date().toISOString(),
				})
				.eq("id", input.conversationId)
				.eq("business_id", input.businessId)
				.select("id")
				.maybeSingle();
			if (linkError || !linked) {
				return { ok: false, error: "Klienti nuk u lidh me bisedën.", status: 500 };
			}
			// Registering an archived customer again brings them back to the list.
			const patch: Record<string, unknown> = {
				updated_at: new Date().toISOString(),
				archived_at: null,
			};
			if (input.phone?.trim()) patch.phone = input.phone.trim();
			if (displayName) patch.display_name = displayName;
			if (username) patch.username = username;
			await supabase.from("customers").update(patch).eq("id", existing.id).eq("business_id", input.businessId);
			return { ok: true, customerId: existing.id as string, created: false };
		}
	}

	const { data: created, error: createError } = await supabase
		.from("customers")
		.insert({
			business_id: input.businessId,
			instagram_user_id: whatsappUserId ? null : instagramUserId,
            whatsapp_user_id: whatsappUserId,
			username,
			display_name: displayName,
			phone: input.phone?.trim() || conversation.whatsapp_participant_id || null,
		})
		.select("id")
		.single();

	if (createError || !created?.id) {
		return {
			ok: false,
			error: "Klienti nuk u krijua.",
			status: 500,
		};
	}

	const { data: linked, error: linkError } = await supabase
		.from("conversations")
		.update({
			customer_id: created.id,
			updated_at: new Date().toISOString(),
		})
		.eq("id", input.conversationId)
		.eq("business_id", input.businessId)
		.select("id")
		.maybeSingle();

	if (linkError || !linked) {
		return { ok: false, error: "Klienti nuk u lidh me bisedën.", status: 500 };
	}

	return { ok: true, customerId: created.id as string, created: true };
}

/** The name a conversation is shown under in the Inbox (web, mobile, assistant). */
export function conversationDisplayName(row: {
	participant_display_name?: string | null;
	participant_username?: string | null;
	customers?: {
		display_name?: string | null;
		username?: string | null;
	} | null;
}): string {
	const customer = row.customers;
	// The name the channel shows (profile name) comes first; a name the customer gave
	// in the conversation (kept on the CRM record) is used only when the channel shows none.
	return (
		row.participant_display_name?.trim() ||
		customer?.display_name?.trim() ||
		customer?.username ||
		row.participant_username ||
		"Bisedë me klientin"
	);
}
