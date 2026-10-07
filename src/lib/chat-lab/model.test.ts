import { expect, it, vi, afterEach } from "vitest";
import { redactDebug, workflowFields } from "./model";
import { emptyState } from "@/lib/workflows/engine";
afterEach(() => vi.unstubAllEnvs());
it("redacts nested credentials and free text while retaining token usage", () => {
  vi.stubEnv("OPENAI_API_KEY", "provider-private-credential");
  expect(redactDebug({ authorization: "private", nested: [{ access_token: "secret", input_tokens: 42 }], text: "provider-private-credential Bearer abc sk-example" })).toEqual({ authorization: "[REDACTED]", nested: [{ access_token: "[REDACTED]", input_tokens: 42 }], text: "[REDACTED] Bearer [REDACTED] [REDACTED]" });
});
it("distinguishes false/zero collected values, optional fields, and missing customer data", () => {
  const state = emptyState(); state.fields = { approval: false, quantity: 0 }; state.customer.name = "Test";
  const fields = workflowFields(state, [{ key: "approval", kind: "confirm" }, { key: "quantity", kind: "text" }, { key: "note", kind: "text", required: false }, { key: "customer", kind: "customer" }]);
  expect(fields.filter((f) => f.status === "missing").map((f) => f.key)).toEqual(["phone", "city", "address"]);
  expect(fields.find((f) => f.key === "note")?.status).toBe("optional");
  expect(fields.find((f) => f.key === "approval")?.status).toBe("completed");
});
it("includes missing catalog qualification without inventing order fields", () => {
  const state = emptyState(); state.fields.catalog_context = { pending: "market", requirements: { language: "Albanian" } };
  expect(workflowFields(state, [])).toEqual([{ key: "language", value: "Albanian", status: "completed" }, { key: "market", value: null, status: "missing" }]);
});
