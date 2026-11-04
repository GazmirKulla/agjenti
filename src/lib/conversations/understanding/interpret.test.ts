import { afterEach, expect, it, vi } from "vitest";
vi.unmock("./context");
vi.unmock("./interpret");
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = provider; } }));
import { interpretMessage, UnderstandingUnavailable } from "./interpret";
import { parseUnderstanding, unknownUnderstanding } from "./contract";
import { withMessageUnderstanding, messageUnderstanding } from "./context";
import { migrateContext } from "@/lib/workflows/context";
const text = "My name is Ada";
const observation = () => ({ ...structuredClone(unknownUnderstanding), act: "answer" as const,
  facts: [{ key: "name", value: "Ada", evidence: text }], evidence: text });
afterEach(() => { vi.unstubAllEnvs(); provider.create.mockReset(); });
it("validates evidence and field ownership before returning model observations", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  provider.create.mockResolvedValue({ output_text: JSON.stringify(observation()) });
  const state = migrateContext(), before = structuredClone(state);
  expect(await interpretMessage(text, state)).toMatchObject({ facts: [{ key: "name", value: "Ada" }] });
  expect(state).toEqual(before);
  expect(provider.create.mock.calls[0][0]).toMatchObject({ store: false, text: { format: { strict: true } } });
});
it.each(["missing_key", "provider", "invalid_json", "invented_evidence", "foreign_field"])("fails closed without state changes or lexical fallback: %s", async reason => {
  vi.stubEnv("OPENAI_API_KEY", reason === "missing_key" ? "" : "synthetic-key");
  const state = migrateContext(), before = structuredClone(state), data = observation();
  if (reason === "invented_evidence") data.facts[0].evidence = "An older customer message";
  if (reason === "foreign_field") data.facts[0].key = "admin";
  if (reason === "provider") provider.create.mockRejectedValue(new Error("unavailable"));
  else provider.create.mockResolvedValue({ output_text: reason === "invalid_json" ? "no" : JSON.stringify(data) });
  await expect(interpretMessage(text, state)).rejects.toBeInstanceOf(UnderstandingUnavailable);
  expect(state).toEqual(before);
});
it("rejects conflicting values, unsupported keys, and ambiguous ordinal selections", () => {
  const data = observation();
  expect(parseUnderstanding({ ...data, facts: [...data.facts, ...data.facts] }, text, ["name"])).toBeNull();
  expect(parseUnderstanding({ ...data, unresolvedFields: [{key:"name",reason:"ambiguous"}] }, text, ["name"])).toBeNull();
  expect(parseUnderstanding({ ...data, referenceMode:"ordinal",referenceIndex:null }, text, ["name"])).toBeNull();
  expect(parseUnderstanding({ ...data, permission:true }, text, ["name"])).toBeNull();
});
it("keeps simultaneous conversations and nested turns isolated", async () => {
  const a = { ...observation(), act: "accept" as const }, b = { ...observation(), act: "decline" as const };
  await Promise.all([a,b].map(meaning => withMessageUnderstanding(text, meaning, async () => {
    await Promise.resolve();
    expect(messageUnderstanding(text)).toBe(meaning);
    expect(messageUnderstanding("different message").act).toBe("uncertain");
    withMessageUnderstanding(text, observation(), () => expect(messageUnderstanding(text).act).toBe("answer"));
    expect(messageUnderstanding(text)).toBe(meaning);
  })));
  expect(messageUnderstanding(text).act).toBe("uncertain");
});
it("distinguishes independent process requests from a single process mention", () => {
  const data = { ...observation(), requestedProcesses: ["order" as const,"booking" as const] };
  expect(parseUnderstanding(data,text,["name"])?.requestedProcesses).toEqual(["order","booking"]);
  expect(parseUnderstanding({...data,requestedProcesses:["order","order"]},text,["name"])).toBeNull();
});
it("rejects conflicting aliases for the same customer field", () => {
  const data = observation();
  expect(parseUnderstanding({...data,facts:[...data.facts,{...data.facts[0],key:"customer_name"}]},text,["name","customer_name"])).toBeNull();
});
it("revokes the previous value and confirmation when a correction is ambiguous", async () => {
  const { setFact, extractExplicitFacts } = await import("@/lib/workflows/context");
  const state = migrateContext();
  setFact(state,"customer_phone","+355691234567","phone","message_evidence");
  state.context!.execution.orderConfirmed = true;
  const message = "Use one of my other numbers";
  withMessageUnderstanding(message,{...structuredClone(unknownUnderstanding),correction:true,
    unresolvedFields:[{key:"phone",reason:"ambiguous"}],evidence:message},()=>extractExplicitFacts(state,message));
  expect(state.context!.execution.invalidFields).toContain("customer_phone");
  expect(state.context!.execution.orderConfirmed).toBe(false);
});
