import { createServiceSupabase } from "@/lib/supabase/service";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import { changeWorkflowBooking } from "@/lib/calendar/service";
import { localInstant, validDate, validTime } from "@/lib/calendar/model";
import { ownBookings, type OwnBooking } from "@/lib/calendar/own-bookings";
import type { OrderCustomerIdentity } from "@/lib/orders/own-orders";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { CustomerCommand, FactInput, Instance, Observation, ProcessDefinition, Value } from "./contracts";
import type { EffectResult, ToolAdapter } from "./execute";
import type { ProcessLease } from "./persistence";
import { bookingManageFields, noOwnBooking } from "./booking-manage-definition";
import { notifyOwnerOfBooking } from "@/lib/calendar/notices";

const summary = (bookings: OwnBooking[]) => JSON.stringify(bookings.map(b => ({ id: b.id, service: b.serviceName, date: b.date, time: b.time, status: b.status })));

/** The customer's own bookings for this turn: the only IDs the model may pick and the source of the reviewed facts. */
export function bookingManageContext(versions: VisualVersion[], bookings: OwnBooking[]) {
  const nodeIds = versions.flatMap(v => v.graph.nodes.filter(n => n.kind === "booking_manage").map(n => n.id));
  const changeable = bookings.filter(b => b.changeable);
  return {
    /** The definitions with the booking choice limited to this customer's own bookings. */
    definitions(definitions: ProcessDefinition[]): ProcessDefinition[] {
      if (!nodeIds.length) return definitions;
      const ids = new Set(nodeIds.map(id => bookingManageFields(id).key("bookingId")));
      const options = changeable.length ? changeable.map(b => b.id) : [noOwnBooking];
      // With one changeable booking there is nothing to choose: the server sets it, the customer is not asked
      // which one, and the review still shows it before anything changes. The step keeps its id, so an
      // instance waiting there moves on.
      const single = changeable.length === 1;
      const collectSteps = new Set(nodeIds.map(id => bookingManageFields(id).key("collect_booking")));
      return definitions.map(d => d.fields.some(f => ids.has(f.id)) ? { ...d,
        fields: d.fields.map(f => ids.has(f.id) ? { ...f, options, ...(single ? { source: "server" as const } : {}) } : f),
        steps: single ? d.steps.map(step => step.kind === "collect" && collectSteps.has(step.id) ? { id: step.id, kind: "resolve" as const, fieldIds: [step.fieldId], next: step.next } : step) : d.steps,
      } : d);
    },
    serverFacts(definition: ProcessDefinition, instance: Instance): Record<string, Value> {
      const result: Record<string, Value> = {};
      for (const nodeId of nodeIds) {
        const { key } = bookingManageFields(nodeId);
        if (!definition.fields.some(f => f.id === key("action"))) continue;
        result[key("changeable")] = changeable.length > 0;
        if (changeable.length === 1) result[key("bookingId")] = changeable[0].id;
        const booking = changeable.find(b => b.id === instance.facts[key("bookingId")]?.value);
        if (booking && booking.status !== "cancelled") Object.assign(result, { [key("serviceId")]: booking.serviceId, [key("serviceName")]: booking.serviceName,
          [key("startsAt")]: `${booking.date} ${booking.time}`, [key("status")]: booking.status, [key("bookingRevision")]: booking.revision });
      }
      return result;
    },
    /**
     * With one changeable booking the server sets which booking it is; a reading that names it too is
     * dropped here (the server's value stands), so it is not refused as a write to a server field.
     */
    withoutServerChoice(observation: Observation): Observation {
      if (changeable.length !== 1) return observation;
      const ids = new Set(nodeIds.map(id => bookingManageFields(id).key("bookingId")));
      const keep = (facts: FactInput[]) => facts.filter(fact => !ids.has(fact.fieldId));
      return { ...observation, commands: observation.commands.flatMap((command): CustomerCommand[] => {
        if (command.kind === "facts") { const values = keep(command.values); return values.length ? [{ ...command, values }] : []; }
        if (command.kind === "start" || command.kind === "accept_offer") return [{ ...command, initialFacts: keep(command.initialFacts) }];
        return [command];
      }) };
    },
    /** What the interpretation sees: the customer's own bookings, never anyone else's. */
    observation: bookings.map(b => ({ id: b.id, service: b.serviceName, date: b.date, time: b.time, status: b.status, changeable: b.changeable })),
  };
}

/** Reads the customer's bookings for this turn; empty without a verified channel identity (e.g. Chat Lab). */
export async function readOwnBookings(businessId: string, identity?: OrderCustomerIdentity): Promise<OwnBooking[]> {
  if (!identity || isIsolatedExecution()) return [];
  try { return await ownBookings(businessId, identity) ?? []; } catch { return []; }
}

type Scope = { businessId: string; conversationId: string; identity?: OrderCustomerIdentity; lease?: ProcessLease };
const inScope = (scope: Scope | undefined, context: { businessId: string; conversationId: string }) =>
  !isIsolatedExecution() && scope && scope.businessId === context.businessId && scope.conversationId === context.conversationId;

