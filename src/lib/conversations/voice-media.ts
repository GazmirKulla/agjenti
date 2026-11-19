import { createServiceSupabase } from "@/lib/supabase/service";
import { downloadConversationMedia, type MediaLimits } from "@/lib/orders/conversation-photos";
import { transcribeAudio } from "@/lib/business-intelligence/transcription";
import { withAiUsage } from "@/lib/ai/usage";

/**
 * Voice messages and videos a customer sends: the server downloads them from the channel, transcribes
 * what is said, stores the transcript on the message (for staff) and gives it to the agent as part of
 * the message. A video's picture is not read, only its sound.
 */
const types: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a", "audio/ogg": "ogg", "audio/opus": "ogg",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/flac": "flac", "video/mp4": "mp4", "video/webm": "webm", "video/mpeg": "mpeg",
};
export const VOICE_LIMITS: MediaLimits = { types, maxBytes: 25 * 1024 * 1024 };
const MAX_PER_MESSAGE = 3;

export type VoiceResult = { kind: "audio" | "video"; transcript?: string; failure?: "too_large" | "unsupported" | "unavailable" | "failed" };
type Media = { kind?: unknown; transcript?: unknown; transcriptFailure?: unknown };

const failureOf = (status: number): NonNullable<VoiceResult["failure"]> => status === 413 ? "too_large" : status === 415 ? "unsupported" : status === 404 || status === 410 ? "unavailable" : "failed";

/** Transcribes the voice and video attachments of one stored customer message, once: a retry reuses what is stored. */
export async function transcribeMessageMedia(businessId: string, conversationId: string, messageId: string): Promise<VoiceResult[]> {
  const db = createServiceSupabase();
  const { data, error } = await db.from("messages").select("media").eq("id", messageId).eq("business_id", businessId).eq("conversation_id", conversationId).maybeSingle();
  if (error || !Array.isArray(data?.media)) return [];
  const media = data.media as Media[];
  const results: VoiceResult[] = [];
  let changed = false;
  for (const [index, item] of media.entries()) {
    if ((item.kind !== "audio" && item.kind !== "video") || results.length >= MAX_PER_MESSAGE) continue;
    const kind = item.kind as VoiceResult["kind"];
    if (typeof item.transcript === "string") { results.push({ kind, transcript: item.transcript }); continue; }
    if (typeof item.transcriptFailure === "string") { results.push({ kind, failure: item.transcriptFailure as VoiceResult["failure"] }); continue; }
    const read = await downloadConversationMedia(businessId, conversationId, item, VOICE_LIMITS);
    let result: VoiceResult;
    if ("error" in read) result = { kind, failure: failureOf(read.status) };
    else {
      try {
        const file = new File([new Uint8Array(read.bytes)], `${kind}.${types[read.type] ?? "mp4"}`, { type: read.type });
        result = { kind, transcript: await withAiUsage(businessId, () => transcribeAudio(file)) };
      } catch { result = { kind, failure: "failed" }; }
    }
    media[index] = { ...item, ...(result.transcript ? { transcript: result.transcript } : { transcriptFailure: result.failure }) };
    changed = true;
    results.push(result);
  }
  if (changed) await db.from("messages").update({ media }).eq("id", messageId).eq("business_id", businessId);
  return results;
}

/** The message the agent reads: the customer's text with what each voice message or video says, or that it could not be heard. */
export function messageWithVoice(text: string | null | undefined, results: VoiceResult[]) {
  const parts = results.map(r => r.transcript
    ? `[${r.kind === "audio" ? "Mesazh zanor" : "Video"} i klientit, i transkriptuar] ${r.transcript}`
    : `[${r.kind === "audio" ? "Mesazh zanor" : "Video"} i klientit që nuk u dëgjua (${r.failure}); kërkoji klientit ta shkruajë.]`);
  return [text?.trim(), ...parts].filter(Boolean).join("\n");
}
