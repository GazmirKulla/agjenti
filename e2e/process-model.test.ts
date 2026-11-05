import { describe, expect, it } from "vitest";
import { initialSnapshot, type ProcessDefinition } from "../src/lib/orchestration/contracts";
import { interpretCustomer } from "../src/lib/orchestration/interpret";
import { recordPresentation, transitionCustomer, type Environment } from "../src/lib/orchestration/transition";

const definition: ProcessDefinition = {
  id: "contact_request", versionId: "version-contact", businessId: "synthetic-business",
  name: "Request a consultation", purpose: "Collect the organization's contact email to request a consultation", offerPolicy: "when_relevant",
  entry: "email", fields: [{ id: "email_registration", subject: "organization", label: "Organization email", type: "email", required: true }],
  steps: [
    { id: "email", kind: "collect", fieldId: "email_registration", next: "review" },
    { id: "review", kind: "confirm", fieldIds: ["email_registration"], label: "Review the consultation request", yes: "done", no: "declined" },
    { id: "done", kind: "end", label: "Request collected" }, { id: "declined", kind: "end", label: "Request declined" },
  ],
};
const cases = [
  { language: "sq", email: "Emaili i biznesit është demo@example.test", detour: "Para se të vendos, a mund të ma shpjegosh si vazhdon më tej?", approve: "Vazhdoje kërkesën me këto të dhëna.", negate: "Nuk po e konfirmoj ende; dua të di nëse mund ta ndryshoj emailin." },
  { language: "en", email: "Use demo@example.test for our organization", detour: "Before deciding, could you explain what happens next?", approve: "Please proceed with the request using those details.", negate: "I'm not confirming yet; can I change the email later?" },
  { language: "it", email: "L'email della nostra azienda è demo@example.test", detour: "Prima di decidere, mi spieghi cosa succede dopo?", approve: "Procedi con la richiesta usando questi dati.", negate: "Non sto ancora confermando; posso cambiare l'email in seguito?" },
  { language: "tr", email: "Şirketimizin e-posta adresi demo@example.test", detour: "Karar vermeden önce bundan sonra ne olacağını açıklar mısın?", approve: "Bu bilgilerle talebi ilerletmeni istiyorum.", negate: "Henüz onaylamıyorum; e-posta adresini daha sonra değiştirebilir miyim?" },
];

describe("real model: custom field and delivered confirmation", () => {
  for (const sample of cases) {
    it.concurrent(sample.language, async () => {
      let serial = 0;
      const env: Environment = { mode: "test", now: Date.now(), definitions: [definition], startableVersionIds: new Set([definition.versionId]), tools: [], promptTtlMs: 120000, id: () => `target-${++serial}` };
      const base = initialSnapshot(definition.businessId, `conversation-${sample.language}`, "test");
      const event = (message: string) => ({ id: `event-${++serial}`, businessId: base.businessId, conversationId: base.conversationId, actor: "customer" as const, message });
      let state = transitionCustomer(base, event("Request a consultation"), { revision: 0, needsClarification: false, commands: [{ kind: "start", definitionId: definition.id, versionId: definition.versionId, initialFacts: [], evidence: "Request a consultation" }] }, env).state;
      const id = state.focusId!;
      state = recordPresentation(state, [state.instances[id].wait!.id], env.now);
      const email = await interpretCustomer({ message: sample.email, state, env, history: [{ role: "assistant", content: "What is your organization's email?" }], deadline: Date.now() + 16000 });
      state = transitionCustomer(state, event(sample.email), email.observation, env).state;
      expect(state.instances[id].facts.email_registration.value).toBe("demo@example.test");
      expect(state.instances[id].stepId).toBe("review");
      const target = state.instances[id].wait!.id;
      state = recordPresentation(state, [target], env.now);
      const history = [{ role: "assistant" as const, content: "The request uses demo@example.test. Do you confirm sending this consultation request?" }];
      // Each call gets the same checkpoint; these are semantic probes, not a synthetic chat completion claim.
      const outputs = [];
      for (const message of [sample.detour, sample.negate, sample.approve]) {
        outputs.push(await interpretCustomer({ message, state, env, history, deadline: Date.now() + 16000 }));
      }
      for (const output of outputs.slice(0, 2)) {
        const next = transitionCustomer(state, event(output === outputs[0] ? sample.detour : sample.negate), output.observation, env);
        expect(next.state.instances[id].status).toBe("waiting_approval");
        expect(next.state.instances[id].wait!.id).toBe(target);
        expect(next.actions).toEqual([]);
      }
      const approved = transitionCustomer(state, event(sample.approve), outputs[2].observation, env);
      expect(approved.state.instances[id].status, JSON.stringify(outputs[2].observation)).toBe("completed");
      console.info(JSON.stringify({ language: sample.language, model: email.model, calls: 4, elapsedMs: [email, ...outputs].map(o => o.elapsedMs),
        inputTokens: [email, ...outputs].reduce((sum, o) => sum + o.inputTokens, 0), outputTokens: [email, ...outputs].reduce((sum, o) => sum + o.outputTokens, 0) }));
    }, 80000);
  }
});

describe("real model: process offer policy", () => {
  it("proposes a collection-only consultation after learning the business and its needs", async () => {
    const configured = { ...definition, purpose: "Offer a consultation to businesses that want to automate customer replies, product recommendations and order collection. Propose once the customer has described their business and automation needs." };
    const env: Environment = { mode: "test", now: Date.now(), definitions: [configured], startableVersionIds: new Set([configured.versionId]), tools: [], promptTtlMs: 60000 };
    const state = initialSnapshot(configured.businessId, "offer-probe", "test");
    const meaning = await interpretCustomer({ state, env, message: "te gjtiha", deadline: Date.now() + 16000, history: [
      { role: "user", content: "ne shesim produkte ne instagram, produkte kozmetike" },
      { role: "assistant", content: "Çfarë do të automatizonit më shumë: përgjigjet për produktet, rekomandimet apo mbledhjen e porosive?" },
    ] });
    expect(meaning.observation.commands, JSON.stringify(meaning.observation)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "offer", definitionId: configured.id })]));
    const result = transitionCustomer(state, { id: "offer-event", businessId: state.businessId, conversationId: state.conversationId, actor: "customer", message: "te gjtiha" }, meaning.observation, env);
    expect(result.notices.some(n => n.kind === "offer")).toBe(true);
    expect(result.actions).toEqual([]);
  });
  it("allows a normal informational closing with no configured process", async () => {
    const env: Environment = { mode: "test", now: Date.now(), definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 60000 };
    const meaning = await interpretCustomer({ state: initialSnapshot("information-only", "closing-probe", "test"), env, message: "okay super", deadline: Date.now() + 16000,
      history: [{ role: "assistant", content: "Mund ta shohësh orarin tonë në faqen e biznesit." }] });
    expect(meaning.observation.commands).toEqual([]);
    expect(meaning.observation.needsClarification).toBe(false);
  });
});
