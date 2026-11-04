import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateAgentReply } from "@/lib/agents/generate";
import { migrateContext } from "@/lib/workflows/context";
import { extractCustomerDeclaredFacts } from "@/lib/workflows/customer-declared-facts";
import { readResult, type BusinessGrounding } from "@/lib/agents/business-grounding";
import { chooseGuidance } from "@/lib/workflows/guidance";
const config=JSON.parse(readFileSync('config/businesses/agjenti-app.json','utf8'));
const questions = [
  'okay super, por ju mesazhet i ktheni nga instagrami im domethen?',
  'e kam fjalen, mesazhet qe i ktheni klienteve te mi - ja ktheni nga instagrami im, a duhet te ju jap une te dhenat e instagramit apo cfare?',
  'Si i marr produktet nga website dhe a ndryshon stoku automatikisht?',
  'A mund ta lidh edhe WhatsApp?'
];
it.skipIf(process.env.RUN_JOURNEY_MODEL !== '1')('checks the real model against the prepared business knowledge', async()=>{
  const state=migrateContext();
  extractCustomerDeclaredFacts(state,'Lloji i biznesit: dyqan veshjesh për fëmijë; Pyetjet tipike: produktet dhe masat');
  const grounding: BusinessGrounding = {
    products: readResult("products", "trial", {data:[], count:0}),
    services: readResult("booking_services", "trial", {data:[], count:0}),
    knowledge: readResult("knowledge_entries", "trial", {data:config.knowledge.map((k: {title:string;body:string}, i:number)=>({...k,id:String(i)})), count:config.knowledge.length}),
    documents: readResult("catalog_sections", "trial", {data:[], count:0}),
    inventory:"unsupported", availability:"unverified", bookingModuleEnabled:false,
  };
  for(const customerMessage of questions){
    const result=await generateAgentReply({grounding,onTrace:event=>{if(event.label === "Response consistency checked") console.log(JSON.stringify(event.data));},instructions:config.instructions,communication:config.communication,state,knowledge:config.knowledge.map((k: {title:string;body:string})=>k.title+'\n'+k.body).join('\n\n'),customerMessage,previousResponseId:null,catalogSummary:''});
    console.log(JSON.stringify({question:customerMessage,reply:result.reply,followup:result.customerQuestion,source:result.source}));
    expect.soft(result.source).toBe('ai'); expect.soft(result.reply).not.toContain('nuk kam deklarim');
    expect.soft((result.reply.match(/\?/g)||[]).length+(result.customerQuestion?1:0)).toBeLessThanOrEqual(1);
  }
},120000);
it.skipIf(process.env.RUN_JOURNEY_MODEL !== '1')('verifies real semantic routing without executing any action',async()=>{
 for(const [message,expected] of [['Si mund të regjistrohem?','route'],['A përgjigjeni nga Instagrami im?','answer'],['A kushton regjistrimi?','answer']]){
 const selected=await chooseGuidance({message,state:migrateContext(),targets:[],routes:[{id:'flow_registration',label:'Regjistrim biznesi',kind:'custom'}],allowOrder:false,allowSupport:false,allowProcessInquiry:true});
 console.log(JSON.stringify({message,selected}));expect(selected.action).toBe(expected);
 }
},120000);
