import OpenAI from "openai";
import { agentModel } from "@/lib/agents/generate";

export async function completeText(params: {
  instructions: string;
  input: string;
  maxChars?: number;
}): Promise<
  | { ok: true; text: string }
  | { ok: false; error: string; reason: "missing_api_key" | "provider_error" | "empty" }
> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      ok: false,
      error: "AI nuk është konfiguruar (mungon OPENAI_API_KEY).",
      reason: "missing_api_key",
    };
  }
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: agentModel(),
      instructions: params.instructions,
      input: params.input,
    });
    let text = response.output_text?.trim() ?? "";
    text = text.replace(/^["'«»]|["'«»]$/g, "").trim();
    if (!text) {
      return { ok: false, error: "AI nuk ktheu tekst. Provo përsëri.", reason: "empty" };
    }
    const max = params.maxChars ?? 400;
    if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
    return { ok: true, text };
  } catch (err) {
    console.error(
      "[ai.complete]",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: "Gjenerimi dështoi. Provo përsëri pas pak.",
      reason: "provider_error",
    };
  }
}
