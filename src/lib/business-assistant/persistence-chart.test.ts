import { expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({revision:1,write:vi.fn(),events:vi.fn()}));
vi.mock("@/lib/business-assistant/service",()=>({openTicket:vi.fn(),loadSelectedContext:vi.fn()}));
vi.mock("@/lib/tracking/events",()=>({recordCapabilityEvents:m.events}));
vi.mock("@/lib/supabase/service",()=>({createServiceSupabase:()=>({rpc:async(_name:string,args:{p_operation:string;p_payload:unknown})=>{
 m.write(args);if(args.p_operation==="finish")m.revision=2;return {data:{revision:m.revision},error:null};
}})}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabase:async()=>({from:(table:string)=>{
 const result=()=>({error:null,data:table==="assistant_conversations"?{revision:m.revision,plan_revision:4}:table==="assistant_messages"?[]:{revision:4,snapshot:{version:1,request:"Change product",preview:{title:"Pending review",fields:[]}},preferences:{}}});
 const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve:(v:unknown)=>void)=>Promise.resolve(result()).then(resolve)};return q;
}})}));
import { persistedTurn } from "./persistence";
it("stores chart blocks and records their outcome only after saving, without changing the pending plan",async()=>{
 const chart={type:"chart" as const,version:1 as const,chart:{title:"Orders",kind:"line" as const,categories:[{key:"2026-11-25",label:"25.11"}],series:[{key:"orders",label:"Orders",values:[2]}]}};
 await persistedTurn({businessId:"b",userId:"u",modules:["reports","orders"],catalogSource:"internal"},
 {conversationId:"00000000-0000-4000-8000-000000000001",requestId:"00000000-0000-4000-8000-000000000002",revision:1},
 {mode:"plan",content:"Orders chart"},async()=>({reportChart:true,message:"2 orders",blocks:[chart]}));
 const finish=m.write.mock.calls.find(([args])=>args.p_operation==="finish")![0];
 expect(finish.p_payload.blocks).toEqual([chart]);expect(finish.p_payload).not.toHaveProperty("snapshot");expect(finish.p_payload).not.toHaveProperty("preferences");
 expect(m.events).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({capability:"assistant.report_chart",point:"stored"})]));
 expect(m.write.mock.invocationCallOrder.at(-1)).toBeLessThan(m.events.mock.invocationCallOrder[0]);
});
