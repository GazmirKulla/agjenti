import { amendExternalOrder, fetchExternalOrder } from "@/lib/integrations/zana";
import { manualOrderError, MAX_ORDER_LINES, type ManualOrderLine } from "@/lib/orders/manual";
import { signFiles } from "@/lib/orders/dispatch";
import { loadOrderProducts } from "@/lib/products/order-products";
import { assertBusinessEffectAllowed, isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";

/** One item of an order as the database priced it (order_changes.changes.lines, before.lines). */
export type PricedLine = {
  product_id: string; product_name?: string; variant_id: string | null; variant?: Record<string, string> | null;
  quantity: number; unit?: string | null; unit_amount?: number; line_total?: number; selection?: Record<string, unknown> | null;
};
/** What staff can change in an existing order: the client and delivery details, the note and the items. */
export type OrderChangeValues = {
  customer?: Partial<Record<"name" | "phone" | "city" | "address", string | null>>;
  note?: string | null;
  /** All the items after the change, as "Krijo porosi" sends them; the database prices them. */
  lines?: ManualOrderLine[];
};
/** A change as stored: the items priced, with the new total. */
export type StoredChangeValues = Omit<OrderChangeValues, "lines"> & { lines?: PricedLine[]; total?: number; currency?: string };
export type OrderChange = {
  changeId: string;
  status: "pending" | "accepted" | "rejected" | "uncertain";
  external: boolean;
  before: { customer: Record<string, string | null>; note: string | null; lines?: PricedLine[]; total?: number | null; currency?: string | null };
  changes: StoredChangeValues;
  error: string | null;
  createdAt: string;
};
export type OrderChangeOutcome =
  | { ok: true; change: OrderChange }
  | { ok: false; error: string; status: number; change?: OrderChange };

const errors: Record<string, [string, number]> = {
  unauthorized: ["Nuk ke qasje në këtë biznes.", 403],
  invalid_change: ["Të dhënat e ndryshimit nuk janë të vlefshme.", 400],
  customer_required: ["Emri (dhe telefoni, kur biznesi e kërkon) nuk mund të mbeten bosh.", 400],
  no_change: ["Nuk ka asnjë ndryshim nga të dhënat e porosisë.", 400],
  order_not_found: ["Porosia nuk u gjet.", 404],
  order_unsettled: ["Dërgimi i kësaj porosie te webi nuk është verifikuar ende. Kontrolloje te webi para se ta ndryshosh.", 409],
  change_in_progress: ["Një ndryshim tjetër i kësaj porosie nuk ka përfunduar. Provoje atë përsëri ose prit përgjigjen.", 409],
  change_conflict: ["Ky ndryshim i përket një porosie tjetër. Rifresko faqen.", 409],
  unmapped_product: ["Ky produkt nuk është i lidhur me webin e biznesit, ndaj nuk mund të shtohet në këtë porosi.", 409],
  not_synced: ["Ky produkt nuk është rifreskuar ende nga webi i biznesit. Rifreskoje te Produktet dhe provo përsëri.", 409],
  unmapped_variant: ["Ky variant nuk është i lidhur me webin e biznesit.", 409],
  files_unavailable: ["Fotot e porosisë nuk u përgatitën për webin. Provo përsëri.", 503],
};
/** The website's own refusal codes, in the owner's words. */
const websiteRefusals: Record<string, string> = {
  not_editable: "Webi i biznesit nuk e lejon më ndryshimin e kësaj porosie (p.sh. është në prodhim ose e dërguar).",
  change_unsupported: "Webi i biznesit nuk pranon ende ndryshime porosish. Ndryshoje drejtpërdrejt te webi.",
  integration_unavailable: "Lidhja me webin e biznesit nuk është e konfiguruar.",
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the keys a change may carry, as strings or null; the database checks lengths and required fields again. */
export function readChangeValues(raw: unknown): OrderChangeValues | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "customer" && k !== "note" && k !== "lines")) return null;
  const text = (v: unknown) => (v === null || typeof v === "string" ? v : undefined);
  const out: OrderChangeValues = {};
  if (body.customer !== undefined) {
    if (!body.customer || typeof body.customer !== "object" || Array.isArray(body.customer)) return null;
    const customer: NonNullable<OrderChangeValues["customer"]> = {};
    for (const [key, value] of Object.entries(body.customer as Record<string, unknown>)) {
      if (!["name", "phone", "city", "address"].includes(key) || text(value) === undefined) return null;
      customer[key as "name"] = value as string | null;
    }
    if (Object.keys(customer).length) out.customer = customer;
  }
  if (body.note !== undefined) {
    if (text(body.note) === undefined) return null;
    out.note = body.note as string | null;
  }
  if (body.lines !== undefined) {
    const lines = readLines(body.lines);
    if (!lines) return null;
    out.lines = lines;
  }
  return Object.keys(out).length ? out : null;
}

