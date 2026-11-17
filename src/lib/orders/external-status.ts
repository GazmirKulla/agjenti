import type { SupabaseClient } from "@supabase/supabase-js";
import { STATUS_KEY, type ExternalOrderView } from "@/lib/integrations/zana";

/** The website's status of an order, as Agjenti keeps it; `at` orders notices that arrive late. */
export type ExternalStatus = { status: string; label: string; at: string };

/** A status the website sent: a safe key, its name (or the key) and a valid time. Null otherwise. */
export function readExternalStatus(input: { status?: unknown; statusLabel?: unknown; changedAt?: unknown }, now = new Date()): ExternalStatus | null {
  if (typeof input.status !== "string" || !STATUS_KEY.test(input.status)) return null;
  const label = typeof input.statusLabel === "string" && input.statusLabel.trim() ? input.statusLabel.trim().slice(0, 80) : input.status;
  const time = typeof input.changedAt === "string" ? Date.parse(input.changedAt) : Number.NaN;
  // A time from the future would block every later notice: the arrival time is used instead.
  const at = Number.isFinite(time) && time <= now.getTime() + 5 * 60_000 ? new Date(time) : now;
  return { status: input.status, label, at: at.toISOString() };
}

/** The status in an order read from the website, timed now (what the website holds at this moment). */
export function statusOfView(view: ExternalOrderView, now = new Date()): ExternalStatus | null {
  return view.status ? readExternalStatus({ status: view.status, statusLabel: view.statusLabel }, now) : null;
}

/**
 * Keeps the website's status of this business's order sent there as `externalOrderId`.
 * An older notice never replaces a newer one. True when an order of this business was updated.
 */
export async function recordExternalStatus(db: SupabaseClient, businessId: string, externalOrderId: string, status: ExternalStatus): Promise<boolean> {
  const { data, error } = await db.from("orders")
    .update({ external_status: status.status, external_status_label: status.label, external_status_at: status.at })
    .eq("business_id", businessId).eq("external_system", "external").eq("external_order_id", externalOrderId)
    .or(`external_status_at.is.null,external_status_at.lte.${status.at}`)
    .select("id");
  if (error) throw new Error("external_status_write_failed");
  return (data ?? []).length > 0;
}
