import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({access:vi.fn(),session:vi.fn(),rpc:vi.fn(),from:vi.fn(),after:vi.fn(),run:vi.fn(),prior:null as unknown,retried:null as unknown,filters:[] as unknown[],rows:[] as unknown[]}));
vi.mock("@/lib/tenant/access",()=>({getSessionUser:async()=>({id:"user"}),requireBusinessAccess:async()=>({business:{id:"tenant"}})}));
vi.mock("@/lib/conversations/transport-access",async original=>({...await original<typeof import("@/lib/conversations/transport-access")>(),transportAccess:m.access}));
vi.mock("@/lib/agents/test-chat/session",()=>({readTestSession:m.session}));
vi.mock("@/lib/conversations/workflow-queue",()=>({runWorkflowQueue:m.run}));
vi.mock("@/lib/crypto/tokens",()=>({decryptSecret:(value:string)=>value}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),after:m.after}));
import { POST, GET } from "./route";
const input={requestId:"00000000-0000-4000-8000-000000000001",streamId:"00000000-0000-4000-8000-000000000002",sequence:0,input:{message:"synthetic",session:null}};
const request=(data:unknown=input)=>new Request("http://local.test/api/agent-test/turns?slug=synthetic",{method:"POST",body:JSON.stringify(data)});
beforeEach(()=>{
 vi.clearAllMocks();m.prior=null;m.retried=null;m.filters=[];m.rows=[];m.run.mockResolvedValue(1);m.session.mockReturnValue({turns:0});m.rpc.mockResolvedValue({data:{id:1,status:"queued"},error:null});
 m.access.mockResolvedValue({userId:"user",db:{rpc:m.rpc,from:m.from}});
 m.from.mockImplementation(()=>{
  let update=false;
  const chain={select:()=>chain,eq:(...args:unknown[])=>{m.filters.push(args);return chain;},limit:()=>chain,order:()=>chain,lt:()=>chain,gt:()=>chain,update:()=>{update=true;return chain;},maybeSingle:async()=>({data:update?m.retried:m.prior,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:m.rows,error:null}).then(resolve)};return chain;
 });
});
it("rejects a missing first message instead of starting at sequence 1",async()=>{
 expect((await POST(request({...input,sequence:1}))).status).toBe(409);expect(m.rpc).not.toHaveBeenCalled();expect(m.after).not.toHaveBeenCalled();
});
it("allows a fork only from its authenticated checkpoint position",async()=>{
 m.session.mockReturnValue({turns:3});expect((await POST(request({...input,sequence:3,input:{...input.input,session:"sealed"}}))).status).toBe(202);
 expect(m.rpc).toHaveBeenCalledWith("enqueue_transport_operation",expect.objectContaining({p_sequence:3,p_user:"user",p_business:"tenant",p_scope:input.streamId}));
});
it("scopes private worker and persisted lookup to current tenant/user/stream",async()=>{
 expect((await POST(request())).status).toBe(202);await m.after.mock.calls[0][0]();
 expect(m.run).toHaveBeenCalledWith(10,{businessId:"tenant",userId:"user",streamId:input.streamId});
 expect(m.filters).toEqual(expect.arrayContaining([["business_id","tenant"],["operator_user_id","user"],["test_stream_id",input.streamId]]));
});
it("does not claim retry success when the attempt limit or TTL blocked the write",async()=>{
 m.prior={id:1};m.rpc.mockResolvedValue({data:{id:1,status:"failed"},error:null});
 expect((await POST(request({...input,retry:true}))).status).toBe(409);expect(m.after).not.toHaveBeenCalled();
 m.retried={id:1};expect((await POST(request({...input,retry:true}))).status).toBe(202);
});
it("rejects revoked membership and invalid checkpoint without accepting work",async()=>{
 m.access.mockResolvedValueOnce(null);expect((await POST(request())).status).toBe(403);
 m.session.mockImplementationOnce(()=>{throw new Error("expired");});expect((await POST(request())).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
});
it("computes the fragment hint on the server and ignores fabricated grouping/count fields",async()=>{
 expect((await POST(request({...input,input:{message:'Emri: Drita',fragmentKind:'fragment',messageCount:20},batchId:'forged'}))).status).toBe(202);
 const payload=m.rpc.mock.calls[0][1].p_payload;
 expect(payload.fragmentKind).toBe('separate');
 expect(payload).not.toHaveProperty('messageCount');expect(payload).not.toHaveProperty('batchId');
 m.rpc.mockClear();
 expect((await POST(request({...input,input:{message:'po mundohem'}}))).status).toBe(202);
 expect(m.rpc.mock.calls[0][1].p_payload.fragmentKind).toBe('fragment');
});
it("does not reset a batched child as an independent retry",async()=>{
 m.rpc.mockResolvedValue({data:{id:2,status:'batched',batch_parent_id:1},error:null});
 expect((await POST(request({...input,retry:true}))).status).toBe(409);
 expect(m.after).not.toHaveBeenCalled();
});
it("returns one authoritative group outcome only within the already-authorized private stream",async()=>{
 const result={reply:'synthetic',session:'sealed'};
 const head={id:10,client_request_id:'head',client_sequence:0,status:'sent',expires_at:new Date(Date.now()+60000).toISOString(),result_ciphertext:JSON.stringify(result)};
 m.rows=[head,{id:11,client_request_id:'child',client_sequence:1,status:'batched',batch_parent_id:10},{id:12,client_request_id:'orphan',client_sequence:2,status:'batched',batch_parent_id:99}];
 const response=await GET(new Request(`http://local.test/api/agent-test/turns?slug=synthetic&stream=${input.streamId}`));
 const {jobs}=await response.json();
 expect(jobs[0]).toMatchObject({requestId:'head',batchId:'head',status:'sent',result});
 expect(jobs[1]).toMatchObject({requestId:'child',sequence:1,batchId:'head',status:'sent',result});
 expect(jobs[2]).toMatchObject({status:'failed',result:null});
 expect(m.from).toHaveBeenCalledTimes(1);
 expect(m.filters).toEqual(expect.arrayContaining([['business_id','tenant'],['operator_user_id','user'],['test_stream_id',input.streamId]]));
 m.rows=[{...head,expires_at:'2000-01-01T00:00:00Z'},m.rows[1]];
 const expired=await (await GET(new Request(`http://local.test/api/agent-test/turns?slug=synthetic&stream=${input.streamId}`))).json();
 expect(expired.jobs.map((job:{result:unknown})=>job.result)).toEqual([null,null]);
});
