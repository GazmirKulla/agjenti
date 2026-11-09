import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { agentModel } from "@/lib/agents/model";
import { effectiveModel, requestModel, rewriteRequestModel } from "./model-choice";

const scope = new AsyncLocalStorage<{ businessId?: string }>();

/** Attributes every OpenAI request made while `work` runs to `businessId`.
 * Without an id the enclosing attribution is kept until `attributeAiUsage` names the business. */
export function withAiUsage<T>(businessId: string | undefined, work: () => T): T {
  return scope.run({ businessId: businessId ?? aiUsageBusiness() }, work);
}

/** Names the business once an entry point has authorized it, for the rest of the current scope. */
export function attributeAiUsage(businessId: string) {
  const store = scope.getStore();
  if (store) store.businessId = businessId;
}

/** Opens a metering scope for a request; `requireBusinessAccess` names the business inside it. */
export function meteredRoute<A extends unknown[], R>(handler: (...args: A) => Promise<R>) {
  return (...args: A) => withAiUsage(undefined, () => handler(...args));
}

export function aiUsageBusiness() {
  return scope.getStore()?.businessId;
}

type Usage = { model: string; input: number; output: number };
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/** Reads the usage block shared by Responses, Chat Completions, Embeddings and Audio. */
export function usageFrom(body: unknown): Usage {
  const value = (body && typeof body === "object" ? body : {}) as {
    model?: unknown;
    usage?: Record<string, unknown>;
  };
  const usage = value.usage ?? {};
  const input = count(usage.input_tokens) || count(usage.prompt_tokens);
  const output = count(usage.output_tokens) || count(usage.completion_tokens);
  return {
    model: typeof value.model === "string" ? value.model : "unknown",
    input,
    output: output || Math.max(count(usage.total_tokens) - input, 0),
  };
}

async function record(businessId: string, response: Response, path: string) {
  let body: unknown = null;
  if (response.headers.get("content-type")?.includes("application/json"))
    body = await response.json().catch(() => null);
  else await response.body?.cancel().catch(() => undefined);
  const usage = usageFrom(body);
  const { error } = await createServiceSupabase().rpc("record_ai_usage", {
    p_business: businessId,
    p_model: usage.model,
    p_input: usage.input,
    p_output: usage.output,
  });
  if (error) console.error("[ai.usage] not recorded", path, error.message);
}

/** Counts successful OpenAI requests without delaying or failing the caller. */
export function meteredFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    // The administrator's model choice (per business, else platform) replaces the standard model.
    const standard = agentModel();
    if (requestModel(init) === standard) init = rewriteRequestModel(init, standard, await effectiveModel(aiUsageBusiness()));
    const response = await inner(input, init);
    if (!response.ok) return response;
    const path = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    ).pathname;
    const businessId = aiUsageBusiness();
    if (!businessId) {
      console.warn("[ai.usage] request without business", path);
      return response;
    }
    const pending = record(businessId, response.clone(), path).catch((error) =>
      console.error("[ai.usage] not recorded", path, error instanceof Error ? error.message : error),
    );
    try {
      after(pending);
    } catch {
      // Outside a request (scripts, tests) the promise simply completes on its own.
    }
    return response;
  };
}
