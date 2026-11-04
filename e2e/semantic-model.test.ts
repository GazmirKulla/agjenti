/** Opt-in, real provider; synthetic inputs only, no database or effects. */
import { it, expect } from "vitest";
import { interpretMessage } from "@/lib/conversations/understanding/interpret";
import { emptyState } from "@/lib/workflows/engine";
import { interpretProcessOffer } from "@/lib/conversations/interpret-process-offer";
const live = it.skipIf(process.env.RUN_SEMANTIC_MODEL !== "1");
live.each([
 ["Si funksionon lidhja me Instagram?", { intent:"information", question:true }],
 ["Vazhdo me porosinë e mëparshme.", { navigation:"resume", process:"order" }],
 ["No, don't create anything yet.", { act:"decline" }],
 ["Non voglio prenotare, vorrei solo sapere il prezzo.", { intent:"information" }],
 ["Je veux le deuxième produit de la liste.", { referenceMode:"ordinal", referenceIndex:2 }],
 ["Emri im është Elira.", { facts:[{key:"name",value:"Elira",evidence:"Emri im është Elira."}] }],
 ["Nuk dua produktin e parë, dua të dytin.", { referenceMode:"ordinal", referenceIndex:2, correction:true }],
])("interprets synthetic message %s", async(message,expected)=>{
 const state=emptyState();
 state.recentMessages=[{role:"assistant",content:"Dëshiron ta krijoj kërkesën tani?"}];
 const result=await interpretMessage(message,state);
 // Evidence may be a shorter exact substring; verify the semantic values.
 if("facts" in expected) expect(result.facts).toContainEqual(expect.objectContaining({key:"name",value:"Elira"}));
 else expect(result).toMatchObject(expected);
 console.log(JSON.stringify({message,meaning:{intent:result.intent,act:result.act,navigation:result.navigation,reference:result.referenceMode}}));
});
live("keeps a question detour separate from acceptance of the registration offer",async()=>{
 const offer={flowId:"registration",prompt:"Dëshiron të përgatisim biznesin tënd?"};
 for(const [message,relation] of [["A duhet të jap fjalëkalimin?","clarify"],["Po, le ta nisim përgatitjen e biznesit.","accept"],["Faleminderit për shpjegimin.","other"]]){
  const result=await interpretProcessOffer({message,offer,history:[{role:"assistant",content:offer.prompt}]});
  expect(result?.relation).toBe(relation);
 }
});

import { briefingQuestion } from "@/lib/business-assistant/briefing-intent";
import { validateResponse } from "@/lib/agents/response-consistency";
live.each([
 ["Sa porosi u regjistruan sot?", "today"],
 ["Zeig mir die Zusammenfassung dieser Woche.", "week"],
 ["Sa porosi kemi sot dhe krijo një produkt", null],
 ["Compare revenue today and yesterday", null],
])("interprets owner briefing scope without phrase lists: %s",async(text,period)=>{
 expect(await briefingQuestion(text)).toBe(period);
});
live("retains two independent requests for server clarification",async()=>{
 const meaning=await interpretMessage("Dua të bëj një porosi dhe gjithashtu të rezervoj një takim.",emptyState());
 expect(meaning.requestedProcesses).toEqual(expect.arrayContaining(["order","booking"]));
});
live("blocks an unreceipted ownership invitation claim",async()=>{
 const result=await validateResponse("Biznesi u krijua dhe lidhja e pronësisë të është dërguar.",{
  message:"A u krijua biznesi?",state:emptyState(),informational:true,products:[],services:[],customer:{profile:{},declared:{}},
 });
 expect(result.changed).toBe(true);
 expect(result.findings).toContainEqual(expect.objectContaining({code:"execution_receipt_absent"}));
 expect(result.reply).not.toContain("të është dërguar");
});
