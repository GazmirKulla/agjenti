import { CapabilityEnforcementError, requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { submitExternalOrder } from "@/lib/integrations/zana";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isIsolatedExecution, refuseIsolatedEffect, assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";
import type { Snapshot } from "@/lib/orchestration/contracts";

export type SubmissionReceipt = {
  orderId: string;
  attemptId: string;
  status: "pending_reconciliation" | "accepted" | "rejected" | "local_only";
  externalOrderId?: string | null;
  dispatch: boolean;
  payload?: Record<string, unknown>;
};
export class OrderSubmissionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const errors: Record<string, [string, number]> = {
  unauthorized: ["Nuk ke më akses në këtë biznes.", 403],
  conversation_unavailable: ["Biseda nuk u gjet në këtë biznes.", 404],
  module_disabled: ["Moduli i porosive ose produkteve është çaktivizuar.", 403],
  stale_state: ["Biseda ndryshoi gjatë dërgimit. Rifresko dhe kontrollo konfirmimin.", 409],
  confirmation_required: ["Porosia kërkon një konfirmim të ri nga klienti.", 400],
  confirmation_conflict: ["Ky konfirmim nuk përputhet me porosinë e ruajtur.", 409],
  commercial_terms_changed: ["Çmimi ose monedha ndryshoi. Klienti duhet ta rikonfirmojë porosinë.", 409],
  product_changed: ["Produkti ndryshoi. Klienti duhet ta rikonfirmojë porosinë.", 409],
  product_unavailable: ["Produkti nuk është aktiv në këtë biznes.", 400],
  workflow_not_ready: ["Produkti është në katalog, por workflow-i i porosisë nuk u verifikua. Kontakto stafin.", 409],
  customer_unavailable: ["Klienti nuk i përket këtij biznesi.", 403],
  unsupported_order_scope: ["Dërgimi mbështet vetëm një produkt me sasi 1. Kjo kërkesë duhet shqyrtuar nga stafi.", 400],
  submission_unavailable: ["Porosia nuk u gjet në këtë bisedë.", 404],
  result_conflict: ["Rezultati i porosisë është regjistruar tashmë. Rifresko gjendjen.", 409],
  submission_in_flight: ["Dërgimi mund të jetë ende në proces. Prit të paktën një minutë para pajtimit manual.", 409],
};
function fail(code: string): never {
  const [message, status] = errors[code] ?? ["Ruajtja nuk u verifikua. Rifresko porositë ose riprovo të njëjtën kërkesë; mos krijo një konfirmim tjetër.", 503];
  throw new OrderSubmissionError(code in errors ? code : "persistence_unverified", message, status);
}
function isReceipt(value: unknown): value is SubmissionReceipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<SubmissionReceipt>;
  return typeof r.orderId === "string" && !!r.orderId && typeof r.attemptId === "string" && !!r.attemptId
    && ["pending_reconciliation", "accepted", "rejected", "local_only"].includes(r.status ?? "")
    && typeof r.dispatch === "boolean"
    && (!r.dispatch || r.status === "pending_reconciliation" && !!r.payload && typeof r.payload === "object" && !Array.isArray(r.payload));
}

/** Server-owned state only: the POST body cannot supply prices, product IDs or intent keys. */
export async function submitConfirmedOrder(input: { businessId: string; conversationId: string; userId: string; expectedRevision?: number; actionId?: string }): Promise<SubmissionReceipt> {
  return submitOrder(input);
}
async function submitOrder(input: {businessId: string; conversationId: string; userId: string; expectedRevision?: number; actionId?: string}): Promise<SubmissionReceipt> {
  assertBusinessEffectAllowed("order.create");
  if (isIsolatedExecution()) refuseIsolatedEffect("order.create");
  const db = createServiceSupabase();
  const { businessId, conversationId, userId } = input;
  await requireRuntimeModules(businessId, ["orders", "products"]);
  const { data: conversation, error: conversationError } = await db.from("conversations").select("id")
    .eq("id", conversationId).eq("business_id", businessId).maybeSingle();
  if (conversationError) fail("read_failed");
  if (!conversation) fail("conversation_unavailable");
  const { data: row, error: stateError } = await db.from("conversation_states").select("collected,revision,cart,status")
    .eq("conversation_id", conversationId).eq("business_id", businessId).maybeSingle();
  if (stateError) fail("read_failed");
  if (input.expectedRevision !== undefined && row?.revision !== input.expectedRevision) fail("stale_state");
  if (row?.collected?.schemaVersion === 4 && row.status !== "cancelled" && Number.isInteger(row.revision)) {
    if (!userId) fail("confirmation_required"); // Runtime submissions require the claimed queue lease, through the domain adapter.
    const snapshot = row.collected as Snapshot;
    if (snapshot.businessId !== businessId || snapshot.conversationId !== conversationId || snapshot.mode !== "live") fail("confirmation_required");
    const actions = Object.values(snapshot.instances).flatMap(i => i.action?.tool === "order.create" ? [i.action] : []);
    const pending = actions.filter(a => a.output?.submissionStatus === "awaiting_staff");
    const eligible = input.actionId ? actions.filter(a => a.id === input.actionId) : pending.length ? pending : actions;
    if (eligible.length !== 1 || !uuid.test(eligible[0].id)) fail("confirmation_required");
    const { data, error } = await db.rpc("submit_process_order", { p_business: businessId, p_conversation: conversationId, p_revision: row.revision,
      p_action: eligible[0].id, p_user: userId, p_job: null, p_token: null });
    if (error || !isReceipt(data)) fail(error?.message ?? "write_failed");
    return settleReceipt(businessId, userId, data);
  }
  fail("confirmation_required");
}

