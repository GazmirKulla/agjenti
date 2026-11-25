import { createServiceSupabase } from "@/lib/supabase/service";

/** Read the persisted display number without turning a missing label into a failed order. */
export async function readOrderNumber(businessId: string, orderId: string): Promise<number | null> {
  try {
    const { data, error } = await createServiceSupabase().from("orders").select("order_number")
      .eq("business_id", businessId).eq("id", orderId).maybeSingle();
    return !error && data && Number.isSafeInteger(data.order_number) && data.order_number >= 1001 ? data.order_number : null;
  } catch { return null; }
}
