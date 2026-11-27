import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), run: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/conversations/transport-access", async original => ({ ...await original<typeof import("@/lib/conversations/transport-access")>(), transportAccess: m.access }));
vi.mock("@/lib/conversations/workflow-queue", () => ({ runWorkflowQueue: m.run }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: m.after }));
import { GET, POST } from "./route";
const business = "10000000-0000-4000-8000-000000000001", conversation = "20000000-0000-4000-8000-000000000001", requestId = "30000000-0000-4000-8000-000000000001";
const call = (body: unknown = { requestId, body: "Përshëndetje nga stafi" }) => POST(new Request("https://example.test/messages", {method:"POST",body:JSON.stringify(body)}), {params:Promise.resolve({id:business,conversationId:conversation})});
beforeEach(() => {
 vi.clearAllMocks();
 m.access.mockResolvedValue({userId:"operator",db:{rpc:m.rpc}});
 m.rpc.mockResolvedValue({data:{status:"prepared"},error:null});
 m.run.mockResolvedValue(1);
});
it("acknowledges durable enqueue, not provider delivery; ownership is claimed by the same RPC transaction",async()=>{
 const response=await call();expect(response.status).toBe(202);
 expect(await response.json()).toEqual({accepted:true,requestId,status:"prepared"});
 expect(m.rpc).toHaveBeenCalledWith("enqueue_transport_operation",expect.objectContaining({p_business:business,p_user:"operator",p_scope:conversation,p_request:requestId,p_kind:"staff"}));
 expect(m.run).not.toHaveBeenCalled();
 await m.after.mock.calls[0][0]();expect(m.run).toHaveBeenCalledOnce();
});
it("reuses request identity/fingerprint on retry rather than sending directly",async()=>{
 await call();await call();
 expect(m.rpc.mock.calls[0]).toEqual(m.rpc.mock.calls[1]);
});
it("three rapid requests are individually enqueued without merging",async()=>{
 const ids=[1,2,3].map(n=>`30000000-0000-4000-8000-00000000000${n}`);
 const replies=await Promise.all(ids.map((requestId,i)=>call({requestId,body:`message ${i}`})));
 expect(replies.map(r=>r.status)).toEqual([202,202,202]);
 expect(m.rpc.mock.calls.map(([,p])=>p.p_request)).toEqual(ids);
 expect(m.run).not.toHaveBeenCalled();
});
it("does not start work if ownership/enqueue cannot commit",async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:"synthetic transaction failure"}});
 expect((await call()).status).toBe(409);expect(m.after).not.toHaveBeenCalled();
});
it.each([null,{body:"No identity"},{requestId,body:" "},{requestId,body:"x".repeat(20001)}])("rejects malformed operations %j before RPC",async body=>{
 expect((await call(body)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects unauthenticated, revoked or cross-tenant access",async()=>{
 m.access.mockResolvedValue(null);expect((await call()).status).toBe(403);
 expect(m.rpc).not.toHaveBeenCalled();expect(m.after).not.toHaveBeenCalled();
});
it("does not turn an uncertain existing operation into a fresh send",async()=>{
 m.rpc.mockResolvedValue({data:{status:"uncertain"},error:null});
 const response=await call();expect((await response.json()).status).toBe("uncertain");
 expect(m.rpc).toHaveBeenCalledWith("enqueue_transport_operation",expect.objectContaining({p_request:requestId}));
});
it("requires atomic same-operation eligibility and attempt fencing for explicit provider retry",async()=>{
 m.rpc.mockResolvedValueOnce({data:{status:"prepared"},error:null});
 const response=await call({requestId,body:"Përshëndetje nga stafi",retryAttempt:1});
 expect((await response.json()).status).toBe("prepared");
 expect(m.rpc).toHaveBeenCalledWith("retry_staff_transport",{p_business:business,p_user:"operator",p_conversation:conversation,p_request:requestId,p_attempt:1});
 expect(m.rpc).not.toHaveBeenCalledWith("enqueue_transport_operation",expect.anything());
});
it("sends a photo by the URL the server resolves and fingerprints it by its stable identity",async()=>{
 const resolved=vi.spyOn(await import("@/lib/conversations/staff-photo"),"staffPhotoToSend");
 resolved.mockResolvedValue({url:"https://files.test/signed?token=a",identity:"upload:x"});
 await call({requestId,body:"",media:{kind:"upload",path:"x"}});
 resolved.mockResolvedValue({url:"https://files.test/signed?token=b",identity:"upload:x"});
 await call({requestId,body:"",media:{kind:"upload",path:"x"}});
 expect(m.rpc.mock.calls[0][1].p_payload).toEqual({body:"",media:{kind:"image",url:"https://files.test/signed?token=a"}});
 expect(m.rpc.mock.calls[0][1].p_fingerprint).toBe(m.rpc.mock.calls[1][1].p_fingerprint);
 resolved.mockResolvedValue(null);
 expect((await call({requestId,body:"",media:{kind:"product",productId:"x"}})).status).toBe(400);
 resolved.mockRestore();
});

it("marks a send whose message is already stored, so the thread shows it at its own time and not as pending", async () => {
 const stored = "30000000-0000-4000-8000-000000000009";
 const reads: Record<string, unknown> = {
  conversations: { data: { id: conversation }, error: null },
  workflow_inbound_queue: { data: [{ client_request_id: stored, status: "failed", error: "Token i Instagramit është i pavlefshëm.", reply: "test", created_at: "2026-11-20T11:41:43Z", attempts: 1 },
   { client_request_id: requestId, status: "prepared", error: null, reply: "në radhë", created_at: "2026-11-27T10:00:00Z", attempts: 0 }], error: null },
  messages: { data: [{ transport_request_id: stored }], error: null },
 };
 const scoped: string[] = [];
 const from = (table: string) => { const q: Record<string, unknown> = {}; for (const k of ["select", "order", "limit", "in"]) q[k] = () => q;
  q.eq = (column: string, value: string) => { scoped.push(`${table}.${column}=${value}`); return q; };
  q.maybeSingle = () => Promise.resolve(reads[table]); q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(reads[table]).then(resolve); return q; };
 m.access.mockResolvedValue({ userId: "operator", db: { from } });
 const response = await GET(new Request("https://example.test/messages"), { params: Promise.resolve({ id: business, conversationId: conversation }) });
 const { jobs } = await response.json();
 expect(jobs.map((j: { requestId: string; stored: boolean }) => [j.requestId, j.stored])).toEqual([[requestId, false], [stored, true]]);
 expect(scoped).toContain(`messages.business_id=${business}`);
});
