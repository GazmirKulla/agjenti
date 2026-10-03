import { generateAgentReply } from "@/lib/agents/generate";
import { decryptSecret } from "@/lib/crypto/tokens";
import { sendInstagramText } from "@/lib/instagram/send";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
	applyInboundToState,
	emptyState,
	promptForStep,
	type ConversationStatePayload,
	type WorkflowStepKind,
} from "@/lib/workflows/engine";

type ConnectionRow = {
	id: string;
	business_id: string;
	ig_user_id: string;
	access_token_ciphertext: string;
	status: string;
};

async function alreadyHandled(externalId: string): Promise<boolean> {
	const supabase = createServiceSupabase();
	const { data } = await supabase
		.from("webhook_events")
		.select("id")
		.eq("external_event_id", externalId)
		.maybeSingle();
	return Boolean(data?.id);
}

export async function handleInboundMessage(message: NormalizedIncomingMessage): Promise<void> {
	console.log("[inbound] start", {
		externalMessageId: message.externalMessageId,
		externalParticipantId: message.externalParticipantId,
		textPreview: message.text?.slice(0, 80) ?? null,
		attachmentCount: message.attachments.length,
		contextMetadata: message.contextMetadata,
	});

	const accountId =
		typeof message.contextMetadata?.instagramAccountId === "string"
			? message.contextMetadata.instagramAccountId
			: null;
	if (!accountId) {
		console.warn("[inbound] early return: missing instagramAccountId");
		return;
	}
	if (await alreadyHandled(message.externalMessageId)) {
		console.warn("[inbound] early return: alreadyHandled", {
			externalMessageId: message.externalMessageId,
		});
		return;
	}

	const supabase = createServiceSupabase();
	const { data: webhookEvent, error: webhookEventError } = await supabase
		.from("webhook_events")
		.insert({
			external_event_id: message.externalMessageId,
			status: "received",
		})
		.select("id")
		.maybeSingle();
	console.log("[inbound] webhook_events insert", {
		ok: !webhookEventError,
		id: webhookEvent?.id ?? null,
		error: webhookEventError?.message ?? null,
		externalMessageId: message.externalMessageId,
	});

	const { data: connection, error: connectionError } = await supabase
		.from("instagram_connections")
		.select("id,business_id,ig_user_id,access_token_ciphertext,status")
		.eq("ig_user_id", accountId)
		.neq("status", "disconnected")
		.maybeSingle();
	console.log("[inbound] connection lookup", {
		lookupIgUserId: accountId,
		found: Boolean(connection),
		connectionId: connection?.id ?? null,
		businessId: connection?.business_id ?? null,
		status: connection?.status ?? null,
		error: connectionError?.message ?? null,
	});
	if (!connection) {
		console.warn("[inbound] early return: unknown Instagram account", accountId);
		const { error: logError } = await supabase.from("integration_logs").insert({
			business_id: null,
			direction: "inbound",
			target: "meta",
			status: "unknown_account",
			error: accountId,
		});
		if (logError) {
			console.warn("[inbound] integration_logs insert failed", logError.message);
		}
		return;
	}
	const conn = connection as ConnectionRow;
	const businessId = conn.business_id;

	const { data: existingCustomer, error: existingCustomerError } = await supabase
		.from("customers")
		.select("id,username,display_name")
		.eq("business_id", businessId)
		.eq("instagram_user_id", message.externalParticipantId)
		.maybeSingle();
	console.log("[inbound] customer lookup", {
		businessId,
		instagramUserId: message.externalParticipantId,
		found: Boolean(existingCustomer?.id),
		error: existingCustomerError?.message ?? null,
	});

	let customerId = existingCustomer?.id as string | undefined;
	if (!customerId) {
		const { data: created, error: createCustomerError } = await supabase
			.from("customers")
			.insert({
				business_id: businessId,
				instagram_user_id: message.externalParticipantId,
				username: message.senderUsername,
				display_name: message.senderDisplayName,
			})
			.select("id")
			.single();
		customerId = created?.id;
		console.log("[inbound] customer insert", {
			ok: !createCustomerError,
			customerId: customerId ?? null,
			error: createCustomerError?.message ?? null,
		});
	}
	if (!customerId) {
		console.warn("[inbound] early return: no customerId after lookup/insert");
		return;
	}

	const { data: open } = await supabase
		.from("conversations")
		.select("id,status,auto_reply,openai_previous_response_id")
		.eq("customer_id", customerId)
		.in("status", ["active", "paused"])
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	let conversationId = open?.id as string | undefined;
	let previousId: string | null = null;
	if (!conversationId) {
		const { data: last } = await supabase
			.from("conversations")
			.select("id")
			.eq("customer_id", customerId)
			.eq("status", "completed")
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		previousId = last?.id ?? null;
		const { data: created, error: createConversationError } = await supabase
			.from("conversations")
			.insert({
				business_id: businessId,
				customer_id: customerId,
				instagram_connection_id: conn.id,
				status: "active",
				previous_conversation_id: previousId,
				last_inbound_at: message.timestamp.toISOString(),
				last_message_at: message.timestamp.toISOString(),
				last_message_preview: message.text?.slice(0, 140) ?? "[media]",
				unread_count: 1,
			})
			.select("id")
			.single();
		conversationId = created?.id;
		console.log("[inbound] conversation insert", {
			ok: !createConversationError,
			conversationId: conversationId ?? null,
			error: createConversationError?.message ?? null,
		});
		if (conversationId) {
			const { error: stateError } = await supabase.from("conversation_states").insert({
				conversation_id: conversationId,
				business_id: businessId,
				status: "in_progress",
				collected: emptyState(),
			});
			console.log("[inbound] conversation_states insert", {
				ok: !stateError,
				error: stateError?.message ?? null,
			});
		}
	} else {
		const { error: updateConversationError } = await supabase
			.from("conversations")
			.update({
				last_inbound_at: message.timestamp.toISOString(),
				last_message_at: message.timestamp.toISOString(),
				last_message_preview: message.text?.slice(0, 140) ?? "[media]",
				unread_count: (open ? 1 : 1),
			})
			.eq("id", conversationId);
		console.log("[inbound] conversation update", {
			conversationId,
			ok: !updateConversationError,
			error: updateConversationError?.message ?? null,
		});
	}
	if (!conversationId) {
		console.warn("[inbound] early return: no conversationId");
		return;
	}

	const { data: insertedMessage, error: messageInsertError } = await supabase
		.from("messages")
		.insert({
			business_id: businessId,
			conversation_id: conversationId,
			instagram_connection_id: conn.id,
			direction: "inbound",
			source: "customer",
			body: message.text,
			external_message_id: message.externalMessageId,
			media: message.attachments,
			delivery_status: "delivered",
		})
		.select("id")
		.maybeSingle();
	console.log("[inbound] messages insert", {
		ok: !messageInsertError,
		messageId: insertedMessage?.id ?? null,
		conversationId,
		error: messageInsertError?.message ?? null,
	});

	const { data: business } = await supabase
		.from("businesses")
		.select("auto_reply")
		.eq("id", businessId)
		.maybeSingle();
	const convAuto = open?.auto_reply;
	const autoOn = convAuto ?? business?.auto_reply ?? false;
	if (!autoOn || open?.status === "paused") {
		console.log("[inbound] skip auto-reply", {
			autoOn,
			conversationStatus: open?.status ?? null,
		});
		return;
	}

	const { data: stateRow } = await supabase
		.from("conversation_states")
		.select("collected, workflow_id")
		.eq("conversation_id", conversationId)
		.maybeSingle();
	let state = (stateRow?.collected as ConversationStatePayload | null) ?? emptyState();

	const { data: products } = await supabase
		.from("products")
		.select("id,name,product_type_id")
		.eq("business_id", businessId);
	const text = message.text?.trim() ?? "";
	if (!state.product_id && text && products?.length) {
		const match = products.find((p) => p.name.toLowerCase().includes(text.toLowerCase()));
		if (match) {
			state.product_id = match.id;
			state.product_type_id = match.product_type_id;
		}
	}

	let steps: { key: string; kind: WorkflowStepKind }[] = [
		{ key: "collect_customer", kind: "customer" },
	];
	if (state.product_type_id) {
		const { data: type } = await supabase
			.from("product_types")
			.select("workflow_id")
			.eq("id", state.product_type_id)
			.maybeSingle();
		if (type?.workflow_id) {
			const { data: wfSteps } = await supabase
				.from("workflow_steps")
				.select("key,kind,position")
				.eq("workflow_id", type.workflow_id)
				.order("position");
			if (wfSteps?.length) {
				steps = wfSteps.map((s) => ({ key: s.key, kind: s.kind as WorkflowStepKind }));
			}
		}
	}

	const hasPhoto = message.attachments.some((a) => a.kind === "image");
	state = applyInboundToState(state, text, hasPhoto, steps);
	await supabase.from("conversation_states").upsert({
		conversation_id: conversationId,
		business_id: businessId,
		status: state.step_key === "order_ready" ? "ready" : "in_progress",
		collected: state,
		step_key: state.step_key,
		updated_at: new Date().toISOString(),
	});

	const { data: agent } = await supabase
		.from("ai_agents")
		.select("instructions")
		.eq("business_id", businessId)
		.eq("is_active", true)
		.maybeSingle();
	const { data: knowledge } = await supabase
		.from("knowledge_entries")
		.select("title,body")
		.eq("business_id", businessId)
		.eq("is_active", true)
		.order("sort_order")
		.limit(12);

	const started = Date.now();
	const generated = await generateAgentReply({
		instructions:
			agent?.instructions ||
			"You are a customer support agent. Write in the customer's language. Do not invent prices.",
		state,
		knowledge: (knowledge ?? []).map((k) => `${k.title}: ${k.body}`).join("\n"),
		customerMessage: text || "[media]",
		previousResponseId: open?.openai_previous_response_id ?? null,
		catalogSummary: (products ?? []).map((p) => p.name).join(", "),
	});

	let token: string;
	try {
		token = decryptSecret(conn.access_token_ciphertext);
	} catch {
		await supabase
			.from("instagram_connections")
			.update({ status: "revoked", last_error: "decrypt_failed" })
			.eq("id", conn.id);
		return;
	}

	const send = await sendInstagramText({
		accountId: conn.ig_user_id,
		token,
		to: message.externalParticipantId,
		body: generated.reply || promptForStep(state.step_key),
	});

	await supabase.from("agent_turns").insert({
		conversation_id: conversationId,
		business_id: businessId,
		status: send.ok ? "ok" : "failed",
		reply: generated.reply,
		elapsed_ms: Date.now() - started,
	});

	if (send.ok) {
		await supabase.from("messages").insert({
			business_id: businessId,
			conversation_id: conversationId,
			instagram_connection_id: conn.id,
			direction: "outbound",
			source: "agent",
			body: generated.reply,
			external_message_id: send.messageId ?? null,
			delivery_status: "sent",
		});
		await supabase
			.from("conversations")
			.update({
				openai_previous_response_id: generated.responseId,
				last_message_at: new Date().toISOString(),
				last_message_preview: generated.reply.slice(0, 140),
			})
			.eq("id", conversationId);
	} else if (send.code === "token_revoked") {
		await supabase
			.from("instagram_connections")
			.update({ status: "revoked", last_error: send.error })
			.eq("id", conn.id);
	}
}
