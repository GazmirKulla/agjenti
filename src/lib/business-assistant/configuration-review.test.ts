import {beforeEach,expect,it,vi} from "vitest";
const create=vi.hoisted(()=>vi.fn());
vi.mock("openai",()=>({default:class {responses={create};}}));
import {reviewConfigurationRequest} from "./configuration-review";
const steps=[{key:"knowledge.save",input:{title:"Hours",body:"Weekdays",is_active:true}}];
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("OPENAI_API_KEY","synthetic");});
it("binds each authorized step to exact current-request evidence",async()=>{
 create.mockResolvedValue({output_text:JSON.stringify({question:"",remainingQuestion:"Cilat produkte ofron?",steps:[{step:0,quote:"Configure replies",withinRequest:true,factsGrounded:true}]})});
 expect(await reviewConfigurationRequest("Configure replies",[],steps,{})).toMatchObject({request:"Configure replies",evidence:[{step:0,quote:"Configure replies"}],remainingQuestion:"Cilat produkte ofron?"});
});
it.each([
 {step:0,quote:"Old approval",withinRequest:true,factsGrounded:true},
 {step:0,quote:"Configure replies",withinRequest:false,factsGrounded:true},
 {step:0,quote:"Configure replies",withinRequest:true,factsGrounded:false},
 {step:5,quote:"Configure replies",withinRequest:true,factsGrounded:true},
])("rejects ungrounded, denied or mismatched authoring evidence",async observation=>{
 create.mockResolvedValue({output_text:JSON.stringify({question:"",remainingQuestion:"",steps:[observation]})});
 await expect(reviewConfigurationRequest("Configure replies",[{role:"user",content:"Old approval"}],steps,{})).rejects.toThrow();
});
it("does not fall back to interpreting phrases when the model fails",async()=>{
 create.mockRejectedValue(Error("provider unavailable"));
 await expect(reviewConfigurationRequest("Po aktivizoji",[],steps,{})).rejects.toThrow();
});
