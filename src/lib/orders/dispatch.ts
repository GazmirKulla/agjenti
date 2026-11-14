import { submitExternalOrder } from "@/lib/integrations/zana";
import { assertBusinessEffectAllowed, isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";

export const ORDER_FILES_BUCKET = "order-files";
/** Long enough for the website to copy the file while handling the order. */
const FILE_LINK_SECONDS = 60 * 60;

export type DispatchOutcome = {
  status: "local_only" | "pending_reconciliation" | "accepted" | "rejected";
  externalOrderId?: string | null;
  /** Why the order stayed local (unmapped_product, unmapped_variant) or the website's error code. */
  reason?: string;
};

type Begin = {
  orderId: string; attemptId?: string; status: DispatchOutcome["status"]; externalOrderId?: string | null;
  dispatch: boolean; reason?: string; payload?: Record<string, unknown>;
};

/** Short-lived links instead of storage paths, so the website can download the files. */
async function signFiles(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];
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
  if (!begin.dispatch) return { status: begin.status, externalOrderId: begin.externalOrderId ?? null, ...(begin.reason ? { reason: begin.reason } : {}) };
  // Permission was granted and recorded: from here a failure is reconciled, not retried.
  const payload = begin.payload ? await signFiles(begin.payload).catch(() => null) : null;
  if (!payload || !begin.attemptId) return { status: "pending_reconciliation", reason: "files_unavailable" };
  const result = await submitExternalOrder({ businessId: input.businessId, attemptId: begin.attemptId, payload });
  if (result.status === "local_only") return { status: "pending_reconciliation", reason: "integration_removed" };
  const finished = await db.rpc("finish_order_submission", { p_business: input.businessId, p_order: input.orderId,
    p_attempt: begin.attemptId, p_status: result.status, p_external: result.orderId ?? null }).then((v) => v, () => null);
  if (!finished || finished.error) return { status: "pending_reconciliation", reason: "result_unrecorded" };
  return { status: result.status, externalOrderId: result.orderId ?? null, ...(result.code ? { reason: result.code } : {}) };
}
