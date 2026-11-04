import { expect, it } from "vitest";
import { linearCollectionCommunication } from "./linear-communication";
import { migrateContext, setFact } from "./context";
import type { WorkflowStepDef } from "./engine";
import { renderProcessCommunication } from "@/lib/conversations/process-communication";
const steps: WorkflowStepDef[] = [{ key: "details", kind: "customer" }, { key: "size", kind: "choice", options: ["M", "L"] }, { key: "approve", kind: "confirm" }];
it("asks for only the next missing field while preserving the linear cursor and existing facts", () => {
  const state = migrateContext(); state.step_key = "details"; setFact(state, "customer_name", "Ana", "text", "message_label");
  const before = structuredClone(state);
  const output = linearCollectionCommunication(state, steps, "Telefonin, qytetin dhe adresën.");
  expect(output).toMatchObject({ kind: "collect", field: "customer_phone", format: "phone" });
  expect(state).toEqual(before);
  expect(renderProcessCommunication(output)).toBe("Telefonin, qytetin dhe adresën.");
});
it.each(["order_confirm", "order_ready", "approve"])("does not allow language generation to rewrite %s", key => {
  const state = migrateContext(); state.step_key = key;
  expect(linearCollectionCommunication(state, steps, "Konfirmo")).toBeUndefined();
});
it("keeps the profile review protected and identifies the actual invalid field", () => {
  const state = migrateContext(); state.step_key = "details"; state.context!.execution.profileConfirmation = "pending";
  expect(linearCollectionCommunication(state, steps, "Konfirmo profilin")).toBeUndefined();
  delete state.context!.execution.profileConfirmation;
  state.context!.execution.invalidFields = ["customer_phone"];
  expect(linearCollectionCommunication(state, steps, "Kontrollo telefonin.")).toMatchObject({ field: "customer_phone", invalid: true });
});