/** 1–10 items in the shape of a new order; the database checks products, variants, choices and quantities. */
function readLines(raw: unknown): ManualOrderLine[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ORDER_LINES) return null;
  const lines: ManualOrderLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const line = item as Record<string, unknown>;
    if (typeof line.productId !== "string" || !uuid.test(line.productId)) return null;
    if (line.variantId !== undefined && line.variantId !== null && (typeof line.variantId !== "string" || !uuid.test(line.variantId))) return null;
    if (typeof line.quantity !== "number" || !Number.isFinite(line.quantity)) return null;
    const selection = line.selection;
    if (selection !== undefined && selection !== null && (typeof selection !== "object" || Array.isArray(selection))) return null;
    lines.push({ productId: line.productId, variantId: (line.variantId as string | null | undefined) ?? null, quantity: line.quantity,
      selection: (selection as ManualOrderLine["selection"]) ?? null });
  }
  return lines;
}

function toChange(row: Record<string, unknown>): OrderChange {
  const before = (row.before ?? {}) as OrderChange["before"];
  return {
    changeId: String(row.change_id), status: row.status as OrderChange["status"], external: row.external === true,
    before: { ...before, customer: before.customer ?? {}, note: before.note ?? null }, changes: (row.changes ?? {}) as StoredChangeValues,
    error: typeof row.error === "string" ? row.error : null, createdAt: String(row.created_at),
  };
}

function refusal(code: string | undefined, field?: string) {
  const known = code ? websiteRefusals[code] : undefined;
  return known ?? `Webi i biznesit nuk e pranoi ndryshimin${code ? ` (${code}${field ? `: ${field}` : ""})` : ""}.`;
}

/**
 * Changes the delivery details and/or the note of an existing order. An order only in Agjenti changes at
 * once; an order on the business website changes only when the website accepts it. The same changeId
 * never changes the order twice: an unclear answer is sent again with the same id when staff retry.
 */
export async function amendOrder(input: { businessId: string; userId: string; orderId: string; changeId: string; changes: OrderChangeValues }): Promise<OrderChangeOutcome> {
  assertBusinessEffectAllowed("order.change");
  if (isIsolatedExecution()) refuseIsolatedEffect("order.create", "order_change");
  if (!uuid.test(input.changeId)) return { ok: false, ...errorOf("invalid_change") };
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("begin_order_change", {
    p_business: input.businessId, p_user: input.userId, p_order: input.orderId, p_change: input.changeId, p_changes: input.changes,
  });
  if (error || !data) return { ok: false, ...errorOf(error?.message) };
  const begun = data as Record<string, unknown>;
  if (begun.send !== true) return settled(toChange(begun));
  if (typeof begun.externalOrderId !== "string") return { ok: false, ...errorOf("order_not_found") };
  // What the website receives (with the new items' files as short-lived links); older rows carry only the changes.
  const request = begun.request && typeof begun.request === "object" ? await signFiles(begun.request as Record<string, unknown>).catch(() => null)
    : (begun.changes as Record<string, unknown>);
  if (!request) {
    // Nothing was asked: the change ends here and a new one can be made.
    await db.rpc("finish_order_change", { p_business: input.businessId, p_change: input.changeId, p_status: "rejected", p_error: "files_unavailable" });
    return { ok: false, ...errorOf("files_unavailable") };
  }
  const answer = await amendExternalOrder(input.businessId, begun.externalOrderId, input.changeId, request);
  const finishError = answer.status === "rejected" ? (answer.code ? `${answer.code}${answer.field ? `:${answer.field}` : ""}` : "rejected") : null;
  const { data: finished, error: finishFailed } = await db.rpc("finish_order_change", {
    p_business: input.businessId, p_change: input.changeId, p_status: answer.status, p_error: finishError,
  });
  // The website answered but the answer was not recorded: never claim success, and do not resend blindly.
  if (finishFailed || !finished) return { ok: false, error: "Përgjigja e webit nuk u ruajt. Rifresko faqen dhe kontrollo porosinë.", status: 503 };
  return settled(toChange(finished as Record<string, unknown>));
}

