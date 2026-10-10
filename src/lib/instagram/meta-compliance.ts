import { randomBytes } from "node:crypto";
import { encryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";

export type InstagramConnectionRow = {
	id: string;
	business_id: string;
	ig_user_id: string;
	username: string | null;
	status: string;
};

export async function findInstagramConnectionByMetaUserId(
	metaUserId: string,
): Promise<InstagramConnectionRow | null> {
	const supabase = createServiceSupabase();
	const { data, error } = await supabase
		.from("instagram_connections")
		.select("id,business_id,ig_user_id,username,status")
		.eq("ig_user_id", metaUserId)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return data;
}

/** Soft-revoke Instagram OAuth for a Meta/Instagram user id. */
export async function deauthorizeInstagramConnection(
	metaUserId: string,
): Promise<{ found: boolean; connectionId: string | null }> {
	const connection = await findInstagramConnectionByMetaUserId(metaUserId);
	if (!connection) return { found: false, connectionId: null };

	const supabase = createServiceSupabase();
	const { error } = await supabase
		.from("instagram_connections")
		.update({
			status: "revoked",
			access_token_ciphertext: encryptSecret("revoked"),
			last_error: "deauthorized_by_meta",
			updated_at: new Date().toISOString(),
		})
		.eq("id", connection.id);
	if (error) throw new Error(error.message);
	return { found: true, connectionId: connection.id };
}

export function createDeletionConfirmationCode(): string {
	return randomBytes(16).toString("hex");
}

export async function deleteInstagramUserData(params: {
	metaUserId: string;
	confirmationCode: string;
	appBaseUrl: string;
}): Promise<{
	confirmationCode: string;
	statusUrl: string;
	connectionFound: boolean;
}> {
	const supabase = createServiceSupabase();
	const connection = await findInstagramConnectionByMetaUserId(
		params.metaUserId,
	);
	const now = new Date().toISOString();

	if (connection) {
		await supabase
			.from("instagram_connections")
			.update({
				status: "revoked",
				access_token_ciphertext: encryptSecret("revoked"),
				username: null,
				last_error: "data_deletion_requested",
				expires_at: null,
				refreshed_at: null,
				updated_at: now,
			})
			.eq("id", connection.id)
			.throwOnError();

		// New memory and queued payloads are personal data too. Missing tables are tolerated before migration.
        for (const table of ["conversation_profiles", "workflow_inbound_queue"]) {
          const { error } = await supabase.from(table).delete().eq("business_id", connection.business_id).eq("connection_id", connection.id);
          if (error && !["42P01", "PGRST205"].includes(error.code ?? "")) throw new Error("Nuk u fshi kujtesa e klientit.");
        }
		const { data: conversations } = await supabase
			.from("conversations")
			.select("id,customer_id")
			.eq("instagram_connection_id", connection.id);

		const conversationIds = (conversations ?? []).map((row) => row.id);
		const customerIds = [
			...new Set(
				(conversations ?? [])
					.map((row) => row.customer_id)
					.filter((id): id is string => Boolean(id)),
			),
		];

		if (conversationIds.length) {
			await supabase
				.from("messages")
				.update({
					body: null,
					media: null,
					delivery_error: null,
					external_message_id: null,
				})
				.in("conversation_id", conversationIds)
				.throwOnError();

			await supabase
				.from("conversations")
				.update({
					last_message_preview: null,
					openai_previous_response_id: null,
					unread_count: 0,
					instagram_participant_id: null,
					participant_username: null,
					participant_display_name: null,
					updated_at: now,
				})
				.in("id", conversationIds)
				.throwOnError();

			await supabase
				.from("conversation_states")
				.update({
					cart: [],
					customer_fields: {},
					collected: {},
					updated_at: now,
				})
				.in("conversation_id", conversationIds)
				.throwOnError();
		}

		if (customerIds.length) {
			await supabase
				.from("customers")
				.update({
					instagram_user_id: null,
					username: null,
					display_name: "Deleted Instagram user",
					phone: null,
					updated_at: now,
				})
				.in("id", customerIds)
				.throwOnError();
		}
	}

	const statusUrl = new URL(
		"/api/meta/data-deletion",
		params.appBaseUrl,
	);
	statusUrl.searchParams.set("code", params.confirmationCode);

	await supabase
		.from("meta_data_deletion_requests")
		.insert({
			confirmation_code: params.confirmationCode,
			meta_user_id: params.metaUserId,
			instagram_connection_id: connection?.id ?? null,
			business_id: connection?.business_id ?? null,
			status: "completed",
			status_url: statusUrl.toString(),
			completed_at: now,
		})
		.throwOnError();

	return {
		confirmationCode: params.confirmationCode,
		statusUrl: statusUrl.toString(),
		connectionFound: Boolean(connection),
	};
}

export async function getDataDeletionStatus(confirmationCode: string) {
	const supabase = createServiceSupabase();
	const { data, error } = await supabase
		.from("meta_data_deletion_requests")
		.select(
			"confirmation_code,meta_user_id,status,status_url,created_at,completed_at",
		)
		.eq("confirmation_code", confirmationCode)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return data;
}
