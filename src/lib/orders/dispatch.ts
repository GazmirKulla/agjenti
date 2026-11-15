import { submitExternalOrder } from "@/lib/integrations/zana";
import { assertBusinessEffectAllowed, isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { LinkedSpec } from "@/lib/integrations/linked-catalog";
import { rejectionDetail, type RejectionDetail } from "./dispatch-detail";

export const ORDER_FILES_BUCKET = "order-files";
/** Long enough for the website to copy the file while handling the order. */
const FILE_LINK_SECONDS = 60 * 60;

export type DispatchOutcome = {
  status: "local_only" | "pending_reconciliation" | "accepted" | "rejected";
  externalOrderId?: string | null;
  /** Why the order stayed local (unmapped_product, unmapped_variant) or the website's error code. */
  reason?: string;
} & RejectionDetail & WebsiteTotals;

/** What the website says the customer pays (items plus shipping), when it says so. */
export type WebsiteTotals = { websiteTotal?: number; shipping?: number; currency?: string };
export function websiteTotals(result: { total?: number; shipping?: number }, payload: Record<string, unknown>): WebsiteTotals {
  if (result.total === undefined && result.shipping === undefined) return {};
  return { ...(result.total !== undefined ? { websiteTotal: result.total } : {}), ...(result.shipping !== undefined ? { shipping: result.shipping } : {}),
    ...(typeof payload.currency === "string" ? { currency: payload.currency } : {}) };
}

type Begin = {
  orderId: string; attemptId?: string; status: DispatchOutcome["status"]; externalOrderId?: string | null;
  dispatch: boolean; reason?: string; line?: number; payload?: Record<string, unknown>;
};

/** Short-lived links instead of storage paths, so the website can download the files. */
export async function signFiles(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];
  if (!items.some((item) => Array.isArray(item.files) && item.files.length)) return payload;
  const storage = createServiceSupabase().storage.from(ORDER_FILES_BUCKET);
  const signed = [];
  for (const item of items) {
    const files = Array.isArray(item.files) ? (item.files as { key: string; path: string }[]) : [];
    const out = [];
    for (const file of files) {
      const { data, error } = await storage.createSignedUrl(file.path, FILE_LINK_SECONDS);
      if (error || !data?.signedUrl) return null;
      const ext = file.path.split(".").pop() ?? "jpg";
      out.push({ key: file.key, url: data.signedUrl, contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext.startsWith("hei") ? `image/${ext}` : "image/jpeg" });
    }
    signed.push({ ...item, files: out, photoUrls: out.map((f) => f.url) });
  }
  return { ...payload, items: signed };
}

/**
 * Sends a manual order to the business website once. The database grants the permission a single
 * time; a crash or lost response after that leaves the order for staff reconciliation, never a resend.
 */
export async function dispatchManualOrder(input: { businessId: string; userId: string; orderId: string }): Promise<DispatchOutcome> {
  assertBusinessEffectAllowed("provider.order");
  if (isIsolatedExecution()) refuseIsolatedEffect("order.create", "external_provider");
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("begin_order_dispatch", { p_business: input.businessId, p_user: input.userId, p_order: input.orderId });
  if (error || !data || typeof data !== "object") return { status: "pending_reconciliation", reason: "dispatch_unverified" };
  const begin = data as Begin;
  if (!begin.dispatch) return { status: begin.status, externalOrderId: begin.externalOrderId ?? null, ...(begin.reason ? { reason: begin.reason } : {}),
    ...(typeof begin.line === "number" ? { line: begin.line } : {}) };
  // Permission was granted and recorded: from here a failure is reconciled, not retried.
  const payload = begin.payload ? await signFiles(begin.payload).catch(() => null) : null;
  if (!payload || !begin.attemptId) return { status: "pending_reconciliation", reason: "files_unavailable" };
  const result = await submitExternalOrder({ businessId: input.businessId, attemptId: begin.attemptId, payload });
  if (result.status === "local_only") return { status: "pending_reconciliation", reason: "integration_removed" };
  const finished = await db.rpc("finish_order_submission", { p_business: input.businessId, p_order: input.orderId,
    p_attempt: begin.attemptId, p_status: result.status, p_external: result.orderId ?? null }).then((v) => v, () => null);
  if (!finished || finished.error) return { status: "pending_reconciliation", reason: "result_unrecorded" };
  const detail = result.status === "rejected" && result.field ? await refusedField(input.businessId, payload, result.code, result.field, result.item) : {};
  return { status: result.status, externalOrderId: result.orderId ?? null, ...(result.code ? { reason: result.code } : {}), ...detail, ...websiteTotals(result, payload) };
}

/** The item and the owner's label for the field the website refused. Best effort: the order is already recorded. */
export async function refusedField(businessId: string, payload: Record<string, unknown>, code: string | undefined, field: string, item?: number): Promise<RejectionDetail> {
  const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];
  const ids = [...new Set(items.map((item) => item.productId).filter((id): id is string => typeof id === "string"))];
  const { data } = ids.length
    ? await createServiceSupabase().from("products").select("external_id,external_spec").eq("business_id", businessId).in("external_id", ids)
      .then((v) => v, () => ({ data: null }))
    : { data: null };
  const specs = new Map((data ?? []).map((p) => [p.external_id as string, (p.external_spec ?? null) as LinkedSpec | null]));
  return rejectionDetail({ code, field, item, items, specs });
}

/** The owner's label for a field Agjenti itself found missing or invalid (the order stayed here). */
export async function localFieldDetail(businessId: string, orderId: string, field: string, line?: number): Promise<RejectionDetail> {
  const { data } = await createServiceSupabase().from("order_items").select("position,products(external_spec)")
    .eq("order_id", orderId).order("position", { ascending: true }).then((v) => v, () => ({ data: null }));
  const rows = (data ?? []) as { products: { external_spec: LinkedSpec | null } | { external_spec: LinkedSpec | null }[] | null }[];
  const spec = (row: (typeof rows)[number] | undefined) => (Array.isArray(row?.products) ? row?.products[0] : row?.products)?.external_spec ?? null;
  const own = spec(rows[(line ?? 1) - 1]);
  const pool = own ? [own] : rows.map(spec).filter((s): s is LinkedSpec => !!s);
  const fieldLabel = pool.flatMap((s) => [...s.options, ...s.fields]).find((f) => f.key === field)?.label;
  return { field, ...(fieldLabel ? { fieldLabel } : {}), ...(line ? { line } : {}) };
}