function errorOf(code: string | undefined) {
  // An item the database refused, numbered (`variant_required:2`): the same words as a new order.
  const line = /^([a-z_]+):(\d+)$/.exec(code ?? "");
  if (line && errors[line[1]]) return { error: `Artikulli ${line[2]}: ${errors[line[1]][0]}`, status: errors[line[1]][1] };
  if (line || code === "invalid_lines" || code === "mixed_currency") return manualOrderError(code);
  const [error, status] = errors[code ?? ""] ?? ["Ndryshimi nuk u ruajt. Provo përsëri.", 500];
  return { error, status };
}

function settled(change: OrderChange): OrderChangeOutcome {
  if (change.status === "accepted") return { ok: true, change };
  if (change.status === "rejected") {
    const [code, field] = (change.error ?? "").split(":");
    return { ok: false, error: refusal(code || undefined, field), status: 409, change };
  }
  return { ok: false, change, status: 202,
    error: "Webi i biznesit nuk u përgjigj qartë. Ndryshimi mund të jetë bërë: kontrolloje te webi ose provo përsëri (nuk aplikohet dy herë)." };
}

/** What the order editor shows: the current delivery, whether the website still allows a change, and the history. */
export async function readOrderChanges(businessId: string, orderId: string) {
  const db = createServiceSupabase();
  const { data: order, error } = await db.from("orders").select("id,status,conversation_id,currency,total_amount,external_system,external_order_id,delivery:payload->customer,note:payload->note")
    .eq("id", orderId).eq("business_id", businessId).maybeSingle();
  if (error) throw new Error("order_unavailable");
  if (!order) return null;
  const { data: rows, error: historyError } = await db.from("order_changes").select("change_id,status,external,before,changes,error,created_at")
    .eq("business_id", businessId).eq("order_id", orderId).order("created_at", { ascending: false }).limit(10);
  if (historyError) throw new Error("order_unavailable");
  const { data: items, error: itemsError } = await db.from("order_items").select("product_id,variant_id,quantity,unit_amount,selection,position")
    .eq("order_id", orderId).order("position", { ascending: true, nullsFirst: true });
  if (itemsError) throw new Error("order_unavailable");
  // The items' products as the order form shows them, so staff change them with the same choices.
  const ids = [...new Set((items ?? []).map((item) => item.product_id).filter((id): id is string => typeof id === "string"))];
  const products = ids.length ? await loadOrderProducts(db, businessId, { ids }) : [];
  const external = order.external_system === "external" && typeof order.external_order_id === "string" ? order.external_order_id : null;
  // The website decides; when it says nothing, Agjenti offers the change and the website can still refuse it.
  const view = external ? await fetchExternalOrder(businessId, external) : null;
  const customer = (order.delivery && typeof order.delivery === "object" ? order.delivery : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    orderId: order.id as string,
    external: Boolean(external),
    editable: order.status !== "pending_reconciliation" && (view?.editable ?? true),
    websiteStatus: view?.status || null,
    delivery: { name: str(customer.name), phone: str(customer.phone), city: str(customer.city), address: str(customer.address) },
    note: str(order.note),
    conversationId: str(order.conversation_id),
    currency: str(order.currency),
    total: typeof order.total_amount === "number" ? order.total_amount : order.total_amount == null ? null : Number(order.total_amount),
    lines: (items ?? []).map((item) => ({ productId: item.product_id as string | null, variantId: item.variant_id as string | null,
      quantity: Number(item.quantity), unitAmount: item.unit_amount == null ? null : Number(item.unit_amount),
      selection: (item.selection ?? null) as ManualOrderLine["selection"] })),
    /** Products of the items that can still be ordered (null when the catalog could not be read). */
    products: products ?? [],
    changes: (rows ?? []).map((row) => toChange(row as Record<string, unknown>)),
  };
}
