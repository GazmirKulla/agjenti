import type { Instance, ProcessDefinition, RuntimeNotice, Snapshot } from "@/lib/orchestration/contracts";
import { processToolCapability, type CustomerCapability } from "./capabilities";
import type { CapabilityEvent } from "./events";

/** The capability a process carries out: its effect's tool, else a staff handoff, else a custom process. */
export function processCapability(definition: ProcessDefinition | undefined): CustomerCapability {
  const tools = definition?.steps.flatMap(step => step.kind === "effect" ? [step.tool] : []) ?? [];
  for (const tool of tools) if (processToolCapability[tool]) return processToolCapability[tool];
  if (tools.length) return "customer.business_action";
  if (definition?.steps.some(step => step.kind === "handoff") && definition.steps.every(step => step.kind === "handoff" || step.kind === "inform" || step.kind === "end")) return "customer.handoff";
  return "customer.custom_process";
}

const terminal = new Set<Instance["status"]>(["completed", "failed", "handoff"]);
const code = (value: unknown) => typeof value === "string" ? value : undefined;

/** How a finished effect ends its capability, from the durable result the server recorded. */
function effectExit(capability: CustomerCapability, action: NonNullable<Instance["action"]>, instance: Instance): { point: string; reason?: string } {
  if (action.status === "failed" || action.status === "unknown") return { point: "failed", reason: code(action.output?.code) ?? action.status };
  if (capability === "customer.booking_manage") {
    if (action.tool === "booking.change") return { point: action.output?.action === "cancel" ? "cancelled" : "moved" };
    // Reading the bookings ends the process only on the status path, the "no booking" path or a declined change (server step IDs).
    return { point: instance.stepId.endsWith("_status_done") ? "answered" : instance.stepId.endsWith("_none") ? "no_booking" : "closed" };
  }
  if (capability === "customer.order") return { point: action.output?.submissionStatus === "awaiting_staff" ? "collected" : "registered" };
  if (capability === "customer.booking") return { point: action.output?.status === "confirmed" ? "booked" : "requested", reason: code(action.output?.status) };
  if (capability === "customer.order_status") return { point: "answered" };
  return { point: "completed" };
}

/**
 * The capability entries and exits one customer turn produced, from the process state before and after it:
 * a new process is an entry; a process that finished, failed, went to staff or was stopped by the server
 * is an exit. Pure: the caller records them only after the turn is committed.
 */
export function processCapabilityEvents(before: Snapshot | undefined, after: Snapshot, notices: RuntimeNotice[],
  definitionOf: (instance: Instance) => ProcessDefinition | undefined): Omit<CapabilityEvent, "businessId" | "mode">[] {
  const events: Omit<CapabilityEvent, "businessId" | "mode">[] = [];
  const ref = (instance: Instance) => `${after.conversationId}:${instance.id}`;
  const blocked = new Map(notices.flatMap(n => n.kind === "blocked" && n.instanceId ? [[n.instanceId, n.reason] as const] : []));
  for (const instance of Object.values(after.instances)) {
    const previous = before?.instances[instance.id];
    const capability = processCapability(definitionOf(instance));
    const base = { capability, conversationId: after.conversationId, ref: ref(instance) };
    if (!previous) events.push({ ...base, point: "started" });
    if (previous && terminal.has(previous.status)) continue;
    const action = instance.action;
    const settled = action && (action.status === "succeeded" || action.status === "failed" || action.status === "unknown")
      && (previous?.action?.id !== action.id || previous.action.status !== action.status);
    if (blocked.has(instance.id)) events.push({ ...base, point: "blocked", reason: blocked.get(instance.id) ?? "blocked" });
    else if (instance.status === "handoff") events.push({ ...base, point: "handed_off" });
    // Reading a customer's bookings is a step on the way to a cancellation or a move, not an exit, while the process goes on.
    else if (settled && !(action.tool === "booking.mine" && instance.status !== "completed")) events.push({ ...base, ...effectExit(capability, action, instance) });
    else if (instance.status === "failed") events.push({ ...base, point: "failed", reason: instance.lastError ?? "failed" });
    // An effect already ended the capability; finishing the process afterwards is not a second exit.
    // A process that read the customer's bookings and then ended without a change (declined, nothing to change).
    else if (instance.status === "completed" && action?.tool === "booking.mine" && action.status === "succeeded")
      events.push({ ...base, ...effectExit(capability, action, instance) });
    else if (instance.status === "completed" && !(action && ["succeeded", "failed", "unknown"].includes(action.status)))
      events.push({ ...base, point: capability === "customer.custom_process" ? "completed" : "closed" });
  }
  return events;
}
