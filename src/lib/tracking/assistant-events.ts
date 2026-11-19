import { AssistantError } from "@/lib/business-assistant/model";
import { capabilities } from "./capabilities";
import { recordCapabilityEvents } from "./events";

/** The Assistant capability of an action; for an operation, the operation's own key when it is a known one. */
export function assistantCapability(action: string, operationKey?: string) {
  if (action === "operation" && operationKey && capabilities[`assistant.${operationKey}`]) return `assistant.${operationKey}`;
  return capabilities[`assistant.${action}`] ? `assistant.${action}` : "assistant.operation";
}

/** The operation key a proposal names, read from its structured changes (never from the owner's words). */
export function proposalOperationKey(proposal: { action: string; changes?: { field: string; value: string }[] }) {
  return proposal.action === "operation" ? proposal.changes?.find(change => change.field === "key")?.value : undefined;
}

type Prepared = { clarifying?: boolean; token?: string };
const refused = (error: unknown) => error instanceof AssistantError;

/** One owner request the Assistant prepared: its entry and how it ended (a proposal, an answer, a question, a refusal). */
export async function trackAssistantPreparation<T extends Prepared>(businessId: string, capability: string, ref: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const record = (point: string, reason?: string) => recordCapabilityEvents([
    { businessId, capability, point: "requested", mode: "live", ref },
    { businessId, capability, point, reason, mode: "live", ref, durationMs: Date.now() - started },
  ]);
  try {
    const result = await work();
    await record(result.clarifying ? "clarified" : result.token ? "proposed" : "answered");
    return result;
  } catch (error) {
    await record(refused(error) ? "refused" : "failed", refused(error) ? "assistant_refusal" : "error");
    throw error;
  }
}

/** The owner confirmed a proposal: whether it was carried out. */
export async function trackAssistantExecution<T>(businessId: string, capability: string, ref: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    await recordCapabilityEvents([{ businessId, capability, point: "executed", mode: "live", ref, durationMs: Date.now() - started }]);
    return result;
  } catch (error) {
    await recordCapabilityEvents([{ businessId, capability, point: "execution_failed", reason: refused(error) ? "assistant_refusal" : "error", mode: "live", ref, durationMs: Date.now() - started }]);
    throw error;
  }
}
