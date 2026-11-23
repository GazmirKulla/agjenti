import { createServiceSupabase } from "@/lib/supabase/service";
import { workerOrigin } from "@/lib/discovery/continue";
import { recordSystem, stepFailure } from "@/lib/tracking/system-events";
import { runWorkflowQueue } from "./workflow-queue";
import { runPanelChat, type PanelScope } from "@/lib/agents/panel-chat/execute";

export type TransportWork = { kind: "inbound" } | { kind: "test" | "panel"; scope: PanelScope };
export const MAX_TRANSPORT_HOPS = 100;

/** Resume persisted work after a batch or an expired lease, independently of a
 * browser GET. One handoff per completed batch; no recurring status polling.
 * The existing scheduled worker recovers a lost handoff or a crashed function.
 */
export async function continueTransport(work: TransportWork = { kind: "inbound" }, hop = 0) {
  const started = Date.now();
  const businessId = work.kind === "inbound" ? undefined : work.scope.businessId;
  try {
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
