import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { prompt } from "@/lib/ai/prompts/files";
import { attributeAiUsage } from "@/lib/ai/usage";
/** No recipient identities or conversation history enter this model request. */
export async function suggestCampaignCopy(businessId: string, body: unknown, terms: unknown) {
  if (typeof body !== "string" || typeof terms !== "string" || body.length > 1000 || terms.length > 1000 || !(body.trim() || terms.trim())) throw new Error("invalid_input");
  attributeAiUsage(businessId);
  const response = await new OpenAI({ timeout: 15000, maxRetries: 0 }).responses.create({ model: modelFor("utility"), store: false, max_output_tokens: 1200,
    instructions: prompt("campaigns/draft"), input: JSON.stringify({ draft: body, terms, variables: ["{{emri}}", "{{biznesi}}"] }),
    text: { format: { type: "json_schema", name: "campaign_drafts", strict: true, schema: { type: "object", additionalProperties: false, required: ["variants"], properties: { variants: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } } } } },
  });
  if (response.status !== "completed") throw new Error("draft_unavailable");
  const parsed = JSON.parse(response.output_text);
  if (!Array.isArray(parsed.variants) || parsed.variants.length !== 3 || parsed.variants.some((v: unknown) => typeof v !== "string" || !v.trim() || v.length > 700)) throw new Error("draft_unavailable");
  return parsed.variants as string[];
}
