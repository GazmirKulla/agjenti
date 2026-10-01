import { describe, expect, it } from "vitest";
import { applyInboundToState, emptyState, nextStepKey } from "@/lib/workflows/engine";

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
		expect(nextStepKey("collect_customer", [{ key: "collect_customer" }])).toBe("order_ready");
	});
});
