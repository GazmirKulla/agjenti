import { capabilities } from "./capabilities";
import { assistantRequestId } from "./assistant-request";
import { recordCapabilityEvents } from "./events";
import { failureCode, logUnexpected } from "./failure";

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

/** Retries that restore an existing reply never reach this write. */
export async function trackBlockStorage<T>(businessId: string, ref: string, write: Promise<T>, hasChart = false): Promise<T> {
  const event = { businessId, ref, capability: "assistant.message_blocks", mode: "live" as const };
  try {
    const result = await write;
    await recordCapabilityEvents([{ ...event, point: "prepared" }, { ...event, point: "stored" },
      ...(hasChart ? [{ ...event, capability: "assistant.report_chart", point: "requested" }, { ...event, capability: "assistant.report_chart", point: "stored" }] : [])]);
    return result;
  } catch (error) {
    await recordCapabilityEvents([{ ...event, point: "prepared" }, { ...event, point: "store_failed", reason: failureCode(error) },
      ...(hasChart ? [{ ...event, capability: "assistant.report_chart", point: "requested" }, { ...event, capability: "assistant.report_chart", point: "store_failed", reason: failureCode(error) }] : [])]);
    throw error;
  }
}

/** One owner request the Assistant prepared: its entry and how it ended (a proposal, an answer, a question, a refusal).
 * `ref` is the owner's request in the Assistant conversation when there is one, so a failure leads back to it. */
export async function trackAssistantPreparation<T extends Prepared>(businessId: string, capability: string, fallbackRef: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now(), ref = assistantRequestId() ?? fallbackRef;
  const record = (point: string, reason?: string) => recordCapabilityEvents([
    { businessId, capability, point: "requested", mode: "live", ref },
    { businessId, capability, point, reason, mode: "live", ref, durationMs: Date.now() - started },
  ]);
  try {
    const result = await work();
    await record(result.clarifying ? "clarified" : result.token ? "proposed" : "answered");
    return result;
  } catch (error) {
    const code = failureCode(error);
    logUnexpected("assistant_preparation", capability, ref, error);
    await record(code === "assistant_refusal" ? "refused" : "failed", code);
    throw error;
  }
}

/** The owner confirmed a proposal: whether it was carried out. */
export async function trackAssistantExecution<T>(businessId: string, capability: string, fallbackRef: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now(), ref = assistantRequestId() ?? fallbackRef;
  try {
    const result = await work();
    await recordCapabilityEvents([{ businessId, capability, point: "executed", mode: "live", ref, durationMs: Date.now() - started }]);
    return result;
  } catch (error) {
    logUnexpected("assistant_execution", capability, ref, error);
    await recordCapabilityEvents([{ businessId, capability, point: "execution_failed", reason: failureCode(error), mode: "live", ref, durationMs: Date.now() - started }]);
    throw error;
  }
}
