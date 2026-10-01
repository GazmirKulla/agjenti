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
	const accountId =
		typeof message.contextMetadata?.instagramAccountId === "string"
			? message.contextMetadata.instagramAccountId
			: null;
	if (!accountId) {
		console.warn("[inbound] missing instagramAccountId");
		return;
	}
	if (await alreadyHandled(message.externalMessageId)) return;

	const supabase = createServiceSupabase();
	await supabase.from("webhook_events").insert({
		external_event_id: message.externalMessageId,
		status: "received",
	});

	const { data: connection } = await supabase
		.from("instagram_connections")
		.select("id,business_id,ig_user_id,access_token_ciphertext,status")
		.eq("ig_user_id", accountId)
		.neq("status", "disconnected")
		.maybeSingle();
	if (!connection) {
		console.warn("[inbound] unknown Instagram account", accountId);
		await supabase.from("integration_logs").insert({
			business_id: null,
			direction: "inbound",
			target: "meta",
			status: "unknown_account",
			error: accountId,
		});
		return;
	}
	const conn = connection as ConnectionRow;
	const businessId = conn.business_id;

	const { data: existingCustomer } = await supabase
		.from("customers")
		.select("id,username,display_name")
		.eq("business_id", businessId)
		.eq("instagram_user_id", message.externalParticipantId)
		.maybeSingle();

	let customerId = existingCustomer?.id as string | undefined;
	if (!customerId) {
		const { data: created } = await supabase
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
	}
	if (!customerId) return;

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
		const { data: created } = await supabase
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
		if (conversationId) {
			await supabase.from("conversation_states").insert({
				conversation_id: conversationId,
				business_id: businessId,
				status: "in_progress",
				collected: emptyState(),
			});
		}
	} else {
		await supabase
			.from("conversations")
			.update({
				last_inbound_at: message.timestamp.toISOString(),
				last_message_at: message.timestamp.toISOString(),
				last_message_preview: message.text?.slice(0, 140) ?? "[media]",
				unread_count: (open ? 1 : 1),
			})
			.eq("id", conversationId);
	}
	if (!conversationId) return;

	await supabase.from("messages").insert({
		business_id: businessId,
		conversation_id: conversationId,
		instagram_connection_id: conn.id,
		direction: "inbound",
		source: "customer",
		body: message.text,
		external_message_id: message.externalMessageId,
		media: message.attachments,
		delivery_status: "delivered",
	});

	const { data: business } = await supabase
		.from("businesses")
		.select("auto_reply")
		.eq("id", businessId)
		.maybeSingle();
	const convAuto = open?.auto_reply;
	const autoOn = convAuto ?? business?.auto_reply ?? false;
	if (!autoOn || open?.status === "paused") return;

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
