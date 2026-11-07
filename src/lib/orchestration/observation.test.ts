import { describe, expect, it } from "vitest";
import { initialSnapshot, type ProcessDefinition } from "./contracts";
import { observationContext, parseObservation } from "./observation";
import { transitionCustomer, type Environment } from "./transition";

describe("semantic observation boundary", () => {
  it.each([
    { revision: 0, commands: [], needsClarification: false, authorized: true },
    { revision: 0, commands: [{ kind: "approve", instanceId: "i", waitId: "w", evidence: "yes", presentedAt: 1 }], needsClarification: false },
    { revision: 0, commands: [{ kind: "facts", instanceId: "i", values: [{ fieldId: "email", value: {}, evidence: "yes" }] }], needsClarification: false },
    { revision: -1, commands: [], needsClarification: false },
    { revision: 0, commands: Array.from({ length: 33 }, () => ({ kind: "cancel", instanceId: "i", evidence: "stop" })), needsClarification: false },
    { revision: 0, commands: [{ kind: "execute", tool: "sql" }], needsClarification: false },
  ])("rejects malformed or authority-bearing output %#", value => {
    expect(() => parseObservation(value)).toThrow("invalid_observation");
  });

  it("includes the entire pending custom field schema before any value has been saved", () => {
    const definition: ProcessDefinition = { id: "inquiry", versionId: "v1", businessId: "b", name: "Inquiry", purpose: "Collect a business contact", offerPolicy: "when_relevant",
      entry: "email", fields: [{ id: "email_registration", subject: "organization", label: "Registration email", type: "email", required: true }],
      steps: [{ id: "email", kind: "collect", fieldId: "email_registration", next: "done" }, { id: "done", kind: "end", label: "Saved" }] };
    const env: Environment = { mode: "test", now: 0, definitions: [definition], startableVersionIds: new Set(["v1"]), tools: [], promptTtlMs: 1000, id: () => "instance" };
    const context = observationContext(initialSnapshot("b", "c", "test"), env);
    expect(context.processes[0].fields).toEqual(definition.fields);
    expect(context.instances).toEqual([]);
    const result = transitionCustomer(initialSnapshot("b", "c", "test"), { id: "e", businessId: "b", conversationId: "c", actor: "customer", message: "Send this inquiry to me@example.test" }, parseObservation({
      revision: 0, needsClarification: false, commands: [{ kind: "start", definitionId: "inquiry", versionId: "v1", evidence: "Send this inquiry", initialFacts: [{ fieldId: "email_registration", value: "me@example.test", evidence: "me@example.test" }] }],
    }), env);
    expect(result.state.instances.instance.status).toBe("completed");
    expect(result.state.instances.instance.facts.email_registration.subject).toBe("organization");
    expect(result.notices.some(n => n.kind === "question")).toBe(false);
  });
  it("includes presented catalog ids and profile memory without treating them as authorization", () => {
    const state = initialSnapshot("b", "c", "test");
    state.profileMemory = { name: { value: "Ana", type: "text" } };
    const env: Environment = { mode: "test", now: 0, definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 1000 };
    const context = observationContext(state, env, { catalog: { kind: "product", entities: [{ id: "p2", displayOrder: 1, available: true, name: "Second" }] }, products: [{ id: "p2", name: "Second" }] });
    expect(context.profileMemory).toEqual({ name: { value: "Ana", type: "text" } });
    expect(context.catalogPresentation).toEqual({ kind: "product", entities: [{ id: "p2", displayOrder: 1, available: true, name: "Second" }] });
    expect(context.catalog.products).toEqual([{ id: "p2", name: "Second" }]);
  });
});
