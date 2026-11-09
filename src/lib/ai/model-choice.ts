import { agentModel, roleOf, type ModelRole } from "@/lib/agents/model";
import { createServiceSupabase } from "@/lib/supabase/service";

/** Valid OpenAI model id shape; the database enforces the same pattern. */
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
/** Suggestions in the admin form; any model the OpenAI account can use is accepted. */
export const MODEL_SUGGESTIONS = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini"];
export const ROLE_LABELS: Record<ModelRole, string> = {
  customer: "Përgjigjet për klientët",
  assistant: "Asistenti",
  utility: "Kontrollet e brendshme",
};
export const DEFAULT_TIER = "high";

export type ModelTier = { id: string; label: string; position: number } & Record<`${ModelRole}_model`, string | null>;

const TTL = 30_000;
let tiersCache: { tiers: ModelTier[]; platformTier: string; at: number } | null = null;
const businessTier = new Map<string, { tier: string | null; at: number }>();

export function clearModelChoiceCache() {
  tiersCache = null;
  businessTier.clear();
}

const validModel = (value: unknown) => (typeof value === "string" && MODEL_PATTERN.test(value) ? value : null);

export async function loadModelTiers(): Promise<{ tiers: ModelTier[]; platformTier: string }> {
  if (tiersCache && Date.now() - tiersCache.at < TTL) return tiersCache;
  const db = createServiceSupabase();
  const [tiers, settings] = await Promise.all([
    db.from("model_tiers").select("id,label,position,customer_model,assistant_model,utility_model").order("position"),
    db.from("app_settings").select("model_tier").eq("id", true).maybeSingle(),
  ]);
  const list = (tiers.error ? [] : tiers.data ?? []).map((t) => ({
    id: String(t.id), label: String(t.label), position: Number(t.position) || 0,
    customer_model: validModel(t.customer_model), assistant_model: validModel(t.assistant_model), utility_model: validModel(t.utility_model),
  }));
  const platformTier = !settings.error && typeof settings.data?.model_tier === "string" ? settings.data.model_tier : DEFAULT_TIER;
  tiersCache = { tiers: list, platformTier, at: Date.now() };
  return tiersCache;
}

async function tierOfBusiness(businessId: string) {
  const cached = businessTier.get(businessId);
  if (cached && Date.now() - cached.at < TTL) return cached.tier;
  const { data, error } = await createServiceSupabase().from("businesses").select("model_tier").eq("id", businessId).maybeSingle();
  const tier = !error && typeof data?.model_tier === "string" ? data.model_tier : null;
  businessTier.set(businessId, { tier, at: Date.now() });
  return tier;
}

/** The model for a kind of work in a group; an empty slot uses the server default. */
export function tierModel(tier: ModelTier | undefined, role: ModelRole) {
  return tier?.[`${role}_model`] ?? agentModel();
}

/** The group a business uses (its own, else the platform's) and that group's model for `role`. */
export async function effectiveModel(businessId: string | undefined, role: ModelRole) {
  try {
    const { tiers, platformTier } = await loadModelTiers();
    const id = (businessId ? await tierOfBusiness(businessId) : null) ?? platformTier;
    return tierModel(tiers.find((t) => t.id === id) ?? tiers.find((t) => t.id === platformTier), role);
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

/** Replaces the placeholder model of a request with the chosen model. */
export function rewriteRequestModel(init: RequestInit | undefined, chosen: string): RequestInit | undefined {
  if (!init || typeof init.body !== "string") return init;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body);
  } catch {
    return init;
  }
  if (!body || typeof body !== "object" || !roleOf(body.model)) return init;
  return { ...init, body: JSON.stringify({ ...body, model: chosen }) };
}

/** Checks with OpenAI that the account can use a model, before an admin saves it. */
export async function verifyModel(model: string): Promise<string | null> {
  if (!MODEL_PATTERN.test(model)) return `"${model}" nuk është emër i vlefshëm modeli.`;
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return `Modeli "${model}" nuk ekziston ose nuk është i disponueshëm për këtë llogari OpenAI.`;
    if (!response.ok) return `Modeli "${model}" nuk u verifikua te OpenAI. Provo përsëri.`;
    return null;
  } catch {
    return `Modeli "${model}" nuk u verifikua te OpenAI. Provo përsëri.`;
  }
}
