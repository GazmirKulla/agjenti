import { actions } from "@/lib/business-assistant/model";
import { operationCatalog } from "@/lib/actions/operations/catalog";

/**
 * Every capability the agents have, with its entry and its exits. Only these can be recorded
 * (recordCapabilityEvents rejects anything else), and the coverage test fails when a capability the code
 * offers has no entry here, or when a declared exit is never emitted by the file named in `emittedBy`.
 *
 * An exit's outcome says how it counts: success, failure, handoff (to staff), or neutral (nothing to judge,
 * e.g. the customer closed the request or a message needed no reply).
 */
export type Outcome = "success" | "failure" | "handoff" | "neutral";
export type AgentKind = "customer" | "assistant";
export type CapabilitySpec = {
  agent: AgentKind;
  module: string;
  label: string;
  /** The point recorded when the capability starts; null when it has none (a reply only ends). */
  entry: string | null;
  exits: Record<string, Outcome>;
  /** Source files that emit this capability's points (checked by the coverage test). */
  emittedBy: string[];
};

const processEvents = "src/lib/tracking/process-events.ts";
/** Ended by the daily job when a started process never reached an exit. */
const abandoned = { abandoned: "failure" } as const;

export const customerCapabilities = {
  "customer.reply": { agent: "customer", module: "inbox", label: "Përgjigjja te klienti", entry: null,
    exits: { sent: "success", ignored: "neutral", failed: "failure", attempt_failed: "failure" },
    emittedBy: ["src/lib/conversations/workflow-queue.ts"] },
  "customer.order": { agent: "customer", module: "orders", label: "Merr porosi", entry: "started",
    exits: { registered: "success", collected: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.order_status": { agent: "customer", module: "orders", label: "Tregon statusin e porosisë", entry: "started",
    exits: { answered: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.booking": { agent: "customer", module: "bookings", label: "Rezervon", entry: "started",
    exits: { booked: "success", requested: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.handoff": { agent: "customer", module: "inbox", label: "Ia kalon bisedën stafit", entry: "started",
    exits: { handed_off: "handoff", closed: "neutral", blocked: "failure", failed: "failure", ...abandoned },
    emittedBy: [processEvents] },
  "customer.business_action": { agent: "customer", module: "workflows", label: "Veprim i biznesit nga procesi i personalizuar", entry: "started",
    exits: { completed: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.custom_process": { agent: "customer", module: "workflows", label: "Procesi i personalizuar (pa veprim)", entry: "started",
    exits: { completed: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
} as const satisfies Record<string, CapabilitySpec>;

/** Which customer capability a process effect belongs to. A tool missing here is reported as untracked. */
export const processToolCapability: Record<string, keyof typeof customerCapabilities> = {
  "order.create": "customer.order",
  "orders.status": "customer.order_status",
  "booking.create": "customer.booking",
  "business.provision": "customer.business_action",
};

const assistantExits = { proposed: "neutral", answered: "neutral", clarified: "neutral", refused: "failure", failed: "failure", executed: "success", execution_failed: "failure" } as const;
const assistantModule = (key: string) => (operationCatalog as Record<string, { module?: string }>)[key]?.module ?? key.split(/[._]/)[0];
/** The Assistant's capabilities come from its own action and operation lists, so a new one is tracked by construction. */
export const assistantCapabilityIds = [
  // "assistant.operation" holds an operation whose key could not be read.
  ...actions.map(action => `assistant.${action}`),
  ...Object.keys(operationCatalog).map(key => `assistant.${key}`),
];
const assistantCapabilities: Record<string, CapabilitySpec> = Object.fromEntries(assistantCapabilityIds.map(id => {
  const key = id.slice("assistant.".length);
  const operation = (operationCatalog as Record<string, { title?: string }>)[key];
  return [id, { agent: "assistant", module: assistantModule(key), label: operation?.title ?? key, entry: "requested", exits: assistantExits,
    emittedBy: ["src/lib/tracking/assistant-events.ts"] } satisfies CapabilitySpec];
}));

export type CustomerCapability = keyof typeof customerCapabilities;
export const capabilities: Record<string, CapabilitySpec> = { ...customerCapabilities, ...assistantCapabilities };

/** The outcome a point counts as, or null when the capability does not declare it. */
export function outcomeOf(capability: string, point: string): Outcome | "entry" | null {
  const spec = capabilities[capability];
  if (!spec) return null;
  if (point === spec.entry) return "entry";
  return (spec.exits as Record<string, Outcome>)[point] ?? null;
}
