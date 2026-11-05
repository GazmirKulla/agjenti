import { expect, it } from "vitest";
import { parseConfigurationSteps, resolveConfigurationInput } from "./configuration-policy";
const create = {key:"agent.manage",input:{name:"Support",instructions:"Use verified information",is_active:true}};
it("resolves only confirmed outputs from a preceding dependency of the same entity kind", () => {
  const steps = parseConfigurationSteps([create,{key:"agent.communication",input:{mode:"draft",instructions:"New instructions"},after:[0],references:{id:{step:0,output:"id"}}}]);
  expect(resolveConfigurationInput(steps[1],[{id:"11111111-1111-4111-8111-111111111111"}])).toMatchObject({id:"11111111-1111-4111-8111-111111111111"});
  expect(() => resolveConfigurationInput(steps[1],[])).toThrow();
});
it("rejects destructive operations, cross-entity references, forward dependencies and overriding identities", () => {
  expect(() => parseConfigurationSteps([{key:"product.delete",input:{id:"x"}}])).toThrow();
  for (const step of [
    {key:"knowledge.save",input:{},after:[0],references:{id:{step:0,output:"id"}}},
    {key:"agent.manage",input:{},after:[2]},
    {key:"agent.manage",input:{id:"x"},after:[0],references:{id:{step:0,output:"id"}}},
    {key:"agent.manage",input:{},references:{id:{step:0,output:"id"}}},
  ]) expect(() => parseConfigurationSteps([create,step])).toThrow();
});
it("does not mutate the model's proposal", () => {
  const raw = [structuredClone(create)]; const parsed = parseConfigurationSteps(raw); parsed[0].input.name = "Changed";
  expect(raw[0].input.name).toBe("Support");
});
