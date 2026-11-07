/** Opt-in, real provider; synthetic inputs only, no database or effects. */
import { it, expect } from "vitest";
import { interpretCustomer } from "@/lib/orchestration/interpret";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import type { Environment } from "@/lib/orchestration/transition";
import { briefingQuestion } from "@/lib/business-assistant/briefing-intent";
const live = it.skipIf(process.env.RUN_SEMANTIC_MODEL !== "1");
const env: Environment = { mode: "test", now: Date.now(), definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 60_000 };
live.each([
 ["Sa porosi u regjistruan sot?", "today"],
 ["Zeig mir die Zusammenfassung dieser Woche.", "week"],
 ["Sa porosi kemi sot dhe krijo një produkt", null],
 ["Compare revenue today and yesterday", null],
])("interprets owner briefing scope without phrase lists: %s",async(text,period)=>{
 expect(await briefingQuestion(text)).toBe(period);
});
live("returns a structured observation without mutating the snapshot", async () => {
 const state = initialSnapshot("journey", "journey", "test");
 const before = structuredClone(state);
 const result = await interpretCustomer({
  message: "Si funksionon lidhja me Instagram?",
  state,
  env,
  history: [],
  deadline: Date.now() + 30_000,
 });
 expect(result.observation).toEqual(expect.objectContaining({
  needsClarification: expect.any(Boolean),
  commands: expect.any(Array),
 }));
 expect(state).toEqual(before);
});
