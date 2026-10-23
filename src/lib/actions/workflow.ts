import { createHash } from "node:crypto";
import type { ActionBinding } from "./catalog";
import { parseProvisionInput } from "./catalog";
import { provisionBusiness } from "./provision";
import type { BookingEffectGuard } from "@/lib/calendar/service";
import { isIsolatedExecution, recordExternalAction, assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";
export async function executeWorkflowAction(p: {
  businessId: string;
  versionId: string;
  nodeId: string;
  binding: ActionBinding;
  values: Record<string, string>;
  mode?: "production" | "test";
  guard?: BookingEffectGuard;
}) {
  assertBusinessEffectAllowed("workflow.action");
  const input = parseProvisionInput(
    Object.fromEntries(
      Object.entries(p.binding.inputs).map(([key, field]) => [
        key,
        Object.hasOwn(p.values, field) ? p.values[field] : "",
      ]),
    ),
  );
  if (p.mode === "test" || isIsolatedExecution()) {
    recordExternalAction({ kind: "action.provision", disposition: "SIMULATED", detail: "not_provisioned" });
    return {
      businessId: "simulation",
      invitationUrl: "[SIMULIM: link regjistrimi — nuk u krijua biznes]",
      expiresAt: "[SIMULIM]",
    };
  }
  if (!p.guard) throw new Error("Mungon konteksti i verifikuar i bisedës.");
  const requestId = `workflow:${p.guard.conversationId}:${p.versionId}:${p.nodeId}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
  return provisionBusiness({
    businessId: p.businessId,
    userId: null,
    requestId,
    input,
    workflowVersionId: p.versionId,
    nodeId: p.nodeId,
    conversationId: p.guard.conversationId,
    guard: p.guard,
  });
}
/** Substitute only persisted action outputs; never evaluate expressions. */
export function renderActionMessage(
  message: string,
  results: Record<string, Record<string, string>> = {},
) {
  return message.replace(
    /\{\{actions\.([A-Za-z0-9_-]+)\.([A-Za-z]+)\}\}/g,
    (_match, node, key) =>
      Object.hasOwn(results, node) && Object.hasOwn(results[node], key)
        ? results[node][key]
        : "[rezultat i padisponueshëm]",
  );
}
