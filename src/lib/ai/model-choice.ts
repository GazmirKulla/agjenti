import { agentModel } from "@/lib/agents/model";
import { createServiceSupabase } from "@/lib/supabase/service";

/** Valid OpenAI model id shape; the database enforces the same pattern. */
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
/** Suggestions in the admin form; any model the OpenAI account can use is accepted. */
export const MODEL_SUGGESTIONS = ["gpt-5.6-luna", "gpt-5.5", "gpt-5.5-mini", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"];

const TTL = 30_000;
let platform: { model: string | null; at: number } | null = null;
const perBusiness = new Map<string, { model: string | null; at: number }>();

export function clearModelChoiceCache() {
  platform = null;
  perBusiness.clear();
}

async function platformModel() {
  if (platform && Date.now() - platform.at < TTL) return platform.model;
  const { data, error } = await createServiceSupabase().from("app_settings").select("ai_model").eq("id", true).maybeSingle();
  // Before the migration the column is missing: keep the environment default.
  const model = !error && typeof data?.ai_model === "string" && MODEL_PATTERN.test(data.ai_model) ? data.ai_model : null;
  platform = { model, at: Date.now() };
  return model;
}

async function businessModel(businessId: string) {
  const cached = perBusiness.get(businessId);
  if (cached && Date.now() - cached.at < TTL) return cached.model;
  const { data, error } = await createServiceSupabase().from("businesses").select("ai_model").eq("id", businessId).maybeSingle();
  const model = !error && typeof data?.ai_model === "string" && MODEL_PATTERN.test(data.ai_model) ? data.ai_model : null;
  perBusiness.set(businessId, { model, at: Date.now() });
  return model;
}

/** The model a business's AI requests use: its override, else the platform setting, else the environment default. */
export async function effectiveModel(businessId?: string) {
  try {
    return (businessId ? await businessModel(businessId) : null) ?? (await platformModel()) ?? agentModel();
  } catch {
    return agentModel();
  }
}

/** The model named in a JSON OpenAI request body, if any. */
export function requestModel(init: RequestInit | undefined): string | null {
  if (!init || typeof init.body !== "string" || !init.body.includes('"model"')) return null;
  try {
    const body = JSON.parse(init.body);
    return body && typeof body.model === "string" ? body.model : null;
  } catch {
    return null;
  }
}

/** Swaps the standard chat model in an OpenAI request body for the chosen one.
 * Requests that name a specific model (embeddings, transcription, vision) are untouched. */
export function rewriteRequestModel(init: RequestInit | undefined, standard: string, chosen: string): RequestInit | undefined {
  if (!init || typeof init.body !== "string" || chosen === standard) return init;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body);
  } catch {
    return init;
  }
  if (!body || typeof body !== "object" || body.model !== standard) return init;
  return { ...init, body: JSON.stringify({ ...body, model: chosen }) };
}

/** Checks with OpenAI that the account can use a model, before an admin saves it. */
export async function verifyModel(model: string): Promise<string | null> {
  if (!MODEL_PATTERN.test(model)) return "Emri i modelit nuk është i vlefshëm.";
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return `Modeli "${model}" nuk ekziston ose nuk është i disponueshëm për këtë llogari OpenAI.`;
    if (!response.ok) return "Modeli nuk u verifikua te OpenAI. Provo përsëri.";
    return null;
  } catch {
    return "Modeli nuk u verifikua te OpenAI. Provo përsëri.";
  }
}
