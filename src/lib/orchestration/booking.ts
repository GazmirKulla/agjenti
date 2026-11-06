import { createServiceSupabase } from "@/lib/supabase/service";
import { availableSlots, persistBooking } from "@/lib/calendar/service";
import { defaultSettings, localInstant, validDate, validTime } from "@/lib/calendar/model";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import { digest } from "./definition";
import { TransitionError } from "./contracts";
import type { EffectResult, ToolAdapter } from "./execute";
import type { ProcessLease } from "./persistence";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
import { compileVisualProcesses } from "./visual-definition";
import { bookingFields } from "./booking-definition";

export type BookingTerms = { serviceId: string; serviceName: string; durationMinutes: number; bufferMinutes: number; timezone: string; confirmationMode: "manual" | "automatic" };
export async function readBookingTerms(businessId: string, serviceId: string, collectionOnly = false): Promise<BookingTerms> {
  await requireRuntimeModules(businessId, collectionOnly ? ["services"] : ["bookings", "services"]);
  const db = createServiceSupabase();
  let query = db.from("booking_services").select("id,name,duration_minutes,buffer_minutes").eq("business_id", businessId).eq("id", serviceId).eq("is_active", true);
  if (!collectionOnly) query = query.eq("booking_enabled", true);
  const [service, settings] = await Promise.all([
    query.maybeSingle(),
    db.from("business_calendar_settings").select("timezone,confirmation_mode,agent_booking_enabled").eq("business_id", businessId).maybeSingle(),
  ]);
  if (service.error || settings.error || !service.data || !collectionOnly && !settings.data?.agent_booking_enabled) throw new TransitionError("booking_unavailable");
  const calendar = settings.data ?? defaultSettings;
  return { serviceId: service.data.id, serviceName: service.data.name, durationMinutes: service.data.duration_minutes,
    bufferMinutes: service.data.buffer_minutes, timezone: calendar.timezone, confirmationMode: calendar.confirmation_mode };
}

/** The reviewed terms are server fields; customer observations cannot set them. */
export function bookingAdapter(scope?: { businessId: string; conversationId: string; lease: ProcessLease;
  definitionForInstance: (id: string) => { versionId: string; definitionId: string } | undefined }): ToolAdapter {
  return { key: "booking.create", version: 1,
    async execute(action, context): Promise<EffectResult> {
      if (isIsolatedExecution() || !scope || scope.businessId !== context.businessId || scope.conversationId !== context.conversationId) throw new TransitionError("effect_scope_mismatch");
      const { serviceId, date, time, name, contact } = action.input;
      if (typeof serviceId !== "string" || typeof date !== "string" || !validDate(date) || typeof time !== "string" || !validTime(time)
        || typeof name !== "string" || typeof contact !== "string") return { status: "failed", output: { code: "invalid_booking_input" } };
      try {
        const identity = scope.definitionForInstance(action.instanceId);
        const version = identity && await loadVisualVersion(scope.businessId, identity.versionId);
        const definition = version && compileVisualProcesses(version).find(d => d.id === identity!.definitionId);
        const node = version?.graph.nodes.find(n => n.kind === "booking" && bookingFields(n.id).key("create") === action.stepId);
        const step = definition?.steps.find(s => s.id === action.stepId);
        const flow = version?.graph.version === 2 ? version.graph.flows.find(f => f.nodeIds.includes(node?.id ?? "")) : undefined;
        if (!node || step?.kind !== "effect" || step.tool !== "booking.create" || flow?.serviceIds?.length && !flow.serviceIds.includes(serviceId))
          return { status: "failed", output: { code: "booking_definition_unavailable" } };
      } catch { return { status: "failed", output: { code: "booking_definition_unavailable" } }; }
      // Failures before dispatch are definitive. A failure inside persistBooking is uncertain
      // because either the booking or an external calendar event might have committed.
      let current: BookingTerms;
      try { current = await readBookingTerms(scope.businessId, serviceId); }
      catch { return { status: "failed", output: { code: "booking_terms_unavailable" } }; }
      const reviewed = Object.fromEntries(Object.keys(current).map(key => [key, action.input[key]]));
      if (digest(current) !== digest(reviewed)) return { status: "failed", output: { code: "booking_terms_changed" } };
      const start = localInstant(date, time, current.timezone);
      try {
        const slots = await availableSlots(scope.businessId, serviceId, date);
        if (!slots.some(slot => Date.parse(slot.start) === Date.parse(start))) return { status: "failed", output: { code: "slot_unavailable" } };
      } catch { return { status: "failed", output: { code: "availability_unverified" } }; }
      if (context.signal.aborted) return { status: "failed", output: { code: "dispatch_cancelled" } };
      const result = await persistBooking(scope.businessId, { serviceId, name, contact, start, notes: "",
        status: current.confirmationMode === "automatic" ? "confirmed" : "pending", requestKey: `ig:${scope.conversationId}:${action.id}` },
        { ...scope.lease, conversationId: scope.conversationId, revision: context.revision });
      return { status: "succeeded", output: { bookingId: result.booking.id, status: result.booking.status,
        startsAt: result.booking.starts_at, serviceName: result.booking.service_name, calendarSync: result.syncError ? "unverified" : result.booking.sync_status } };
    },
    async reconcile(action, context): Promise<EffectResult | null> {
      if (isIsolatedExecution() || !scope || scope.businessId !== context.businessId || scope.conversationId !== context.conversationId) return null;
      const { data, error } = await createServiceSupabase().from("bookings").select("id,status,starts_at,service_name,sync_status,service_id,customer_name,customer_contact")
        .eq("business_id", scope.businessId).eq("request_key", `ig:${scope.conversationId}:${action.id}`).maybeSingle();
      if (error || !data || data.service_id !== action.input.serviceId || data.customer_name !== String(action.input.name).trim() || data.customer_contact !== String(action.input.contact).trim()) return null;
      return { status: "succeeded", output: { bookingId: data.id, status: data.status, startsAt: data.starts_at, serviceName: data.service_name, calendarSync: data.sync_status } };
    },
    async simulate() {
      recordExternalAction({ kind: "booking.create", disposition: "SIMULATED", detail: "process_runtime_not_booked" });
      return { bookingId: "simulation", status: "simulated", availability: "unverified" };
    },
  };
}
