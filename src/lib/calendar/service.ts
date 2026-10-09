import { createServiceSupabase } from "@/lib/supabase/service";
import {
  googleBusy,
  googleConnection,
  syncBooking,
  writableCalendars,
  type GoogleCalendar,
  type BusyPeriod,
} from "./google";
import {
  defaultSettings,
  localInstant,
  overlaps,
  slotCandidates,
  uuid,
  zonedParts,
  type Booking,
  type BookingService,
  type CalendarSettings,
} from "./model";
export const bookingColumns =
  "id,service_id,service_name,customer_name,customer_contact,starts_at,ends_at,blocked_until,status,notes,sync_status,google_event_id,google_calendar_id,revision";
export type CalendarData = {
  available: boolean;
  settings: CalendarSettings;
  services: BookingService[];
  bookings: Booking[];
  busy: BusyPeriod[];
  google: {
    connected: boolean;
    calendar_id: string | null;
    calendar_name: string | null;
  };
  calendars: GoogleCalendar[];
  googleError: string | null;
};
export async function loadCalendar(
  businessId: string,
  start: string,
  end: string,
): Promise<CalendarData> {
  const db = createServiceSupabase();
  const results = await Promise.all([
    db
      .from("business_calendar_settings")
      .select(
        "timezone,hours,closed_dates,confirmation_mode,agent_booking_enabled",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    db
      .from("booking_services")
      .select("id,name,duration_minutes,buffer_minutes,is_active")
      .eq("business_id", businessId)
      .order("name"),
    db
      .from("bookings")
      .select(bookingColumns)
      .eq("business_id", businessId)
      .lt("starts_at", end)
      .gt("blocked_until", start)
      .order("starts_at"),
  ]);
  const missing = results.some(
    (r) => r.error && ["42P01", "PGRST205"].includes(r.error.code),
  );
  const empty: CalendarData = {
    available: !missing,
    settings: defaultSettings,
    services: [],
    bookings: [],
    busy: [],
    google: { connected: false, calendar_id: null, calendar_name: null },
    calendars: [],
    googleError: null,
  };
  if (missing) return empty;
  if (results.some((r) => r.error))
    throw new Error("Kalendari nuk u ngarkua. Provo përsëri.");
  const connection = await googleConnection(businessId);
  let calendars: GoogleCalendar[] = [],
    busy: BusyPeriod[] = [],
    googleError: string | null = null;
  if (connection?.connected) {
    try {
      if (connection.calendar_id)
        busy = await googleBusy(businessId, start, end);
      else calendars = await writableCalendars(connection);
    } catch {
      googleError =
        "Google Calendar nuk u ngarkua. Lidhe përsëri ose provo më vonë; rezervimet kontrollohen përsëri para ruajtjes.";
    }
  }
  return {
    ...empty,
    settings: results[0].data ?? defaultSettings,
    services: results[1].data ?? [],
    bookings: results[2].data ?? [],
    busy,
    calendars,
    googleError,
    google: {
      connected: connection?.connected ?? false,
      calendar_id: connection?.calendar_id ?? null,
      calendar_name: connection?.calendar_name ?? null,
    },
  };
}
export async function availableSlots(
  businessId: string,
  serviceId: string,
  date: string,
) {
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
      .single(),
  ]);
  if (cfg.error || service.error)
    throw new Error("Shërbimi ose orari nuk është i disponueshëm.");
  const settings = cfg.data ?? defaultSettings;
  if (Date.parse(`${date}T12:00Z`) > Date.now() + 90 * 86400000) return [];
  const start = localInstant(date, "00:00", settings.timezone);
  const tomorrow = new Date(`${date}T12:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const end = localInstant(
    tomorrow.toISOString().slice(0, 10),
    "00:00",
    settings.timezone,
  );
  const [bookings, busy] = await Promise.all([
    db
      .from("bookings")
      .select("starts_at,blocked_until")
      .eq("business_id", businessId)
      .in("status", ["pending", "confirmed"])
      .lt("starts_at", end)
      .gt("blocked_until", start),
    googleBusy(businessId, start, end),
  ]);
  if (bookings.error) throw new Error("Orari nuk u verifikua.");
  return slotCandidates(date, service.data, settings).filter(
    (slot) =>
      ![
        ...(bookings.data ?? []).map((b) => ({
          start: b.starts_at,
          end: b.blocked_until,
        })),
        ...busy,
      ].some((b) => overlaps(slot.start, slot.blockedUntil, b.start, b.end)),
  );
}
const errorMessages: Record<string, string> = {
  agent_booking_disabled:
    "Rezervimet nga biseda janë të çaktivizuara. Kontakto biznesin.",
  stale_booking: "Rezervimi ndryshoi. Rifresko faqen dhe provo përsëri.",
  sync_in_progress: "Rezervimi po sinkronizohet. Provo përsëri pas pak.",
  outside_hours:
    "Zgjidh një orar brenda orarit të punës dhe jashtë ditëve të mbyllura.",
  invalid_date: "Zgjidh një orë të ardhshme, brenda 90 ditëve.",
  service_unavailable: "Shërbimi nuk është aktiv.",
  booking_cancelled: "Rezervimi është anuluar.",
  booking_not_found: "Rezervimi nuk u gjet.",
};
export type BookingInput = {
  id?: string;
  revision?: number;
  serviceId: string;
  name: string;
  contact: string;
  start: string;
  status: "pending" | "confirmed" | "cancelled";
  notes: string;
  requestKey?: string;
};
export async function persistBooking(businessId: string, input: BookingInput) {
  if (
    !uuid(input.serviceId) ||
    (input.id && !uuid(input.id)) ||
    input.name.trim().length < 2 ||
    input.name.length > 120 ||
    input.contact.length > 200 ||
    input.notes.length > 1000 ||
    !Number.isFinite(Date.parse(input.start)) ||
    !["pending", "confirmed", "cancelled"].includes(input.status) ||
    (input.id && (!Number.isInteger(input.revision) || input.revision! < 1)) ||
    (input.requestKey && input.requestKey.length > 200)
  )
    throw new Error("Kontrollo të dhënat e rezervimit.");
  const db = createServiceSupabase();
  if (input.requestKey) {
    const previous = await db
      .from("bookings")
      .select(bookingColumns)
      .eq("business_id", businessId)
      .eq("request_key", input.requestKey)
      .maybeSingle();
    if (previous.error) throw new Error("Nuk u verifikua kërkesa e mëparshme.");
    if (previous.data)
      return { booking: previous.data as Booking, syncError: null };
  }
  let existing: Booking | null = null;
  if (input.id) {
    const row = await db
      .from("bookings")
      .select(bookingColumns)
      .eq("business_id", businessId)
      .eq("id", input.id)
      .single();
    if (row.error || !row.data) throw new Error("Rezervimi nuk u gjet.");
    existing = row.data;
  }
  // Both pending and confirmed reservations hold a slot locally. Fail closed if Google cannot be checked.
  if (input.status !== "cancelled") {
    const service = await db
      .from("booking_services")
      .select("duration_minutes,buffer_minutes")
      .eq("business_id", businessId)
      .eq("id", input.serviceId)
      .single();
    if (service.error) throw new Error("Shërbimi nuk u gjet.");
    const blocked = new Date(
      Date.parse(input.start) +
        (service.data.duration_minutes + service.data.buffer_minutes) * 60000,
    ).toISOString();
    const busy = await googleBusy(
      businessId,
      input.start,
      blocked,
      existing?.google_event_id,
    );
    if (busy.some((b) => overlaps(input.start, blocked, b.start, b.end)))
      throw new Error("Ky orar është i zënë në Google Calendar.");
  }
  const result = await db.rpc("save_calendar_booking", {
    p_business: businessId,
    p_id: input.id ?? null,
    p_revision: input.revision ?? 0,
    p_service: input.serviceId,
    p_name: input.name,
    p_contact: input.contact,
    p_start: input.start,
    p_status: input.status,
    p_notes: input.notes,
    p_request_key: input.requestKey ?? null,
  });
  if (result.error) {
    if (result.error.code === "23P01")
      throw new Error("Ky orar sapo u rezervua. Zgjidh një tjetër.");
    throw new Error(
      errorMessages[result.error.message] ??
        "Rezervimi nuk u ruajt. Provo përsëri.",
    );
  }
  const booking = (
    Array.isArray(result.data) ? result.data[0] : result.data
  ) as Booking;
  let syncError: string | null = null;
  if (["pending", "error"].includes(booking.sync_status)) {
    try {
      await syncBooking(businessId, booking.id);
    } catch (err) {
      syncError = err instanceof Error ? err.message : "Sinkronizimi dështoi.";
    }
  }
  return { booking, syncError };
}
export function weekDates(date: string) {
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}
export function today(timezone: string) {
  return zonedParts(new Date(), timezone).date;
}
