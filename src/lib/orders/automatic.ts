import { createServiceSupabase } from "@/lib/supabase/service";
import { migrateContext } from "@/lib/workflows/context";
import { restoreOrder } from "@/lib/workflows/conversation-processes";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import { submitAgentConfirmedOrder } from "./submission";
/** Runs after durable conversation-state commit, before the prepared reply is sent.
 * Reading and replays are safe; the submission transaction owns all write checks. */
export async function registerAutomaticLocalOrder(businessId: string, conversationId: string) {
  const db = createServiceSupabase();
  const policy = await db.from("business_automation_policies").select("local_orders").eq("business_id",businessId).maybeSingle();
  if (policy.error) {
    // During deployment, absent policy storage means no automatic authority.
    if (["42P01","PGRST205"].includes(policy.error.code)) return null;
    throw new Error("Order policy unavailable");
  }
  if (!policy.data?.local_orders) return null;
  const current = await db.from("conversation_states").select("collected,revision,status").eq("business_id",businessId).eq("conversation_id",conversationId).maybeSingle();
  if (current.error) throw new Error("Order state unavailable");
  if (!current.data || current.data.status === "cancelled") return null;
  const stored = migrateContext(current.data.collected as ConversationStatePayload);
  const state = stored.schemaVersion === 3 && stored.processes?.order ? restoreOrder(stored) : stored;
  if (state.step_key !== "order_ready" || state.context?.execution.orderConfirmed !== true) return null;
  return submitAgentConfirmedOrder({businessId,conversationId,expectedRevision:current.data.revision});
}
