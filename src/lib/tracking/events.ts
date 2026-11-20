import { createServiceSupabase } from "@/lib/supabase/service";
import { capabilities, outcomeOf } from "./capabilities";

/**
 * One entry or exit of a capability. Codes only: never message text or personal data. `ref` ties an
 * entry to its exit (a process instance, an Assistant request); `reason` is the server's code.
 */
export type CapabilityEvent = {
  /** Null only for platform work that serves no single business (a scheduled run). */
  businessId: string | null;
  capability: string;
  point: string;
  reason?: string;
  mode: "live" | "test";
  conversationId?: string;
  ref?: string;
  durationMs?: number;
};

const safeCode = (value: string | undefined) => value === undefined ? null : /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : "other";

/** The rows to store, or an error naming the first event the capability list does not declare. */
export function capabilityRows(events: CapabilityEvent[]) {
  return events.map(event => {
    const outcome = outcomeOf(event.capability, event.point);
    if (!outcome) throw new Error(`undeclared_capability_point:${event.capability}:${event.point}`);
    if (!event.businessId && capabilities[event.capability].agent !== "system") throw new Error(`capability_without_business:${event.capability}`);
    return { business_id: event.businessId, agent: capabilities[event.capability].agent, capability: event.capability, point: event.point,
      outcome, reason: safeCode(event.reason), mode: event.mode, conversation_id: event.conversationId ?? null,
      ref: event.ref ? event.ref.slice(0, 200) : null, duration_ms: event.durationMs ?? null };
  });
}

/**
 * Records events after the work they describe is committed. Measurement never changes the outcome for the
 * customer or the owner: a failure to record is swallowed (and logged), never thrown.
 */
export async function recordCapabilityEvents(events: CapabilityEvent[]) {
  if (!events.length) return;
  try {
    const { error } = await createServiceSupabase().from("capability_events").insert(capabilityRows(events));
    if (error) console.error("capability_events_insert_failed", error.code);
  } catch (error) {
    console.error("capability_events_unavailable", error instanceof Error ? error.message : "unknown");
  }
}
