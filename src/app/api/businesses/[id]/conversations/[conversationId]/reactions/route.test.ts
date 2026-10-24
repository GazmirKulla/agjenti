import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),send:vi.fn(),maybe:vi.fn()}));
vi.mock("@/lib/conversations/transport-access",async o=>({...await o<typeof import("@/lib/conversations/transport-access")>(),transportAccess:m.access}));
vi.mock("@/lib/conversations/provider-reactions",()=>({sendManualReaction:m.send}));
vi.mock("@/lib/crypto/tokens",()=>({decryptSecret:()=>"synthetic-only"}));
import { GET,POST } from "./route";
const id="10000000-0000-4000-8000-000000000001",cid="20000000-0000-4000-8000-000000000001",mid="30000000-0000-4000-8000-000000000001",rid="40000000-0000-4000-8000-000000000001";
const ctx={params:Promise.resolve({id,conversationId:cid})},body={messageId:mid,requestId:rid,emoji:"👍",revision:0};
const post=(value:unknown=body)=>POST(new Request("https://local.test/reactions",{method:"POST",body:JSON.stringify(value)}),ctx);
beforeEach(()=>{
 vi.clearAllMocks();const q={select:()=>q,eq:()=>q,maybeSingle:m.maybe};
 m.access.mockResolvedValue({userId:"operator",db:{rpc:m.rpc,from:()=>q}});
 m.rpc.mockImplementation(async name=>({data:name==="reserve_message_reaction"?{claimed:true,token:"fence",channel:"instagram",connectionId:"connection",participant:"server-person",externalId:"server-message"}:[],error:null}));
 m.maybe.mockResolvedValue({data:{ig_user_id:"server-account",access_token_ciphertext:"sealed",status:"connected"},error:null});
 m.send.mockResolvedValue({status:"sent",externalId:null,error:null});
});
it("uses server-authorized identities, never client provider IDs or actor",async()=>{
 expect((await post({...body,actor:"customer",providerId:"foreign",tenantId:"other"})).status).toBe(200);
 expect(m.send).toHaveBeenCalledWith(expect.objectContaining({to:"server-person",messageId:"server-message",accountId:"server-account"}));
 expect(m.rpc).toHaveBeenCalledWith("reserve_message_reaction",expect.objectContaining({p_business:id,p_user:"operator",p_conversation:cid,p_message:mid,p_request:rid}));
});
it("does not resend duplicate, in-flight or uncertain requests",async()=>{
 for(const status of ["sending","sent","uncertain"]){m.rpc.mockResolvedValueOnce({data:{claimed:false,status},error:null});expect((await post()).status).toBe(200);}expect(m.send).not.toHaveBeenCalled();
});
it("retries only DB completion when persistence fails, not provider HTTP",async()=>{
 const original=m.rpc.getMockImplementation()!;let n=0;m.rpc.mockImplementation(async(name,...args)=>name==="finish_message_reaction"?{error:++n===1?{}:null}:original(name,...args));
 expect((await post()).status).toBe(200);expect(m.send).toHaveBeenCalledOnce();expect(n).toBe(2);
});
it("failed persistence returns uncertainty for reload/reconciliation",async()=>{
 const original=m.rpc.getMockImplementation()!;m.rpc.mockImplementation(async(name,...args)=>name==="finish_message_reaction"?{error:{}}:original(name,...args));
 const response=await post();expect(response.status).toBe(503);expect((await response.json()).status).toBe("uncertain");expect(m.send).toHaveBeenCalledOnce();
});
it("blocks revoked membership and cross-tenant/stale target before provider call",async()=>{
 m.access.mockResolvedValueOnce(null);expect((await post()).status).toBe(403);
 m.rpc.mockResolvedValueOnce({error:{message:"reaction_revision_conflict"}});expect((await post()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();
});
it("rejects unsupported emoji or malformed identity before reservation",async()=>{
 for(const value of [{...body,emoji:"yes"},{...body,requestId:"invalid"},{...body,revision:-1},{...body,retryAttempt:0}])expect((await post(value)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
});
it("GET rechecks membership and is never cached",async()=>{
 const response=await GET(new Request("https://local.test/reactions"),ctx);expect(response.headers.get("Cache-Control")).toBe("no-store");expect(m.send).not.toHaveBeenCalled();
 m.access.mockResolvedValueOnce(null);expect((await GET(new Request("https://local.test/reactions"),ctx)).status).toBe(403);
});
