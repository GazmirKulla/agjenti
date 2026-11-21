import { actions } from "@/lib/business-assistant/model";
import { operationCatalog } from "@/lib/actions/operations/catalog";
import { scheduledJobCapability, scheduledJobs } from "./scheduled-jobs";

export { scheduledJobCapability, scheduledJobs };

/**
 * Every capability the agents have, with its entry and its exits. Only these can be recorded
 * (recordCapabilityEvents rejects anything else), and the coverage test fails when a capability the code
 * offers has no entry here, or when a declared exit is never emitted by the file named in `emittedBy`.
 *
 * An exit's outcome says how it counts: success, failure, handoff (to staff), or neutral (nothing to judge,
 * e.g. the customer closed the request or a message needed no reply).
 */
export type Outcome = "success" | "failure" | "handoff" | "neutral";
export type AgentKind = "customer" | "assistant" | "system";
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
  "customer.voice": { agent: "customer", module: "inbox", label: "Lexon mesazhet zanore dhe videot", entry: null,
    exits: { transcribed: "success", not_heard: "failure" }, emittedBy: ["src/lib/conversations/handle-inbound.ts"] },
  "customer.escalation": { agent: "customer", module: "inbox", label: "Kupton kur klientit i duhet një person", entry: null,
    exits: { handed_off: "handoff", notified: "handoff" }, emittedBy: ["src/lib/conversations/handle-inbound.ts"] },
  "customer.order": { agent: "customer", module: "orders", label: "Merr porosi", entry: "started",
    exits: { registered: "success", collected: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.order_status": { agent: "customer", module: "orders", label: "Tregon statusin e porosisë", entry: "started",
    exits: { answered: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.booking": { agent: "customer", module: "bookings", label: "Rezervon", entry: "started",
    exits: { booked: "success", requested: "success", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
    emittedBy: [processEvents] },
  "customer.booking_manage": { agent: "customer", module: "bookings", label: "Statusi, anulimi dhe zhvendosja e rezervimit nga klienti", entry: "started",
    exits: { answered: "success", cancelled: "success", moved: "success", no_booking: "neutral", closed: "neutral", blocked: "failure", failed: "failure", handed_off: "handoff", ...abandoned },
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
  "booking.mine": "customer.booking_manage",
  "booking.change": "customer.booking_manage",
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

const systemEvents = "src/lib/tracking/system-events.ts";
const scheduledCapabilities: Record<string, CapabilitySpec> = Object.fromEntries(Object.entries(scheduledJobs).map(([job, label]) =>
  [scheduledJobCapability(job), { agent: "system", module: "jobs", label, entry: null, exits: { completed: "success", failed: "failure" },
    emittedBy: [`src/app/api/cron/${job}/route.ts`, systemEvents] } satisfies CapabilitySpec]));

/** Platform work behind the agents: background jobs of one business and integrations with other services. */
export const systemCapabilities: Record<string, CapabilitySpec> = {
  "system.discovery": { agent: "system", module: "jobs", label: "Analiza e biznesit (Instagram, website)", entry: null,
    exits: { completed: "success", step_failed: "failure" }, emittedBy: ["src/lib/discovery/queue.ts", systemEvents] },
  "system.training": { agent: "system", module: "jobs", label: "Importi dhe analiza e bisedave", entry: null,
    exits: { completed: "success", step_failed: "failure" }, emittedBy: ["src/lib/conversation-training/job.ts", systemEvents] },
  "system.source_refresh": { agent: "system", module: "jobs", label: "Rifreskimi i burimeve të një biznesi", entry: null,
    exits: { queued: "success", failed: "failure" }, emittedBy: ["src/app/api/cron/source-refresh/route.ts"] },
  "system.instagram_connect": { agent: "system", module: "integrations", label: "Lidhja me Instagram", entry: null,
    exits: { connected: "success", webhook_failed: "failure", profile_incomplete: "failure", failed: "failure" }, emittedBy: ["src/app/api/instagram/oauth/callback/route.ts"] },
  "system.instagram_token": { agent: "system", module: "integrations", label: "Token-i i Instagram (rifreskimi dhe vlefshmëria)", entry: null,
    exits: { refreshed: "success", refresh_failed: "failure", token_rejected: "failure" }, emittedBy: ["src/app/api/cron/refresh-instagram-tokens/route.ts", "src/lib/instagram/token-health.ts"] },
  "system.whatsapp_connect": { agent: "system", module: "integrations", label: "Lidhja me WhatsApp", entry: null,
    exits: { connected: "success", failed: "failure" }, emittedBy: ["src/app/api/businesses/[id]/whatsapp/connect/route.ts"] },
  "system.google_connect": { agent: "system", module: "integrations", label: "Lidhja me Google Calendar", entry: null,
    exits: { connected: "success", failed: "failure" }, emittedBy: ["src/app/api/calendar/google/callback/route.ts"] },
  "system.google_sync": { agent: "system", module: "integrations", label: "Rezervimi në Google Calendar", entry: null,
    exits: { synced: "success", failed: "failure" }, emittedBy: ["src/lib/calendar/google.ts"] },
  "system.pok_payment": { agent: "system", module: "integrations", label: "Pagesa me POK", entry: null,
    exits: { checkout_opened: "success", checkout_failed: "failure", paid: "success", payment_failed: "failure", left_unpaid: "neutral" }, emittedBy: ["src/lib/billing/payments.ts"] },
  "system.order_dispatch": { agent: "system", module: "integrations", label: "Dërgimi i porosisë te webi i biznesit", entry: null,
    exits: { accepted: "success", rejected: "failure", unverified: "failure", local_only: "neutral" }, emittedBy: ["src/lib/integrations/zana.ts"] },
  "system.catalog_index": { agent: "system", module: "jobs", label: "Analiza e një katalogu", entry: null,
    exits: { completed: "success", step_failed: "failure" }, emittedBy: ["src/app/api/catalogs/[id]/index/route.ts", systemEvents] },
  "system.prospect_scan": { agent: "system", module: "jobs", label: "Leximi i profilit të një klienti", entry: null,
    exits: { read: "success", not_found: "neutral", failed: "failure" }, emittedBy: ["src/lib/prospects/instagram-scan.ts"] },
  "system.account_deletion": { agent: "system", module: "jobs", label: "Fshirja e një llogarie", entry: null,
    exits: { completed: "success", step_failed: "failure" }, emittedBy: ["src/lib/account/deletion.ts"] },
  "system.booking_message": { agent: "system", module: "integrations", label: "Mesazhi për klientin për rezervimin (kujtesë ose vendim i stafit)", entry: null,
    exits: { sent: "success", skipped_window: "neutral", failed: "failure" }, emittedBy: ["src/lib/calendar/notices.ts"] },
  "system.mobile_push": { agent: "system", module: "integrations", label: "Njoftimi në celular", entry: null,
    exits: { delivered: "success", step_failed: "failure" }, emittedBy: ["src/lib/mobile/notifications.ts"] },
  ...scheduledCapabilities,
};

export type CustomerCapability = keyof typeof customerCapabilities;
export const capabilities: Record<string, CapabilitySpec> = { ...customerCapabilities, ...assistantCapabilities, ...systemCapabilities };

/** The outcome a point counts as, or null when the capability does not declare it. */
export function outcomeOf(capability: string, point: string): Outcome | "entry" | null {
  const spec = capabilities[capability];
  if (!spec) return null;
  if (point === spec.entry) return "entry";
  return (spec.exits as Record<string, Outcome>)[point] ?? null;
}
