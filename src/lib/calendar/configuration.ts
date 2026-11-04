import { createServiceSupabase } from "@/lib/supabase/service";
import { defaultSettings, parseSettings, type CalendarSettings } from "./model";
export async function prepareCalendarConfiguration(businessId: string, patch: Record<string, unknown>) {
  const result = await createServiceSupabase().from("business_calendar_settings")
    .select("timezone,hours,closed_dates,confirmation_mode,agent_booking_enabled").eq("business_id", businessId).maybeSingle();
  if (result.error) throw Error("Cilësimet nuk u lexuan.");
  return { before: result.data, values: parseSettings({ ...(result.data ?? defaultSettings), ...patch } as CalendarSettings) };
}
export async function saveCalendarConfiguration(businessId: string, userId: string, proposal: Awaited<ReturnType<typeof prepareCalendarConfiguration>>) {
  const result = await createServiceSupabase().rpc("save_calendar_configuration", { p_business: businessId, p_user: userId, p_before: proposal.before, p_values: proposal.values });
  if (result.error) throw Error("Orari ndryshoi ose nuk u ruajt. Rishqyrto konfigurimin.");
  return { message: "Orari u ruajt.", path: "calendar" };
}
