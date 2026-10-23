import { describe, it, expect } from "vitest";
import { consumeCustomerQuestion, renderCustomerQuestion, type QuestionField } from "./customer-question";
import { migrateContext, setFact } from "./context";
import { rememberTurn } from "./guidance";
const fields: QuestionField[] = ["name", "business_type", "instagram_handle", "stated_needs"];
const original = "Miqail\n\nShitje rrobash online\n\nfiliz_studio_\n\nKam pyetje per masat, a eshte gjendje etj";
function setup(keys = fields) {
  const state = migrateContext(); state.schemaVersion = 3;
  const reply = renderCustomerQuestion(state, `[[ask_customer:${keys.join(",")}]]`, "tenant", true, 1000);
  state.recentMessages = [{ role: "assistant", content: reply }];
  return state;
}
function answer(state: ReturnType<typeof setup>, message: string, now = 2000) {
  const before = structuredClone(state);
  const result = consumeCustomerQuestion(state, { businessId: "tenant", message, test: true, now });
  if (result) rememberTurn(before, state, message, result.reply);
  return result;
}
describe("F1 server-owned bounded question (not arbitrary assistant prose)", () => {
  it.each([original, original.replaceAll("\n\n", "\n")])("maps the original four answers only under a valid question", message => {
    const state = setup(); expect(answer(state, message)?.accepted).toBe(4);
    expect(state.context?.profile.name).toMatchObject({ value: "Miqail", source: "customer_declaration" });
    expect(state.customerDeclaredFacts?.instagram_handle?.value).toBe("filiz_studio_");
    expect(state.customerDeclaredFacts?.business_type?.value).toBe("Shitje rrobash online");
    expect(state.customerDeclaredFacts?.stated_needs?.value).toBe("Kam pyetje per masat, a eshte gjendje etj");
    expect(state.context?.order).toEqual({}); expect(state.pendingCustomerQuestion).toBeUndefined();
  });
  it("does not depend on a particular customer/business", () => {
    const state = setup(); expect(answer(state, "Elira\nOfroj konsulencë ligjore\n@synthetic_law\nKlientet pyesin per takime")?.accepted).toBe(4);
    expect(state.context?.profile.name?.value).toBe("Elira");
  });
  it("retains partial progress, consumes the remaining response, and tolerates duplicate input", () => {
    const state = setup(); expect(answer(state, "Miqail\nShitje rrobash online")?.accepted).toBe(2);
    expect(state.pendingCustomerQuestion?.fields).toEqual(["instagram_handle", "stated_needs"]);
    expect(answer(state, "Miqail\nShitje rrobash online")?.accepted).toBe(0);
    expect(state.pendingCustomerQuestion?.fields).toEqual(["instagram_handle", "stated_needs"]);
    expect(answer(state, "filiz_studio_\nKam pyetje per masat")?.accepted).toBe(2);
  });
  it("reordered labelled fields are explicit; unlabelled reorder must clarify without partial corruption", () => {
    const state = setup(); const result = answer(state, "filiz_studio_\nMiqail\nShitje rrobash online\nKam pyetje per masat");
    expect(result?.accepted).toBe(0); expect(state.context?.profile).toEqual({}); expect(state.customerDeclaredFacts).toBeUndefined();
    expect(answer(state, "Instagram: filiz_studio_; Pyetjet tipike: masat; Emri: Miqail; Lloji i biznesit: Shitje rrobash online")?.accepted).toBe(4);
  });
  it.each(["Hello\nWorld", "Arben\nElira", "Tekst i rastësishëm\nNjë paragraf tjetër", "Miqail\nShitje rrobash online\nnot-an-instagram\nKam pyetje"]) ("ambiguous/unrelated/invalid answers do not create facts: %s", message => {
    const state=setup(); expect(answer(state,message)?.accepted).toBe(0); expect(state.context?.profile).toEqual({}); expect(state.customerDeclaredFacts).toBeUndefined();
  });
  it.each(["leje fare", "Ta bëjmë një test sikur ti të ishe klienti?", "Dua të rezervoj", "Vazhdo"]) ("navigation belongs to the coordinator: %s", message => {
    const state=setup(); expect(answer(state,message)).toBeNull(); expect(state.pendingCustomerQuestion).toBeUndefined(); expect(state.context?.profile).toEqual({});
  });
  it("expired, foreign-tenant, undelivered and old prose do not authorize extraction", () => {
    expect(answer(setup(),original,1000000)).toBeNull();
    const other=setup(); expect(consumeCustomerQuestion(other,{businessId:"other",message:original,test:true,now:2000})).toBeNull();
    const missing=setup(); expect(consumeCustomerQuestion(missing,{businessId:"tenant",message:original,test:false,now:2000})).toBeNull();
    const delivered=setup(); expect(consumeCustomerQuestion(delivered,{businessId:"tenant",message:original,test:false,deliveredReply:delivered.pendingCustomerQuestion!.prompt,now:2000})?.accepted).toBe(4);
    const prose=migrateContext(); prose.recentMessages=[{role:"assistant",content:"Emri, biznesi, Instagrami dhe pyetjet?"}]; expect(answer(prose,original)).toBeNull();
  });
  it("staff ownership, pause and process snapshots are not bypassed", () => {
    for(const kind of ["staff", "pause", "order"]){const state=setup(); if(kind==="staff")state.staffHandoff=true;else if(kind==="pause")state.conversationPaused=true;else state.processes={active:"order"};
      const context=structuredClone(state.context);expect(answer(state,original)).toBeNull();expect(state.context).toEqual(context);}
  });
  it("explicit corrections reuse canonical profile invalidation without changing process fields", () => {
    const state=setup(); answer(state,"Miqail\nShitje rrobash online"); state.context!.execution.orderConfirmed=true;
    expect(answer(state,"Emri: Elira; Instagram: corrected_profile; Pyetjet tipike: oraret")?.accepted).toBe(3);
    expect(state.context?.profile.name?.value).toBe("Elira");expect(state.context?.execution.orderConfirmed).toBe(false);
    expect(state.context?.order).toEqual({});
  });
  it("server strips unsupported slots, does not reask known facts, and v1/v2 remain readable", () => {
    for(const version of [undefined,2,3] as const){const state=migrateContext(); state.schemaVersion=version;
      expect(renderCustomerQuestion(state,"[[ask_customer:password]]","tenant",true)).not.toContain("ask_customer");expect(state.pendingCustomerQuestion).toBeUndefined();
      setFact(state,"customer_name","Elira","text","message_label");renderCustomerQuestion(state,"[[ask_customer:name,instagram_handle]]","tenant",true);
      expect(state.pendingCustomerQuestion?.fields).toEqual(["instagram_handle"]);expect(migrateContext(JSON.parse(JSON.stringify(state))).pendingCustomerQuestion).toEqual(state.pendingCustomerQuestion);}
  });
});
