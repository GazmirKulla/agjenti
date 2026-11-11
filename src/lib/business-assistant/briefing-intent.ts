import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { briefingPeriods, type BriefingPeriod } from "./briefing-model";

/** Prompt text: prompts/asistenti/permbledhja-e-periudhes.md */
export const BRIEFING_INTENT_PROMPT = () => prompt("asistenti/permbledhja-e-periudhes");
/** Read-only semantic shortcut. All other requests retain the existing assistant path. */
export async function briefingQuestion(text: string): Promise<BriefingPeriod | null> {
  if (!text.trim() || !process.env.OPENAI_API_KEY?.trim()) return null;
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 150,
      instructions: BRIEFING_INTENT_PROMPT(),
      input: text,
      text: { format: { type: "json_schema", name: "briefing_intent", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["period","evidence"], properties: {
          period: { type: ["string","null"], enum: [...briefingPeriods,null] }, evidence: { type: ["string","null"] },
        },
      } } },
    });
    const v = JSON.parse(response.output_text);
    return v && Object.keys(v).length === 2 && briefingPeriods.includes(v.period)
      && typeof v.evidence === "string" && v.evidence.trim() && text.includes(v.evidence) ? v.period : null;
  } catch { return null; }
}
