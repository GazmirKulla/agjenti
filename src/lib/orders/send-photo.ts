import { fetchExternalOrder } from "@/lib/integrations/zana";
import { createServiceSupabase } from "@/lib/supabase/service";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The URL of an order photo staff may send to the customer: one of the business's own photos of an item
 * (role output, e.g. the processed design) of an order of THIS conversation, read again from the business
 * website at this moment. A URL from the request is never sent as such; null when it does not match.
 */
export async function orderPhotoToSend(businessId: string, conversationId: string, raw: unknown): Promise<string | null> {
  const media = raw && typeof raw === "object" ? (raw as { orderId?: unknown; item?: unknown; key?: unknown; url?: unknown }) : null;
  if (!media || typeof media.orderId !== "string" || !uuid.test(media.orderId) || typeof media.item !== "number" || !Number.isInteger(media.item)
    || typeof media.key !== "string" || typeof media.url !== "string" || media.url.length > 2000) return null;
  const { data: order } = await createServiceSupabase().from("orders").select("external_order_id,external_system")
    .eq("id", media.orderId).eq("business_id", businessId).eq("conversation_id", conversationId).maybeSingle();
  if (!order || order.external_system !== "external" || typeof order.external_order_id !== "string") return null;
  const view = await fetchExternalOrder(businessId, order.external_order_id);
  const file = view?.items.find((i) => i.item === media.item)?.files.find((f) => f.role === "output" && f.key === media.key && f.url === media.url);
  return file ? file.url : null;
}
