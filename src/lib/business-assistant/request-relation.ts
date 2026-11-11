import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import type { AssistantUIContext } from "./context";

/** Prompt text: prompts/asistenti/kerkese-e-re-apo-vazhdim.md */
export const REQUEST_RELATION_PROMPT = () => prompt("asistenti/kerkese-e-re-apo-vazhdim");

/** A new objective may start a fresh proposal, never inherit an old approval.
 * Ambiguity/provider failure retains the prior plan and its server checks. */
export async function isIndependentRequest(message: string, priorRequest: string, context?: AssistantUIContext): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 500,
      instructions: REQUEST_RELATION_PROMPT(),
      input: JSON.stringify({ message, priorRequest, context }),
      text: { format: { type: "json_schema", name: "request_relation", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["relation", "evidence"], properties: {
          relation: { type: "string", enum: ["independent", "related", "uncertain"] }, evidence: { type: "string" },
        },
      } } },
    });
    const result = JSON.parse(response.output_text);
    return Boolean(response.status === "completed" && result && Object.keys(result).length === 2 && result.relation === "independent"
      && typeof result.evidence === "string" && Boolean(result.evidence.trim()) && message.includes(result.evidence));
  } catch { return false; }
}
