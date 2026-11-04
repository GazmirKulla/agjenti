import { afterEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = provider; } }));
import { briefingQuestion } from "./briefing-intent";
afterEach(() => { vi.unstubAllEnvs(); provider.create.mockReset(); });
it.each([
  ["Çfarë ndodhi sot në biznes?", "today", "sot"],
  ["Sa porosi kemi dje?", "yesterday", "dje"],
  ["Më jep përmbledhjen e javës.", "week", "javës"],
])("validates a semantic period with exact evidence: %s", async (text,period,evidence) => {
  vi.stubEnv("OPENAI_API_KEY","test");
  provider.create.mockResolvedValue({output_text:JSON.stringify({period,evidence})});
  expect(await briefingQuestion(text)).toBe(period);
});
it.each([
  {period:"month",evidence:"today"}, {period:"today",evidence:"yesterday"},
  {period:null,evidence:null}, {period:"today",evidence:"today",execute:true},
])("rejects unsupported or ungrounded observations %j",async value => {
  vi.stubEnv("OPENAI_API_KEY","test");
  provider.create.mockResolvedValue({output_text:JSON.stringify(value)});
  expect(await briefingQuestion("Summary today")).toBeNull();
});
it("leaves provider failure to the existing assistant path without word matching", async () => {
  vi.stubEnv("OPENAI_API_KEY","");
  expect(await briefingQuestion("Sa porosi kemi sot?")).toBeNull();
  expect(provider.create).not.toHaveBeenCalled();
  vi.stubEnv("OPENAI_API_KEY","test"); provider.create.mockRejectedValue(new Error("unavailable"));
  expect(await briefingQuestion("Sa porosi kemi sot?")).toBeNull();
});
