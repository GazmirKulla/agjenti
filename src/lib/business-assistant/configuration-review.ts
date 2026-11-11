import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import type { ConfigurationAuthority, ConfigurationStep } from "@/lib/actions/operations/configuration-policy";
import { AssistantError } from "./model";

/** Prompt text: prompts/asistenti/kontrolli-i-ndryshimeve.md */
export const CONFIGURATION_REVIEW_PROMPT = () => prompt("asistenti/kontrolli-i-ndryshimeve");

export type ConfigurationReview = ConfigurationAuthority & {remainingQuestion?: string};
/** Semantic interpretation supplies evidence only. The configuration executor
 * separately checks actor, operation allowlist, tenant, snapshots and receipts. */
export async function reviewConfigurationRequest(request: string, history: {role: string; content: string}[], steps: ConfigurationStep[], context: unknown): Promise<ConfigurationReview> {
  if (!process.env.OPENAI_API_KEY) throw new AssistantError("Kërkesa nuk u verifikua. Nuk u ndryshua konfigurimi.");
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 }).responses.create({
    model: modelFor("assistant"), store: false, max_output_tokens: 3000,
    instructions: CONFIGURATION_REVIEW_PROMPT(),
    input: JSON.stringify({request, history, steps, context}),
    text: {format: {type: "json_schema", name: "configuration_review", strict: true, schema: {type: "object", additionalProperties: false, required: ["steps", "question", "remainingQuestion"], properties: {
      question: {type: "string"}, remainingQuestion: {type:"string"}, steps: {type: "array", maxItems: 16, items: {type: "object", additionalProperties: false, required: ["step", "withinRequest", "factsGrounded", "quote"], properties: {
        step: {type: "integer"}, withinRequest: {type: "boolean"}, factsGrounded: {type: "boolean"}, quote: {type: "string"},
      }}},
    }}}},
  });
  const value = JSON.parse(response.output_text);
  if (!value || !Array.isArray(value.steps) || value.steps.length !== steps.length || typeof value.question !== "string" || typeof value.remainingQuestion !== "string" || value.remainingQuestion.length > 1000) throw new AssistantError("Verifikimi i konfigurimit nuk përfundoi.");
  const seen = new Set<number>();
  for (const item of value.steps) {
    if (!item || !Number.isInteger(item.step) || item.step < 0 || item.step >= steps.length || seen.has(item.step) ||
      typeof item.quote !== "string" || !item.quote.trim() || !request.includes(item.quote) || item.withinRequest !== true || item.factsGrounded !== true)
      throw new AssistantError(value.question || "Duhet sqaruar informacioni ose ndryshimi që dëshiron përpara aktivizimit.");
    seen.add(item.step);
  }
  if (value.question.trim()) throw new AssistantError(value.question);
  return {request, remainingQuestion:value.remainingQuestion, expires: Date.now() + 10 * 60000, evidence: value.steps.map((s: {step: number; quote: string}) => ({step:s.step,quote:s.quote}))};
}
