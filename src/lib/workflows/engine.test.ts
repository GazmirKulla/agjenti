import { describe, expect, it } from "vitest";
import {
	buildWorkflowProgress,
	emptyState,
	nextStepKey,
} from "@/lib/workflows/engine";

describe("workflow engine", () => {
	it("returns order_ready after last step", () => {
		expect(nextStepKey("collect_customer", [{ key: "collect_customer" }])).toBe(
			"order_ready",
		);
	});

	it("marks workflow steps done/current/pending", () => {
		const progress = buildWorkflowProgress({
			productName: "Bluzë",
			steps: [
				{ key: "collect_size", kind: "choice", label: "Madhësi" },
				{ key: "collect_customer", kind: "customer", label: "Klienti" },
			],
			state: {
				...emptyState(),
				product_id: "p1",
				step_key: "collect_customer",
				fields: { collect_size: "M" },
				customer: {
					name: "Ana",
					phone: null,
					city: null,
					address: null,
				},
			},
		});
		expect(progress.map((s) => [s.key, s.status, s.value])).toEqual([
			["choose_product", "done", "Bluzë"],
			["collect_size", "done", "M"],
			["collect_customer", "current", "Ana"],
			["order_ready", "pending", null],
		]);
	});
});
