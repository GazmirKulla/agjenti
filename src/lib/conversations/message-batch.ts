import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import type { WorkflowJob } from "./workflow-queue";

export function inboundBatch(message: NormalizedIncomingMessage, job?: WorkflowJob) {
  const payloads = job?.batch_payloads;
  if (!payloads) return { message, originals: [message] };
  if (!Array.isArray(payloads) || !payloads.length || payloads.length > 20) throw new Error("Invalid inbound batch");
  const ids = new Set<string>();
  const originals = payloads.map(payload => {
    if (!payload || payload.channel !== "instagram" || payload.externalParticipantId !== job.participant_id
      || payload.contextMetadata?.instagramAccountId !== message.contextMetadata?.instagramAccountId
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
