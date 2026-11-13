import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";
import { renderActionMessage } from "@/lib/actions/workflow";
import type { ReferenceProduct } from "@/lib/products/entity-bridge";
import { type RuntimeNotice, type Snapshot } from "./contracts";
import { definitionFor, type Environment } from "./transition";
import { trainingPrompt, type TrainingContext } from "@/lib/agents/training/model";
import { communicationPolicyInstructions, parseCommunicationPolicy } from "@/lib/agents/communication-policy";
import { renderCatalogSlots } from "./catalog-presentation";

/** Prompt text: prompts/agjenti-i-klienteve/pergjigja-ndaj-klientit.md */
export const CUSTOMER_REPLY_PROMPT = () => prompt("agjenti-i-klienteve/pergjigja-ndaj-klientit");

export type ReplyContext = { instructions: string; communication?: unknown; training?: TrainingContext; businessProcess?: string; knowledge: unknown; products?: unknown; services?: unknown; documents?: unknown; attachments?: string;
  /** Server-read public Instagram profile the prospect named (Agjenti.app only). */
  prospect?: unknown;
  profileMemory?: Snapshot["profileMemory"];
  availability?: { instanceId: string; serviceId: string; date: string; starts: string[]; status: string }[] };
export async function composeProcessReply(input: {
  message: string; history: { role: "user" | "assistant"; content: string }[]; state: Snapshot; env: Environment;
  notices: RuntimeNotice[]; context: ReplyContext; deadline: number;
}): Promise<{ reply: string; targetIds: string[]; presented?: { kind: "product" | "service"; items: ReferenceProduct[] }; responseId: string; inputTokens: number; outputTokens: number }> {
  const remaining = input.deadline - Date.now();
  if (remaining < 1000 || !process.env.OPENAI_API_KEY?.trim()) throw new Error("reply_unavailable");
  const notices = input.notices.map(n => {
    const instance = n.instanceId ? input.state.instances[n.instanceId] : undefined;
    const definition = instance ? definitionFor(input.state, instance, input.env) : undefined;
    const offer = n.kind === "offer" && n.targetId ? input.state.offers[n.targetId] : undefined;
    const process = offer ? input.env.definitions.find(d => d.id === offer.definitionId && d.versionId === offer.versionId) : definition;
    const action = instance?.action;
    const reviewStep = definition?.steps.find(s => s.id === instance?.stepId);
    const receipts = { ...instance?.results, ...(action?.output ? { [action.stepId]: { actionId: action.id, tool: action.tool, status: action.status, output: action.output } } : {}) };
    const results = Object.fromEntries(Object.entries(receipts).flatMap(([stepId, receipt]) => receipt.status === "simulated" || receipt.status === "succeeded"
      ? [[stepId, Object.fromEntries(Object.entries(receipt.output).map(([key, value]) => [key, String(value)]))]] : []));
    return { ...n, process: process?.name, purpose: process?.purpose, text: n.text ? renderActionMessage(n.text, results) : undefined,
      review: n.kind === "approval" && instance && reviewStep?.kind === "confirm" ? reviewStep.fieldIds.flatMap(id => {
        const f = instance.facts[id];
        return f ? [{ label: definition?.fields.find(field => field.id === id)?.label ?? id, value: f.value, subject: f.subject }] : [];
      }) : undefined,
      effect: action ? { tool: action.tool, status: action.status, output: action.output } : undefined };
  });
  const targets = [...new Set(notices.flatMap(n => n.targetId ? [n.targetId] : []))];
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Math.min(18000, remaining), maxRetries: 0 }).responses.create({
    model: modelFor("customer"), store: false, max_output_tokens: 2200,
    instructions: `${communicationPolicyInstructions(input.context.communication ? parseCommunicationPolicy(input.context.communication) : undefined)}${trainingPrompt(input.context.training)}\n${CUSTOMER_REPLY_PROMPT()}`,
    input: JSON.stringify({ message: input.message, mode: input.state.mode, history: input.history.slice(-12), business: input.context, notices,
      processes: Object.values(input.state.instances).map(i => ({ id: i.id, status: i.status, facts: i.facts, pending: i.wait, receipts: i.results ?? {} })) }),
    text: { format: { type: "json_schema", name: "process_reply", strict: true, schema: { type: "object", additionalProperties: false, required: ["answer", "prompts"], properties: {
      answer: { type: "string" }, prompts: { type: "object", additionalProperties: false, required: targets,
        properties: Object.fromEntries(targets.map(id => [id, { type: "string" }])) },
    } } } },
  });
  if (response.status !== "completed" || Date.now() > input.deadline) throw new Error("reply_incomplete");
  const parsed = JSON.parse(response.output_text);
  if (!parsed || typeof parsed.answer !== "string" || parsed.answer.length > 10000 || !parsed.prompts || typeof parsed.prompts !== "object" || Array.isArray(parsed.prompts)
    || Object.keys(parsed.prompts).length !== targets.length
    || targets.some(id => !Object.hasOwn(parsed.prompts, id) || typeof parsed.prompts[id] !== "string" || !parsed.prompts[id].trim() || parsed.prompts[id].length > 2000)) throw new Error("invalid_reply_targets");
  const parts = [parsed.answer.trim(), ...targets.map(targetId => {
    const p = { targetId, text: parsed.prompts[targetId] as string };
    const notice = notices.find(n => n.targetId === p.targetId)!;
    const review = notice.review?.map(f => `${f.label}: ${String(f.value)}`).join("\n");
    return review ? `${review}\n\n${p.text.trim()}` : p.text.trim();
  })].filter(Boolean);
  if (!parts.length) throw new Error("empty_process_reply");
  const catalogRows = (value: unknown): ReferenceProduct[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string") as ReferenceProduct[]
    : value && typeof value === "object" && Array.isArray((value as { records?: unknown }).records) ? catalogRows((value as { records: unknown }).records) : [];
  const rendered = renderCatalogSlots(parts.join("\n\n"), catalogRows(input.context.products), catalogRows(input.context.services));
  return { reply: rendered.reply, targetIds: targets, presented: rendered.presented, responseId: response.id,
    inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
}
