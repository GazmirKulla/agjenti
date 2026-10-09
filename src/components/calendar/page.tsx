import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { createServiceSupabase } from "@/lib/supabase/service";
import { defaultSettings, validDate, zonedParts } from "@/lib/calendar/model";
import { loadCalendar, weekDates } from "@/lib/calendar/service";
import { googleConfigured } from "@/lib/calendar/google";
import { CalendarWorkspace } from "./workspace";
export async function CalendarPageContent({
  slug,
  date: requestedDate,
  view,
  google,
  service,
}: {
  slug: string;
  date?: string;
  view: "calendar" | "bookings";
  google?: string;
  service?: string;
}) {
  const { access } = await requireEnabledModule(slug, view);
  const result = await createServiceSupabase()
    .from("business_calendar_settings")
    .select("timezone")
    .eq("business_id", access.business.id)
    .maybeSingle();
  const timezone = result.data?.timezone ?? defaultSettings.timezone;
  const date =
    requestedDate && validDate(requestedDate)
      ? requestedDate
      : zonedParts(new Date(), timezone).date;
  const days = weekDates(date);
  // Cover the week in every supported IANA time zone; UI groups by the business zone.
  const start = new Date(
    Date.parse(`${days[0]}T00:00Z`) - 86400000,
  ).toISOString();
  const end = new Date(
    Date.parse(`${days[6]}T00:00Z`) + 2 * 86400000,
  ).toISOString();
  const data = await loadCalendar(access.business.id, start, end);
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
      slug={access.business.slug}
      date={date}
      days={days}
      view={view}
      googleConfigured={googleConfigured()}
      initialService={
        data.services.find(
          (s) => s.id === service && s.is_active && s.booking_enabled !== false,
        )?.id
      }
      googleNotice={google ? notices[google] : undefined}
    />
  );
}
