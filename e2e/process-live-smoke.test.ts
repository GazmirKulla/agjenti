import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createServiceSupabase } from "../src/lib/supabase/service";
import { tryProcessConversation } from "../src/lib/orchestration/conversation";
import { readStoredConversationState } from "../src/lib/orchestration/stored-state";
import { digest } from "../src/lib/orchestration/definition";

// Explicit opt-in only. Creates and deletes only this smoke run's panel conversation.
it.skipIf(!process.env.PROCESS_SMOKE_BUSINESS_ID)("runs two real panel turns through the process checkpoint and delivery transaction", async () => {
  const db = createServiceSupabase(), businessId = process.env.PROCESS_SMOKE_BUSINESS_ID!;
  const admin = await db.from("platform_admins").select("user_id").limit(1).single();
  if (admin.error) throw admin.error;
  const streamId = randomUUID(), userId = admin.data.user_id;
  const created = await db.rpc("create_panel_chat", { p_business: businessId, p_user: userId, p_stream: streamId });
  if (created.error) throw created.error;
  const conversationId = created.data;
  try {
    for (const [sequence, message] of ["Si funksionon?", "Dua të regjistroj një biznes."].entries()) {
      const queued = await db.rpc("enqueue_panel_chat", { p_business: businessId, p_user: userId, p_stream: streamId, p_request: randomUUID(), p_sequence: sequence, p_message: message, p_fingerprint: digest([streamId, sequence, message]) });
      if (queued.error) throw queued.error;
      const claim = await db.rpc("claim_panel_chat", { p_business: businessId, p_user: userId, p_stream: streamId });
      if (claim.error || !claim.data?.[0]) throw new Error("smoke_claim_failed");
      const job = claim.data[0];
      const saved = await db.from("conversation_states").select("collected,revision").eq("business_id", businessId).eq("conversation_id", conversationId).single();
      if (saved.error) throw saved.error;
      const turn = await tryProcessConversation({ businessId, message, hasPhoto: false, mode: "production", source: "panel",
        onTrace: e => { if (e.label === "Process observation validated") console.info("SMOKE_OBSERVATION", JSON.stringify({ commands: e.data?.commands, conditions: e.data?.conditions })); },
        state: readStoredConversationState(saved.data.collected, { businessId, conversationId, revision: saved.data.revision }),
        processTransport: { jobId: job.id, leaseToken: job.lease_token, conversationId, revision: saved.data.revision } });
      expect(turn?.nextState.runtime?.mode).toBe("live");
      expect(turn?.processCheckpoint).toBeTruthy();
      const envelope = turn!.processCheckpoint!;
      const finished = await db.rpc("finish_process_panel_chat", { p_id: job.id, p_token: job.lease_token, p_revision: envelope.expectedRevision,
        p_state: turn!.nextState.runtime, p_event: envelope.event.id, p_event_hash: digest(envelope.event), p_reply: turn!.reply,
        p_targets: envelope.targetIds, p_result: "synthetic-smoke-receipt", p_handoff: false });
      if (finished.error) throw finished.error;
      if (sequence === 1) {
        const after = await db.from("conversation_states").select("collected").eq("conversation_id", conversationId).single();
        if (after.error) throw after.error;
        const instances = Object.values(after.data.collected.instances) as { status: string; wait?: { presentedAt?: number }; action?: unknown }[];
        console.info("SMOKE_RESULT", JSON.stringify({ reply: turn!.reply, instances, offers: after.data.collected.offers }));
        expect(instances.some(i => i.status === "waiting_input" && typeof i.wait?.presentedAt === "number")).toBe(true);
        expect(instances.every(i => !i.action)).toBe(true);
      }
    }
  } finally {
    await db.from("workflow_inbound_queue").delete().eq("business_id", businessId).eq("operator_user_id", userId).eq("test_stream_id", streamId).throwOnError();
    await db.from("conversations").delete().eq("business_id", businessId).eq("id", conversationId).eq("panel_stream_id", streamId).throwOnError();
  }
});
