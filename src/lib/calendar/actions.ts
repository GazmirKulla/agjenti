"use server";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import {
  localInstant,
  parseSettings,
  uuid,
  type CalendarSettings,
} from "./model";
import { googleConnection, syncBooking, writableCalendars } from "./google";
import { persistBooking } from "./service";
async function access(slug: string) {
  const user = await getSessionUser();
  const result = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!result) throw new Error("Nuk ke qasje në këtë biznes.");
  const profile = await loadDashboardProfile(result.business.id);
  if (!profile.enabledModules.includes("bookings"))
    throw new Error("Aktivizo Rezervimet te Cilësimet → Modulet.");
  return result.business.id;
}
function refresh(slug: string) {
  revalidatePath(`/b/${slug}/calendar`);
  revalidatePath(`/b/${slug}/bookings`);
}
export async function saveCalendarSettings(slug: string, form: FormData) {
  try {
    const id = await access(slug);
    const settings = parseSettings({
      timezone: String(form.get("timezone") ?? ""),
      hours: JSON.parse(String(form.get("hours") ?? "[]")),
      closed_dates: String(form.get("closedDates") ?? "")
        .split(/[\s,]+/)
        .filter(Boolean),
      confirmation_mode: form.get(
        "confirmationMode",
      ) as CalendarSettings["confirmation_mode"],
      agent_booking_enabled: form.get("agentBooking") === "on",
    });
    await createServiceSupabase()
      .from("business_calendar_settings")
      .upsert({
        business_id: id,
        ...settings,
        updated_at: new Date().toISOString(),
      })
      .throwOnError();
    refresh(slug);
    return { success: "Orari u ruajt." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Orari nuk u ruajt." };
  }
}
export async function saveBooking(slug: string, form: FormData) {
  try {
    const businessId = await access(slug),
      db = createServiceSupabase();
    const cfg = await db
      .from("business_calendar_settings")
      .select("timezone")
      .eq("business_id", businessId)
      .maybeSingle();
    if (cfg.error) throw new Error("Orari nuk u ngarkua.");
    const id = String(form.get("id") ?? "");
    const result = await persistBooking(businessId, {
      ...(id ? { id, revision: Number(form.get("revision")) } : {}),
      serviceId: String(form.get("service") ?? ""),
      name: String(form.get("name") ?? ""),
      contact: String(form.get("contact") ?? ""),
      start: localInstant(
        String(form.get("date") ?? ""),
        String(form.get("time") ?? ""),
        cfg.data?.timezone ?? "Europe/Tirane",
      ),
      status: form.get("status") as "pending" | "confirmed" | "cancelled",
      notes: String(form.get("notes") ?? ""),
      requestKey: id
        ? undefined
        : String(form.get("requestKey") ?? "") || undefined,
    });
    refresh(slug);
    return result.syncError
      ? { success: result.syncError }
      : {
          success:
            result.booking.status === "cancelled"
              ? "Rezervimi u anulua."
              : "Rezervimi u ruajt.",
        };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Rezervimi nuk u ruajt.",
    };
  }
}
export async function retryBookingSync(slug: string, form: FormData) {
  try {
    const businessId = await access(slug),
      id = String(form.get("id") ?? "");
    if (!uuid(id)) throw new Error("Rezervimi është i pavlefshëm.");
    await syncBooking(businessId, id);
    refresh(slug);
    return { success: "Sinkronizimi përfundoi." };
  } catch (err) {
    refresh(slug);
    return {
      error: err instanceof Error ? err.message : "Sinkronizimi dështoi.",
    };
  }
}
export async function selectGoogleCalendar(slug: string, form: FormData) {
  try {
    const businessId = await access(slug),
      connection = await googleConnection(businessId);
    if (!connection?.connected) throw new Error("Lidh Google Calendar.");
    const selected = (await writableCalendars(connection)).find(
      (c) => c.id === form.get("calendar"),
    );
    if (!selected)
      throw new Error("Zgjidh një kalendar ku ke leje për ndryshime.");
    const db = createServiceSupabase();
    // Keep the provider calendar stable once reservations are exported.
    if (connection.calendar_id && selected.id !== connection.calendar_id)
      throw new Error(
        "Takimet ekzistuese janë lidhur me këtë kalendar. Rishiko ato para ndryshimit të kalendarit.",
      );
    await db
      .from("google_calendar_connections")
      .update({ calendar_id: selected.id, calendar_name: selected.summary })
      .eq("business_id", businessId)
      .eq("id", connection.id)
      .throwOnError();
    refresh(slug);
    return {
      success: "Kalendari u zgjodh. Rezervimet e reja do të sinkronizohen.",
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Kalendari nuk u zgjodh.",
    };
  }
}
export async function disconnectGoogleCalendar(slug: string) {
  try {
    const businessId = await access(slug);
    await createServiceSupabase()
      .from("google_calendar_connections")
      .update({
        connected: false,
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .throwOnError();
    refresh(slug);
    return {
      success:
        "Lidhja u shkëput. Ngjarjet ekzistuese mbeten në Google Calendar.",
    };
  } catch {
    return { error: "Lidhja nuk u shkëput." };
  }
}