async function settleReceipt(businessId: string, userId: string | null, receipt: SubmissionReceipt): Promise<SubmissionReceipt> {
  const db = createServiceSupabase();

  if (!receipt.dispatch) return receipt;
  if (userId === null) fail("unexpected_dispatch");
  // PENDING_RECONCILIATION was persisted before permission to send was returned.
  // Crash, response loss or concurrent replay cannot acquire permission again.
  let result;
  try {
    result = await submitExternalOrder({ businessId, attemptId: receipt.attemptId, payload: receipt.payload! });
  } catch {
    return { ...receipt, dispatch: false, payload: undefined, status: "pending_reconciliation" };
  }
  const finished = await db.rpc("finish_order_submission", { p_business: businessId, p_order: receipt.orderId,
    p_attempt: receipt.attemptId, p_status: result.status, p_external: result.orderId ?? null }).then(value => value, () => null);
  // An accepted response is not reported as successful until persisted.
  if (!isReceipt(finished?.data) || finished?.error || finished.data.dispatch
      || finished.data.orderId !== receipt.orderId || finished.data.attemptId !== receipt.attemptId)
    return { ...receipt, dispatch: false, payload: undefined, status: "pending_reconciliation" };
  return finished.data;
}

/** Manual, evidence-backed reconciliation, not a retry endpoint. */
export async function reconcileOrder(input: { businessId: string; conversationId: string; userId: string; body: unknown }): Promise<SubmissionReceipt> {
  const body = input.body as { orderId?: unknown; status?: unknown; externalOrderId?: unknown; evidence?: unknown } | null;
  if (!body || typeof body.orderId !== "string" || !uuid.test(body.orderId) || !["accepted", "rejected"].includes(String(body.status))
    || typeof body.evidence !== "string" || body.evidence.trim().length < 12 || body.evidence.length > 1000
    || (body.externalOrderId !== undefined && (typeof body.externalOrderId !== "string" || body.externalOrderId.length > 200))
    || (body.status === "accepted" && !(body.externalOrderId as string | undefined)?.trim()))
    throw new OrderSubmissionError("reconciliation_evidence_required", "Jep rezultatin e verifikuar, referencën e jashtme dhe provën e kontrollit nga stafi.", 400);
  // Reconciliation remains possible after module deactivation: it sends nothing.
  const { data, error } = await createServiceSupabase().rpc("reconcile_order_submission", {
    p_business: input.businessId, p_user: input.userId, p_conversation: input.conversationId, p_order: body.orderId,
    p_status: body.status, p_external: (body.externalOrderId as string | undefined)?.trim() ?? null, p_evidence: body.evidence.trim(),
  });
  if (error || !isReceipt(data) || data.dispatch || data.orderId !== body.orderId) fail(error?.message ?? "write_failed");
  return data;
}
export function submissionError(error: unknown) {
  if (error instanceof OrderSubmissionError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof CapabilityEnforcementError) return { status: 403, body: { error: error.message, code: error.code } };
  return { status: 503, body: { error: "Rezultati nuk u verifikua. Kontrollo listën e porosive para një konfirmimi të ri.", code: "submission_unverified" } };
}
export function submissionResponse(receipt: SubmissionReceipt) {
  const status = receipt.status === "pending_reconciliation" ? 202 : receipt.status === "rejected" ? 502 : 200;
  return { status, body: { ok: status === 200, orderId: receipt.orderId, externalOrderId: receipt.externalOrderId,
    submissionStatus: receipt.status, submissionId: receipt.attemptId, localOrderCreated: true,
    ...(status === 202 ? { error: "Porosia është ruajtur, por dërgimi nuk është verifikuar. Kërkohet kontroll nga stafi; mos e ridërgo." }
      : status === 502 ? { error: "Sistemi i jashtëm e refuzoi porosinë. Retry nuk e ridërgon." } : {}),
  } };
}
