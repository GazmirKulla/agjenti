import OpenAI from "@/lib/ai/openai";
import { agentModel } from "@/lib/agents/model";
import { type Observation, type Snapshot } from "./contracts";
import { observationContext, observationInstructions, observationSchema, parseObservation } from "./observation";
import { type Environment } from "./transition";
type ObservationExtras = Parameters<typeof observationContext>[2];

export class InterpretationUnavailable extends Error {
  constructor(readonly reason: "budget" | "configuration" | "incomplete" | "invalid_output" | "provider") {
    super("Interpretimi nuk u përfundua. Progresi i ruajtur nuk ndryshoi.");
  }
}
export type Interpretation = {
  observation: Observation;
  model: string;
  responseId: string;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
};
/** No phrase fallback, no side effects, no historical response chain with hidden state. */
export async function interpretCustomer(input: {
  message: string;
  state: Snapshot;
  env: Environment;
  history: { role: "user" | "assistant"; content: string }[];
  deadline: number;
  businessContext?: { instructions: string; knowledge: unknown };
  observationExtras?: ObservationExtras;
}): Promise<Interpretation> {
  const startedAt = Date.now();
  const remaining = input.deadline - startedAt;
  if (remaining < 1000) throw new InterpretationUnavailable("budget");
  if (!process.env.OPENAI_API_KEY?.trim()) throw new InterpretationUnavailable("configuration");
  const model = agentModel();
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Math.min(15000, remaining), maxRetries: 0 }).responses.create({
      model, store: false, max_output_tokens: 3000,
      instructions: observationInstructions,
      input: JSON.stringify({ message: input.message, businessContext: input.businessContext, context: observationContext(input.state, input.env, input.observationExtras),
        history: input.history.slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 6000) })) }),
      text: { format: { type: "json_schema", name: "process_observation", strict: true, schema: observationSchema } },
    });
    if (Date.now() > input.deadline) throw new InterpretationUnavailable("budget");
    if (response.status !== "completed" || !response.output_text) throw new InterpretationUnavailable("incomplete");
    let observation: Observation;
    try { observation = parseObservation(JSON.parse(response.output_text)); }
    catch { throw new InterpretationUnavailable("invalid_output"); }
    return { observation, model, responseId: response.id, elapsedMs: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
  } catch (error) {
    if (error instanceof InterpretationUnavailable) throw error;
    throw new InterpretationUnavailable("provider");
  }
}
