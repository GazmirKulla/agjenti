import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ response: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: m.response }; } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({from: () => { const q = { select:vi.fn().mockReturnThis(), eq:vi.fn().mockReturnThis(), order:vi.fn().mockReturnThis(), limit:vi.fn().mockReturnThis(), returns:vi.fn().mockResolvedValue({data:[],error:null}) };return q; }}) }));
import { planRequest } from "./service";
import { readProposal } from "./model";
import { inspectAttachment, resolveMaterials, sealAttachment } from "./materials";
const access = {userId:"user",businessId:"business",modules:["products"],catalogSource:"internal"};
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TOKEN_ENCRYPTION_KEY","test-key");vi.stubEnv("OPENAI_API_KEY","test-key"); });
it("routes a complete CSV to one shared batch review, including a price-only instruction", async () => {
  const raw = 'emri,sku,cmimi\n' + Array.from({length:10},(_,i)=>`Produkt ${i},SKU-${i},790`).join('\n');
  m.response.mockResolvedValue({output_text:JSON.stringify({action:"product_import",id:null,message:"Review",changes:[{field:"fields",value:'["price_amount","currency"]'}]})});
  const result = await planRequest(access,"Përditëso vetëm çmimet e 10 produkteve",[],undefined,undefined,[{name:"ten.csv",text:raw,kind:"document"}]);
  expect(result.productImport).toMatchObject({count:10,raw,fields:["price_amount","currency"]});
  expect(result.productImport?.token).toBeTruthy();
  expect(result.token).toBeUndefined(); // Source is not a write authorization.
});
it("does not allow model-generated CSV values, IDs, or unsupported fields", () => {
  for (const p of [{id:"11111111-1111-4111-8111-111111111111",changes:[]},{id:null,changes:[{field:"name",value:"Invented"}]}]) expect(()=>readProposal({action:"product_import",message:"",...p})).toThrow();
});
it("requires an actual supplied CSV and refuses multiple ambiguous files", async () => {
  m.response.mockResolvedValue({output_text:JSON.stringify({action:"product_import",id:null,message:"",changes:[]})});
  for (const materials of [[],[{name:"a.csv",text:"emri\nNjë",kind:"document"},{name:"b.csv",text:"emri\nDy",kind:"document"}]]) expect(await planRequest(access,"Importo",[],undefined,undefined,materials)).toMatchObject({clarifying:true});
});
it("keeps a CSV over 16000 characters complete through upload/seal/read", async () => {
  const text = 'emri,pershkrimi\n' + Array.from({length:10},(_,i)=>`Produkt ${i},${'a'.repeat(2000)}`).join('\n');
  const file = new File([text],"products.csv",{type:"text/csv"});
  const attachment = sealAttachment(await inspectAttachment(file),"user","business");
  expect((await resolveMaterials([attachment.token],[],"user","business"))[0].text).toBe(text);
});
