import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { validDate, zonedParts } from "@/lib/calendar/model";
import { loadCalendar, loadPendingBookings } from "@/lib/calendar/service";
import { googleConfigured } from "@/lib/calendar/google";
import { calendarModes, type CalendarMode } from "./booking-calendar-modes";
import { CalendarWorkspace } from "./workspace";
export async function CalendarPageContent({
  slug,
  date: requestedDate,
  mode: requestedMode,
  view,
  google,
  service,
}: {
  slug: string;
  date?: string;
  mode?: string;
  view: "calendar" | "bookings";
  google?: string;
  service?: string;
}) {
  const { access } = await requireEnabledModule(slug, view);
  const [data, pending] = await Promise.all([
    loadCalendar(access.business.id),
    loadPendingBookings(access.business.id).catch(() => null),
  ]);
  const date =
    requestedDate && validDate(requestedDate)
      ? requestedDate
      : zonedParts(new Date(), data.settings.timezone).date;
  const mode: CalendarMode | undefined = calendarModes.find(m => m === requestedMode);
  const notices: Record<string, string> = {
    connected: "Google u lidh. Zgjidh kalendarin në konfigurim.",
    cancelled: "Lidhja me Google u ndërpre.",
    error:
      "Google nuk u lidh. Kontrollo lejet dhe përdor të njëjtën llogari nëse po rilidh kalendarin.",
    unavailable: "Google Calendar nuk është konfiguruar nga administratori.",
  };
  return (
    <CalendarWorkspace
      data={data}
      pending={pending}
      slug={access.business.slug}
      date={date}
      mode={mode}
      view={view}
      googleConfigured={googleConfigured()}
      initialService={
        service && data.services.some((s) => s.id === service && s.is_active && s.booking_enabled !== false)
          ? service
          : undefined
      }
      googleNotice={google ? notices[google] : undefined}
    />
  );
}
