import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
import { parseProviderReactions, sendManualReaction } from "./provider-reactions";
import { createIsolatedExecution, runWithExecution } from "@/lib/runtime/execution-context";
const now = Date.UTC(2026,9,24,12), fetcher = vi.fn();
const ig = (action: string, emoji?: string, time = now, sender = "customer", recipient = "account") => ({ object:"instagram", entry:[{id:"account",messaging:[{sender:{id:sender},recipient:{id:recipient},timestamp:time,reaction:{mid:"target-part",action,emoji}}]}] });
const wa = (emoji?: string, time = now) => ({object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"account"},messages:[{id:"event",from:"customer",timestamp:time/1000,type:"reaction",reaction:{message_id:"target-part",...(emoji===undefined?{}:{emoji})}}]}}]}]});
beforeEach(()=>{vi.stubGlobal("fetch",fetcher);fetcher.mockReset();});
afterEach(()=>vi.unstubAllGlobals());
it("normalizes customer add/change/remove independently for both official envelopes",()=>{
  for(const make of [(e?:string)=>ig(e?"react":"unreact",e),wa]) for(const emoji of ["❤️","👍",undefined]) {
    expect(parseProviderReactions(make(emoji),now)).toEqual([expect.objectContaining({accountId:"account",participantId:"customer",messageId:"target-part",emoji:emoji??""})]);
  }
});
it("rejects malformed emoji, stale/future timestamps, wrong recipients and business echoes",()=>{
  for(const p of [ig("react","yes"),ig("react","👍👍"),ig("invalid","👍"),ig("react","👍",now+600000),ig("react","👍",0),ig("react","👍",now,"account","customer"),ig("react","👍",now,"customer","foreign")])expect(parseProviderReactions(p,now)).toEqual([]);
});
it("keeps duplicates/out-of-order identity for atomic DB ordering, including removals",()=>{
  expect([wa("👍",now),wa(undefined,now-1000),wa("👍",now)].flatMap(x=>parseProviderReactions(x,now)).map(x=>x.emoji)).toEqual(["👍","","👍"]);
});
it.each(["instagram","whatsapp"] as const)("sends a %s reaction, not an emoji text message",async channel=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify(channel==="instagram"?{recipient_id:"customer"}:{messages:[{id:"reaction-ack"}]})));
  const result=await sendManualReaction({channel,accountId:"account",token:"synthetic",to:"customer",messageId:"exact-target",emoji:"👍"});
  expect(result.status).toBe("sent");
  const body=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toEqual(channel==="instagram"?{recipient:{id:"customer"},sender_action:"react",payload:{message_id:"exact-target",reaction:"👍"}}:{messaging_product:"whatsapp",recipient_type:"individual",to:"customer",type:"reaction",reaction:{message_id:"exact-target",emoji:"👍"}});
  expect(body.message?.text??body.text).toBeUndefined();
});
it("Instagram removal omits reaction; unsupported WA removal makes no HTTP call",async()=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify({success:true})));
  expect((await sendManualReaction({channel:"instagram",accountId:"a",token:"synthetic",to:"customer",messageId:"target",emoji:""})).status).toBe("sent");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({recipient:{id:"customer"},sender_action:"unreact",payload:{message_id:"target"}});
  fetcher.mockClear();expect((await sendManualReaction({channel:"whatsapp",accountId:"a",token:"synthetic",to:"customer",messageId:"target",emoji:""})).status).toBe("failed");expect(fetcher).not.toHaveBeenCalled();
});
it.each([400,500])("classifies provider %i without inventing success",async code=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify({error:{code:100}}),{status:code}));
  expect((await sendManualReaction({channel:"instagram",accountId:"a",token:"synthetic",to:"p",messageId:"m",emoji:"❤️"})).status).toBe(code===400?"failed":"uncertain");
});
it("timeout and malformed ACK are uncertain and never retried by the adapter",async()=>{
  fetcher.mockRejectedValueOnce(new DOMException("Timed out","TimeoutError")).mockResolvedValueOnce(new Response("{}"));
  const p={channel:"instagram" as const,accountId:"a",token:"synthetic",to:"p",messageId:"m",emoji:"❤️"};
  expect((await sendManualReaction(p)).status).toBe("uncertain");expect((await sendManualReaction(p)).status).toBe("uncertain");expect(fetcher).toHaveBeenCalledTimes(2);
});
it("a conflicting Instagram recipient in an ACK cannot confirm success",async()=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify({message_id:"target",recipient_id:"another-person"})));
  expect((await sendManualReaction({channel:"instagram",accountId:"a",token:"synthetic",to:"customer",messageId:"target",emoji:"❤️"})).status).toBe("uncertain");
});
it("W6a isolated execution refuses any provider reaction",async()=>{
  await expect(runWithExecution(createIsolatedExecution(),()=>sendManualReaction({channel:"instagram",accountId:"a",token:"synthetic",to:"p",messageId:"m",emoji:"❤️"}))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
