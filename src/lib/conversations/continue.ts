import { createServiceSupabase } from "@/lib/supabase/service";
import { workerOrigin } from "@/lib/discovery/continue";
import { recordSystem, stepFailure } from "@/lib/tracking/system-events";
import { runWorkflowQueue } from "./workflow-queue";
import { runPanelChat, type PanelScope } from "@/lib/agents/panel-chat/execute";

export type TransportWork = { kind: "inbound" } | { kind: "test" | "panel"; scope: PanelScope };
export const MAX_TRANSPORT_HOPS = 100;
/** A staff message not sent within this time is closed: it is never sent late and never blocks the next one. */
export const STAFF_SEND_MAX_AGE_MS = 24 * 3600_000;

/**
 * Staff messages that waited too long. One still queued or prepared was never sent: it is closed as not sent.
 * One left uncertain (the channel did not confirm it) is closed without sending it again, so it stops blocking
 * the staff's later messages to the same customer. The thread keeps its own delivery status; staff rewrite if needed.
 */
export async function closeStaleStaffSends(now = Date.now()) {
  const db = createServiceSupabase();
  const cutoff = new Date(now - STAFF_SEND_MAX_AGE_MS).toISOString();
  const [unsent, unconfirmed] = await Promise.all([
    db.from("workflow_inbound_queue").update({ status: "failed", leased_until: null,
      error: "Mesazhi nuk u dërgua brenda 24 orëve dhe u mbyll pa u dërguar. Rishkruaje nëse duhet." })
      .eq("operation_kind", "staff").in("status", ["queued", "prepared"]).lt("created_at", cutoff).select("id,business_id"),
    db.from("workflow_inbound_queue").update({ status: "failed", leased_until: null,
      error: "Dërgimi nuk u konfirmua nga kanali dhe u mbyll pas 24 orësh pa u ridërguar. Kontrollo te klienti nëse e mori." })
      .eq("operation_kind", "staff").eq("status", "uncertain").lt("created_at", cutoff).select("id,business_id"),
  ]);
  if (unsent.error || unconfirmed.error) throw new Error("stale_staff_close_failed");
  await Promise.all([
    ...(unsent.data ?? []).map(job => recordSystem("system.transport_wake", "expired", { businessId: job.business_id, reason: "staff_send:not_sent", ref: `job:${job.id}` })),
    ...(unconfirmed.data ?? []).map(job => recordSystem("system.transport_wake", "expired", { businessId: job.business_id, reason: "staff_send:unconfirmed", ref: `job:${job.id}` })),
  ]);
}

/** Resume persisted work after a batch or an expired lease, independently of a
 * browser GET. One handoff per completed batch; no recurring status polling.
 * The existing scheduled worker recovers a lost handoff or a crashed function.
 */
export async function continueTransport(work: TransportWork = { kind: "inbound" }, hop = 0) {
  const started = Date.now();
  const businessId = work.kind === "inbound" ? undefined : work.scope.businessId;
  try {
    // Closing old staff messages never holds up the queue: a failure is recorded and the work goes on.
    if (work.kind === "inbound") await closeStaleStaffSends().catch(error =>
      recordSystem("system.transport_wake", "failed", { reason: stepFailure("system.transport_wake", "close_stale", error) }));
    const processed = work.kind === "panel" ? await runPanelChat(work.scope)
      : await runWorkflowQueue(10, work.kind === "test" ? work.scope : undefined);
    let query = createServiceSupabase().from("workflow_inbound_queue").select("id,leased_until")
      .in("status", ["queued", "prepared", "processing", "sending"])
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("leased_until", { nullsFirst: true }).limit(1);
    if (work.kind === "inbound") query = query.in("operation_kind", ["inbound", "staff"]);
    else query = query.eq("operation_kind", work.kind).eq("business_id", work.scope.businessId).eq("operator_user_id", work.scope.userId).eq("test_stream_id", work.scope.streamId);
    const { data, error } = await query;
    if (error) throw new Error("transport_due_read_failed");
    if (!data?.length) return;
    const secret = process.env.CRON_SECRET?.trim(), origin = workerOrigin();
    if (!secret || !origin || hop >= MAX_TRANSPORT_HOPS) {
      await recordSystem("system.transport_wake", "failed", { businessId, reason: hop >= MAX_TRANSPORT_HOPS ? "handoff:hop_limit" : "handoff:configuration_missing" });
      return;
    }
    const due = data[0].leased_until ? Date.parse(data[0].leased_until) - Date.now() : 0;
    // A queued successor can be blocked by an earlier failed turn. Without
    // progress or a future lease deadline, wait for an explicit retry/new work.
    if (processed === 0 && due <= 0) {
      await recordSystem("system.transport_wake", "waiting", { businessId, reason: "handoff:no_claimable_work" });
      return;
    }
    // A lease is a known deadline, not a timer probing whether data changed.
    if (due > 0) await new Promise(resolve => setTimeout(resolve, Math.min(due + 100, Math.max(0, 145_000 - (Date.now() - started)))));
    const response = await fetch(new URL("/api/cron/workflow-inbound", origin), {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ work, hop: hop + 1 }), redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    await recordSystem("system.transport_wake", response.ok ? "scheduled" : "failed", { businessId, reason: response.ok ? undefined : `handoff:http_${response.status}` });
  } catch (error) {
    await recordSystem("system.transport_wake", "failed", { businessId, reason: stepFailure("system.transport_wake", "handoff", error) });
  }
}
