import { expect, it, vi } from "vitest";
vi.unmock("./context");
import { parseUnderstanding, unknownUnderstanding } from "./contract";
import { withMessageUnderstanding, messageUnderstanding } from "./context";
const text = "My name is Ada";
const observation = () => ({ ...structuredClone(unknownUnderstanding), act: "answer" as const,
  facts: [{ key: "name", value: "Ada", evidence: text }], evidence: text });
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
