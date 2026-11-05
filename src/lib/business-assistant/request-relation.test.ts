import { afterEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = provider; } }));
import { isIndependentRequest } from "./request-relation";
afterEach(() => { vi.unstubAllEnvs(); provider.create.mockReset(); });
it.each(["Remove the listed products", "Fshi produktet e listuara", "Elimina los productos mostrados"])("uses evidence-bound interpretation for a new objective: %s", async message => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic");
  provider.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ relation: "independent", evidence: message }) });
  expect(await isIndependentRequest(message, "Configure the agent")).toBe(true);
});
it.each([
  { relation: "uncertain", evidence: "yes" },
  { relation: "related", evidence: "yes" },
  { relation: "independent", evidence: "older message" },
  { relation: "independent", evidence: "yes", authorized: true },
  null,
])("retains the old boundary for ambiguity or malformed interpretation: %j", async result => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic");
  provider.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify(result) });
  expect(await isIndependentRequest("yes", "Configure the agent")).toBe(false);
});
it("does not recover familiar commands through phrase matching when the model fails", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic"); provider.create.mockRejectedValue(new Error("offline"));
  expect(await isIndependentRequest("Fshi të gjitha produktet", "Configure the agent")).toBe(false);
});
