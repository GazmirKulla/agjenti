import { interpretFragment } from "./fragment-observation";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import type { WorkflowJob } from "./workflow-queue";
import type { TestChatInput } from "@/lib/agents/test-chat/types";

/** Best-effort transport observation, never consent. A failed/uncertain
 * classification keeps messages separate without blocking ingestion. */
export async function fragmentKind(text: string | null, hasMedia = false): Promise<"fragment" | "continuation" | "close" | "separate"> {
  if (hasMedia || !text?.trim() || text.length > 160) return "separate";
  return interpretFragment(text);
}

export function testInputBatch(input: TestChatInput, job: WorkflowJob): { input: TestChatInput; count: number } {
  const parts = job.batch_payloads as unknown as (TestChatInput & { requestId: string; sequence: number })[] | null;
  if (!parts) return { input, count: 1 };
  if (!Array.isArray(parts) || !parts.length || parts.length > 20) throw new Error("Invalid test batch");
  const ids = new Set<string>();
  for (const [index, part] of parts.entries()) {
    if (!part || part.configurationDraft !== input.configurationDraft || part.slug !== input.slug || typeof part.message !== "string" || part.hasMedia || part.attachments?.length
      || typeof part.requestId !== "string" || ids.has(part.requestId) || part.sequence !== job.client_sequence! + index
      || index === 0 && part.requestId !== job.client_request_id) throw new Error("Invalid test batch identity");
    ids.add(part.requestId);
  }
  const message = parts.map(part => part.message).join("\n");
  if (message.length > 2000) throw new Error("Test batch too large");
  return { input: { ...input, message }, count: parts.length };
}

export function inboundBatch(message: NormalizedIncomingMessage, job?: WorkflowJob) {
  const payloads = job?.batch_payloads;
  if (!payloads) return { message, originals: [message] };
  if (!Array.isArray(payloads) || !payloads.length || payloads.length > 20) throw new Error("Invalid inbound batch");
  const ids = new Set<string>();
  const originals = payloads.map(payload => {
    const account = message.channel === "whatsapp" ? "whatsappPhoneNumberId" : "instagramAccountId";
    if (!payload || payload.channel !== message.channel || payload.externalParticipantId !== job.participant_id
      || payload.contextMetadata?.[account] !== message.contextMetadata?.[account]
      || typeof payload.externalMessageId !== "string" || !payload.externalMessageId || ids.has(payload.externalMessageId)
      || (payload.text !== null && typeof payload.text !== "string") || !Array.isArray(payload.attachments)) throw new Error("Invalid inbound batch identity");
    ids.add(payload.externalMessageId);
    const timestamp = new Date(payload.timestamp);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid inbound batch timestamp");
    return { ...payload, timestamp };
  });
  if (originals[0].externalMessageId !== message.externalMessageId) throw new Error("Invalid inbound batch leader");
  return { originals, message: {
    ...message, timestamp: originals.at(-1)!.timestamp,
    text: originals.map(item => item.text).filter(Boolean).join("\n") || null,
    attachments: originals.flatMap(item => item.attachments),
  } };
}
