export type Hours = { day: number; start: string; end: string };
export type CalendarSettings = {
  timezone: string;
  hours: Hours[];
  closed_dates: string[];
  confirmation_mode: "manual" | "automatic";
  agent_booking_enabled: boolean;
};
export type BookingService = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  booking_enabled?: boolean;
  hours?: Hours[] | null;
};
export type Booking = {
  id: string;
  service_id: string;
  service_name: string;
  customer_name: string;
  customer_contact: string;
  starts_at: string;
  ends_at: string;
  blocked_until: string;
  status: "pending" | "confirmed" | "cancelled";
  notes: string;
  sync_status: "local" | "pending" | "synced" | "error";
  google_event_id: string | null;
  google_calendar_id: string | null;
  revision: number;
};
export const defaultSettings: CalendarSettings = {
  timezone: "Europe/Tirane",
  hours: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })),
  closed_dates: [],
  confirmation_mode: "manual",
  agent_booking_enabled: false,
};
export const dayNames = [
  "E diel",
  "E hënë",
  "E martë",
  "E mërkurë",
  "E enjte",
  "E premte",
  "E shtunë",
];
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export function validDate(value: string) {
  const at = new Date(`${value}T12:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(at.getTime()) &&
    at.toISOString().slice(0, 10) === value
  );
}
export function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function zonedParts(instant: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
/** Reject nonexistent and ambiguous DST wall times rather than silently shifting appointments. */
export function localInstant(date: string, time: string, timezone: string) {
  if (!validDate(date) || !validTime(time))
    throw new Error("Data ose ora është e pavlefshme.");
  const naive = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const at = naive + delta,
      parts = zonedParts(new Date(at), timezone);
    offsets.add(Date.parse(`${parts.date}T${parts.time}:00Z`) - at);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((at) => {
      const parts = zonedParts(at, timezone);
      return parts.date === date && parts.time === time;
    });
  if (candidates.length !== 1)
    throw new Error(
      "Kjo orë është e paqartë për shkak të ndryshimit të orës. Zgjidh një orë tjetër.",
    );
  return candidates[0].toISOString();
}
export function parseSettings(input: CalendarSettings): CalendarSettings {
  try {
    new Intl.DateTimeFormat("sq", { timeZone: input.timezone }).format();
  } catch {
    throw new Error("Zona kohore është e pavlefshme.");
  }
  if (!Array.isArray(input.hours) || input.hours.length > 28)
    throw new Error("Orari është i pavlefshëm.");
  const hours = input.hours
    .map((h) => {
      if (
        !Number.isInteger(h.day) ||
        h.day < 0 ||
        h.day > 6 ||
        !validTime(h.start) ||
        !validTime(h.end) ||
        h.end <= h.start
      )
        throw new Error("Ora e mbylljes duhet të jetë pas hapjes.");
      return { day: h.day, start: h.start, end: h.end };
    })
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  if (
    hours.some(
      (h, i) =>
        i > 0 && hours[i - 1].day === h.day && hours[i - 1].end > h.start,
    )
  )
    throw new Error("Intervalet e punës mbivendosen.");
  if (
    !Array.isArray(input.closed_dates) ||
    input.closed_dates.length > 366 ||
    input.closed_dates.some((d) => !validDate(d))
  )
    throw new Error("Ditët e mbyllura janë të pavlefshme.");
  if (!["manual", "automatic"].includes(input.confirmation_mode))
    throw new Error("Zgjidh mënyrën e konfirmimit.");
  return {
    timezone: input.timezone,
    hours,
    closed_dates: [...new Set(input.closed_dates)],
    confirmation_mode: input.confirmation_mode,
    agent_booking_enabled: input.agent_booking_enabled === true,
  };
}
export function fitsHours(
  startsAt: string,
  blockedUntil: string,
  settings: CalendarSettings,
) {
  const start = zonedParts(startsAt, settings.timezone),
    end = zonedParts(blockedUntil, settings.timezone);
  if (start.date !== end.date || settings.closed_dates.includes(start.date))
    return false;
  const day = new Date(`${start.date}T12:00:00Z`).getUTCDay();
  return settings.hours.some(
    (h) => h.day === day && start.time >= h.start && end.time <= h.end,
  );
}
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) {
  return (
    Date.parse(aStart) < Date.parse(bEnd) &&
    Date.parse(bStart) < Date.parse(aEnd)
  );
}
export function slotCandidates(
  date: string,
  service: BookingService,
  settings: CalendarSettings,
  now = Date.now(),
) {
  if (
    !validDate(date) ||
    settings.closed_dates.includes(date) ||
    service.booking_enabled === false
  )
    return [];
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const slots: { start: string; end: string; blockedUntil: string }[] = [];
  for (const h of settings.hours.filter((h) => h.day === day)) {
    const minutes = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    for (
      let min = minutes(h.start);
      min + service.duration_minutes + service.buffer_minutes <= minutes(h.end);
      min += 15
    ) {
      try {
        const start = localInstant(
          date,
          `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`,
          settings.timezone,
        );
        const end = new Date(
          Date.parse(start) + service.duration_minutes * 60000,
        ).toISOString();
        const blockedUntil = new Date(
          Date.parse(end) + service.buffer_minutes * 60000,
        ).toISOString();
        if (
          Date.parse(start) > now &&
          fitsHours(start, blockedUntil, settings) &&
          (service.hours == null ||
            fitsHours(start, blockedUntil, {
              ...settings,
              hours: service.hours,
            }))
        )
          slots.push({ start, end, blockedUntil });
      } catch {
        /* Skip DST gaps and ambiguous times. */
      }
    }
  }
  return slots;
}
