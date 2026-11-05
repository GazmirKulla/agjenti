/** Real planner + independent reviewer, synthetic tenant and no business writes. */
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({observations:[] as unknown[],prepare:vi.fn(),execute:vi.fn(),assess:vi.fn(),load:vi.fn()}));
vi.mock("openai",async original=>{
 const actual=await original<typeof import("openai")>();
 return {...actual,default:new Proxy(actual.default,{construct(Target,args){const client=Reflect.construct(Target,args);client.responses.create=new Proxy(client.responses.create.bind(client.responses),{async apply(target,receiver,args){const response=await Reflect.apply(target,receiver,args) as {output_text:string};m.observations.push({kind:args[0].text?.format?.name,response:JSON.parse(response.output_text),...(args[0].text?.format?.name==="configuration_review"?{input:JSON.parse(args[0].input)}:{})});return response;}});return client;}})};
});
afterEach(()=>{if(process.env.CONFIGURATION_MODEL_DIAGNOSTICS==="1") console.log(JSON.stringify(m.observations));});
vi.mock("@/lib/actions/operations/plans",()=>({prepareConfigurationPlan:m.prepare,executeConfigurationPlan:m.execute,loadConfigurationPlan:vi.fn(),renewConfigurationPlan:vi.fn(),prepareOperationPlan:vi.fn(),resumeOperationPlan:vi.fn(),executeOperationPlan:vi.fn()}));
vi.mock("@/lib/capabilities/assessment",()=>({assessBusinessCapabilities:m.assess,summarizeCapabilityAssessments:(v:unknown)=>v}));
vi.mock("@/lib/business-assistant/workflow-service",async original=>({...await original<typeof import("@/lib/business-assistant/workflow-service")>(),loadAssistantWorkflow:m.load}));
vi.mock("@/lib/supabase/service",()=>({createServiceSupabase:()=>({from:(table:string)=>{
 const data=table==="businesses"?[{id:"synthetic",name:"Synthetic shop",catalog_source:"internal"}]:[];
 const q={select:()=>q,eq:()=>q,order:()=>q,gte:()=>q,limit:()=>q,returns:async()=>({data,count:data.length,error:null})};return q;
}})}));
import {planRequest} from "@/lib/business-assistant/service";
import {reviewConfigurationRequest} from "@/lib/business-assistant/configuration-review";
import {emptyVisualGraph} from "@/lib/workflows/visual/model";
const live=it.skipIf(process.env.RUN_SEMANTIC_MODEL!=="1");
const access={businessId:"synthetic",userId:"synthetic-owner",modules:["settings","knowledge","agents","products","orders","workflows"],catalogSource:"internal"};
beforeEach(()=>{
 vi.clearAllMocks();m.observations=[];
 m.assess.mockResolvedValue(["knowledge.answer","order.create"].map(capabilityKey=>({capabilityKey,status:"needs_setup",missingRequirements:["active_knowledge"],reasonCode:"missing_configuration"})));
 m.load.mockResolvedValue({workspace:{graph:emptyVisualGraph(),revision:0,generated:true,available:true,enabled:false,publishedVersionId:null},published:null});
 m.prepare.mockResolvedValue({id:"synthetic-plan"});
 m.execute.mockResolvedValue({planId:"synthetic-plan",state:"completed",completed:["Synthetic knowledge"],total:1,message:"Synthetic test only"});
});
live("configures the supplied business facts instead of presenting an empty activation loop",async()=>{
 const request="un kam nje faqe instagrami me produkte femijesh, kryesisht veshje por dhe aksesore, dua qe ju ti pergjigjeni klienteve dhe te krijoni porosi ketu duke marre te dhenat e klientit si adrese dhe numer telefoni";
 const result=await planRequest(access,request,[],{page:"home",entryPoint:"home"});
 expect(result.configuration?.state).toBe("completed");expect(result.actionPlan).toBeUndefined();
 const steps=m.prepare.mock.calls[0][2] as {key:string;input:Record<string,unknown>}[];
 expect(steps.some(s=>s.key==="knowledge.save" && s.input.is_active===true)).toBe(true);
 expect(steps.some(s=>s.key==="product.create")).toBe(false);
 expect(steps.some(s=>s.key==="order.submit")).toBe(false);
});
live.each([
 "Mos ndrysho asgjë. Dua vetëm një plan për përgjigjet automatike.",
 "Do not activate anything. Explain how setup would work.",
 "Quelles informations dois-je préparer avant d’activer les réponses ?",
])("does not authorize live configuration from a read-only request: %s",async request=>{
 await expect(reviewConfigurationRequest(request,[],[{key:"business.autoreply",input:{enabled:true}}],{})).rejects.toThrow();
});
live("rejects invented commercial policy even in an authorized setup request",async()=>{
 await expect(reviewConfigurationRequest("Konfiguro agjentin për dyqanin tim të veshjeve.",[],[{key:"knowledge.save",input:{title:"Shipping",body:"Free worldwide shipping and returns within 90 days",is_active:true}}],{})).rejects.toThrow();
});
