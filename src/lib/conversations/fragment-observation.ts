import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";

/** Prompt text: prompts/agjenti-i-klienteve/mesazhet-e-copezuara.md */
export const FRAGMENT_OBSERVATION_PROMPT = () => prompt("agjenti-i-klienteve/mesazhet-e-copezuara");
export async function interpretFragment(text: string): Promise<"fragment" | "continuation" | "close" | "separate"> {
  if (!process.env.OPENAI_API_KEY?.trim()) return "separate";
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 2000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 100,
      instructions: FRAGMENT_OBSERVATION_PROMPT(),
      input: text,
      text: { format: { type: "json_schema", name: "fragment_hint", strict: true,
        schema: { type: "object", additionalProperties: false, required: ["kind"],
          properties: { kind: { type: "string", enum: ["fragment","continuation","close","separate"] } } } } },
    });
    const value = JSON.parse(response.output_text);
    return value && Object.keys(value).length === 1 && ["fragment","continuation","close","separate"].includes(value.kind) ? value.kind : "separate";
  } catch { return "separate"; }
}
