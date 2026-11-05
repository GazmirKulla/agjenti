import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(()=>({actor:vi.fn(),allow:vi.fn(),prepare:vi.fn(),execute:vi.fn(),row:{} as Record<string,unknown>, receipts:new Map<string,unknown>(), updates:[] as Record<string,unknown>[]}));
vi.mock("./access",()=>({configurationActor:m.actor,operationActor:m.actor}));
vi.mock("./service",()=>({prepareOperation:m.prepare,executeOperation:m.execute}));
vi.mock("@/lib/dashboard/modules/entitlements",()=>({requireModuleAllowed:m.allow}));
vi.mock("@/lib/supabase/service",()=>({createServiceSupabase:()=>({from:(table:string)=>{
  let id=""; let update:Record<string,unknown>|undefined;
  const q={select:()=>q,eq:(key:string,value:unknown)=>{if(key==="id")id=String(value);return q;},update:(v:Record<string,unknown>)=>{update=v;m.updates.push(v);return q;},maybeSingle:async()=>({data:update?{id}:table==="business_operation_plans"?m.row:m.receipts.get(id)??null,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return q;
}})}));
import { configurationFingerprint, executeConfigurationPlan, type ConfigurationPlan } from "./plans";
const makeSteps=():ConfigurationPlan["steps"]=>[
  {version:2,requestId:"one",definition:{key:"knowledge.save",input:{title:"Hours",body:"Open weekdays",is_active:true}},authority:{request:"Configure replies",expires:Date.now()+60000,evidence:[{step:0,quote:"Configure replies"}]}},
  {version:2,requestId:"two",definition:{key:"business.autoreply",input:{enabled:true},after:[0]},authority:{request:"Configure replies",expires:Date.now()+60000,evidence:[{step:1,quote:"Configure replies"}]}},
];
beforeEach(()=>{vi.clearAllMocks();m.receipts.clear();m.updates=[];const steps=makeSteps();m.row={steps,fingerprint:configurationFingerprint(steps)};m.actor.mockResolvedValue({});m.allow.mockResolvedValue(undefined);m.prepare.mockImplementation(async(_b,_u,key,input)=>({version:1,key,input,snapshot:{},requestId:"generated",preview:{title:key,fields:[]}}));m.execute.mockResolvedValue({message:"Saved",path:"knowledge"});});
it("persists each resolved snapshot before dispatch and completes dependent steps in order",async()=>{
  const result=await executeConfigurationPlan("tenant","owner","plan");
  expect(result.state).toBe("completed");expect(m.execute.mock.calls.map(c=>c[2].requestId)).toEqual(["one","two"]);
  expect(m.updates.filter(u=>u.steps)).toHaveLength(2);
});
it("replays completed work without repeating it and blocks uncertain outcomes",async()=>{
  m.receipts.set("one",{state:"completed",result:{}});m.receipts.set("two",{state:"uncertain"});
  const result=await executeConfigurationPlan("tenant","owner","plan");
  expect(result).toMatchObject({state:"blocked",completed:["knowledge.save"]});expect(m.execute).not.toHaveBeenCalled();
});
it("stops when authority expires or membership is revoked",async()=>{
  const steps=makeSteps();steps[0].authority.expires=1;m.row={steps,fingerprint:configurationFingerprint(steps)};
  expect(await executeConfigurationPlan("tenant","owner","plan")).toMatchObject({state:"blocked",completed:[]});expect(m.execute).not.toHaveBeenCalled();
  m.actor.mockRejectedValueOnce(Error("revoked"));await expect(executeConfigurationPlan("tenant","owner","plan")).rejects.toThrow("revoked");
});
it("fingerprints are independent of JSONB key order but bind exact inputs and authority",async()=>{
  const steps=makeSteps();const reordered=steps.map(s=>({authority:s.authority,prepared:s.prepared,requestId:s.requestId,definition:{input:s.definition.input,key:s.definition.key,after:s.definition.after},version:s.version}));
  expect(configurationFingerprint(reordered)).toBe(configurationFingerprint(steps));
  (m.row.steps as ConfigurationPlan["steps"])[0].definition.input.body="Tampered";
  await expect(executeConfigurationPlan("tenant","owner","plan")).rejects.toThrow("ndryshuar");expect(m.execute).not.toHaveBeenCalled();
});
it("rejects a prepared action whose immutable target differs from the authorized step",async()=>{
 const steps=makeSteps();
 steps[0].prepared={version:1,key:"knowledge.save",input:{id:"another",title:"Hours",body:"Tampered"},snapshot:{},requestId:"one",preview:{title:"Wrong target",fields:[]}};
 m.row={steps,fingerprint:configurationFingerprint(steps)};
 expect(await executeConfigurationPlan("tenant","owner","plan")).toMatchObject({state:"blocked",completed:[]});
 expect(m.execute).not.toHaveBeenCalled();
});
