import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";

/** Prompt text: prompts/agjenti-i-klienteve/interesi-i-klientit.md */
export const INTEREST_READING_PROMPT = () => prompt("agjenti-i-klienteve/interesi-i-klientit");

export type InterestReading = { kind: "price" | "availability" | "contact" | "purchase"; summary: string };
type History = { role: "user" | "assistant"; content: string }[];

const schema = {
  type: "object", additionalProperties: false, required: ["shown", "kind", "summary", "evidence"],
  properties: {
    shown: { type: "boolean" },
    kind: { type: "string", enum: ["price", "availability", "contact", "purchase", "none"] },
    summary: { type: "string" },
    evidence: { type: "string" },
  },
};

/** Only a reading with a kind, a summary and a quote that is really in the customer's message counts. */
export function acceptInterest(value: unknown, message: string): InterestReading | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.shown !== true || !["price", "availability", "contact", "purchase"].includes(String(v.kind))) return null;
  const summary = typeof v.summary === "string" ? v.summary.trim().slice(0, 300) : "";
  const evidence = typeof v.evidence === "string" ? v.evidence.trim() : "";
  const normal = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ");
  if (!summary || !evidence || !normal(message).includes(normal(evidence))) return null;
  return { kind: v.kind as InterestReading["kind"], summary };
}

/**
 * A light reading of buying interest for conversations the customer agent does not answer (automatic
 * replies off, or the conversation with staff), so the conversation still becomes a lead. The answering
 * agent reads interest in its own interpretation instead. No phrase lists; null when unsure or unavailable.
 */
export async function readCustomerInterest(message: string, history: History, options: { timeoutMs?: number } = {}): Promise<InterestReading | null> {
  const text = message.trim();
  if (!text || text.length > 4000 || !process.env.OPENAI_API_KEY?.trim()) return null;
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: options.timeoutMs ?? 5000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 250,
      instructions: INTEREST_READING_PROMPT(),
      input: JSON.stringify({ history: history.slice(-6).map(m => ({ role: m.role, content: m.content.slice(0, 1200) })), currentMessage: text }),
      text: { format: { type: "json_schema", name: "customer_interest", strict: true, schema } },
    });
    if (response.status !== "completed" || !response.output_text) return null;
    return acceptInterest(JSON.parse(response.output_text), text);
  } catch { return null; }
}
