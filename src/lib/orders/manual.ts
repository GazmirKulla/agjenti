import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { assertBusinessEffectAllowed, isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";

/** One item of a manual order: its own product, variant, choices and quantity. */
export type ManualOrderLine = {
  productId: string;
  /** The chosen variant (size, length…); required when the product has variants. */
  variantId?: string | null;
  /** Whole items 1–999; for a product priced per unit (m³, m…) up to three decimals, e.g. 0.5. The RPC checks it against the product. */
  quantity: number;
  /** For a linked product: the choices, extras, data and files the website declares (checked by the RPC). */
  selection?: OrderSelection | null;
};

type OrderHeader = {
  businessId: string;
  userId: string;
  conversationId: string;
  customer: { name: string; phone: string; city: string; address: string };
  note: string;
  requestKey: string;
};

export const MAX_ORDER_LINES = 10;
export type ManualOrderLinesInput = OrderHeader & { lines: ManualOrderLine[] };
export type ManualOrderInput = OrderHeader & ManualOrderLine;

export type OrderSelection = {
  options?: Record<string, string>;
  fields?: Record<string, string | number | boolean>;
  files?: Record<string, string[]>;
  addons?: string[];
};

const errors: Record<string, [string, number]> = {
  unauthorized: ["Nuk ke qasje në këtë biznes.", 403],
  invalid_request: ["Kërkesë e pavlefshme. Rifresko faqen.", 400],
  invalid_quantity: ["Sasia nuk vlen: copë të plota nga 1 deri në 999, ose për produktet me njësi (m³, m…) deri në 3 shifra pas pikës, p.sh. 0.5.", 400],
  invalid_customer: ["Të dhënat e klientit janë të pavlefshme.", 400],
  customer_required: ["Shkruaj emrin dhe telefonin e klientit.", 400],
  invalid_note: ["Shënimi është shumë i gjatë.", 400],
  invalid_conversation: ["Biseda nuk u gjet në këtë biznes.", 404],
  product_unavailable: ["Produkti nuk është aktiv.", 409],
  price_missing: ["Produkti nuk ka çmim. Vendos çmimin te Produktet.", 409],
  price_on_request: ["Ky produkt nuk ka një çmim të caktuar (nga–deri ose sipas kërkesës). Zgjidh një variant me çmim ose vendos çmimin te Produktet.", 409],
  variant_required: ["Zgjidh variantin (p.sh. masën) e produktit.", 400],
  variant_unavailable: ["Ky variant nuk është më në shitje.", 409],
  selection_required: ["Plotëso zgjedhjet dhe të dhënat që kërkon produkti (p.sh. ngjyra, foto).", 400],
  invalid_selection: ["Një zgjedhje nuk është më mes vlerave të produktit. Rifresko formularin.", 409],
  invalid_lines: [`Porosia duhet të ketë nga 1 deri në ${MAX_ORDER_LINES} artikuj.`, 400],
  mixed_currency: ["Të gjithë artikujt e porosisë duhet të kenë të njëjtën monedhë.", 400],
};

/** RPC error → message; a line error (`selection_required:2`) names the item when the order has several. */
export function manualOrderError(code: string | undefined, lineCount = 2): { error: string; status: number } {
  const match = /^([a-z_]+):(\d+)$/.exec(code ?? "");
  const [message, status] = errors[match?.[1] ?? code ?? ""] ?? ["Porosia nuk u ruajt. Provo përsëri.", 500];
  return { error: match && errors[match[1]] && lineCount > 1 ? `Artikulli ${match[2]}: ${message}` : message, status };
}

/** A LOCAL order the owner records from a conversation, with 1–10 items; the RPC rechecks membership and takes prices from the catalog. */
export async function createManualOrderLines(input: ManualOrderLinesInput): Promise<{ orderId: string } | { error: string; status: number }> {
  assertBusinessEffectAllowed("order.create");
  if (isIsolatedExecution()) refuseIsolatedEffect("order.create");
  await requireRuntimeModules(input.businessId, ["orders", "products"]);
  const { data, error } = await createServiceSupabase().rpc("create_manual_order_lines", {
    p_business: input.businessId,
    p_user: input.userId,
    p_conversation: input.conversationId,
    p_lines: input.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
      selection: line.selection ?? null,
    })),
    p_customer: input.customer,
    p_note: input.note,
    p_request_key: input.requestKey,
  });
  if (error || typeof data !== "string") return manualOrderError(error?.message, input.lines.length);
  return { orderId: data };
}

/** One product, as before multi-item orders. */
export async function createManualOrder(input: ManualOrderInput): Promise<{ orderId: string } | { error: string; status: number }> {
  const { productId, variantId, quantity, selection, ...header } = input;
  return createManualOrderLines({ ...header, lines: [{ productId, variantId, quantity, selection }] });
}
