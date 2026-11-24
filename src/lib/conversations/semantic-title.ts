import { withAiUsage } from "@/lib/ai/usage";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { prompt } from "@/lib/ai/prompts/files";
import { recordSystem } from "@/lib/tracking/system-events";

type Message = { role: string; content: string };
/** Display metadata only. Failure must never fail or replay a business action. */
export async function semanticConversationTitle(businessId: string, messages: Message[]): Promise<string | null> {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("unavailable");
    const input = messages.slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
    const response = await withAiUsage(businessId, () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 300,
      instructions: prompt("asistenti/titulli-i-bisedes"), input: JSON.stringify(input),
      text: { format: { type: "json_schema", name: "conversation_title", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["title", "message", "quote"], properties: {
          title: { type: ["string", "null"] }, message: { type: "integer" }, quote: { type: "string" },
        },
      } } },
    }));
    const value = JSON.parse(response.output_text);
    if (value?.title === null) {
      await recordSystem("assistant.conversation_title", "deferred", { businessId, reason: "topic:unclear" });
      return null;
    }
    if (!value || typeof value.title !== "string" || !value.title.trim() || value.title.length > 80 ||
      !Number.isInteger(value.message) || input[value.message]?.role !== "user" ||
      typeof value.quote !== "string" || !value.quote.trim() || !input[value.message].content.includes(value.quote))
      throw new Error("invalid_title");
    return value.title.trim();
  } catch {
    await recordSystem("assistant.conversation_title", "failed", { businessId, reason: "generation:unavailable_or_invalid" });
    return null;
  }
}
