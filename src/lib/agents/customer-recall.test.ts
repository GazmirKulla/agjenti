import {it,expect} from "vitest";
import {migrateContext,extractExplicitFacts} from "@/lib/workflows/context";
import {extractCustomerDeclaredFacts} from "@/lib/workflows/customer-declared-facts";
import {projectCustomerContext} from "./customer-context";
import {validateResponse} from "./response-consistency";
it("question examples are declarations, not requests for unknown identity or verified business instructions", () => {
  const state = migrateContext();
  expect(extractCustomerDeclaredFacts(state, "Pyetjet tipike: sa kushton? a e keni masen X?")).toBe(1);
  const message = "Çfarë pyetjesh marr zakonisht?";
  const customer = projectCustomerContext(state, message);
  expect(customer.declared.stated_needs).toMatchObject({ value: "sa kushton? a e keni masen X?" });
  const result = validateResponse("Nuk m'i ke treguar pyetjet.", { state, message, customer, informational: true, products: [], services: [] });
  expect(result.reply).toContain("sa kushton?");
  expect(extractCustomerDeclaredFacts(state, "Instagram: cili është profili yt?; Lloji i biznesit: çfarë shes?")).toBe(0);
  expect(state.context?.order).toEqual({});
});
function fixture(message:string){const state=migrateContext();extractExplicitFacts(state,"Quhem Miqail");extractCustomerDeclaredFacts(state,"Instagram: filiz_studio_; Lloji i biznesit: Shitje rrobash online; Pyetjet tipike: masat dhe gjendja");return{state,message,customer:projectCustomerContext(state,message),informational:true,products:[],services:[]};}
it.each(["Si e kisha emrin une?","Po dhe si quhem?","Si e kam emrin?"])("F2/F3 supported name variants share the same authority: %s",message=>{
const e=fixture(message);expect(e.customer.profile.name.value).toBe("Miqail");expect(validateResponse("Nuk ma ke treguar emrin.",e).reply).toBe("Ti ke deklaruar emrin: Miqail.");expect(validateResponse("Ti quhesh Miqail.",e).reply).toBe("Ti quhesh Miqail.");});
it.each(["Çfarë shes unë?","Jo, unë Miqaili çfarë shes?","Edhe njëherë, çfarë shes unë?"])("F2/F3 customer business, not tenant offering: %s",message=>{
const e=fixture(message);expect(e.customer.declared.business_type.value).toBe("Shitje rrobash online");expect(validateResponse("Ti ofron automatizim AI si Agjenti.app.",e).reply).toContain("Shitje rrobash online");expect(validateResponse("Ti shet rroba online.",e).reply).toBe("Ti shet rroba online.");});
it("Instagram recall corrects denials, not account ownership",()=>{const e=fixture("Cili është Instagram-i im?");expect(validateResponse("Nuk ma ke treguar Instagramin.",e).reply).toContain("filiz_studio_");expect(validateResponse("Ke deklaruar profilin @filiz_studio_.",e).reply).toBe("Ke deklaruar profilin @filiz_studio_.");});
it("short follow-up uses only bounded user topic; handle never proves sales location",()=>{const e=fixture("Ku?");e.state.recentMessages=[{role:"user",content:"Çfarë shes unë?"},{role:"assistant",content:"Invented policy"}];e.customer=projectCustomerContext(e.state,e.message);expect(e.customer.reference?.relation).toBe("sales_location");expect(validateResponse("Ti shet në Instagram.",e).reply).toContain("nuk provon");e.state.recentMessages=[{role:"user",content:"Çfarë ofron Agjenti.app?"}];expect(projectCustomerContext(e.state,"Ku?").reference).toBeUndefined();});
it.each(["Çfarë ofron Agjenti.app?","Cili është telefoni i biznesit?","Si quhet pronari?","A ofroni shërbime online?"])("does not disclose unrelated customer identity: %s",message=>{const e=fixture(message);expect(e.customer.profile).toEqual({});expect(e.customer.declared).toEqual({});expect(validateResponse("Agjenti.app ofron automatizim AI.",e).reply).toBe("Agjenti.app ofron automatizim AI.");});
it("corrections supersede values; assistant history never supplies missing facts",()=>{const e=fixture("Si e kam emrin?");extractExplicitFacts(e.state,"Quhem Elira");e.state.recentMessages=[{role:"assistant",content:"Ti quhesh Miqail."}];e.customer=projectCustomerContext(e.state,e.message);expect(validateResponse("Ti quhesh Miqail.",e).reply).toContain("Elira");const other=migrateContext();other.recentMessages=e.state.recentMessages;expect(projectCustomerContext(other,e.message).profile).toEqual({});});
it("preserves acknowledgements to declarations rather than treating them as recall",()=>{const e=fixture("Quhem Miqail");expect(validateResponse("Faleminderit, si mund të të ndihmoj?",e).reply).toBe("Faleminderit, si mund të të ndihmoj?");});
it("unknown customer identity stays uncertain rather than borrowed from model/history",()=>{const e=fixture("Si quhem?");e.state=migrateContext();e.customer=projectCustomerContext(e.state,e.message);expect(validateResponse("Ti quhesh Invented.",e).status).toBe("unverifiable");expect(validateResponse("Nuk e di emrin.",e).reply).toBe("Nuk e di emrin.");});
