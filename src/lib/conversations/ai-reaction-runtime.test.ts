import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),send:vi.fn(),decrypt:vi.fn(),isolated:vi.fn(),events:[] as string[],policy:true,connectionError:false}));
vi.mock('@/lib/supabase/service',()=>({createServiceSupabase:()=>({rpc:m.rpc,from:m.from})}));
vi.mock('@/lib/crypto/tokens',()=>({decryptSecret:m.decrypt}));
vi.mock('./provider-reactions',()=>({sendManualReaction:m.send}));
vi.mock('@/lib/runtime/execution-context',()=>({isIsolatedExecution:m.isolated}));
import {runAiReaction} from './ai-reaction-runtime';
const input={businessId:'tenant',conversationId:'conversation',messageId:'internal-message-uuid',text:'Faleminderit',channel:'instagram' as const,
 accountId:'ig-account',participantId:'customer',autoReplyEnabled:true,humanTakeover:false,jobId:1,leaseToken:'queue-lease'};
const reservation={id:'operation',claimed:true,token:'lease',channel:'instagram',connectionId:'connection',participant:'customer',externalId:'meta-message-id',status:'sending'};
beforeEach(()=>{
 vi.clearAllMocks();m.events=[];m.policy=true;m.connectionError=false;m.isolated.mockReturnValue(false);m.decrypt.mockReturnValue('synthetic');
 m.from.mockImplementation((table:string)=>{
  m.events.push(table);
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='businesses'?{auto_reply:true,ai_reactions_enabled:m.policy}:table==='message_reaction_operations'?{status: 'uncertain',provider_id:null,error:'synthetic persisted result'}:table==='conversations'?{status:'active',auto_reply:true}:table==='instagram_connections'?{ig_user_id:'ig-account',access_token_ciphertext:'sealed',status:'connected'}:null,error:table==='instagram_connections'&&m.connectionError?{}:null})};return q;
 });
 m.rpc.mockImplementation(async(name:string)=>{m.events.push(name);return {data:name==='reserve_ai_message_reaction'?reservation:name==='begin_ai_message_reaction'?true:null,error:null};});
 m.send.mockImplementation(async()=>{m.events.push('provider');return {status:'sent',externalId:null,error:null};});
});
describe('actual AI reaction orchestration (SQL/provider mocked)',()=>{
 it('sends the provider message identity, never the internal message UUID',async()=>{
  await runAiReaction(input);
  expect(m.send).toHaveBeenCalledOnce();expect(m.send.mock.calls[0][0]).toMatchObject({messageId:'meta-message-id',to:'customer',accountId:'ig-account'});
 });
 it('performs the atomic final guard after credential loading and immediately before send',async()=>{
  await runAiReaction(input);
  expect(m.events.slice(m.events.indexOf('instagram_connections'),m.events.indexOf('provider')+1)).toEqual(['instagram_connections','begin_ai_message_reaction','provider']);
 });
 it.each(['sending','uncertain','failed','sent'])('does not send or fabricate acceptance for duplicate %s',async status=>{
  m.rpc.mockResolvedValueOnce({data:{...reservation,claimed:false,duplicate:true,status},error:null});
  const result=await runAiReaction(input);expect(m.send).not.toHaveBeenCalled();
  if(status!=='sent')expect(result.result?.status).not.toBe('sent');
 });
 it('fails closed when takeover or manual revision supersedes the final claim',async()=>{
  m.rpc.mockImplementation(async(name:string)=>({data:name==='reserve_ai_message_reaction'?reservation:false,error:null}));
  await runAiReaction(input);expect(m.send).not.toHaveBeenCalled();
 });
 it('never dispatches from an isolated Agent Test execution',async()=>{
  m.isolated.mockReturnValue(true);await runAiReaction(input);expect(m.send).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
 });
 it('keeps default OFF inert before reservation',async()=>{
  m.policy=false;await runAiReaction(input);expect(m.rpc).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
 });
 it('a missing connection does not start an external effect',async()=>{
  m.connectionError=true;await runAiReaction(input);expect(m.send).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalledWith('begin_ai_message_reaction',expect.anything());
 });
 it('retries only result persistence, never a timed-out provider action',async()=>{
  let finishes=0;
  m.rpc.mockImplementation(async(name:string)=>({data:name==='reserve_ai_message_reaction'?reservation:name==='begin_ai_message_reaction'?true:null,error:name==='finish_message_reaction'&&finishes++===0?{}:null}));
  m.send.mockResolvedValue({status:'uncertain',externalId:null,error:'Synthetic timeout'});
  const result=await runAiReaction(input);expect(m.send).toHaveBeenCalledOnce();expect(result.result?.status).toBe('uncertain');
  expect(m.rpc.mock.calls.filter(([name])=>name==='finish_message_reaction')).toHaveLength(2);
 });
 it('does not throw optional reaction failures into the normal reply path',async()=>{
  m.rpc.mockRejectedValue(new Error('synthetic connection loss'));
  await expect(runAiReaction(input)).resolves.toBeDefined();expect(m.send).not.toHaveBeenCalled();
 });
});
