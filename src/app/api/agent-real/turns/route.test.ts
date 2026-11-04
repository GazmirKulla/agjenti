import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({rpc:vi.fn(),after:vi.fn(),run:vi.fn(),access:vi.fn()}));
vi.mock("@/lib/tenant/access",()=>({getSessionUser:async()=>({id:"owner"}),requireBusinessAccess:async()=>({business:{id:"tenant"}})}));
vi.mock("@/lib/conversations/transport-access",async original=>({...await original<object>(),transportAccess:m.access}));
vi.mock("@/lib/agents/panel-chat/execute",()=>({runPanelChat:m.run}));
vi.mock("next/server",async original=>({...await original<object>(),after:m.after}));
import { POST } from "./route";
const streamId="00000000-0000-4000-8000-000000000001",requestId="00000000-0000-4000-8000-000000000002";
const input={streamId,requestId,sequence:0,input:{message:"Synthetic request"}};
const request=(data:unknown,origin="https://local.test")=>new Request("https://local.test/api/agent-real/turns?slug=demo",{method:"POST",headers:{origin},body:JSON.stringify(data)});
beforeEach(()=>{
 vi.clearAllMocks();
 m.access.mockResolvedValue({userId:"owner",db:{rpc:m.rpc}});
 m.rpc.mockImplementation(async(name:string)=>({data:name==="can_use_panel_chat"?true:{},error:null}));
});
it("requires same-origin access and current owner/admin authorization",async()=>{
 expect((await POST(request(input,"https://foreign.test"))).status).toBe(403);
 expect(m.access).not.toHaveBeenCalled();
 m.rpc.mockResolvedValueOnce({data:false,error:null});
 expect((await POST(request(input))).status).toBe(403);
 expect(m.after).not.toHaveBeenCalled();
});
it("creates the real stream only after an explicit mode confirmation",async()=>{
 expect((await POST(request({streamId,start:true}))).status).toBe(400);
 expect(m.rpc).not.toHaveBeenCalledWith("create_panel_chat",expect.anything());
 expect((await POST(request({streamId,start:true,confirmRealActions:true}))).status).toBe(201);
 expect(m.rpc).toHaveBeenCalledWith("create_panel_chat",{p_business:"tenant",p_user:"owner",p_stream:streamId});
});
it.each(["session","state","visualPreview","attachments"])("rejects client-supplied %s at the real execution boundary",async field=>{
 expect((await POST(request({...input,input:{...input.input,[field]:"forged"}}))).status).toBe(400);
 expect(m.rpc).not.toHaveBeenCalledWith("enqueue_panel_chat",expect.anything());
 expect(m.after).not.toHaveBeenCalled();
});
it("enqueues under the authenticated scope and defers the canonical worker",async()=>{
 expect((await POST(request({...input,businessId:"foreign",userId:"foreign"}))).status).toBe(202);
 expect(m.rpc).toHaveBeenCalledWith("enqueue_panel_chat",expect.objectContaining({p_business:"tenant",p_user:"owner",p_stream:streamId,p_request:requestId,p_sequence:0}));
 expect(m.run).not.toHaveBeenCalled();
 await m.after.mock.calls[0][0]();
 expect(m.run).toHaveBeenCalledWith({businessId:"tenant",userId:"owner",streamId});
});
it("does not report acceptance or dispatch after an enqueue conflict",async()=>{
 m.rpc.mockImplementation(async(name:string)=>name==="can_use_panel_chat"?{data:true,error:null}:{data:null,error:{message:"conflict"}});
 expect((await POST(request(input))).status).toBe(409);
 expect(m.after).not.toHaveBeenCalled();
});
