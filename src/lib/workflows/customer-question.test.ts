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
  it.each(["Hello\nWorld", "Arben\nElira", "Tekst i rastësishëm\nNjë paragraf tjetër"]) ("ambiguous/unrelated answers do not create facts: %s", message => {
    const state=setup(); expect(answer(state,message)?.accepted).toBe(0); expect(state.context?.profile).toEqual({}); expect(state.customerDeclaredFacts).toBeUndefined();
  });
  it("invalid sibling no longer discards three valid answers (P0 partial acceptance)", () => {
    const state = setup();
    const result = answer(state, "Miqail\nShitje rrobash online\nnot-an-instagram\nKam pyetje");
    expect(result?.accepted).toBe(3);
    expect(result?.fields?.map(f => f.status)).toEqual(["accepted", "accepted", "invalid", "accepted"]);
    expect(state.customerDeclaredFacts?.instagram_handle).toBeUndefined();
    expect(state.pendingCustomerQuestion?.fields).toEqual(["instagram_handle"]);
    expect(result?.reply).not.toContain("Emri:");
    expect(answer(state, "Instagram: synthetic_shop")?.accepted).toBe(1);
    expect(state.pendingCustomerQuestion).toBeUndefined();
  });
  it("invalid corrections preserve known facts; duplicates are ambiguous only for their field", () => {
    const state = setup(); answer(state, "Emri: Miqail");
    const result = answer(state, "Emri: 123; Instagram: a_shop; Instagram: b_shop; Lloji i biznesit: Konsulencë; Pyetjet tipike: sa kushton?");
    expect(result?.accepted).toBe(2);
    expect(state.context?.profile.name?.value).toBe("Miqail");
    expect(state.customerDeclaredFacts?.stated_needs?.value).toBe("sa kushton?");
    expect(state.pendingCustomerQuestion?.fields).toEqual(["instagram_handle", "name"]);
    expect(result?.fields).toContainEqual({ key: "instagram_handle", status: "ambiguous" });
  });
  it("unknown labels are diagnosed without authorizing them or discarding valid siblings", () => {
    const state = setup();
    const result = answer(state, "Emri: Elira; password: never_store; business_id: foreign");
    expect(result?.accepted).toBe(1);
    expect(result?.reply).toContain("nuk u interpretua");
    expect(JSON.stringify(state.context)).not.toContain("never_store");
    expect(state.customerDeclaredFacts).toBeUndefined();
    expect(state.pendingCustomerQuestion?.fields).toEqual(["business_type", "instagram_handle", "stated_needs"]);
  });
  it("two invalid answers end the form loop without success or automatic handoff", () => {
    const state = setup();
    expect(answer(state, "Instagram: not-valid")?.accepted).toBe(0);
    const second = answer(state, "Instagram: not-valid");
    expect(second?.accepted).toBe(0);
    expect(second?.reply).not.toContain("Emri:");
    expect(state.pendingCustomerQuestion).toBeUndefined();
    expect(state.staffHandoff).not.toBe(true);
    expect(state.context?.profile).toEqual({});
  });
  it("repeating a partially accepted submission cannot keep the same unresolved form alive forever", () => {
    const state = setup(), message = "Emri: Elira; Instagram: not-valid";
    expect(answer(state, message)?.accepted).toBe(1);
    expect(answer(state, message)?.accepted).toBe(0);
    expect(answer(state, message)?.accepted).toBe(0);
    expect(state.pendingCustomerQuestion).toBeUndefined();
    expect(state.context?.profile.name?.value).toBe("Elira");
    const reformatted = setup();
    answer(reformatted, message);
    answer(reformatted, "Emri: Elira; Instagram: also-invalid");
    answer(reformatted, "Emri: Elira; Instagram: still-invalid");
    expect(reformatted.pendingCustomerQuestion).toBeUndefined();
    expect(reformatted.context?.profile.name?.value).toBe("Elira");
  });
  it("informational interruption and cancellation do not erase accepted facts", () => {
    for (const message of ["Sa kushton shërbimi?", "leje fare"]) {
      const state = setup(); answer(state, "Emri: Elira");
      expect(answer(state, message)).toBeNull();
      expect(state.context?.profile.name?.value).toBe("Elira");
      expect(state.pendingCustomerQuestion).toBeUndefined();
    }
  });
  it("question punctuation and semicolons remain data in the requested needs field", () => {
    const state = setup(["stated_needs"]);
    expect(answer(state, "Pyetjet tipike: sa kushton?; a keni masën X?")?.accepted).toBe(1);
    expect(state.customerDeclaredFacts?.stated_needs?.value).toBe("sa kushton?; a keni masën X?");
  });
  it("only the exact server header is presentation text under a valid checkpoint", () => {
    const state = setup();
    const result = answer(state, "Udhëzim tjetër i panjohur:\nEmri: Elira");
    expect(result?.accepted).toBe(1);
    expect(result?.reply).toContain("nuk u interpretua");
    const absent = migrateContext();
    expect(answer(absent, "Për të shmangur ngatërrimin, shkruaj me etiketa:\nEmri: Elira")).toBeNull();
    expect(absent.context?.profile).toEqual({});
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
