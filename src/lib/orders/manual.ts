import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { assertBusinessEffectAllowed, isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";

export type ManualOrderInput = {
  businessId: string;
  userId: string;
  conversationId: string;
  productId: string;
  quantity: number;
  customer: { name: string; phone: string; city: string; address: string };
  note: string;
  requestKey: string;
};

const errors: Record<string, [string, number]> = {
  unauthorized: ["Nuk ke qasje në këtë biznes.", 403],
  invalid_request: ["Kërkesë e pavlefshme. Rifresko faqen.", 400],
  invalid_quantity: ["Sasia duhet të jetë nga 1 deri në 999.", 400],
  invalid_customer: ["Të dhënat e klientit janë të pavlefshme.", 400],
  customer_required: ["Shkruaj emrin dhe telefonin e klientit.", 400],
  invalid_note: ["Shënimi është shumë i gjatë.", 400],
  invalid_conversation: ["Biseda nuk u gjet në këtë biznes.", 404],
  product_unavailable: ["Produkti nuk është aktiv.", 409],
  price_missing: ["Produkti nuk ka çmim. Vendos çmimin te Produktet.", 409],
};

/** A LOCAL order the owner records from a conversation; the RPC rechecks membership and takes prices from the catalog. */
export async function createManualOrder(input: ManualOrderInput): Promise<{ orderId: string } | { error: string; status: number }> {
  assertBusinessEffectAllowed("order.create");
  if (isIsolatedExecution()) refuseIsolatedEffect("order.create");
  await requireRuntimeModules(input.businessId, ["orders", "products"]);
  const { data, error } = await createServiceSupabase().rpc("create_manual_order", {
    p_business: input.businessId,
    p_user: input.userId,
    p_conversation: input.conversationId,
    p_product: input.productId,
    p_quantity: input.quantity,
    p_customer: input.customer,
    p_note: input.note,
    p_request_key: input.requestKey,
  });
  if (error || typeof data !== "string") {
    const [message, status] = errors[error?.message ?? ""] ?? ["Porosia nuk u ruajt. Provo përsëri.", 500];
    return { error: message, status };
  }
  return { orderId: data };
}