/** booking.mine: read only. Identity comes from the verified channel, never from the action input. */
export function bookingStatusAdapter(scope?: Scope): ToolAdapter {
  const read = async (): Promise<EffectResult> => {
    await requireRuntimeModules(scope!.businessId, ["bookings", "workflows"]);
    const identity = scope!.identity;
    if (!identity || identity.conversationId !== scope!.conversationId) return { status: "failed", output: { code: "customer_identity_unverified" } };
    const bookings = await ownBookings(scope!.businessId, identity);
    if (!bookings) return { status: "failed", output: { code: "customer_identity_unverified" } };
    return { status: "succeeded", output: { bookings: summary(bookings), count: bookings.length } };
  };
  return { key: "booking.mine", version: 1,
    async execute(_action, context) {
      if (!inScope(scope, context)) return { status: "failed", output: { code: "effect_scope_mismatch" } };
      try { return await read(); } catch { return { status: "failed", output: { code: "booking_status_unavailable" } }; }
    },
    async reconcile(_action, context) {
      if (!inScope(scope, context)) return null;
      try { return await read(); } catch { return null; }
    },
    async simulate() {
      recordExternalAction({ kind: "booking.status", disposition: "SIMULATED", detail: "no_customer_bookings_read" });
      return { bookings: "[]", count: 0, realBookingsRead: false };
    },
  };
}

/** booking.change: cancels or moves the customer's own booking after their confirmation. */
export function bookingChangeAdapter(scope?: Scope): ToolAdapter {
  return { key: "booking.change", version: 1,
    async execute(action, context): Promise<EffectResult> {
      if (!inScope(scope, context) || !scope?.lease) return { status: "failed", output: { code: "effect_scope_mismatch" } };
      const { action: kind, bookingId, bookingRevision, date, time } = action.input;
      if ((kind !== "cancel" && kind !== "reschedule") || typeof bookingId !== "string" || typeof bookingRevision !== "number"
        || kind === "reschedule" && (typeof date !== "string" || !validDate(date) || typeof time !== "string" || !validTime(time)))
        return { status: "failed", output: { code: "invalid_booking_change" } };
      const db = createServiceSupabase();
      const [settings, current] = await Promise.all([
        db.from("business_calendar_settings").select("timezone,agent_booking_enabled").eq("business_id", scope.businessId).maybeSingle(),
        db.from("bookings").select("service_id,starts_at").eq("business_id", scope.businessId).eq("id", bookingId).maybeSingle(),
      ]);
      if (settings.error || current.error || !current.data) return { status: "failed", output: { code: "booking_not_found" } };
      if (!settings.data?.agent_booking_enabled) return { status: "failed", output: { code: "agent_booking_disabled" } };
      let start: string | null = null;
      if (kind === "reschedule") {
        try {
          start = localInstant(date as string, time as string, settings.data.timezone);
          const { availableSlots } = await import("@/lib/calendar/service");
          const slots = await availableSlots(scope.businessId, current.data.service_id, date as string, bookingId);
          if (!slots.some(slot => Date.parse(slot.start) === Date.parse(start!))) return { status: "failed", output: { code: "slot_unavailable" } };
        } catch { return { status: "failed", output: { code: "availability_unverified" } }; }
      }
      if (context.signal.aborted) return { status: "failed", output: { code: "dispatch_cancelled" } };
      try {
        const result = await changeWorkflowBooking(scope.businessId, { bookingId, bookingRevision, action: kind, start, requestKey: `ig:${scope.conversationId}:${action.id}` },
          { ...scope.lease, conversationId: scope.conversationId, revision: context.revision });
        await notifyOwnerOfBooking(scope.businessId, { bookingId, conversationId: scope.conversationId, kind: kind === "cancel" ? "cancelled" : "moved",
          previousStartsAt: current.data.starts_at, ref: action.id }).catch(() => undefined);
        return { status: "succeeded", output: { bookingId, action: kind, status: result.booking.status, startsAt: result.booking.starts_at,
          serviceName: result.booking.service_name, calendarSync: result.syncError ? "unverified" : result.booking.sync_status } };
      } catch (error) {
        const code = error instanceof Error ? error.message : "booking_change_failed";
        // Definitive refusals from the database; anything else may have committed and is reconciled.
        if (["slot_unavailable", "booking_cancelled", "booking_started", "booking_not_owned", "booking_not_found", "stale_booking", "outside_hours", "invalid_date", "agent_booking_disabled", "sync_in_progress", "invalid_booking_change"].includes(code))
          return { status: "failed", output: { code } };
        throw error;
      }
    },
    async reconcile(action, context): Promise<EffectResult | null> {
      if (!inScope(scope, context)) return null;
      const { data, error } = await createServiceSupabase().from("workflow_booking_changes").select("booking_id,action,bookings(status,starts_at,service_name,sync_status)")
        .eq("business_id", scope!.businessId).eq("request_key", `ig:${scope!.conversationId}:${action.id}`).maybeSingle();
      const booking = (Array.isArray(data?.bookings) ? data?.bookings[0] : data?.bookings) as { status: string; starts_at: string; service_name: string; sync_status: string } | undefined;
      if (error || !data || !booking || data.booking_id !== action.input.bookingId || data.action !== action.input.action) return null;
      return { status: "succeeded", output: { bookingId: data.booking_id, action: data.action, status: booking.status, startsAt: booking.starts_at, serviceName: booking.service_name, calendarSync: booking.sync_status } };
    },
    async simulate(action) {
      recordExternalAction({ kind: "booking.change", disposition: "SIMULATED", detail: "process_runtime_not_changed" });
      return { bookingId: String(action.input.bookingId ?? ""), action: String(action.input.action ?? ""), status: "simulated" };
    },
  };
}
