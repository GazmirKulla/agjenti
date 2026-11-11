import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { modelFor } from "@/lib/agents/model";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { capabilityRegistry } from "./registry";

/** Prompt text: prompts/asistenti/workflow-aftesite.md */
export const WORKFLOW_CAPABILITY_REVIEW_PROMPT = () => prompt("asistenti/workflow-aftesite");

export type WorkflowSemanticReview = { authoringBehaviorIndexes?: number[]; capabilityKeys: string[]; evidence: { sourceId: string; quote: string; capabilityKey: string; scope?: "runtime" | "authoring" }[] };
const reviews = new AsyncLocalStorage<Map<string, Promise<WorkflowSemanticReview>>>();
export class WorkflowSemanticReviewError extends Error {
  constructor(public readonly reason: string, message: string) { super(message); }
}
/** Reuse interpretation only within this server operation and for identical input.
 * Membership, capabilities, bindings and revisions are always checked afresh. */
export function withWorkflowSemanticReviews<T>(run: () => Promise<T>): Promise<T> {
  return reviews.getStore() ? run() : reviews.run(new Map(), run);
}
export async function reviewWorkflowSemantics(request: string, graph?: VisualGraph, behaviors: { description: string; capabilityKeys: string[] }[] = []): Promise<WorkflowSemanticReview> {
  const cache = reviews.getStore(), key = JSON.stringify([modelFor("assistant"), request, graph, behaviors]);
  let result = cache?.get(key);
  if (!result) {
    result = performReview(request, graph, behaviors);
    cache?.set(key, result);
  }
  try { return structuredClone(await result); }
  catch (error) {
    const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : undefined;
    const reason = error instanceof Error && error.name === "APIConnectionTimeoutError" ? "timeout"
      : status === 429 ? "rate_limit" : status === 401 || status === 403 ? "provider_access"
      : status && status >= 500 ? "provider_unavailable"
      : error instanceof SyntaxError || error instanceof Error && error.message.startsWith("invalid_") ? "invalid_response" : "unavailable";
    // Do not log owner instructions, API keys, provider bodies or customer data.
    console.warn("workflow_semantic_review_failed", { reason, status });
    throw new WorkflowSemanticReviewError(reason, reason === "timeout" ? "Verifikimi me AI tejkaloi kohën pas riprovimit. Provo përsëri; versioni aktiv ruhet."
      : reason === "invalid_response" ? "Përgjigjja e verifikimit me AI nuk kaloi validimin. Propozimi nuk u publikua."
      : reason === "rate_limit" ? "Shërbimi AI ka arritur kufirin e kërkesave. Provo përsëri pas pak."
      : reason === "provider_access" ? "Shërbimi AI refuzoi qasjen. Kontrollo konfigurimin e tij; ky nuk është gabim i lejeve të biznesit."
      : "Shërbimi i verifikimit me AI nuk është i disponueshëm. Propozimi nuk u publikua.");
  }
}
/** Language interpretation only. Capabilities, ownership and writes remain server decisions. */
async function performReview(request: string, graph?: VisualGraph, behaviors: { description: string; capabilityKeys: string[] }[] = []): Promise<WorkflowSemanticReview> {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("workflow_semantic_review_unavailable");
  const sources = new Map<string, string>([["request", request]]);
  for (const node of graph?.nodes ?? []) sources.set(`node:${node.id}`, JSON.stringify({ label: node.label, config: node.config }));
  if (graph?.version === 2) for (const flow of graph.flows) sources.set(`flow:${flow.id}`, flow.label);
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 1 }).responses.create({
    model: modelFor("assistant"), store: false, max_output_tokens: 2500,
    instructions: WORKFLOW_CAPABILITY_REVIEW_PROMPT(),
    input: JSON.stringify({ sources: [...sources].map(([sourceId, text]) => ({ sourceId, text })), graph, behaviors, capabilities: Object.values(capabilityRegistry).map(c => ({ key: c.key, description: c.description })) }),
    text: { format: { type: "json_schema", name: "workflow_semantic_review", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["evidence", "behaviors"], properties: { behaviors: { type: "array", maxItems: 16, items: {
        type: "object", additionalProperties: false, required: ["index", "scope", "quote"], properties: {
          index: { type: "integer" }, scope: { type: "string", enum: ["authoring", "runtime"] }, quote: { type: "string" },
        },
      } }, evidence: { type: "array", maxItems: 64, items: {
        type: "object", additionalProperties: false, required: ["sourceId", "quote", "capabilityKey", "scope"], properties: {
          scope: { type: "string", enum: ["authoring", "runtime"] }, sourceId: { type: "string" }, quote: { type: "string" }, capabilityKey: { type: "string" },
        },
      } } },
    } } },
  });
  const value = JSON.parse(response.output_text);
  if (!value || !Array.isArray(value.evidence) || value.evidence.length > 64) throw new Error("invalid_workflow_semantic_review");
  if (!Array.isArray(value.behaviors) || value.behaviors.length !== behaviors.length) throw new Error("invalid_behavior_scopes");
  const authoringBehaviorIndexes: number[] = [], seen = new Set<number>();
  for (const item of value.behaviors) {
    if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= behaviors.length || seen.has(item.index)
      || !["authoring", "runtime"].includes(item.scope) || typeof item.quote !== "string" || !item.quote.trim() || !behaviors[item.index].description.includes(item.quote)) throw new Error("invalid_behavior_scope_evidence");
    seen.add(item.index);
    if (item.scope === "authoring") authoringBehaviorIndexes.push(item.index);
  }
  for (const item of value.evidence) {
    if (!item || !["runtime", "authoring"].includes(item.scope) || item.scope === "authoring" && item.sourceId !== "request" || typeof item.sourceId !== "string" || typeof item.quote !== "string" || !item.quote.trim() || item.quote.length > 2000 || typeof item.capabilityKey !== "string" || !/^[a-z][a-z0-9_.]{0,80}$/.test(item.capabilityKey) || !sources.get(item.sourceId)?.includes(item.quote))
      throw new Error("invalid_workflow_semantic_evidence");
  }
  return { authoringBehaviorIndexes, capabilityKeys: [...new Set<string>(value.evidence.filter((item: { scope: string }) => item.scope === "runtime").map((item: { capabilityKey: string }) => item.capabilityKey))], evidence: value.evidence };
}
