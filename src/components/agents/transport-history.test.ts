import { describe, expect, it } from "vitest";
import { reconcileTestConversation, readHistory, type ChatTurn, type TestConversation } from "./chat-history";
import { emptyState } from "@/lib/workflows/engine";
const turn = (text: string): ChatTurn => ({ session: text, reply: text, nextState: emptyState(), previousResponseId:null,workflowId:null,productName:null,workflowProgress:[],turns:1,autoReplyEnabled:true,debug:{source:"ai",model:"synthetic",fallbackReason:null,agentConfigured:true,knowledgeCount:0,productCount:0,workflowSteps:[],elapsedMs:0} });
const chat: TestConversation = {id:"stream",title:"Synthetic",entries:[],updatedAt:0,outbox:[0,1,2].map(i=>({id:`op-${i}`,sequence:i,text:`message ${i}`,photo:false,attachments:[],session:null,status:"queued"}))};
describe("durable test UI reconciliation", () => {
  it("does not trust malformed persisted outbox data after reload", () => {
    expect(readHistory(JSON.stringify([{...chat,outbox:{}}]))).toEqual([]);
    expect(readHistory(JSON.stringify([{...chat,outbox:[{...chat.outbox![0],sequence:-1}]}]))).toEqual([]);
  });
  it("restores 3 in-flight operations after reload with the same identities", () => {
    expect(readHistory(JSON.stringify([chat]))[0].outbox?.map(o=>o.id)).toEqual(["op-0","op-1","op-2"]);
  });
  it("keeps message/reply order when results arrive out of order and twice", () => {
    const second = { requestId:"op-1",sequence:1,status:"sent",result:turn("second") };
    const early = reconcileTestConversation(chat,[second]);
    expect(early.entries).toHaveLength(0);
    const first = {requestId:"op-0",sequence:0,status:"sent",result:turn("first")};
    const reconciled = reconcileTestConversation(early,[second,first]);
    expect(reconciled.entries.map(e=>e.result.reply)).toEqual(["first","second"]);
    expect(reconcileTestConversation(reconciled,[first,second]).entries).toHaveLength(2);
    expect(reconciled.outbox?.map(o=>o.id)).toEqual(["op-2"]);
  });
  it("rejects another operation/sequence result and preserves failures for same-ID retry", () => {
    const result = reconcileTestConversation(chat,[{requestId:"other",sequence:0,status:"sent",result:turn("foreign")},{requestId:"op-0",sequence:1,status:"sent",result:turn("stale")},{requestId:"op-0",sequence:0,status:"failed",error:"synthetic timeout"}]);
    expect(result.entries).toEqual([]);
    expect(result.outbox?.[0]).toMatchObject({id:"op-0",status:"failed",error:"synthetic timeout"});
  });
});
