import { expect, it } from "vitest";
import { inboundBatch, fragmentKind, testInputBatch } from "./message-batch";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import type { WorkflowJob } from "./workflow-queue";
const first: NormalizedIncomingMessage = { channel: "instagram", externalMessageId: "first", externalParticipantId: "person", text: "Ckemi", attachments: [], timestamp: new Date(), contextMetadata: { instagramAccountId: "account" }, rawPayload: {}, phone: null, senderUsername: null, senderDisplayName: null };
const job = (payloads: NormalizedIncomingMessage[]): WorkflowJob => ({ id: 1, payload: first, participant_id: "person", business_id: "business", connection_id: "connection", status: "processing", lease_token: "lease", reply: null, batch_payloads: payloads });
it("retains media, originals and insertion order without mutating the frozen payloads", () => {
 const second = { ...first, externalMessageId: "second", text: "Kete produkt", attachments: [{ kind: "image" as const, externalMediaId: null, sourceUrl: "https://example.test/photo", mimeType: "image/png" }] };
 const frozen = [first, second];
 const result = inboundBatch(first, job(frozen));
 expect(result.message.text).toBe("Ckemi\nKete produkt");
 expect(result.message.attachments).toEqual(second.attachments);
 expect(result.originals.map(item => item.externalMessageId)).toEqual(["first", "second"]);
 expect(frozen[0].text).toBe("Ckemi");
});
it.each([
 { externalParticipantId: "other" },
 { contextMetadata: { instagramAccountId: "other-account" } },
 { channel: "whatsapp" as const },
 { externalMessageId: "first" },
 { timestamp: new Date(NaN) },
])("rejects invalid batch identity or timestamp (%j)", patch => {
 expect(() => inboundBatch(first, job([first, { ...first, externalMessageId: "second", ...patch }]))).toThrow();
});
it("rejects empty, oversized and wrong-leader batches", () => {
 for (const payloads of [[], Array(21).fill(first), [{ ...first, externalMessageId: "other" }]]) expect(() => inboundBatch(first, job(payloads))).toThrow();
});
it("recognizes unfinished discourse without treating the hint as operational consent", () => {
 expect(['pse','po mundohem','cfare po t them'].map(t=>fragmentKind(t))).toEqual(['fragment','fragment','fragment']);
 expect(['ti psh','mund ta kuptosh','tek e tek','te kuptoj'].map(t=>fragmentKind(t))).toEqual(Array(4).fill('continuation'));
 expect(fragmentKind('?')).toBe('close');
});
it.each(['po','jo','ok','konfirmoj','dua porosi','anulo rezervimin','Si quhem une','Miqail\nShitje rroba online\nfiliz_studio_\nSa kushton, a e keni kete masen','Emri: Miqail','Sa kushton produkti?','A mund te rezervoj','+355691234567'])('keeps P1 facts, recall, confirmation and complete questions separate: %s', text => {
 expect(fragmentKind(text)).toBe('separate');
});
it("never batches attachments and does not open a window for a single field answer", () => {
 expect(fragmentKind('pse',true)).toBe('separate');
 expect(fragmentKind('Miqail')).toBe('continuation');
});
it("supports WhatsApp originals without accepting a different account", () => {
 const wa = {...first,channel:'whatsapp' as const,contextMetadata:{whatsappPhoneNumberId:'phone'}};
 expect(inboundBatch(wa,job([wa,{...wa,externalMessageId:'next',text:'fragment'}])).message.text).toBe('Ckemi\nfragment');
 expect(()=>inboundBatch(wa,job([wa,{...wa,externalMessageId:'next',contextMetadata:{whatsappPhoneNumberId:'foreign'}}]))).toThrow();
});
it("joins a private frozen batch in order, retaining the authoritative starting session", () => {
 const parts = ['po mundohem','te kuptoj','cfare po ndodh'].map((message,sequence)=>({slug:'synthetic',message,sequence,requestId:`id-${sequence}`}));
 const queued = {...job([]),client_sequence:0,client_request_id:'id-0',batch_payloads:parts as unknown as WorkflowJob['batch_payloads']};
 const input = {slug:'synthetic',message:'po mundohem',session:'authenticated-session'};
 expect(testInputBatch(input,queued)).toEqual({input:{...input,message:parts.map(p=>p.message).join('\n')},count:3});
 for (const patch of [{slug:'foreign'},{sequence:8},{requestId:'id-0'},{hasMedia:true},{attachments:['token']}]) {
  expect(()=>testInputBatch(input,{...queued,batch_payloads:[parts[0],{...parts[1],...patch}] as unknown as WorkflowJob['batch_payloads']})).toThrow();
 }
 expect(testInputBatch(input,{...queued,batch_payloads:null})).toEqual({input,count:1});
});
