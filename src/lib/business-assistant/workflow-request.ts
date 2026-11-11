import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { visualGraphHash } from "@/lib/workflows/visual/graph-hash";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { AssistantError } from "./model";

/** Prompt text: prompts/asistenti/workflow-menyra.md */
export const WORKFLOW_REQUEST_MODE_PROMPT = () => prompt("asistenti/workflow-menyra");

export type WorkflowRequestReview = { mode: "publish" | "draft" | "preview" | "read" | "clarify"; quote: string; question: string; candidateHash: string; revision: number; expires: number };

/** Interpretation is evidence, not write authority. The caller binds it to the
 * server-loaded candidate; the existing writer checks tenant, actor and revision. */
export async function reviewWorkflowRequest(request: string, history: { role: string; content: string }[], before: VisualGraph, candidate: VisualGraph, revision: number): Promise<WorkflowRequestReview> {
  if (!process.env.OPENAI_API_KEY) throw new AssistantError("Kërkesa për ndryshim nuk u verifikua. Propozimi nuk u aplikua.");
  const candidateHash = visualGraphHash(candidate);
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 1 }).responses.create({
    model: modelFor("assistant"), store: false, max_output_tokens: 1500,
    instructions: WORKFLOW_REQUEST_MODE_PROMPT(),
    input: JSON.stringify({ request, history, before, candidate, candidateHash, revision }),
    text: { format: { type: "json_schema", name: "workflow_request", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["mode", "quote", "question", "candidateHash", "revision"], properties: {
        mode: { type: "string", enum: ["publish", "draft", "preview", "read", "clarify"] }, quote: { type: "string" }, question: { type: "string" }, candidateHash: { type: "string" }, revision: { type: "integer" },
      },
    } } },
  });
  const v = JSON.parse(response.output_text);
  if (!v || !["publish", "draft", "preview", "read", "clarify"].includes(v.mode) || typeof v.quote !== "string" || !v.quote.trim() || !request.includes(v.quote)
    || typeof v.question !== "string" || v.question.length > 1000 || v.candidateHash !== candidateHash || v.revision !== revision
    || (v.mode !== "clarify" && v.question.trim())) throw new AssistantError("Kërkesa nuk u lidh me ndryshimin e saktë. Propozimi nuk u aplikua.");
  return { ...v, expires: Date.now() + 600000 };
}
