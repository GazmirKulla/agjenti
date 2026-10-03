import { describe, expect, it } from "vitest";
import {
	applyInboundToState,
	buildWorkflowProgress,
	emptyState,
	nextStepKey,
	parseCustomerMessage,
} from "@/lib/workflows/engine";

describe("workflow engine", () => {
	it("advances after a product message", () => {
		const steps = [
			{ key: "collect_size", kind: "choice" as const },
			{ key: "collect_customer", kind: "customer" as const },
		];
		const next = applyInboundToState(emptyState(), "puzzle", false, steps);
		expect(next.step_key).toBe("collect_size");
		expect(next.fields.product_query).toBe("puzzle");
	});

	it("returns order_ready after last step", () => {
		expect(nextStepKey("collect_customer", [{ key: "collect_customer" }])).toBe(
			"order_ready",
		);
	});

	it("parses customer details from one labeled message", () => {
		expect(
			parseCustomerMessage(
				"Emri: Ana, Tel: 0691234567, Qyteti: Tiranë, Adresa: Rruga 1",
			),
		).toEqual({
			name: "Ana",
			phone: "0691234567",
			city: "Tiranë",
			address: "Rruga 1",
		});
	});

	it("fills all customer fields from one message on the customer step", () => {
		const state = {
			...emptyState(),
			product_id: "p1",
			step_key: "collect_customer",
		};
		const next = applyInboundToState(
			state,
			"Emri: Ana\nTel: 0691234567\nQyteti: Tiranë\nAdresa: Rruga 1",
			false,
			[{ key: "collect_customer", kind: "customer" }],
		);
		expect(next.step_key).toBe("order_ready");
		expect(next.customer).toEqual({
			name: "Ana",
			phone: "0691234567",
			city: "Tiranë",
			address: "Rruga 1",
		});
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
