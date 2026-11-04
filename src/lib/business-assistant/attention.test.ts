import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), rpc: vi.fn(), from: vi.fn(), reads: [] as {table: string; filters: [string,unknown][]}[], data: {} as Record<string, unknown>, fail: "" }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: {getUser:m.user}, rpc:m.rpc, from:m.from }) }));
vi.mock("@/lib/tenant/access", () => ({ requireBusinessAccess:m.access }));
import { loadAttention } from "./attention";
beforeEach(() => {
  vi.clearAllMocks(); m.reads=[]; m.data={}; m.fail="";
  m.user.mockResolvedValue({data:{user:{id:"owner"}},error:null});
  m.access.mockResolvedValue({business:{id:"tenant",slug:"canonical"}});
  m.rpc.mockResolvedValue({data:true,error:null});
  m.from.mockImplementation((table:string) => {
    const filters:[string,unknown][]=[];m.reads.push({table,filters});
    const result=()=>({data:m.data[table]??null,count:0,error: m.fail===table ? {message:"unavailable"}:null});
    const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q;},is:()=>q,gt:()=>q,order:()=>q,limit:()=>q,or:()=>q,
      maybeSingle:async()=>result(),single:async()=>result(),then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
    return q;
  });
});
it("rejects missing sessions and foreign businesses before source reads", async () => {
  m.user.mockResolvedValue({data:{user:null},error:null});
  await expect(loadAttention("foreign")).rejects.toMatchObject({status:401});
  expect(m.from).not.toHaveBeenCalled();
  m.user.mockResolvedValue({data:{user:{id:"owner"}},error:null});m.access.mockResolvedValue(null);
  await expect(loadAttention("foreign")).rejects.toMatchObject({status:403});expect(m.from).not.toHaveBeenCalled();
});
it("tracks only the user's latest private plan and clears it when closed", async () => {
  m.data.assistant_conversations=[{id:"chat",title:"Shërbimi",plan_revision:3}];
  m.data.assistant_plan_snapshots={snapshot:{version:1,preview:{title:"Shto",fields:[]}}};
  const result=await loadAttention("alias");
  expect(result.items).toHaveLength(1);expect(result.items[0].conversationId).toBe("chat");
  expect(m.reads.find(r=>r.table==="assistant_conversations")?.filters).toEqual(expect.arrayContaining([["business_id","tenant"],["owner_user_id","owner"]]));
  expect(m.reads.find(r=>r.table==="assistant_plan_snapshots")?.filters).toContainEqual(["revision",3]);
  m.data.assistant_plan_snapshots={snapshot:{version:1,request:"",message:"Closed"}};
  expect((await loadAttention("alias")).items).toHaveLength(0);
});
it("reports unavailable sources rather than claiming there are no problems", async () => {
  m.fail="bookings";
  expect((await loadAttention("alias")).unavailable).toContain("Sinkronizimi i rezervimeve");
});
it("discards results if membership is revoked during the reads", async () => {
  m.rpc.mockResolvedValue({data:false,error:null});
  await expect(loadAttention("alias")).rejects.toMatchObject({status:403});
});
