import OpenAI, { toFile } from "openai";
export async function transcribeAudio(
  file: File,
  client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60_000,
    maxRetries: 0,
  }),
) {
  const transcription = await client.audio.transcriptions.create({
    model:
      process.env.ONBOARDING_TRANSCRIPTION_MODEL?.trim() ||
      "gpt-4o-mini-transcribe",
    file: await toFile(await file.arrayBuffer(), file.name, {
      type: file.type,
    }),
    response_format: "json",
  });
  const transcript = transcription.text.trim();
  if (transcript.length < 3 || transcript.length > 12000)
    throw new Error("empty_transcript");
  return transcript;
}
