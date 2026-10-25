import { createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { sendManualReaction, type ReactionResult } from "./provider-reactions";
import { decideAiReaction } from "./ai-reaction-decision";
import { channelAdapter, type MessagingChannel } from "./channel";
import { isIsolatedExecution } from "@/lib/runtime/execution-context";

export async function runAiReaction(input: {
  businessId: string; conversationId: string; messageId: string; text: string | null;
  channel: MessagingChannel; accountId: string; participantId: string;
  autoReplyEnabled: boolean; humanTakeover: boolean; manualEmoji?: string | null;
  jobId: number; leaseToken: string;
}): Promise<{ decision: ReturnType<typeof decideAiReaction>; result?: ReactionResult }> {
  const none = (reason: string) => ({ decision: { kind: "none" as const, reason } });
  if (isIsolatedExecution()) return none("isolated_execution");
  const decision = decideAiReaction(input);
  if (decision.kind !== "reaction") return { decision };
  try {
    const db = createServiceSupabase();
    // Optional feature absence/read failure must not break normal message replies.
    const policy = await db.from("businesses").select("ai_reactions_enabled").eq("id", input.businessId).maybeSingle();
    if (policy.error || policy.data?.ai_reactions_enabled !== true) return none("ai_reactions_disabled_or_unavailable");
    const hash=createHash('sha256').update(`agjenti:ai-reaction:v1:${input.businessId}:${input.messageId}`).digest('hex');
    const requestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const reservation = await db.rpc("reserve_ai_message_reaction", {
      p_business: input.businessId, p_conversation: input.conversationId, p_message: input.messageId,
      p_request: requestId, p_emoji: decision.emoji, p_job: input.jobId, p_lease: input.leaseToken,
    });
    if (reservation.error || !reservation.data) return none("reservation_unavailable");
    const row = reservation.data as { id: string; token: string; claimed: boolean; channel: string; connectionId: string; participant: string; externalId: string };
    // A previous sending/uncertain/failed operation is NOT a successful send.
    // The authoritative reactions GET, not this return value, reports outcomes.
    if (row.claimed !== true) return none("already_reserved");
    const finish = async (result: ReactionResult) => {
      for (let attempt=0;attempt<2;attempt++) {
        try {
          const saved=await db.rpc('finish_message_reaction',{p_request:row.id,p_token:row.token,p_status:result.status,p_external:result.externalId,p_error:result.error});
          if (!saved.error) {
            const current = await db.from('message_reaction_operations').select('status,provider_id,error')
              .eq('id', row.id).eq('business_id', input.businessId).maybeSingle();
            if (!current.error && current.data && ['sent','failed','uncertain'].includes(current.data.status)) {
              return { status: current.data.status as ReactionResult['status'], externalId: current.data.provider_id, error: current.data.error };
            }
          }
        } catch { /* Retry the same DB acknowledgement, never provider HTTP. */ }
      }
      return {status:'uncertain' as const,externalId:result.externalId,error:'Reaction outcome persistence unavailable'};
    };
    let token: string, account: string;
    try {
      if (row.channel!==input.channel || row.participant!==input.participantId || !row.externalId || !row.connectionId || !row.id || !row.token) throw Error();
      const adapter=channelAdapter(input.channel);
      const connection=await db.from(adapter.table).select(`${adapter.account},access_token_ciphertext,status`)
        .eq('id',row.connectionId).eq('business_id',input.businessId).eq(adapter.account,input.accountId).maybeSingle();
      if(connection.error || !connection.data || connection.data.status!=='connected')throw Error();
      account=String('phone_number_id' in connection.data?connection.data.phone_number_id:connection.data.ig_user_id);
      if(account!==input.accountId)throw Error();
      token=decryptSecret(connection.data.access_token_ciphertext);
    } catch {
      return {decision,result:await finish({status:'failed',externalId:null,error:'Reaction connection unavailable'})};
    }
    // This short SQL transaction is the send linearization point: fresh policy,
    // inherited auto-reply, staff ownership, lease, manual tombstone/revision,
    // target/account and single dispatch. No DB transaction spans provider HTTP.
    const begun=await db.rpc('begin_ai_message_reaction',{p_request:row.id,p_token:row.token,p_account:account});
    if(begun.error || begun.data!==true)return none('fresh_guard');
    let result: ReactionResult;
    try {
      result=await sendManualReaction({channel:input.channel,accountId:account,token,to:row.participant,messageId:row.externalId,emoji:decision.emoji});
    } catch {
      result={status:'uncertain',externalId:null,error:'Reaction outcome unavailable; do not resend'};
    }
    return {decision,result:await finish(result)};
  } catch {
    return none('reaction_unavailable');
  }
}
