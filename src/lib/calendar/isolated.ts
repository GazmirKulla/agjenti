import { createServiceSupabase } from "@/lib/supabase/service";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { recordExternalAction, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import {
  defaultSettings,
  slotCandidates,
  type BookingService,
  type CalendarSettings,
} from "./model";

/** Configuration-derived slots only. No Google, live bookings, or credential refresh. */
export async function isolatedAvailableSlots(
  businessId: string,
  serviceId: string,
  date: string,
  excludeBookingId?: string,
) {
  if (excludeBookingId) {
    refuseIsolatedEffect(
      "booking.availability",
      "cannot_inspect_live_booking",
    );
  }
  recordExternalAction({
    kind: "booking.availability",
    disposition: "SIMULATED",
    detail: "synthetic_hours",
  });
  await requireRuntimeModules(businessId, ["bookings", "services"]);
  const db = createServiceSupabase();
  const [cfg, service] = await Promise.all([
    db
      .from("business_calendar_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    db
      .from("booking_services")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", serviceId)
      .eq("is_active", true)
      .eq("booking_enabled", true)
      .single(),
  ]);
  if (cfg.error || service.error)
    throw new Error("Shërbimi ose orari nuk është i disponueshëm.");
  const settings = (cfg.data ?? defaultSettings) as CalendarSettings;
  if (Date.parse(`${date}T12:00Z`) > Date.now() + 90 * 86400000) return [];
  return slotCandidates(date, service.data as BookingService, settings);
}

export function isolatedPersistBooking(): never {
  refuseIsolatedEffect("booking.create", "missing_test_adapter");
}
