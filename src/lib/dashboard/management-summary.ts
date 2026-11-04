import { createServiceSupabase } from "@/lib/supabase/service";
import { defaultSettings, zonedParts } from "@/lib/calendar/model";
import type { ModuleId } from "./modules/types";

export type UpcomingBooking = { id: string; customer_name: string; service_name: string; starts_at: string; status: string; date: string; time: string };
export type ManagementSummary = {
  orders: { confirmed: number; review: number } | null;
  bookings: { items: UpcomingBooking[]; timezone: string } | null;
};
/** Call only after verifying membership; modules are server-resolved entitlements. */
export async function loadManagementSummary(businessId: string, modules: readonly ModuleId[], now = new Date()): Promise<ManagementSummary> {
  const db = createServiceSupabase();
  const [orders, bookings] = await Promise.all([
    (async () => {
      if (!modules.includes("orders")) return null;
      try {
        const count = (statuses: string[]) => db.from("orders").select("id", { count: "exact", head: true })
          .eq("business_id", businessId).in("status", statuses);
        const [confirmed, review] = await Promise.all([count(["confirmed"]), count(["failed", "pending_reconciliation"])]);
        if (confirmed.error || review.error || confirmed.count === null || review.count === null) return null;
        return { confirmed: confirmed.count, review: review.count };
      } catch { return null; }
    })(),
    (async () => {
      if (!modules.includes("bookings")) return null;
      try {
        const [result, settings] = await Promise.all([
          db.from("bookings").select("id,customer_name,service_name,starts_at,status")
            .eq("business_id", businessId).in("status", ["pending", "confirmed"])
            .gte("starts_at", now.toISOString()).order("starts_at").limit(5),
          db.from("business_calendar_settings").select("timezone").eq("business_id", businessId).maybeSingle(),
        ]);
        if (result.error || settings.error || !result.data) return null;
        const timezone = settings.data?.timezone ?? defaultSettings.timezone;
        const formatter = new Intl.DateTimeFormat("sq-AL", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const items = result.data.map(row => ({ ...row, date: zonedParts(new Date(row.starts_at), timezone).date, time: formatter.format(new Date(row.starts_at)) }));
        return { items, timezone };
      } catch { return null; }
    })(),
  ]);
  return { orders, bookings };
}
