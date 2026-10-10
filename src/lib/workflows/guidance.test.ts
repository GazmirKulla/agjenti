import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(()=>({create:vi.fn()}));
vi.mock("openai",()=>({default:class { responses={create:m.create}; }}));
vi.mock("@/lib/agents/generate",()=>({agentModel:()=>"test"}));
import { chooseGuidance, explicitIntent, recentConversation, rememberTurn } from "./guidance";
import { emptyState } from "./engine";
const input = {message:"Atë të mëparshmen doja ta rishikoja",state:emptyState(),targets:[{id:"size",label:"Madhësia"}],current:{id:"photo",label:"Foto"}};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("OPENAI_API_KEY","test-only");});
afterEach(()=>vi.unstubAllEnvs());
it.each(["ok ne rregull, fola ne telefon me stafin, dua te porosis produkt", "Fola me stafin dhe tani dua të porosis", "Kam folur me stafin. Dua të blej"])("routes a new order after past contact: %s",message=>{
 expect(explicitIntent(message)).toBe("order");
});
it.each(["Dua të flas me stafin për të porositur", "Ku është porosia?", "Nuk dua të blej"])("keeps actual support/negative/status requests out of ordering: %s",message=>{
 expect(explicitIntent(message)).not.toBe("order");
});
it("uses bounded recent conversation for ambiguous references and accepts only supplied target IDs",async()=>{
 const state={...emptyState(),recentMessages:[{role:"assistant" as const,content:"Madhësia M, vazhdojmë me foton?"}]};
 m.create.mockResolvedValue({output_text:JSON.stringify({action:"revisit",target:"size",confidence:.99,evidence:"Atë të mëparshmen"})});
 expect(await chooseGuidance({...input,state})).toMatchObject({action:"revisit",target:"size",source:"ai"});
 expect(JSON.parse(m.create.mock.calls[0][0].input).history).toEqual(state.recentMessages);
 m.create.mockResolvedValue({output_text:JSON.stringify({action:"revisit",target:"order_ready",confidence:1,evidence:input.message})});
 expect(await chooseGuidance(input)).toMatchObject({action:"continue"});
});
it.each([
 {action:"order",target:null,confidence:1,evidence:input.message},
 {action:"revisit",target:"size",confidence:.2,evidence:input.message},
 {action:"revisit",target:"size",confidence:1,evidence:"invented"},
 {action:"complete",target:"order_ready",confidence:1,evidence:input.message},
])("rejects an unsupported or ungrounded navigation: %j",async value=>{
 m.create.mockResolvedValue({output_text:JSON.stringify(value)});
 expect(await chooseGuidance(input)).toMatchObject({action:"continue"});
});
it("backtracks deterministically and clarifies ambiguous corrections on provider failure",async()=>{
 expect(await chooseGuidance({...input,message:"Kthehu pas"})).toMatchObject({action:"revisit",target:"size"});
 m.create.mockRejectedValue(new Error("offline"));
 expect(await chooseGuidance({...input,message:"Dua të ndryshoj diçka"})).toMatchObject({action:"clarify"});
 expect(input.state).toEqual(emptyState());
});
it("retains only a bounded transcript without mutating the prior state",()=>{
 const state={...emptyState(),recentMessages:Array.from({length:20},()=>({role:"user" as const,content:"a".repeat(3000)}))};
 const next=emptyState(); rememberTurn(state,next,"hello","reply");
 expect(recentConversation(next)).toHaveLength(10);
 expect(recentConversation(next).every(m=>m.content.length<=1200)).toBe(true);
 expect(state.recentMessages).toHaveLength(20);
});
