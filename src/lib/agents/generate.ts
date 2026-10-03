import OpenAI from "openai";
import {
  promptForStep,
  type ConversationStatePayload,
  type WorkflowProgressItem,
} from "@/lib/workflows/engine";

export const DEFAULT_AGENT_MODEL = "gpt-5.6-luna";

export function agentModel(): string {
  return process.env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
}

export async function generateAgentReply(params: {
  instructions: string;
  state: ConversationStatePayload;
  knowledge: string;
  customerMessage: string;
  previousResponseId: string | null;
  catalogSummary: string;
  workflowProgress?: WorkflowProgressItem[];
}): Promise<{
  reply: string;
  responseId: string | null;
  source: "ai" | "fallback";
  fallbackReason: string | null;
}> {
  const fallback = promptForStep(params.state.step_key);
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      reply: fallback,
      responseId: null,
      source: "fallback",
      fallbackReason: "missing_api_key",
    };
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const progress =
    params.workflowProgress
      ?.map(
        (s) =>
          `- [${s.status}] ${s.label}${s.value ? ` = ${s.value}` : ""}`,
      )
      .join("\n") || "(none)";
  const input = [
    `Customer message: ${params.customerMessage}`,
    `Current step: ${params.state.step_key}`,
    `Order workflow progress:\n${progress}`,
    `Collected state (source of truth): ${JSON.stringify(params.state)}`,
    `Knowledge:\n${params.knowledge || "(none)"}`,
    `Catalog:\n${params.catalogSummary || "(none)"}`,
    "The workflow state above is authoritative. Do not invent completed steps or customer data that is missing.",
    "Write the entire customer-facing reply. Do not invent prices. Ask only for the current incomplete step.",
  ].join("\n");

  try {
    const response = await client.responses.create({
      model: agentModel(),
      instructions: params.instructions,
      input,
      previous_response_id: params.previousResponseId || undefined,
    });
    const text = response.output_text?.trim() || fallback;
    return {
      reply: text,
      responseId: response.id ?? null,
      source: response.output_text?.trim() ? "ai" : "fallback",
      fallbackReason: response.output_text?.trim() ? null : "empty_reply",
    };
  } catch (err) {
    console.error(
      "[agent] OpenAI failed:",
      err instanceof Error ? err.message : err,
    );
    return {
      reply: fallback,
      responseId: params.previousResponseId,
      source: "fallback",
      fallbackReason: "provider_error",
    };
  }
}
