import { describe, expect, it } from "vitest";
import { conversationDisplayName } from "./ensure-customer";

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
