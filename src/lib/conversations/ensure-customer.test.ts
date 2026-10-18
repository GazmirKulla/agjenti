import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationDisplayName, ensureCustomerForConversation } from "./ensure-customer";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => db }));

function query(data: unknown, error: { message: string; code?: string } | null = null) {
	const result = { data, error };
	const builder = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn().mockResolvedValue(result),
		single: vi.fn().mockResolvedValue(result),
		then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
	};
	db.from.mockReturnValueOnce(builder);
	return builder;
}

describe("ensureCustomerForConversation association boundary", () => {
	const input = { businessId: "tenant-a", conversationId: "conversation-a", displayName: "Own customer" };
	const conversation = {
		id: input.conversationId, customer_id: null, instagram_participant_id: "participant-a",
		whatsapp_participant_id: null, participant_username: null, participant_display_name: null,
	};
	beforeEach(() => {
		db.from.mockReset();
		const fallback = query(null);
		db.from.mockReset().mockReturnValue(fallback);
	});

	it("does not report a rejected reuse link as success or expose database details", async () => {
		query(conversation);
		query({ id: "existing-customer" });
		query(null, { code: "23503", message: "private tenant-b / foreign-customer UUID" });

		expect(await ensureCustomerForConversation(input)).toEqual({
			ok: false, error: "Klienti nuk u lidh me bisedën.", status: 500,
		});
		expect(db.from.mock.calls.map(([table]) => table)).toEqual(["conversations", "customers", "conversations"]);
	});

	it("does not report a zero-row association as success", async () => {
		query(conversation);
		query({ id: "existing-customer" });
		query(null);
		expect(await ensureCustomerForConversation(input)).toMatchObject({ ok: false, status: 500 });
		expect(db.from).toHaveBeenCalledTimes(3);
	});

	it("retries the same existing customer without inserting another customer", async () => {
		query(conversation);
		query({ id: "existing-customer" });
		query(null, { message: "temporary write failure" });
		expect((await ensureCustomerForConversation(input)).ok).toBe(false);
		query(conversation);
		query({ id: "existing-customer" });
		const link = query({ id: input.conversationId });
		const patch = query(null);
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: true, customerId: "existing-customer", created: false });
		expect(link.eq).toHaveBeenCalledWith("business_id", input.businessId);
		expect(patch.eq).toHaveBeenCalledWith("business_id", input.businessId);
		expect(patch.update).toHaveBeenCalledWith(expect.objectContaining({ display_name: input.displayName }));
	});

	it("does not attempt customer creation when the identity lookup fails", async () => {
		query(conversation);
		query(null, { message: "private database details" });
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: false, error: "Klienti nuk u gjet.", status: 500 });
		expect(db.from).toHaveBeenCalledTimes(2);
	});

	it("reports new-customer association errors safely and reuses the created row on retry", async () => {
		query(conversation);
		query(null);
		const insert = query({ id: "new-customer" });
		query(null, { code: "23503", message: "private constraint details" });
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: false, error: "Klienti nuk u lidh me bisedën.", status: 500 });
		expect(insert.insert).toHaveBeenCalledTimes(1);
		query(conversation);
		query({ id: "new-customer" });
		query({ id: input.conversationId });
		query(null);
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: true, customerId: "new-customer", created: false });
		expect(db.from.mock.results.filter(({ value }) => value.insert.mock.calls.length)).toHaveLength(1);
	});

	it("preserves successful creation and scopes the association to the tenant", async () => {
		query(conversation);
		query(null);
		query({ id: "new-customer" });
		const link = query({ id: input.conversationId });
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: true, customerId: "new-customer", created: true });
		expect(link.eq).toHaveBeenCalledWith("business_id", input.businessId);
	});

	it("preserves an already linked customer without further writes", async () => {
		query({ ...conversation, customer_id: "linked-customer" });
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: true, customerId: "linked-customer", created: false });
		expect(db.from).toHaveBeenCalledTimes(1);
	});

	it("does not reveal a missing or foreign conversation", async () => {
		const lookup = query(null);
		expect(await ensureCustomerForConversation(input)).toEqual({ ok: false, error: "Biseda nuk u gjet.", status: 404 });
		expect(lookup.eq).toHaveBeenCalledWith("business_id", input.businessId);
		expect(db.from).toHaveBeenCalledTimes(1);
	});
});

describe("conversationDisplayName", () => {
	it("prefers CRM customer name over participant fields", () => {
		expect(
			conversationDisplayName({
				participant_display_name: "IG Name",
				participant_username: "ig_user",
				customers: { display_name: "CRM Name", username: "crm_user" },
			}),
		).toBe("CRM Name");
	});

	it("falls back to participant fields when not a CRM customer", () => {
		expect(
			conversationDisplayName({
				participant_display_name: null,
				participant_username: "faqekuqe_",
				customers: null,
			}),
		).toBe("faqekuqe_");
	});
});
